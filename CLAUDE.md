<!-- standard: v3.3 — https://github.com/MazDev01/dev-standard -->

# CLAUDE.md — geo-intelligence

## Stack

- **buildless** — ไม่มี `package.json` · ไม่มี `node_modules` · ไม่มีขั้นตอน build
- ES modules โหลดตรงจากเบราว์เซอร์ผ่าน `importmap` ใน `index.html`
- Leaflet 1.9.4 + markercluster จาก unpkg (CDN) · htm/React แบบไม่มี JSX
- Node (ESM) สำหรับ `server.mjs` และสคริปต์ท้ายไฟล์นี้

## Commands

| งาน | คำสั่ง | เวลาจริง |
|---|---|---|
| dev server | `node server.mjs` → `http://localhost:5173` | ตอบ 200 ใน ~0.7 วิ |
| ตรวจ syntax | `node --experimental-vm-modules checkall.mjs` | **393 ms** · 39 ไฟล์ |
| **ตรวจว่าเรนเดอร์จริง** | ดูบล็อกใต้ตาราง | **~74 วินาที ต่อหน้า** (ต้องมี `timeout`) |
| build เวอร์ชันแจก | `node build-dist.mjs` | **454 ms** |
| test · lint · type-check | **ไม่มี** | — |

เข้าหน้า admin: `http://localhost:5173/?demo=admin&go=<page>`

### ด่านที่สอง — ยืนยันว่าเรนเดอร์จริง (ไม่ใช่แค่ compile ผ่าน)

ไม่มี puppeteer/playwright ในโปรเจกต์ **แต่ใช้ Chrome ที่ติดตั้งอยู่แล้วได้เลย**

```bash
node server.mjs &                      # พอร์ต 5173
timeout 60 "C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu   --no-sandbox --user-data-dir="$(mktemp -d)"   --virtual-time-budget=15000 --dump-dom "http://localhost:5173/?demo=admin&go=<page>"
```

⚠️ **ต้องมี `timeout` และ `--user-data-dir`** — วัดแล้ว Chrome พ่น DOM ครบแล้ว**ไม่ยอมจบโปรเซส**
ไม่ใส่ `timeout` = ค้างยาว (เจอจริง เกิน 2 นาทีถึงโดนตัด) · ใส่แล้วได้ DOM ครบใน 74 วิ
**และ exit code ใช้ตัดสินไม่ได้** — สำเร็จก็ยังได้ `124` เพราะโดน `timeout` ฆ่า ให้ดูที่ DOM อย่างเดียว

⚠️ **ห้ามถ่ายสกรีนช็อตแล้วอ่านรูปกลับเข้ามา** — วัดจริงในงานหนึ่ง: 7 รูป = **2.4 MB ≈ 600k โทเคน**
ดัน context จาก ~250k เป็น **852k** ทำให้ 118 เทิร์นสุดท้ายราคาพุ่งเป็น 95k/เทิร์น (รวม 11.2 ล้าน)

**ใช้แบบนับแทน — ได้เลขตัวเดียว ราคาเกือบศูนย์**

```bash
... --dump-dom "http://localhost:5173/?demo=admin&go=<page>" | grep -o '<[a-z]' | wc -l
```

⚠️ ต้องเป็น `grep -o ... | wc -l` (นับ**แท็ก**) — `grep -c` นับ**บรรทัด** ซึ่งผิด
DOM ของแอปนี้อยู่บนไม่กี่บรรทัดยาว ๆ `grep -c` จึงได้ 24–27 ทุกหน้าแม้หน้าปกติดี **ทำให้สรุปผิดว่าพังหมด**

**ค่าจริงที่วัดแล้ว 11 หน้า × 3 บทบาท — ปกติทุกหน้า**

```
territory 767 · TC/reports 706 · audit 644 · reports 518 · management/reports 477
users 472 · monitoring 384 · TC 316 · config 276 · data-management 216 · management 127
```

