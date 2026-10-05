const FULL_ACCESS = new Set(['Administrator', 'Management']);

const SQL = `
select p.id, p.type, p.account_no, p.business_name, p.category, p.segment, p.country, p.province, p.district,
  p.address, p.latitude::float8 as latitude, p.longitude::float8 as longitude, p.phone, p.email, p.website,
  p.facebook, to_char(p.date_join, 'YYYY-MM-DD') as date_join,
  to_char(p.created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as created_at,
  o.name as tc_owner, p.visit_status, v.rounds
from places p
left join users o on o.id = p.tc_owner_id
left join (
  select pv.place_id, json_agg(json_build_object(
    'round', pv.round, 'status', pv.status,
    'apptDate', to_char(pv.appt_date, 'YYYY-MM-DD'), 'doneDate', to_char(pv.done_date, 'YYYY-MM-DD'),
    'tc', t.name, 'interest', pv.interest, 'outcome', pv.outcome,
    'cancelReason', pv.cancel_reason, 'note', pv.note) order by pv.round) as rounds
  from place_visits pv
  left join users t on t.id = pv.tc_id
  group by pv.place_id
) v on v.place_id = p.id
where p.type = $1
  and p.deleted_at is null
  and ($2::text is null or p.country = $2)
  and ($3::int is null or p.province in (
    select u.province from users u where u.id = $3 and u.province is not null
    union
    select split_part(a.key, '/', 1) from territory_assign a where a.user_id = $3))
order by p.id`;

const putIf = (obj, key, value) => { if (value !== null && value !== undefined) obj[key] = value; };

const toRound = v => {
  const out = {round: v.round, status: v.status};
  for (const k of ['apptDate', 'doneDate', 'tc', 'interest', 'outcome', 'cancelReason', 'note']) putIf(out, k, v[k]);
  return out;
};

const toCustomer = r => {
  const out = {
    id: r.id, accountNo: r.account_no, businessName: r.business_name, segment: r.segment, status: r.type,
    country: r.country, province: r.province, district: r.district, address: r.address,
    latitude: r.latitude, longitude: r.longitude, phone: r.phone, website: r.website, facebook: r.facebook,
    dateJoin: r.date_join, created_at: r.created_at, tc_owner: r.tc_owner,
  };
  putIf(out, 'category', r.category);
  putIf(out, 'email', r.email);
  putIf(out, 'visit_status', r.visit_status);
  if (r.rounds) out.visitRounds = r.rounds.map(toRound);
  return out;
};

const toLead = r => {
  const out = {
    id: r.id, businessName: r.business_name, category: r.category, segment: r.segment, status: r.type,
    country: r.country, province: r.province, district: r.district, address: r.address, email: r.email,
    latitude: r.latitude, longitude: r.longitude, created_at: r.created_at, tc_owner: r.tc_owner,
    visitRounds: (r.rounds || []).map(toRound), visit_status: r.visit_status, phone: r.phone,
  };
  putIf(out, 'accountNo', r.account_no);
  putIf(out, 'website', r.website);
  putIf(out, 'facebook', r.facebook);
  putIf(out, 'dateJoin', r.date_join);
  return out;
};

const KINDS = {
  customers: {type: 'Existing', map: toCustomer},
  leads: {type: 'Prospect', map: toLead},
};

export async function listPlaces(pool, kind, user, country) {
  const k = KINDS[kind];
  const full = FULL_ACCESS.has(user.role);
  if (!full && !Number.isInteger(user.id)) return [];
  const scopeUserId = full ? null : user.id;
  const r = await pool.query(SQL, [k.type, country || null, scopeUserId]);
  return r.rows.map(k.map);
}
