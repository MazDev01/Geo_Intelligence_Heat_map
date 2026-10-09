create function notify_places_changed() returns trigger language plpgsql as $$
begin
  perform pg_notify('places_changed', '');
  return null;
end $$;

create trigger places_notify after insert or update or delete or truncate on places
  for each statement execute function notify_places_changed();
create trigger place_visits_notify after insert or update or delete or truncate on place_visits
  for each statement execute function notify_places_changed();
create trigger lead_requests_notify after insert or update or delete or truncate on lead_requests
  for each statement execute function notify_places_changed();
create trigger lead_request_files_notify after insert or update of filename, request_id or delete or truncate on lead_request_files
  for each statement execute function notify_places_changed();
create trigger territory_assign_notify after insert or update or delete or truncate on territory_assign
  for each statement execute function notify_places_changed();
create trigger users_notify after update of name, province or delete on users
  for each statement execute function notify_places_changed();
