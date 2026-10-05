import {withTransaction} from './db/pool.mjs';
import {readPlace} from './places.mjs';
import {SCOPE_SQL} from './visit-plans.mjs';

const INTEREST = new Set(['สนใจมาก', 'สนใจ', 'ขอคิดดู', 'ไม่สนใจ']);
const OUTCOME = new Set(['ต้องติดตามต่อ', 'พร้อมปิดดีล', 'ปิดการขาย']);
const CANCEL_REASONS = new Set(['ไม่สะดวกช่วงนี้', 'ราคาไม่ตรง', 'ติดคู่แข่ง', 'ปิดกิจการ', 'ติดต่อไม่ได้', 'อื่น ๆ']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = 500;
const MAX_BACK_DAYS = 365;
const DAY = 864e5;

const fail = (status, message) => Object.assign(new Error(message), {status});
const bangkokToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

function readRound(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'อ่านคำขอไม่ได้');
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') throw fail(400, 'หมายเหตุต้องเป็นข้อความ');
  const note = (body.note || '').trim() || null;
  if (note && note.length > MAX_NOTE) throw fail(400, 'หมายเหตุยาวเกิน ' + MAX_NOTE + ' ตัวอักษร');
  const today = bangkokToday();

  if (body.status === 'ยกเลิก') {
    if (!CANCEL_REASONS.has(body.cancelReason)) throw fail(400, 'เหตุผลการยกเลิกไม่ถูกต้อง');
    return {status: 'ยกเลิก', doneDate: today, interest: null, outcome: null, cancelReason: body.cancelReason, note};
  }

  if (body.status === 'เสร็จสิ้น') {
    const d = body.doneDate === undefined || body.doneDate === null || body.doneDate === '' ? today : String(body.doneDate);
    const t = Date.parse(d + 'T00:00:00Z');
    if (!DATE_RE.test(d) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) throw fail(400, 'วันที่เข้าพบไม่ถูกต้อง ใช้รูปแบบ ปปปป-ดด-วว');
    if (d > today) throw fail(400, 'วันที่เข้าพบต้องไม่เกินวันนี้');
    if (Date.parse(today + 'T00:00:00Z') - t > MAX_BACK_DAYS * DAY) throw fail(400, 'วันที่เข้าพบย้อนหลังได้ไม่เกิน ' + MAX_BACK_DAYS + ' วัน');
    if (!INTEREST.has(body.interest)) throw fail(400, 'ระดับความสนใจไม่ถูกต้อง');
    let outcome = null;
    if (body.interest !== 'ไม่สนใจ') {
      if (!OUTCOME.has(body.outcome)) throw fail(400, 'ผลการเข้าพบไม่ถูกต้อง');
      outcome = body.outcome;
    }
    return {status: 'เสร็จสิ้น', doneDate: d, interest: body.interest, outcome, cancelReason: null, note};
  }

  throw fail(400, 'สถานะรอบต้องเป็น เสร็จสิ้น หรือ ยกเลิก');
}

export async function addPlaceVisit(pool, user, placeId, body) {
  if (typeof placeId !== 'string' || !placeId || placeId.length > 40) throw fail(400, 'ต้องระบุรหัสร้าน');
  const round = readRound(body);
  return withTransaction(pool, async tx => {
    const cur = (await tx.query(
      `select p.type, p.province in (${SCOPE_SQL}) as mine from places p where p.id = $2 and p.deleted_at is null for update`,
      [user.id, placeId])).rows[0];
    if (!cur) throw fail(404, 'ไม่พบร้านนี้');
    if (!cur.mine) throw fail(403, 'ร้านนี้อยู่นอกพื้นที่รับผิดชอบ');
    if (cur.type !== 'Prospect') throw fail(400, 'บันทึกการเข้าพบได้เฉพาะ Lead');
    const next = (await tx.query('select coalesce(max(round), 0)::int + 1 as n from place_visits where place_id = $1', [placeId])).rows[0].n;
    await tx.query(
      `insert into place_visits (place_id, round, status, done_date, tc_id, interest, outcome, note, cancel_reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [placeId, next, round.status, round.doneDate, user.id, round.interest, round.outcome, round.note, round.cancelReason]);
    await tx.query(
      `update places set visit_status = case when exists (select 1 from place_visits where place_id = $1 and status = 'เสร็จสิ้น')
         then 'ครอบคลุมแล้ว' else 'ยังไม่เข้าพบ' end where id = $1`, [placeId]);
    return {ok: true, round: next, record: await readPlace(tx, placeId)};
  });
}
