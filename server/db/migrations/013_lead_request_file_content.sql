alter table lead_request_files alter column stored_path drop not null;
alter table lead_request_files add column content bytea;
alter table lead_request_files alter column content set storage external;
alter table lead_request_files add constraint lead_request_files_body_chk check (content is not null or stored_path is not null);
