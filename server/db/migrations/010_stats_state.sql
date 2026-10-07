create table stats_state (
  id          boolean primary key default true check (id),
  country     jsonb not null default '{}',
  computed_at timestamptz
);
insert into stats_state (id) values (true);

create table stats_dirty (
  id bigint generated always as identity primary key
);
insert into stats_dirty default values;

create function mark_stats_dirty() returns trigger language plpgsql as $$
begin
  insert into stats_dirty default values;
  return null;
end
$$;

create trigger places_mark_stats_dirty after insert or update or delete on places
  for each statement execute function mark_stats_dirty();
