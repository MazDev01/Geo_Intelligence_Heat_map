create table master_data (
  type       text not null check (type in ('segments', 'areas', 'reject-reasons')),
  code       text not null check (btrim(code) <> ''),
  label_th   text not null check (btrim(label_th) <> ''),
  label_en   text,
  color_hex  text,
  icon       text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  is_system  boolean not null default false,
  updated_by integer references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (type, code)
);

insert into master_data (type, code, label_th, label_en, color_hex, icon, sort_order) values
  ('segments', 'Manufacturing', 'ผลิตและวัสดุอุตสาหกรรม', 'Manufacturing & Industrial Materials', '#33d69f', 'Manufacturing', 0),
  ('segments', 'HomeLiving', 'บ้าน อาคาร และของใช้ในบ้าน', 'Home, Building & Living', '#c98500', 'HomeLiving', 1),
  ('segments', 'FoodBeverage', 'อาหารและเครื่องดื่ม', 'Food & Beverage', '#ff5a3c', 'FoodBeverage', 2),
  ('segments', 'HealthBeauty', 'สุขภาพ ความงาม และเวลเนส', 'Health, Beauty & Wellness', '#e87ba4', 'HealthBeauty', 3),
  ('segments', 'Retail', 'ค้าปลีกและสินค้าอุปโภคบริโภค', 'Retail & Consumer Goods', '#ffb02e', 'Retail', 4),
  ('segments', 'ProfessionalServices', 'บริการวิชาชีพและการตลาด', 'Professional & Marketing Services', '#8a7bff', 'ProfessionalServices', 5),
  ('segments', 'AutoTransport', 'ยานยนต์และขนส่ง', 'Automotive & Transport', '#3987e5', 'AutoTransport', 6),
  ('segments', 'Hospitality', 'ที่พักและสันทนาการ', 'Hospitality & Recreation', '#34e0d0', 'Hospitality', 7),
  ('segments', 'Technology', 'เทคโนโลยีและการสื่อสาร', 'Technology & Communications', '#26c6da', 'Technology', 8),
  ('segments', 'PetAnimal', 'สัตว์เลี้ยงและสัตว์', 'Pets & Animals', '#9ccc65', 'PetAnimal', 9),
  ('segments', 'ArtsCulture', 'ศิลปะ วัฒนธรรม และบริการเฉพาะทาง', 'Arts, Culture & Specialty Services', '#6d7cff', 'ArtsCulture', 10),
  ('segments', 'RealEstate', 'ที่ดินและอสังหาริมทรัพย์', 'Real Estate', '#b07be8', 'RealEstate', 11),
  ('segments', 'RestaurantCafe', 'ร้านอาหารและคาเฟ่', 'Restaurants & Cafes', '#8a5a44', 'RestaurantCafe', 12);

insert into master_data (type, code, label_th, label_en, sort_order, is_system) values
  ('reject-reasons', 'dup', 'เป็นลูกค้าอยู่แล้ว / รายการซ้ำ', 'Already a customer / duplicate', 0, false),
  ('reject-reasons', 'evidence', 'ข้อมูลไม่เพียงพอ/ไม่ชัดเจน', 'Not enough or unclear information', 1, false),
  ('reject-reasons', 'wrongdata', 'พื้นที่/ข้อมูลธุรกิจไม่ถูกต้อง', 'Wrong area or business details', 2, false),
  ('reject-reasons', 'notreal', 'ไม่พบว่ามีกิจการจริง', 'No real business found', 3, false),
  ('reject-reasons', 'other', 'อื่น ๆ (ระบุ)', 'Other (specify)', 4, true);

insert into master_data (type, code, label_th, label_en, sort_order, is_system)
  select 'areas', key, name_th, name_en, (row_number() over (order by key))::int - 1, true from provinces;

insert into stats_dirty default values;
