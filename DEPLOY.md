# คู่มือติดตั้ง GeoIntel บนเซิร์ฟเวอร์ลูกค้า

ทำตามทีละบรรทัด จากบนลงล่าง ห้ามข้ามขั้น ผลที่ต้องเห็นเขียนไว้ใต้คำสั่ง ถ้าไม่ตรงให้หยุด

## 0. ข้อมูลเครื่อง

| รายการ | ค่า |
|---|---|
| ระบบ | Ubuntu 24.04 · Docker แบบ rootless |
| ผู้ใช้ SSH | `heatmap` (ใช้กุญแจ · ไม่มี sudo) |
| โฟลเดอร์ติดตั้ง | `/home/heatmap/app` |
| ที่อยู่เว็บ | `https://heatmap.barterconnect.io` (Nginx ของลูกค้า ส่งต่อมาที่ `127.0.0.1:3000`) |
| กุญแจ SSH ฝั่งเรา | `C:\Users\Admin\.ssh\id_ed25519` |

ในคู่มือนี้ `<เซิร์ฟเวอร์>` = ชื่อหรือ IP ที่ลูกค้าให้ไว้สำหรับ SSH

ของที่ต้องอยู่บนเครื่องลูกค้ามี 4 อย่างเท่านั้น ไม่ต้องมีซอร์สโค้ด

```
/home/heatmap/app/geointel-images.tar
/home/heatmap/app/docker-compose.yml
/home/heatmap/app/.env
/home/heatmap/app/basemap/basemap-th.pmtiles
```

## 1. เตรียมไฟล์บนเครื่องเรา (PowerShell)

```powershell
cd "D:\New folder\Geo_Intelligence_Heat_map"
docker build -t geointel-app .
docker save geointel-app postgis/postgis:17-3.5 -o "$HOME\geointel-images.tar"
```

ต้องได้ไฟล์ `C:\Users\Admin\geointel-images.tar` ขนาดราว 290 MB (เก็บนอก repo โดยตั้งใจ ห้ามวางใน repo)

```powershell
ssh heatmap@<เซิร์ฟเวอร์> "mkdir -p /home/heatmap/app/basemap"
scp "$HOME\geointel-images.tar" docker-compose.yml .env.example heatmap@<เซิร์ฟเวอร์>:/home/heatmap/app/
scp basemap\basemap-th.pmtiles heatmap@<เซิร์ฟเวอร์>:/home/heatmap/app/basemap/
```

เสร็จแล้วลบ `C:\Users\Admin\geointel-images.tar` ได้

## 2. ตรวจเครื่องลูกค้า (ทำครั้งแรกครั้งเดียว)

```bash
ssh heatmap@<เซิร์ฟเวอร์>
uname -m
docker info --format '{{.SecurityOptions}}'
docker compose version
loginctl show-user heatmap --property=Linger
```

| คำสั่ง | ต้องเห็น | ถ้าไม่ใช่ |
|---|---|---|
| `uname -m` | `x86_64` | หยุด · image สร้างมาสำหรับ x86_64 |
| `docker info` | มีคำว่า `rootless` | หยุด · แจ้งลูกค้า |
| `docker compose version` | มีเลขรุ่น | หยุด · แจ้งลูกค้าให้ติดตั้ง compose |
| `loginctl` | `Linger=yes` | ติดตั้งต่อได้ แต่แอปจะดับเมื่อออกจาก SSH หรือเครื่องรีบูต · แจ้งลูกค้าให้เปิด linger |

## 3. ติดตั้งครั้งแรก

### 3.1 โหลด image

```bash
cd /home/heatmap/app
docker load -i geointel-images.tar
```

ต้องเห็น 2 บรรทัด

```
Loaded image: geointel-app:latest
Loaded image: postgis/postgis:17-3.5
```

### 3.2 สร้างไฟล์ `.env`

```bash
cp .env.example .env
chmod 600 .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" .env
nano .env
```

ใน `nano` แก้บรรทัดเดียว คือ `ADMIN_EMAIL` ให้เป็นอีเมลจริงของผู้ดูแลระบบคนแรก แล้วบันทึก บรรทัดอื่นไม่ต้องแตะ

| ตัวแปร | ค่า |
|---|---|
| `COMPOSE_PROFILES` | `app` |
| `POSTGRES_PASSWORD` | สุ่มแล้วจากคำสั่งข้างบน |
| `AUTH_SECRET` | สุ่มแล้วจากคำสั่งข้างบน (ต้องยาว 32 ตัวขึ้นไป) |
| `DEMO_PASSWORD` | **เว้นว่าง** ใส่ค่าแล้วแอปไม่เปิด |
| `ADMIN_EMAIL` | อีเมลผู้ดูแลระบบคนแรก |
| `APP_PORT` | `3000` |
| `DB_PORT` | `5433` |
| `DB_POOL_MAX` | `10` |
| `BASEMAP_URL` | `/basemap/basemap-th.pmtiles` |

