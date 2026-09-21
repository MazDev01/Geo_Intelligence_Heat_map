#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# zones.csv (28 เขต) + geoBoundaries THA ADM2  ->  data/zones.geojson
#
#   ./build-zones.sh /path/to/geoBoundaries-THA-ADM2.geojson
#
# ต้องมี: npm i -g mapshaper
# ---------------------------------------------------------------------------
# ⚠ เขียนใหม่จากสคริปต์ต้นฉบับที่เขียนไว้สำหรับ HDX (tha_admbnda_adm2) —
#   geoBoundaries มี properties แค่ shapeName / shapeISO / shapeID / shapeGroup / shapeType
#   ไม่มี ADM1_TH · ADM2_TH · ชื่อจังหวัด  ⇒  ทำสองอย่างนี้ไม่ได้:
#     1. filter ด้วย ADM1_EN === "Bangkok"   → ต้อง filter ด้วย "รายชื่อ 28 เขต" ตรง ๆ แทน
#     2. join ด้วย ADM2_TH ↔ khet_th         → ต้อง join ด้วย shapeName ↔ khet_en แทน
#   และ geoBoundaries สะกดวัฒนาว่า "Vadhana" (ไม่ใช่ Watthana) — zones.csv จึงใช้ Vadhana
#
#   เพราะ filter ด้วยชื่ออย่างเดียว ถ้าจังหวัดอื่นมีอำเภอชื่อซ้ำจะหยิบผิดโดยเงียบ ๆ
#   ขั้นสกัดจึงทำใน Node (extract-zones.mjs) ซึ่ง fail ทันทีถ้าเจอชื่อซ้ำ
# ---------------------------------------------------------------------------
set -euo pipefail

SRC="${1:-geoBoundaries-THA-ADM2.geojson}"
RAW="$(mktemp -d)/bkk-zones-raw.geojson"
OUT="data/zones.geojson"

[ -f "$SRC" ] || { echo "ไม่พบ $SRC — โหลด geoBoundaries THA ADM2 มาก่อน"; exit 1; }
command -v mapshaper >/dev/null || { echo "ไม่มี mapshaper — npm i -g mapshaper"; exit 1; }

echo "==> สกัด 28 เขตจาก $SRC (สตรีมทีละบรรทัด · กันชื่อซ้ำข้ามจังหวัด)"
node extract-zones.mjs "$SRC" "$RAW"

# ไม่ใส่ -simplify: ไม่ simplify เลยได้ 97 KB / ~9,500 จุด ซึ่งต่ำกว่าเพดาน gate (600 KB / 40,000 จุด) มาก
# จะลดขนาดก็เพิ่ม  -simplify 25% keep-shapes  (ได้ ~24 KB) แต่ขอบจะหยาบขึ้นโดยไม่จำเป็น
echo "==> dissolve 28 เขต -> 3 โซน"
mapshaper "$RAW" \
  -dissolve2 fields=zone_id,zone_name \
  -clean \
  -o precision=0.00001 format=geojson "$OUT"

echo "==> ตรวจ"
node verify-zones.mjs        # โครงสร้าง: โซนครบ · 1 โซน 1 feature · ขนาด
node verify-zones-hit.mjs    # เชิงพื้นที่: ยิงพิกัดเขตจริงเข้าไปดูว่าตกโซนถูก
