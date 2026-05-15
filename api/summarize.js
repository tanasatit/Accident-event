export default async function handler(req, res) {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ไม่พบ API key กรุณาตั้งค่า GEMINI_API_KEY ใน Vercel Environment Variables' });
  }

  const { accidents, month, year } = req.body;
  if (!accidents || !Array.isArray(accidents)) {
    return res.status(400).json({ error: 'ข้อมูลอุบัติเหตุไม่ถูกต้อง' });
  }
  if (typeof month !== 'string' || month.length > 20) {
    return res.status(400).json({ error: 'ข้อมูลเดือนไม่ถูกต้อง' });
  }
  if (typeof year !== 'number' || year < 2500 || year > 2700) {
    return res.status(400).json({ error: 'ข้อมูลปีไม่ถูกต้อง' });
  }

  const accidentList = accidents.map((a, i) =>
    `${i + 1}. วันที่ ${a.date} — ${a.location}: ${a.event} (ผู้เสียชีวิต ${a.fatalities} ราย, บาดเจ็บ ${a.injuries} ราย)`
  ).join('\n');

  const prompt = `คุณเป็นผู้เชี่ยวชาญด้านความปลอดภัยอุตสาหกรรม กรุณาสรุปรายงานอุบัติเหตุอุตสาหกรรมโลกประจำเดือน${month} พ.ศ. ${year} จากข้อมูลต่อไปนี้:

${accidentList}

กรุณาเขียนสรุปเป็นภาษาไทย 2-3 ย่อหน้า ในรูปแบบรายงานวิชาชีพสำหรับทีมวิศวกรรมความปลอดภัย โดยระบุ:
1. ภาพรวมของอุบัติเหตุที่เกิดขึ้นในช่วงเดือนนี้
2. เหตุการณ์ที่รุนแรงที่สุดและสาเหตุหลัก
3. ประเภทอุบัติเหตุที่พบบ่อยและภูมิภาคที่ได้รับผลกระทบมากที่สุด`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1024 }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', errText);
      return res.status(502).json({ error: 'ไม่สามารถเชื่อมต่อกับ Gemini API ได้ กรุณาลองใหม่อีกครั้ง' });
    }

    const data = await response.json();
    const summary = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!summary) {
      return res.status(502).json({ error: 'ไม่ได้รับข้อมูลสรุปจาก AI กรุณาลองใหม่อีกครั้ง' });
    }

    return res.status(200).json({ summary });
  } catch (err) {
    console.error('Summarize handler error:', err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง' });
  }
}