ข้อห้าม 2 ข้อ

- ห้ามเปลี่ยน `POSTGRES_PASSWORD` หลังทำขั้น 3.3 แล้ว ฐานข้อมูลจำรหัสตอนสร้างครั้งแรก เปลี่ยนในไฟล์ทีหลังแอปจะต่อฐานข้อมูลไม่ได้
- ห้ามเปลี่ยน `AUTH_SECRET` ทีหลังโดยไม่จำเป็น เปลี่ยนแล้วทุกคนถูกออกจากระบบ

### 3.3 เปิดฐานข้อมูล

```bash
docker compose up -d db
docker compose ps
```

ต้องเห็น `geointel-db-1` สถานะ `healthy` (รอได้ถึง 1 นาที สั่ง `docker compose ps` ซ้ำได้)

### 3.4 สร้างตาราง (migrate)

```bash
docker compose run --rm app node server/db/migrate.mjs up
```

บรรทัดสุดท้ายต้องเป็น `12 migration(s) applied` (เลขเพิ่มตามรุ่น) ถ้าขึ้น `[migrate] ...` ให้หยุด

```bash
docker compose run --rm app node server/db/migrate.mjs status
```

บรรทัดสุดท้ายต้องเป็น `0 pending`

### 3.5 ใส่ข้อมูลพื้นฐาน (จังหวัดและโซน)

```bash
docker compose run --rm app node server/db/seed-base.mjs
```

ต้องเห็น

```
provinces         77 added
master data areas 77 added
zones             2 added
```

ถ้าข้ามขั้นนี้ จะนำเข้าไฟล์ร้านค้าและเพิ่มร้านไม่ได้ เพราะระบบไม่รู้จักจังหวัด

รันซ้ำได้ ไม่ทับของเดิม ส่วนที่มีข้อมูลแล้วจะขึ้น `already present, skipped`

### 3.6 ตั้งรหัสผู้ดูแลระบบคนแรก

```bash
docker compose run --rm app node server/db/set-password.mjs
```

ต้องเห็น

```
account             <อีเมลใน ADMIN_EMAIL>
temporary password  <รหัสชั่วคราว>
```

**จดรหัสชั่วคราวทันที** แสดงครั้งเดียว ไม่เก็บไว้ที่ไหน ถ้าพลาดให้รันคำสั่งเดิมซ้ำ จะได้รหัสใหม่

### 3.7 เปิดแอป

```bash
docker compose up -d
docker compose ps
```

ต้องเห็น 2 บรรทัด `geointel-db-1` และ `geointel-app-1` สถานะ `healthy` ทั้งคู่ (แอปใช้ราว 20 วินาที)

## 4. ตรวจผล

### 4.1 บนเครื่องเซิร์ฟเวอร์

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
curl -s http://127.0.0.1:3000/config/runtime.js
curl -s -o /dev/null -w "%{http_code}\n" -H "Range: bytes=0-99" http://127.0.0.1:3000/basemap/basemap-th.pmtiles
```

| บรรทัดที่ | ต้องเห็น |
|---|---|
| 1 | `200` |
| 2 | `window.__GEO_CONFIG = {"basemapUrl":"/basemap/basemap-th.pmtiles"};` |
| 3 | `206` (ได้ `404` = ไฟล์แผนที่ไม่อยู่ใน `basemap/`) |

### 4.2 ผ่านโดเมน (ตรวจ Nginx ของลูกค้า)

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://heatmap.barterconnect.io/
curl -s -o /dev/null -w "%{http_code}\n" -H "Range: bytes=0-99" https://heatmap.barterconnect.io/basemap/basemap-th.pmtiles
```

ต้องเห็น `200` แล้ว `206` ถ้าบรรทัดที่สองได้ `200` แปลว่า Nginx ตัด Range ทิ้ง แผนที่จะโหลดไฟล์ทั้งก้อน 174 MB แจ้งลูกค้า

### 4.3 ในเบราว์เซอร์

1. เปิด `https://heatmap.barterconnect.io/admin`
2. เข้าด้วยอีเมลใน `ADMIN_EMAIL` และรหัสชั่วคราว
3. ระบบบังคับตั้งรหัสใหม่ ตั้งแล้วเข้าได้
4. แผนที่ฐานขึ้น
5. ทดสอบนำเข้าไฟล์ ถ้าขึ้นข้อผิดพลาด 413 แปลว่า Nginx จำกัดขนาดอัปโหลด แจ้งลูกค้าตั้ง `client_max_body_size 40m`

## 5. อัปเดตรุ่นใหม่

บนเครื่องเรา ทำขั้น 1 ใหม่ (ส่งเฉพาะ `geointel-images.tar` พอ ถ้า `docker-compose.yml` ไม่เปลี่ยน)

บนเครื่องลูกค้า

```bash
cd /home/heatmap/app
docker compose exec -T db pg_dump -U geointel -Fc geointel > backup-$(date +%F-%H%M).dump
docker load -i geointel-images.tar
docker compose run --rm app node server/db/migrate.mjs up
docker compose up -d
docker compose ps
```

