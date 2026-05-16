export default async function handler(req, res) {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'อนุญาตเฉพาะ POST method เท่านั้น' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ไม่พบ GEMINI_API_KEY กรุณาตั้งค่า Environment Variable ใน Vercel Dashboard' });
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

  const totalFatalities = accidents.reduce((s, a) => s + a.fatalities, 0);
  const totalInjuries   = accidents.reduce((s, a) => s + a.injuries, 0);

  const accidentList = accidents.map(a =>
    `เหตุการณ์ที่ ${a.id}: ${a.date} — ${a.location}\nเหตุการณ์: ${a.event}\nผลกระทบ: เสียชีวิต ${a.fatalities} ราย บาดเจ็บ ${a.injuries} ราย`
  ).join('\n\n');

  const prompt = `คุณเป็นผู้เชี่ยวชาญด้านความปลอดภัยในอุตสาหกรรม (Safety Engineer) ระดับอาวุโส

กรุณาสรุปเหตุการณ์อุบัติเหตุอุตสาหกรรมรายใหญ่ทั่วโลกต่อไปนี้เป็นภาษาไทย 2-3 ย่อหน้า โดย:
1. ระบุภาพรวมจำนวนเหตุการณ์ทั้งหมด ผู้เสียชีวิต และผู้บาดเจ็บ
2. เน้นเหตุการณ์ที่มีความรุนแรงสูงสุด
3. วิเคราะห์ประเภทอุบัติเหตุที่พบบ่อย (ระเบิด/ไฟไหม้/สารเคมี ฯลฯ)
4. ระบุภูมิภาคหรือประเทศที่ได้รับผลกระทบมากที่สุด
5. ใช้ภาษาทางการ เหมาะสำหรับรายงานความปลอดภัยระดับองค์กร

สถิติรวม: เหตุการณ์ทั้งหมด ${accidents.length} ครั้ง ผู้เสียชีวิตรวม ${totalFatalities} ราย ผู้บาดเจ็บรวม ${totalInjuries} ราย

รายละเอียดเหตุการณ์:
${accidentList}`;

  try {
    const geminiRes = await fetch(
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

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', errText);
      return res.status(502).json({ error: `Gemini API ตอบกลับผิดพลาด: ${geminiRes.status}` });
    }

    const data = await geminiRes.json();
    const summary = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!summary) return res.status(502).json({ error: 'ไม่สามารถรับข้อมูลสรุปจาก Gemini ได้' });

    return res.status(200).json({ summary });
  } catch (error) {
    console.error('Summarize handler error:', error);
    return res.status(500).json({ error: `เกิดข้อผิดพลาดในการเชื่อมต่อ: ${error.message}` });
  }
}
