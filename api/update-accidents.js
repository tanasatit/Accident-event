export default async function handler(req, res) {
  // Vercel Cron sends GET; allow manual POST triggers too
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Protect against unauthorized calls
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  const githubToken  = process.env.GITHUB_TOKEN;
  const githubRepo   = process.env.GITHUB_REPO;
  const githubBranch = process.env.GITHUB_BRANCH || 'main';
  if (!githubToken || !githubRepo) {
    return res.status(500).json({ error: 'GITHUB_TOKEN or GITHUB_REPO not set' });
  }

  // 1. Ask Gemini (with Google Search grounding) for last week's industrial accidents
  // Allow ?from=YYYY-MM-DD&to=YYYY-MM-DD for manual testing of specific date ranges
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const fromDate = (req.query?.from) || weekAgo.toISOString().slice(0, 10);
  const toDate   = (req.query?.to)   || today.toISOString().slice(0, 10);

  const prompt = `You are a data extraction assistant. Search the web for major industrial accidents \
(explosions, fires, chemical leaks, structural collapses at factories, plants, refineries, mines, or warehouses) \
that occurred worldwide between ${fromDate} and ${toDate}.

CRITICAL RULES:
- Return ONLY a raw JSON array. No markdown, no code fences, no explanation text.
- Do NOT include any citation markers, [cite:], [1], footnotes, or reference annotations anywhere inside the JSON.
- All string values must be plain text with no special markers.

Each element must have exactly these fields:
{
  "date": "YYYY-MM-DD",
  "location": "Site/City, Country",
  "country": "English country name",
  "lat": <decimal number>,
  "lng": <decimal number>,
  "event": "<2-3 sentence Thai description of what happened and the cause if known>",
  "fatalities": <integer, 0 if unknown>,
  "injuries": <integer, 0 if unknown>,
  "reference": "<direct URL to a reliable news source>"
}

Include only confirmed events with a verifiable news source URL. Return [] if none found.`;

  let newRecords = [];
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
        })
      }
    );
    if (!geminiRes.ok) {
      const txt = await geminiRes.text();
      return res.status(502).json({ error: `Gemini error ${geminiRes.status}`, detail: txt });
    }
    const geminiData = await geminiRes.json();
    // gemini-2.5-flash outputs thinking parts (thought:true) before the actual answer — skip them
    // Also deduplicate identical parts (grounding sometimes returns the same chunk twice)
    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const seen = new Set();
    const uniqueParts = parts.filter(p => {
      if (p.thought) return false;
      const key = p.text || '';
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const raw = uniqueParts.map(p => p.text || '').join('');

    // Strip markdown fences and Gemini grounding citation markers ([cite: "..."], [1], etc.)
    const stripped = raw
      .replace(/```(?:json)?/gi, '').replace(/```/g, '')
      .replace(/\[cite:[^\]]*\]/g, '')
      .replace(/\[cite_start\]|\[cite_end\]/g, '');

    // Extract JSON array — handle truncated responses by falling back to last complete object
    const arrayStart = stripped.indexOf('[');
    let parsed = null;
    if (arrayStart !== -1) {
      const chunk = stripped.slice(arrayStart);
      // Try full parse first
      const fullEnd = chunk.lastIndexOf(']');
      if (fullEnd !== -1) {
        try { parsed = JSON.parse(chunk.slice(0, fullEnd + 1)); } catch (_) {}
      }
      // If truncated (no closing ']'), close the array after the last complete object
      if (!parsed) {
        const lastObj = chunk.lastIndexOf('},');
        if (lastObj !== -1) {
          try { parsed = JSON.parse(chunk.slice(0, lastObj + 1) + ']'); } catch (_) {}
        }
      }
    }

    // Debug mode: return full raw response to inspect what Gemini actually sent
    if (req.query?.debug === '1') {
      return res.status(200).json({ debug: true, parts: parts.map(p => ({ thought: p.thought, textLength: p.text?.length, text: p.text })) });
    }

    if (!parsed) {
      return res.status(500).json({ error: 'Gemini returned no valid JSON array', raw: stripped.slice(0, 500) });
    }
    newRecords = parsed;
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get/parse Gemini response', detail: err.message });
  }

  // 2. Fetch current accidents.json from GitHub
  const ghHeaders = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'accident-events-updater'
  };
  const contentsUrl = `https://api.github.com/repos/${githubRepo}/contents/data/accidents.json`;
  let existing = [];
  let fileSha = '';
  try {
    const ghRes = await fetch(`${contentsUrl}?ref=${githubBranch}`, { headers: ghHeaders });
    if (!ghRes.ok) return res.status(502).json({ error: `GitHub fetch failed: ${ghRes.status}` });
    const ghData = await ghRes.json();
    fileSha = ghData.sha;
    existing = JSON.parse(Buffer.from(ghData.content, 'base64').toString('utf8'));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read accidents.json from GitHub', detail: err.message });
  }

  // 3. Deduplicate by (date + location) and assign sequential IDs
  const existingKeys = new Set(existing.map(a => `${a.date}|${a.location}`));
  const maxId = existing.reduce((m, a) => Math.max(m, a.id || 0), 0);
  let nextId = maxId + 1;
  const toAdd = [];
  for (const r of newRecords) {
    if (!r.date || !r.location) continue;
    const key = `${r.date}|${r.location}`;
    if (existingKeys.has(key)) continue;
    toAdd.push({ id: nextId++, ...r });
    existingKeys.add(key);
  }

  if (toAdd.length === 0) {
    return res.status(200).json({ added: 0, total: existing.length, message: 'No new accidents found' });
  }

  // Sort newest first
  const updated = [...existing, ...toAdd].sort((a, b) => (a.date < b.date ? 1 : -1));

  // 4. Commit updated file to GitHub
  const newContent = Buffer.from(JSON.stringify(updated, null, 2)).toString('base64');
  try {
    const putRes = await fetch(contentsUrl, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `chore: auto-update accidents data (${toAdd.length} new record${toAdd.length > 1 ? 's' : ''})`,
        content: newContent,
        sha: fileSha,
        branch: githubBranch
      })
    });
    if (!putRes.ok) {
      const txt = await putRes.text();
      return res.status(502).json({ error: `GitHub commit failed: ${putRes.status}`, detail: txt });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to commit to GitHub', detail: err.message });
  }

  return res.status(200).json({ added: toAdd.length, total: updated.length });
}
