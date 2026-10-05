alter table import_files add column headers jsonb not null default '[]';
alter table import_files add constraint import_files_headers_check
  check (jsonb_typeof(headers) = 'array');

create table import_staging (
  file_id bigint  not null references import_files(file_id) on delete cascade,
  row_no  integer not null check (row_no >= 1),
  raw     jsonb   not null check (jsonb_typeof(raw) = 'array'),
  primary key (file_id, row_no)
);
