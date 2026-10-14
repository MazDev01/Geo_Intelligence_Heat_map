alter table users
  add column color text check (color is null or color ~ '^#[0-9a-f]{6}$');