- ต้อง migrate **ทุกครั้ง** ก่อน `up -d` ไม่มีของใหม่จะขึ้น `up to date`
- ไม่ต้องรัน `seed-base.mjs` และ `set-password.mjs` ซ้ำ
- จบแล้วทำขั้น 4.1 ซ้ำ

## 6. ผู้ดูแลระบบลืมรหัสหรือบัญชีถูกล็อก

```bash
cd /home/heatmap/app
docker compose run --rm app node server/db/set-password.mjs <อีเมลผู้ดูแลระบบ>
```

ได้รหัสชั่วคราวใหม่ ปลดล็อกจากการกรอกผิด และออกจากระบบทุกเครื่องของบัญชีนั้น ใช้ได้เฉพาะบัญชีผู้ดูแลระบบ บัญชีอื่นให้ผู้ดูแลระบบรีเซ็ตจากหน้าผู้ใช้ในเว็บ

## 7. คำสั่งที่ใช้บ่อย

| งาน | คำสั่ง |
|---|---|
| ดูสถานะ | `docker compose ps` |
| ดู log แอป | `docker compose logs --tail 100 app` |
| เปิดแอปใหม่ | `docker compose restart app` |
| ปิดทั้งหมด (ข้อมูลยังอยู่) | `docker compose down` |
| สำรองฐานข้อมูล | `docker compose exec -T db pg_dump -U geointel -Fc geointel > backup.dump` |

**ห้ามใช้ `docker compose down -v`** ตัว `-v` ลบฐานข้อมูลทั้งหมด

ข้อความผิดพลาดที่เจอบ่อย

| ข้อความ | สาเหตุ | แก้ |
|---|---|---|
| `POSTGRES_PASSWORD is required` | ไม่มี `.env` หรือไม่ได้อยู่ใน `/home/heatmap/app` | `cd /home/heatmap/app` แล้วทำขั้น 3.2 |
| `[set-password] database is not ready` หรือ `[seed-base] database is not ready` | ยังไม่ได้ migrate | ทำขั้น 3.4 |
| เพิ่มร้านหรือนำเข้าไฟล์แล้วระบบไม่รับจังหวัดใดเลย | ยังไม่ได้ใส่ข้อมูลพื้นฐาน | ทำขั้น 3.5 |
| `[server] AUTH_SECRET must be at least 32 characters` | `AUTH_SECRET` สั้นไป | ทำบรรทัด `AUTH_SECRET` ในขั้น 3.2 ใหม่ แล้ว `docker compose up -d` |
| `[server] DEMO_PASSWORD must be empty` | ใส่ค่า `DEMO_PASSWORD` | ลบค่าออก แล้ว `docker compose up -d` |
| `[server] BASEMAP_URL must be ...` | `BASEMAP_URL` ผิดรูป | ใส่ `/basemap/basemap-th.pmtiles` |

## 8. สิ่งที่คู่มือนี้ยังไม่ครอบคลุม

**ยังไม่มีขั้นตอน**

- **คืนค่าจากไฟล์สำรอง** มีคำสั่งสำรอง ยังไม่มีขั้นตอนคืนค่าที่ทดสอบแล้ว
- **สำรองรายวัน** ลูกค้าเป็นผู้ตั้ง

**สภาพระบบหลังติดตั้งเสร็จ**

- มีบัญชีผู้ดูแลระบบ 1 บัญชี · จังหวัด 77 · โซน 2 · หมวดธุรกิจ 13
- **ยังไม่มีร้านค้าและ Lead** แผนที่จะว่าง ผู้ดูแลระบบนำเข้าไฟล์ที่เมนูจัดการข้อมูล
- **ยังไม่มีบัญชีผู้ใช้อื่น** ผู้ดูแลระบบสร้างที่หน้าผู้ใช้

**ทดสอบแล้ว** (7 ต.ค. 2569 บนเครื่องพัฒนา Docker Desktop ในโฟลเดอร์ที่มีแค่ 4 ไฟล์ตามขั้น 0)

- ขั้น 1 · 3.1–3.7 · 4.1 · ล็อกอินด้วยรหัสชั่วคราว · ขั้น 5 (ด้วย image ตัวเดิม) · ขั้น 6 · คำสั่งสำรอง

**ยังไม่ได้ทดสอบ**

- ทั้งหมดบนเครื่องลูกค้าจริง
- `scp` ในขั้น 1 และคำสั่งตรวจเครื่องในขั้น 2
- ขั้น 4.2 และ 4.3 ผ่าน Nginx ของลูกค้า (Range ของไฟล์แผนที่ · ขนาดอัปโหลด)
- แอปกลับมาเองหลังเครื่องรีบูต (ขึ้นกับ linger)
- ขั้น 5 ด้วย image รุ่นใหม่จริง และด้วย migration ใหม่บนฐานข้อมูลที่มีข้อมูลแล้ว
