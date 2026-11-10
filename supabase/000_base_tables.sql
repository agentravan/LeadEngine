-- LeadEngine base tables. They live in the same Supabase project as LeadNex CRM,
-- so every LeadEngine table starts with "le_" and never touches LeadNex data.
create table if not exists public.le_leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_id text,
  name text not null,
  category text default '',
  city text default '',
  area text default '',
  address text default '',
  phone text default '',
  website text default '',
  email text default '',
  profile_url text default '',
  source text default '',
  rating numeric,
  reviews int,
  score int default 0,
  priority text default 'Low',
  status text default 'New Leads',
  notes text default '',
  created_at timestamptz not null default now()
);
create table if not exists public.le_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  niche text, location text, count int default 0,
  status text default 'Completed',
  created_at timestamptz not null default now()
);
create index if not exists le_leads_owner_created_idx on public.le_leads (owner_id, created_at desc);
alter table public.le_leads enable row level security;
alter table public.le_campaigns enable row level security;
drop policy if exists "le own leads" on public.le_leads;
create policy "le own leads" on public.le_leads for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "le own campaigns" on public.le_campaigns;
create policy "le own campaigns" on public.le_campaigns for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
