-- Secure login, OTP password reset and in-app settings.
-- Run once in Supabase > SQL Editor, after 001_ai_outreach.sql.
-- None of these tables has an RLS policy, so the browser (anon / logged-in users) can never read them.
-- Only the server (service role key in Vercel) reads and writes them.

-- Keys and passwords you type on the Settings page. Stored encrypted (AES-256-GCM).
create table if not exists public.app_secrets (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  data text not null,
  updated_at timestamptz not null default now()
);

-- Which account owns the automation. The first account that saves Settings claims it.
create table if not exists public.app_owner (
  id int primary key default 1 check (id = 1),
  owner_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

-- One-time codes for "Forgot password". Only a hash of the code is stored.
create table if not exists public.auth_otps (
  id bigserial primary key,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists auth_otps_email_idx on public.auth_otps (email, created_at desc);

-- Login and reset attempts, used for lockout and new-device alerts.
create table if not exists public.auth_attempts (
  id bigserial primary key,
  email text,
  ip text,
  ua text,
  kind text not null,          -- login | forgot | reset
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_email_idx on public.auth_attempts (email, created_at desc);
create index if not exists auth_attempts_ip_idx on public.auth_attempts (ip, created_at desc);

alter table public.app_secrets   enable row level security;
alter table public.app_owner     enable row level security;
alter table public.auth_otps     enable row level security;
alter table public.auth_attempts enable row level security;
revoke all on public.app_secrets, public.app_owner, public.auth_otps, public.auth_attempts from anon, authenticated;
