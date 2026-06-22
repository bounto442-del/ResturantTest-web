-- Restaurant Test — Rewards / loyalty migration
-- Run this in the Supabase SQL editor for project wkohvggqwxowijbgdrbt.

-- 1. Active loyalty rule stored on the singleton settings row.
alter table settings add column if not exists loyalty_config jsonb default null;

-- 2. Optional custom full-page background image URL for the web app.
alter table settings add column if not exists background_image_url text;

-- 3. Track per-phone reward progress.
create table if not exists customer_rewards (
  id uuid primary key default uuid_generate_v4(),
  phone text unique not null,
  stamps integer default 0,
  purchase_count integer default 0,
  lifetime_orders integer default 0,
  opt_in boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
create index if not exists idx_customer_rewards_phone on customer_rewards(phone);

-- 4. Record loyalty discounts on orders so receipts show them.
alter table orders add column if not exists loyalty_discount integer default 0;
alter table orders add column if not exists loyalty_reward_name text;

-- 5. RLS
alter table customer_rewards enable row level security;

drop policy if exists "public read customer_rewards" on customer_rewards;
create policy "public read customer_rewards" on customer_rewards for select using (true);

drop policy if exists "owner write customer_rewards" on customer_rewards;
create policy "owner write customer_rewards" on customer_rewards
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Customers can opt in from checkout without being signed in.
drop policy if exists "public opt-in customer_rewards" on customer_rewards;
create policy "public opt-in customer_rewards" on customer_rewards
  for insert with check (opt_in = true and phone is not null);

drop policy if exists "public opt-in update" on customer_rewards;
create policy "public opt-in update" on customer_rewards
  for update using (true) with check (opt_in = true);

-- 6. Trigger
drop trigger if exists trg_customer_rewards_updated on customer_rewards;
create trigger trg_customer_rewards_updated before update on customer_rewards
  for each row execute function update_updated_at();
