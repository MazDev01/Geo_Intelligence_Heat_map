// Vercel serverless function — พอร์ตจาก server.mjs (/api/visit-plans)
// บังคับสิทธิ์จากโทเคนฝั่งเซิร์ฟเวอร์: ไม่มีโทเคน→401 · ไม่ใช่ TC→403 · ขอ owner/จังหวัดของคนอื่น→403
// โทเคนสาธิต: Authorization: Bearer base64({email,role,province})
export default function handler(req, res) {
  const send = (code, obj) => { res.setHeader('Cache-Control', 'no-store'); res.status(code).json(obj); };

  const auth = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  let tok = null;
  if (m) { try { tok = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch {} }

  if (!tok || !tok.email) return send(401, { error: 'unauthenticated', message: 'ต้องเข้าสู่ระบบก่อน' });
  if (tok.role !== 'Trade Coordinator') return send(403, { error: 'forbidden', message: 'เฉพาะผู้ประสานงานการค้าเท่านั้น' });

  const owner = req.query.owner;
  if (owner && owner !== tok.email) return send(403, { error: 'forbidden', message: 'เรียกดูได้เฉพาะแผนของตนเอง' });

  const prov = req.query.province;
  if (prov && prov !== tok.province) return send(403, { error: 'forbidden', message: 'เรียกดูได้เฉพาะจังหวัดที่รับผิดชอบ' });

  return send(200, { ok: true, owner: tok.email, province: tok.province });
}
