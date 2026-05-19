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
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const fromDate = weekAgo.toISOString().slice(0, 10);
  const toDate   = today.toISOString().slice(0, 10);

  const prompt = `You are a data extraction assistant. Search the web for major industrial accidents \
(explosions, fires, chemical leaks, structural collapses at factories, plants, refineries, mines, or warehouses) \
that occurred worldwide between ${fromDate} and ${toDate}.

Return ONLY a valid JSON array with no markdown fences. Each element must have exactly these fields:
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
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
        })
      }
    );
    if (!geminiRes.ok) {
      const txt = await geminiRes.text();
      return res.status(502).json({ error: `Gemini error ${geminiRes.status}`, detail: txt });
    }
    const geminiData = await geminiRes.json();
    // Collect all text parts (gemini-2.5-flash may split thinking + answer)
    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    const raw = parts.map(p => p.text || '').join('');
    // Extract the first [...] JSON array found anywhere in the response
    const match = raw.match(/\[[\s\S]*\]/);
    newRecords = match ? JSON.parse(match[0]) : [];
    if (!Array.isArray(newRecords)) newRecords = [];
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