หลักร้อย = ปกติ · หลักสิบต้น ๆ = น่าสงสัย
(เลขพวกนี้ขยับตามโค้ด — `territory` วัดซ้ำได้ 792 ไม่ใช่ 767 ใช้ดูแค่ "หลักร้อยหรือหลักสิบ" พอ)

### ⛔ ด่านนับกับด่าน root **ผ่านทั้งคู่ตอนเซิร์ฟเวอร์ไม่ได้รัน**

วัดจริงกับพอร์ตที่ไม่มีอะไรฟัง — Chrome พ่นหน้า error ของตัวเองออกมา:

| | เซิร์ฟเวอร์ตาย | หน้าจริง |
|---|---|---|
| exit code | 0 | 0 (หรือ 124) |
| นับแท็ก | **115** ← "หลักร้อย" = ผ่าน | 792 |
| `<div id="root"></div>` | **ไม่โผล่** ← "ไม่โผล่ = เรนเดอร์แล้ว" = ผ่าน | ไม่โผล่ |
| `class="shell"` | **0** | **1** |

115 อยู่ย่านเดียวกับ `management 127` ซึ่งเป็นหน้าจริงที่ต่ำสุด — **แยกด้วยตัวเลขไม่ได้**

**ต้องเช็คด้วย marker เชิงบวก:**

```bash
... --dump-dom "..." | grep -c 'class="shell"'      # 1 = แอป mount จริง · 0 = ไม่ผ่าน
```

