# งานต่อ: ให้พื้นเทาบนแมพปิดตามโซนที่แอดมินลาก

## เป้าหมาย
แอดมินลากขอบโซน (SL/LP/TL ในกรุงเทพฯ) → TC ที่รับผิดชอบโซนนั้นเปิดแมพแล้ว
**พื้นสีเทาทึบปิดทุกอย่างนอกโซนของตัวเอง** เห็นเฉพาะพื้นที่ในเส้นที่แอดมินลาก

---

## ที่ทำเสร็จแล้ว (อย่าทำซ้ำ)

| ของ | ไฟล์ | สถานะ |
|---|---|---|
| รูปโซน 3 โซน / 27 เขต | `data/zones.geojson` (120 KB · 5,884 จุด) | ใช้ได้ ผ่าน gate ครบ |
| วาดโซนบนแมพ | `src/zone-layer.js` | ทำงานแล้ว ทุก role เห็น |
| โหมดลากขอบ + แผงปุ่มมุมขวาล่าง | `src/zone-editor.js` (เปิดด้วย `?edit=1`) | ลากได้ · ลดหมุด · undo · เซฟ |
| หาโซนจากพิกัด | `src/resolveZone.js` | เขียนเสร็จ **แต่ยังไม่ถูก import เข้าแอป** |
| เกตตรวจ assignment | `verify-zone-assign.mjs` + `zone-baseline.json` | baseline: อยู่ในโซน 552/852 · near-edge 6.1% · conflict 3.5% |
| UI ให้แอดมินมอบหมาย TC ↔ โซน | `src/pages/data-management.js` | **มีแล้ว** แต่ค่าไม่ถูกบันทึก |

---

## 4 ท่อนที่ต้องทำ (เรียงตามลำดับที่แนะนำ)

### ~~1. แก้ `BKK_ZONES` ให้ตรงกับ `zones.csv`~~ ✅ เสร็จแล้ว (15 ก.ย. 2569)
`src/mock/geoData.js:182` เป็น 27 เขตตรงกับ `zones.csv` แล้ว (SL 13 · LP 7 · TL 7)
`bkkZoneOf()` ตัดช่องว่าง/ตัวพิมพ์ก่อนเทียบ + แม็ป 3 ตัวที่เป็นคนละระบบถอดเสียง
(`Watthana→Vadhana` · `Bang Su→Bang Sue` · `Bung Kum→Bueng Kum`)
ผล: ลูกค้า/Lead ในกรุงเทพฯ ที่หาโซนเจอ **675 → 1,057 ราย** (48.5% → 75.9%)
อีก 23 เขตที่เหลือ **ตั้งใจให้ไม่มีโซน** (ไม่ได้อยู่ในแผนที่ที่ลูกค้าวาดมา) — อย่า "เติมให้ครบ 50 เขต"

### ~~2. บันทึกการมอบหมาย TC ↔ โซน ให้อยู่ถาวร~~ ✅ เสร็จแล้ว (15 ก.ย. 2569)
- `server.mjs` เพิ่ม `GET/POST /api/territory` → เก็บที่ `data/territory.json` (เขียน .tmp แล้ว rename)
- `src/territory-store.js` (ใหม่) — `loadTerritory()` / `saveTerritory(assign)`
- `data-management.js` โหลดตอน mount · เซฟทุกครั้งที่ `applyAssign()` · มี `loadedRef` กันเซฟทับก่อนโหลดเสร็จ
- ไม่มีของเก่า = fallback ไปใช้ `seedTerritory()` ตามเดิม
- ⚠ **ยังไม่มีการตรวจสิทธิ์ที่ endpoint นี้** — ใครยิงก็เขียนได้ ถ้าขึ้นใช้จริงต้องกั้นแบบ `/api/visit-plans`

### ~~3. ส่งโซนของ TC เข้าแมพเป็น `lockZone`~~ ✅ เสร็จแล้ว (16 ก.ย. 2569)
- `app.js` โหลด territory หลังล็อกอิน → คำนวณ `tcId` (จับคู่ email กับ `SEED_USERS`, fallback role+จังหวัด)
  → `lockZones` = อาเรย์ zone id ที่ TC คนนั้นถือ เช่น `["LP"]`
- ส่งผ่าน `app.js` → `stage.js` → `lmap.js` เป็น prop ชื่อ **`lockZones`** (พหูพจน์ — TC ถือได้หลายโซน)
- `lmap.js` เก็บไว้ที่ `M.current.lockZones` + ฟังก์ชัน `applyLockZones()` (ตอนนี้ใช้ `zones.setActive()` เน้นโซน)
- `lockZones = null` เมื่อ: ไม่ใช่ TC · ยังไม่เคยมอบหมาย · หรือถือครบทุกโซนในจังหวัด → พฤติกรรมเดิมทุกประการ

