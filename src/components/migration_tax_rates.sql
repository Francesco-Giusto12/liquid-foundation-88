-- Migration: aggiungi tabella tax_rates per aliquote analitiche IVA/IRPEF/INPS
-- Esegui nel SQL Editor di Supabase

create table if not exists public.tax_rates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  iva        numeric(5,4),   -- es. 0.22 = 22%
  irpef      numeric(5,4),   -- es. 0.15 = 15%
  inps       numeric(5,4),   -- es. 0.26 = 26%
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint tax_rates_user_unique unique (user_id)
);

-- RLS
alter table public.tax_rates enable row level security;

create policy "Users can manage their own tax_rates"
  on public.tax_rates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
