alter table visit_plans
  add column province text references provinces(key) on delete set null,
  add column saved_at timestamptz;

alter table visit_plan_items
  add column snapshot jsonb;
