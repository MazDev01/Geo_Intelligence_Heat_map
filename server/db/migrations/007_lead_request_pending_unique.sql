create unique index lead_requests_one_pending_idx on lead_requests (place_id) where status = 'pending';
