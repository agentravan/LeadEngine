-- LeadEngine: AI lead hunt + Zoho auto-outreach
-- Run once in Supabase > SQL Editor. Safe to run again.

alter table public.le_leads
  add column if not exists observations     text default '',
  add column if not exists pitch            text default '',
  add column if not exists contact_person   text default '',
  add column if not exists day0_subject     text default '',
  add column if not exists day0_body        text default '',
  add column if not exists day3_body        text default '',
  add column if not exists day7_body        text default '',
  add column if not exists whatsapp_msg     text default '',
  -- queued | manual | sent | replied | needs_harshit | do_not_contact | bounced | rejected | invalid_email | completed | imported
  add column if not exists outreach_status  text,
  add column if not exists day0_sent_at     timestamptz,
  add column if not exists day3_sent_at     timestamptz,
  add column if not exists day7_sent_at     timestamptz,
  add column if not exists message_id       text,
  add column if not exists last_reply_at    timestamptz,
  add column if not exists reply_count      int default 0,
  add column if not exists auto_replies     int default 0,
  add column if not exists bounce_reason    text;

create index if not exists le_leads_outreach_idx on public.le_leads (owner_id, outreach_status);
create index if not exists le_leads_day0_idx on public.le_leads (owner_id, day0_sent_at);

-- Needed by the hunt's upsert (skip if your table already has this constraint).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'le_leads_owner_source_key') and not exists (
    select 1 from pg_indexes where tablename = 'le_leads' and indexdef ilike '%(owner_id, source_id)%' and indexdef ilike '%unique%') then
    alter table public.le_leads add constraint le_leads_owner_source_key unique (owner_id, source_id);
  end if;
end $$;

create table if not exists public.le_outreach_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  automation_enabled boolean not null default true,
  daily_limit int not null default 10,
  updated_at timestamptz not null default now()
);

create table if not exists public.le_email_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid,
  kind text not null,          -- day0_sent, day3_sent, reply_received, auto_reply_sent, bounce, run, hunt ...
  category text,
  message_id text,
  subject text,
  from_email text,
  to_email text,
  body text,
  created_at timestamptz not null default now()
);
create unique index if not exists le_email_events_msg_uniq on public.le_email_events (owner_id, message_id) where message_id is not null;
create index if not exists le_email_events_lead_idx on public.le_email_events (owner_id, lead_id, created_at);

alter table public.le_outreach_settings enable row level security;
alter table public.le_email_events enable row level security;

drop policy if exists "own settings" on public.le_outreach_settings;
create policy "own settings" on public.le_outreach_settings for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "read own events" on public.le_email_events;
create policy "read own events" on public.le_email_events for select using (owner_id = auth.uid());
