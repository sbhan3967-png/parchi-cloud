-- Parchi Cloud schema. Run this in Supabase Dashboard -> SQL Editor.
-- 1. Tables
create table if not exists parchis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  party_name text not null,
  bill_no text,
  bill_date date,
  kind text not null check (kind in ('silver','gold')),
  metal_rate numeric,              -- Rs per kg pure
  photo_url text,                   -- storage path in parchi-photos bucket
  total_amt numeric,                -- grand total payable (computed)
  photo_hash text,                  -- sha256 of uploaded photo (duplicate photo detection)
  content_hash text,                -- hash of normalized row data (duplicate content detection)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists parchi_rows (
  id uuid primary key default gen_random_uuid(),
  parchi_id uuid references parchis(id) on delete cascade not null,
  sno int,
  item text,
  gwt numeric, tunch numeric, net numeric, tw numeric,
  silver_wt numeric, wastage_pct numeric, wastage_rsg numeric,
  labour_rs numeric, labour_rsg numeric, total_rsg numeric, total_amt numeric,
  dia_wt numeric, dia_rate numeric, st_wt numeric, st_rate numeric,
  making numeric, billed numeric, calc_total numeric, diff numeric,
  flag text,
  created_at timestamptz default now()
);

create index if not exists idx_parchis_user on parchis(user_id, created_at desc);
create index if not exists idx_rows_parchi on parchi_rows(parchi_id, sno);

-- 2. Row Level Security (each user sees only their own data)
alter table parchis enable row level security;
alter table parchi_rows enable row level security;

drop policy if exists "own parchis" on parchis;
create policy "own parchis" on parchis
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on parchi_rows;
create policy "own rows" on parchi_rows
  for all using (
    exists (select 1 from parchis p where p.id = parchi_rows.parchi_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from parchis p where p.id = parchi_rows.parchi_id and p.user_id = auth.uid())
  );

-- 3. Storage bucket for parchi photos (create in Dashboard -> Storage, or via SQL)
insert into storage.buckets (id, name, public)
values ('parchi-photos', 'parchi-photos', false)
on conflict (id) do nothing;

-- Storage policies: users can upload/read/delete only under their own folder user_id/
drop policy if exists "own photo upload" on storage.objects;
create policy "own photo upload" on storage.objects
  for insert with check (bucket_id = 'parchi-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "own photo read" on storage.objects;
create policy "own photo read" on storage.objects
  for select using (bucket_id = 'parchi-photos' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "own photo delete" on storage.objects;
create policy "own photo delete" on storage.objects
  for delete using (bucket_id = 'parchi-photos' and auth.uid()::text = (storage.foldername(name))[1]);