**⚠ กับดักที่เสียเวลาไปแล้วหนึ่งรอบ**: hook ใหม่ (`useMemo`/`useEffect`) ใน `App` **ต้องอยู่เหนือ early return ทุกตัว**
วางไว้ใกล้ ๆ `const isTC = ...` (บรรทัด ~540) จะได้ React error #310 หน้าขาวทั้งแอป — parse gate จับไม่ได้ ต้อง headless

### ~~4. แก้ `buildMask()` ให้เจาะรูจากโซน~~ ✅ เสร็จแล้ว (16 ก.ย. 2569)
`src/lmap.js` `buildMask()` เลือกแหล่งรูปเป็น `srcFeatures`:
- มี `m.lockZones` + โหลด `m.zonesGeo` แล้ว → เจาะรูจาก feature ที่ `zone_id` ตรง
- ไม่งั้น → รูปจังหวัดตามเดิม (รวมกรณีรูปโซนยังโหลดไม่เสร็จ ไม่งั้นแผ่นทึบบังทั้งจอ)
- `revealFeatures` (เส้นกรอบ + clip ป้ายชื่อ) ใช้ `srcFeatures` ตัวเดียวกัน ป้ายจึงถูก clip ตามโซนด้วย
- `m.outlineGeom` แคชเส้นขอบประเทศไว้ เพราะ `buildMask()` ถูกเรียกจาก 3 ที่แล้ว (mask effect · zone fetch · lockZones effect)
- effect ของ `lockZones` เทียบค่าด้วย `JSON.stringify` ก่อน กัน `buildMask` ทำงานซ้ำเมื่อ React ส่งอาเรย์ตัวใหม่ค่าเดิมมา

**ยังเหลือ (ถ้าจะทำต่อ)**: `POST /api/zones` ให้ปุ่มเซฟในโหมดลากขอบส่งไฟล์ขึ้นเซิร์ฟเวอร์เอง
ตอนนี้ยังต้องเอาไฟล์จาก Downloads ไปวางที่ `data/zones.geojson` ด้วยมือ

### (ถ้าอยากให้เส้นส่งถึงกันเอง) `POST /api/zones`
`server.mjs` ยาว 92 บรรทัด มี endpoint เดียว `GET /api/visit-plans` ไม่มี POST
ตอนนี้แอดมินกดเซฟ ไฟล์ลง Downloads ต้องเอาไปวางเอง — **วางที่ `data/` ไม่ใช่ `public/`**

---

## ข้อจำกัดของโปรเจกต์ (ห้ามลืม)

- **ไม่มี npm / package.json / bundler** — importmap + CDN ล้วน · Leaflet เป็น global จาก unpkg
- ไม่มี `import.meta.env` (นั่นของ Vite) — ใช้ query param `?edit=1` / `?perf=1` แทน
- ไม่มี DB ไม่มี secret · `?demo=admin` เป็น client-side switch **ไม่ใช่ auth**
- เสิร์ฟจาก `data/` ไม่มีโฟลเดอร์ `public/`
- `verify-zones.mjs:48` นับ **คอมมาใน JSON ไม่ใช่จุด** (≈2× จุดจริง) — `zone-editor.js` ใช้หน่วยจุดจริง เพดาน 20,000

## คำสั่งตรวจ

```bash
node --experimental-vm-modules checkall.mjs                            # parse gate 43 ไฟล์
node verify-zones.mjs                                                  # โครงสร้าง zones.geojson
node verify-zones-hit.mjs                                              # point-in-polygon 18 เคส
node verify-zone-assign.mjs data/customers.json --province "Bangkok"   # ใครย้าย/หลุดโซน
node server.mjs                                                        # พอร์ต 5173
```

**parse gate ไม่เท่ากับ render** — html`` ที่พังยัง parse ผ่านแต่ทำแอปขาว ต้อง headless verify ด้วย
Leaflet ไม่ mount ใน headless (มาจาก CDN) → ส่วนแมพต้องเปิดเบราว์เซอร์ดูเอง

## ตัวเลขที่ยืนยันแล้ว (ใช้อ้างอิงได้)

- ลูกค้ากรุงเทพฯ 852 ราย · Lead 540 ราย · **พิกัดครบ 100%** · ที่อยู่มีคำว่า "แขวง" **0%**
- ชื่อเขตกับพิกัดขัดกัน 11.5% — เป็นเรื่องขอบจริงแค่ 2.5% ที่เหลือคือ district ผิด
- 6 รายพิกัดหลุดต่างจังหวัด — อยู่ใน accept-list ของ `zone-baseline.json` แล้ว
- ลดจุดถึง 8% ยังไม่มีลูกค้าข้ามโซน (flip = 0) · แต่ `E.thin()` ทำให้ข้ามได้ (100 ม. = 1 ราย)
