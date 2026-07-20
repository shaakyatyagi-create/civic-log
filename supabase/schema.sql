
create extension if not exists "pgcrypto";

create table if not exists reports (
  id bigint generated always as identity primary key,
  citizen_name text not null,
  phone text not null,
  state text not null,
  district text not null,
  ward text not null,
  area text not null,
  category text not null check (category in ('Road','Water','Garbage','Electricity','Other')),
  title text not null,
  citizen_severity text not null check (citizen_severity in ('Critical','Important','Minor','Low priority')),
  near_facility boolean not null default false,
  description text not null,
  image_url text,

  verification_code char(6) not null,
  code_attempts int not null default 0,
  code_locked_until timestamptz,

  ai_severity text check (ai_severity in ('Critical','Important','Minor','Low priority')),
  ai_category_match boolean,
  ai_confidence numeric,
  ai_reasoning jsonb,

  email_draft_subject text,
  email_draft_body text,
  x_post_draft text,

  status text not null default 'unsolved' check (status in ('unsolved','solved')),
  unsolved_count int not null default 0,
  upvotes int not null default 0,

  sent boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_reports_state_district_category_status
  on reports (state, district, category, status);

create table if not exists district_contacts (
  district text primary key,
  authority_email text not null,
  escalation_email text not null
);

insert into district_contacts (district, authority_email, escalation_email) values
  ('Ghaziabad', 'shaakyatyagi@gmail.com', 'eakansh67@gmail.com'),
  ('Noida',     'shaakyatyagi@gmail.com', 'eakansh67@gmail.com'),
  ('Agra',      'shaakyatyagi@gmail.com', 'eakansh67@gmail.com'),
  ('Aligarh',   'shaakyatyagi@gmail.com', 'eakansh67@gmail.com'),
  ('Lucknow',   'shaakyatyagi@gmail.com', 'eakansh67@gmail.com')
on conflict (district) do nothing;

create table if not exists ngos (
  id bigint generated always as identity primary key,
  name text not null,
  district text not null,
  twitter_handle text,
  email text
);

insert into ngos (name, district, twitter_handle, email) values
  ('Ganga Clean Foundation',       'Ghaziabad', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Hindon Riverkeepers Trust',    'Ghaziabad', 'shakyatyagi', 'eakansh67@gmail.com'),
  ('Ghaziabad Sanitation Sangh',   'Ghaziabad', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Noida Civic Welfare Society',  'Noida',     'shakyatyagi', 'eakansh67@gmail.com'),
  ('Green Sector Alliance',        'Noida',     'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Urban Sanitation Trust Noida', 'Noida',     'shakyatyagi', 'eakansh67@gmail.com'),
  ('Yamuna Watch Collective',      'Agra',      'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Taj Heritage Cleanliness Org', 'Agra',      'shakyatyagi', 'eakansh67@gmail.com'),
  ('Agra Citizens Action Group',   'Agra',      'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Aligarh Nagrik Manch',         'Aligarh',   'shakyatyagi', 'eakansh67@gmail.com'),
  ('Clean Aligarh Initiative',     'Aligarh',   'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Aligarh Water Watch',          'Aligarh',   'shakyatyagi', 'eakansh67@gmail.com'),
  ('Lucknow Civic Response Trust', 'Lucknow',   'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Gomti Cleanliness Council',    'Lucknow',   'shakyatyagi', 'eakansh67@gmail.com'),
  ('Nawab City Sanitation Forum',  'Lucknow',   'shakyatyagi', 'shaakyatyagi@gmail.com')
on conflict do nothing;

create table if not exists forum_posts (
  id bigint generated always as identity primary key,
  name text not null,
  address text not null,
  problem text not null,
  votes int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists notifications_log (
  id bigint generated always as identity primary key,
  report_id bigint references reports(id) on delete cascade,
  channel text not null check (channel in ('email','x')),
  kind text not null check (kind in ('initial','escalation','ngo')),
  recipient text,
  payload text,
  sent_at timestamptz not null default now(),
  success boolean not null default true,
  error text
);

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_reports_updated_at on reports;
create trigger trg_reports_updated_at
  before update on reports
  for each row execute function set_updated_at();

alter table reports enable row level security;
alter table district_contacts enable row level security;
alter table ngos enable row level security;
alter table forum_posts enable row level security;
alter table notifications_log enable row level security;

drop policy if exists "public read reports" on reports;
create policy "public read reports" on reports for select using (true);

drop policy if exists "public read district_contacts" on district_contacts;
create policy "public read district_contacts" on district_contacts for select using (true);

drop policy if exists "public read ngos" on ngos;
create policy "public read ngos" on ngos for select using (true);

drop policy if exists "public read forum_posts" on forum_posts;
create policy "public read forum_posts" on forum_posts for select using (true);


alter publication supabase_realtime add table reports;
alter publication supabase_realtime add table forum_posts;

alter table reports add column if not exists ai_flagged boolean not null default false;
alter table reports add column if not exists ngo_manual_requested boolean not null default false;

alter table district_contacts add column if not exists authority_handle text;
alter table district_contacts add column if not exists escalation_handle text;

update district_contacts set
  authority_email = 'rufusnocturnus@gmail.com',
  escalation_email = 'valeriusinfernusscandiacus@gmail.com',
  authority_handle = 'EnderFPV',
  escalation_handle = 'gzdlocal';

alter table ngos add column if not exists category text;

delete from ngos;

insert into ngos (name, district, category, twitter_handle, email) values
  ('Ghaziabad Road Safety Trust',     'Ghaziabad', 'Road', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Smooth Streets Foundation',       'Ghaziabad', 'Road', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Urban Mobility Collective',       'Ghaziabad', 'Road', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Pothole Patrol GZB',              'Ghaziabad', 'Road', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Transit Watch Ghaziabad',         'Ghaziabad', 'Road', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Safe Roads Sangathan',            'Ghaziabad', 'Road', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('City Commute Alliance',           'Ghaziabad', 'Road', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Highway Health Initiative',       'Ghaziabad', 'Road', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Traffic Relief Society',          'Ghaziabad', 'Road', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Pathway Restoration Group',       'Ghaziabad', 'Road', 'shakyatyagi', 'shaakyatyagi@gmail.com'),

  ('Hindon Riverkeepers Trust',       'Ghaziabad', 'Water', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Clean Water Collective GZB',      'Ghaziabad', 'Water', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Sewage Solutions Sangh',          'Ghaziabad', 'Water', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Jal Suraksha Foundation',         'Ghaziabad', 'Water', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Drainage Watch Ghaziabad',        'Ghaziabad', 'Water', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Blue Tap Initiative',             'Ghaziabad', 'Water', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Waterline Restoration Trust',     'Ghaziabad', 'Water', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Pure Flow Society',               'Ghaziabad', 'Water', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Aqua Relief Alliance',            'Ghaziabad', 'Water', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Nirmal Neer Sangathan',           'Ghaziabad', 'Water', 'shakyatyagi', 'shaakyatyagi@gmail.com'),

  ('Ganga Clean Foundation',          'Ghaziabad', 'Garbage', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Ghaziabad Sanitation Sangh',      'Ghaziabad', 'Garbage', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Waste Watchers Collective',       'Ghaziabad', 'Garbage', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Clean City Crusaders',            'Ghaziabad', 'Garbage', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Swachh Ghaziabad Trust',          'Ghaziabad', 'Garbage', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Green Bin Initiative',            'Ghaziabad', 'Garbage', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Sanitation Relief Society',       'Ghaziabad', 'Garbage', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Urban Cleanup Alliance',          'Ghaziabad', 'Garbage', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Zero Waste Sangathan',            'Ghaziabad', 'Garbage', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Tidy Streets Foundation',         'Ghaziabad', 'Garbage', 'shakyatyagi', 'shaakyatyagi@gmail.com'),

  ('Bright Ghaziabad Trust',          'Ghaziabad', 'Electricity', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('PowerLine Watch Collective',      'Ghaziabad', 'Electricity', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Ujjwal Urja Sangathan',           'Ghaziabad', 'Electricity', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Streetlight Restoration Society', 'Ghaziabad', 'Electricity', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Voltage Relief Foundation',       'Ghaziabad', 'Electricity', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Circuit Care Alliance',           'Ghaziabad', 'Electricity', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Illuminate GZB Initiative',       'Ghaziabad', 'Electricity', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Grid Guardian Trust',             'Ghaziabad', 'Electricity', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Lumen Sangathan',                 'Ghaziabad', 'Electricity', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Steady Power Collective',         'Ghaziabad', 'Electricity', 'shakyatyagi', 'shaakyatyagi@gmail.com'),

  ('Ghaziabad Civic Welfare Society', 'Ghaziabad', 'Other', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Community Action Ghaziabad',      'Ghaziabad', 'Other', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Nagrik Sahayata Sangh',           'Ghaziabad', 'Other', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Urban Grievance Alliance',        'Ghaziabad', 'Other', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Civic Response Trust',            'Ghaziabad', 'Other', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Public Interest Collective GZB',  'Ghaziabad', 'Other', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Citizen Watch Foundation',        'Ghaziabad', 'Other', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Local Governance Initiative',     'Ghaziabad', 'Other', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Neighborhood Relief Society',     'Ghaziabad', 'Other', 'shakyatyagi', 'shaakyatyagi@gmail.com'),
  ('Ghaziabad Betterment Sangathan',  'Ghaziabad', 'Other', 'shakyatyagi', 'shaakyatyagi@gmail.com');

create table if not exists forum_replies (
  id bigint generated always as identity primary key,
  post_id bigint not null references forum_posts(id) on delete cascade,
  name text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table forum_replies enable row level security;

drop policy if exists "public read forum_replies" on forum_replies;
create policy "public read forum_replies" on forum_replies for select using (true);
