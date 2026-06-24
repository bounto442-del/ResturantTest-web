-- Demo Restaurant: add payment tracking columns to orders table
-- Run in Supabase SQL Editor

alter table orders
  add column if not exists payment_status text default 'pending',
  add column if not exists payment_method text,
  add column if not exists clover_charge_id text,
  add column if not exists clover_order_id text;

-- Update existing paid online orders that may have been saved before the columns existed
-- (safe no-op if the app already writes these on new orders)
update orders
  set payment_status = 'pending'
  where payment_status is null;