ใช้ `shell` ได้เพราะมันถูกสร้างตอนรันไทม์ที่ [src/app.js:498](src/app.js#L498) เท่านั้น
`index.html` มีแค่ `<div id="root"></div>` ว่าง ๆ (grep `class="shell"` ใน index.html ได้ 0)
= ถ้าเจอ แปลว่า JS รันแล้วจริง ไม่ใช่แค่ HTML ถูกเสิร์ฟ

**เช็ค `<div id="root"></div>` ยังใช้ได้ แต่ใช้ยืนยันขาเดียว** — โผล่ = **หน้าขาวแน่นอน**
ส่วน "ไม่โผล่" **ไม่ได้แปลว่าเรนเดอร์** เพราะหน้า error ของ Chrome ก็ไม่มี root เหมือนกัน

จะดู DOM เต็มก็ต่อเมื่อเลขผิดปกติ และให้ `grep` เฉพาะส่วนที่สงสัย ไม่ใช่ dump ทั้งก้อน
(DOM เต็มของหน้าปกติ ~306 KB · 780 element · วัดซ้ำได้ **74 วินาที** ไม่ใช่ 8 — Chrome ไม่ยอมจบเอง)

```
เรนเดอร์จริง   <div id="root"><div class="shell"><aside class="sidebar">...
หน้าขาว        <div id="root"></div>          ← ว่างเปล่า
```


## Gotchas

| กับดัก | เกิดอะไร | ทางที่ถูก |
|---|---|---|
| **`checkall.mjs` ผ่าน ≠ หน้าไม่ขาว** | ตรวจแค่ว่า *compile ได้ในโหมด module* ไม่ได้ execute — backtick หลงใน `` html`...` `` หรือ `${}` ซ้อนใน `style=${{...}}` **ผ่านฉลุยแต่จอขาว** | ต้องผ่านด่านที่สองเสมอ (บล็อกใต้ตาราง Commands) |
| **`node --check` ใช้ไม่ได้** | มัน parse เป็น "script goal" → ตายที่ `import` บรรทัดแรก แล้ว **รายงานว่าผ่าน** | ต้อง `--experimental-vm-modules` เสมอ |
| **ไม่มี `package.json`** | สั่ง `npm install` / `npm run <script>` / หา script — ไม่มีให้หา | รันไฟล์ `.mjs` ตรง ๆ |
| **ไฟล์ข้อมูลใหญ่มาก** | `thailand-provinces.geojson` 1.2 MB (**~297k โทเคน**) · `prospects.json` 910 KB (~232k) · `customers.json` 821 KB (~205k) — อ่านทั้งก้อนครั้งเดียวทะลุเกณฑ์เตือน 150k ทันที | **อย่า `Read` ไฟล์ใน `data/`** ใช้ `node -e` คำนวณแล้วพิมพ์เฉพาะคำตอบ |
| **พึ่ง CDN unpkg** | ไม่มีเน็ต = แผนที่ไม่ขึ้น แต่ syntax check ยังผ่าน | ถ้าหน้าเพี้ยนให้เช็คเน็ต/CDN ก่อนแก้โค้ด |

## Slow / Hanging Commands

**ไม่มี** — ทุกคำสั่งจบใต้ 1 วินาที (ไม่มี node_modules ให้สแกน)

`grep -r` ทั้งโปรเจกต์ = 1.9 วินาที · `rg` = 282 ms — ต่างกันน้อยพอที่จะใช้อันไหนก็ได้

## Structure / Conventions

- โค้ดแอปอยู่ใน `src/` ทั้งหมด — ไฟล์ใหญ่สุดคือ `app.js` (687 บรรทัด) · `lmap.js` (611) · `panels.js` (456)
- `server.mjs` พอร์ต **5173** (ฝังตายในไฟล์ ไม่ใช่ env) — เสิร์ฟ static **+ มี `/api/visit-plans` ที่บังคับสิทธิ์** (ดู Security)
- `checkall.mjs` รับ argument เป็นโฟลเดอร์ ค่าตั้งต้นคือ `src`
- ข้อมูลอยู่ใน `data/` · แผนที่ฐานใน `basemap/` (Protomaps vector tiles แบบโฮสต์เอง)

**ตอบคำถามเกี่ยวกับข้อมูล ให้เขียนสคริปต์ ไม่ใช่อ่านไฟล์**

```bash
node -e "const d=require('./data/customers.json');
console.log('แถว:', d.length, '| คอลัมน์:', Object.keys(d[0]).join(', '));
for(const k of Object.keys(d[0])) console.log(k, 'ว่าง', d.filter(r=>!r[k]).length, 'แถว');"
```

ได้คำตอบครบด้วยผลลัพธ์ **< 1 KB** แทนที่จะเป็น 205k โทเคน

## Security

⚠️ **`server.mjs` ไม่ได้เสิร์ฟ static ล้วน — มี API ที่บังคับสิทธิ์อยู่ 1 ตัว**

`GET /api/visit-plans` (`server.mjs:29`) คือ **จุดเดียวในระบบที่ตรวจสิทธิ์ฝั่งเซิร์ฟเวอร์**
ที่เหลือทั้งหมดเป็นการซ่อน UI ฝั่ง client ซึ่งข้ามได้ด้วย devtools

| เงื่อนไข | ตอบ |
|---|---|
| ไม่มี `Authorization: Bearer` | **401** |
| `role` ไม่ใช่ `Trade Coordinator` | **403** |
| ขอแผนของ `owner` คนอื่น | **403** |
| ขอข้าม `province` | **403** |

โทเคนคือ `base64({email, role, province})` — **ไม่ได้เซ็น ปลอมได้ง่าย** เป็นของสาธิต ไม่ใช่ความปลอดภัยจริง
ฝั่งเรียกอยู่ที่ `src/pages/visit-plan-report.js:141`

**แก้ไฟล์นี้เมื่อไหร่ = กำลังแตะด่านสิทธิ์** ต้องรู้ตัว

---

- ไม่มี DB ไม่มี secret ในโปรเจกต์
- `?demo=admin` เป็นสวิตช์ฝั่งหน้าเว็บ **ไม่ใช่การยืนยันตัวตน** อย่าเอาไปใช้กันคนเข้าถึงข้อมูลจริง

## Optional Tools

- `build-dist.mjs` — สร้างเวอร์ชันแจก (454 ms)
- `gen.mjs` — สคริปต์สร้างข้อมูล
