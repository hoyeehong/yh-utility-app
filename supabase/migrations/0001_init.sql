-- Utility bill calculator — initial schema.
-- Apply via the Supabase SQL editor or `supabase db push`.

create table public.calculations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  billing_month    text not null,
  created_at       timestamptz not null default now(),

  elec_current     numeric(12,4) not null default 0,
  elec_last        numeric(12,4) not null default 0,
  elec_usage       numeric(12,4) not null default 0,
  elec_rate        numeric(12,6) not null default 0,
  elec_total       numeric(12,4) not null default 0,

  water_current    numeric(12,4) not null default 0,
  water_last       numeric(12,4) not null default 0,
  water_usage      numeric(12,4) not null default 0,
  water_mult_one   numeric(12,4) not null default 0,
  water_mult_two   numeric(12,4) not null default 0,
  water_mult_three numeric(12,4) not null default 0,
  water_tax_base   numeric(12,4) not null default 0,
  water_tax_final  numeric(12,4) not null default 0,
  water_total      numeric(12,4) not null default 0,

  combined_total   numeric(12,4) not null default 0
);

create index calculations_user_created_idx
  on public.calculations (user_id, created_at desc);

alter table public.calculations enable row level security;

create policy "own rows: select" on public.calculations
  for select using (auth.uid() = user_id);

create policy "own rows: insert" on public.calculations
  for insert with check (auth.uid() = user_id);

create policy "own rows: update" on public.calculations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own rows: delete" on public.calculations
  for delete using (auth.uid() = user_id);
