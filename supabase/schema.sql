-- BestMate Outreach: run once in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trades text[] not null,
  city text not null default '',
  state text not null,
  daily_target int not null default 25,
  status text not null default 'Queued',          -- Queued | Active | Paused
  sender_campaign_id text,                         -- campaign ID inside Smartlead / Instantly
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete set null,
  place_id text unique,                            -- Google place ID; the duplicate check
  company text not null,
  industry text, city text, state text,
  phone text, website text, domain text,
  contact text, title text, email text, linkedin text,
  source text not null default 'Discovered by BestMate',
  rating numeric, reviews int, hours jsonb,
  segment text, fit int, signal_pts int, score int, tier text, signal text,
  found jsonb not null default '[]', why text, dq_reason text,
  status text not null default 'Not contacted',
  owner text not null default 'Unassigned',
  pushed_at timestamptz, last_contact_at timestamptz,
  reply_text text, reply_type text, reply_at timestamptz, meeting_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_campaign_idx on leads (campaign_id, score desc);
create index if not exists leads_email_idx on leads (lower(email));
create index if not exists leads_domain_idx on leads (domain);

create table if not exists events (
  id bigserial primary key,
  lead_id uuid references leads(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,                              -- discovered | enriched | pushed | sent | reply | bounce | status | note
  detail text,
  payload jsonb
);
create index if not exists events_lead_idx on events (lead_id, at);

create table if not exists suppression (
  email text primary key,
  reason text,
  at timestamptz not null default now()
);

-- Lock everything down. The server routes use the service role key, which bypasses these.
alter table campaigns enable row level security;
alter table leads enable row level security;
alter table events enable row level security;
alter table suppression enable row level security;
