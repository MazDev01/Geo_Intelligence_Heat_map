create function place_name_key(name text) returns text
language sql immutable parallel safe
return regexp_replace(
  regexp_replace(
    regexp_replace(lower(coalesce(name, '')),
      '(บริษัท|ห้างหุ้นส่วนจำกัด|ห้างหุ้นส่วน|จำกัด|มหาชน|บจก\.?|บมจ\.?|บจ\.?|หจก\.?|หสน\.?)', ' ', 'g'),
    '\m(co\.?,? ?ltd|company limited|limited|ltd|inc|corp)\M\.?', ' ', 'g'),
  '[\s\(\)\.,\-_/&]+', '', 'g');

insert into settings (key, value) values
  ('import.dup_similarity', '0.4'),
  ('import.dup_distance_m', '200');
