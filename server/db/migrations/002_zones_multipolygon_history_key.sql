alter table zones alter column geom type geometry(Geometry,4326);
alter table zones add constraint zones_geom_type_check
  check (GeometryType(geom) in ('POLYGON','MULTIPOLYGON'));

alter table zones add column props    jsonb   not null default '{}';
alter table zones add column position integer not null default 0;

alter table zone_history add column version_key text;
update zone_history
   set version_key = to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24-MI-SS-MS"Z"')
 where version_key is null;
alter table zone_history alter column version_key set not null;
alter table zone_history add constraint zone_history_version_key_key unique (version_key);
alter table zone_history add constraint zone_history_version_key_check
  check (version_key ~ '^[0-9A-Za-z-]+$');
