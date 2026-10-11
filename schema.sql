-- Libretto Allenamento: schema per Supabase
-- Come usarlo: Supabase > SQL Editor > New query > incolla tutto > Run.
-- Si puo' rilanciare senza problemi.

create extension if not exists pgcrypto;

-- Allenatori (si aggiungono a mano, vedi LEGGIMI.md)
create table if not exists public.trainers (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- Clienti. invite_code e' il codice che l'allenatore consegna al cliente.
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Scheda attuale di ogni cliente (giorni ed esercizi in formato JSON)
create table if not exists public.plans (
  client_id uuid primary key references public.clients(id) on delete cascade,
  days jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Schede modello da applicare ai clienti
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  days jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Esercizi aggiunti dall'allenatore (suggerimenti nel campo nome)
create table if not exists public.library (
  name text primary key
);

-- Allenamenti registrati dai clienti: uno per cliente, giorno e data
create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  day_id text not null,
  day_name text not null default '',
  date date not null,
  sets jsonb not null default '{}'::jsonb,
  names jsonb not null default '{}'::jsonb,
  body_weight numeric,
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (client_id, day_id, date)
);
create index if not exists logs_client_date_idx on public.logs (client_id, date desc);
create index if not exists logs_updated_idx on public.logs (updated_at desc);

-- Funzioni di supporto (security definer: leggono senza passare dalle regole)
create or replace function public.is_trainer()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.trainers where user_id = auth.uid())
$$;

create or replace function public.my_client_id()
returns uuid language sql security definer stable set search_path = public as $$
  select id from public.clients where user_id = auth.uid() limit 1
$$;

-- Il cliente collega il proprio account al codice ricevuto
create or replace function public.claim_client(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then
    raise exception 'Devi accedere prima';
  end if;
  update public.clients
     set user_id = auth.uid()
   where invite_code = upper(trim(p_code)) and user_id is null
  returning id into cid;
  if cid is null then
    raise exception 'Codice non valido o gia'' usato';
  end if;
  return cid;
end $$;

revoke all on function public.claim_client(text) from public, anon;
grant execute on function public.claim_client(text) to authenticated;
revoke all on function public.is_trainer() from public, anon;
grant execute on function public.is_trainer() to authenticated;
revoke all on function public.my_client_id() from public, anon;
grant execute on function public.my_client_id() to authenticated;

-- Sicurezza: ogni tabella chiusa, poi si aprono solo i permessi necessari
alter table public.trainers  enable row level security;
alter table public.clients   enable row level security;
alter table public.plans     enable row level security;
alter table public.templates enable row level security;
alter table public.library   enable row level security;
alter table public.logs      enable row level security;

drop policy if exists trainers_self on public.trainers;
create policy trainers_self on public.trainers for select to authenticated
  using (user_id = auth.uid());

drop policy if exists clients_trainer on public.clients;
create policy clients_trainer on public.clients for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());
drop policy if exists clients_self_read on public.clients;
create policy clients_self_read on public.clients for select to authenticated
  using (user_id = auth.uid());

drop policy if exists plans_trainer on public.plans;
create policy plans_trainer on public.plans for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());
drop policy if exists plans_self_read on public.plans;
create policy plans_self_read on public.plans for select to authenticated
  using (client_id = public.my_client_id());

drop policy if exists templates_trainer on public.templates;
create policy templates_trainer on public.templates for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());

drop policy if exists library_trainer on public.library;
create policy library_trainer on public.library for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());

drop policy if exists logs_trainer on public.logs;
create policy logs_trainer on public.logs for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());
drop policy if exists logs_self_read on public.logs;
create policy logs_self_read on public.logs for select to authenticated
  using (client_id = public.my_client_id());
drop policy if exists logs_self_insert on public.logs;
create policy logs_self_insert on public.logs for insert to authenticated
  with check (client_id = public.my_client_id());
drop policy if exists logs_self_update on public.logs;
create policy logs_self_update on public.logs for update to authenticated
  using (client_id = public.my_client_id()) with check (client_id = public.my_client_id());
