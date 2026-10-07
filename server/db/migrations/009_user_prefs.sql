alter table users
  add column prefs jsonb not null default '{}';
