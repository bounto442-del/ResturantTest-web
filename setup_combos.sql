-- Restaurant Test — Combos table migration
-- Run this in the Supabase SQL editor for project wkohvggqwxowijbgdrbt.

-- Requires: update_updated_at() function from setup_menu_items.sql

create table if not exists combos (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  combo_price integer not null,           -- cents, single price for the whole bundle
  image_url text,                          -- optional, reuses menu-images bucket
  emoji text default '🎁',
  item_ids uuid[] not null default '{}',
  active boolean default true,
  display_order integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists idx_combos_active on combos(active);

alter table combos enable row level security;

-- Public read for customer carousel
drop policy if exists "public read combos" on combos;
create policy "public read combos" on combos for select using (true);

-- Owner writes require Supabase Auth
drop policy if exists "public write combos" on combos;
drop policy if exists "owner write combos" on combos;
create policy "owner write combos" on combos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Auto-update trigger
drop trigger if exists trg_combos_updated on combos;
create trigger trg_combos_updated before update on combos
  for each row execute function update_updated_at();
