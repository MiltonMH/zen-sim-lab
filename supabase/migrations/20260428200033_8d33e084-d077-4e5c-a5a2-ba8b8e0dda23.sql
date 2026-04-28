-- Spot prices from Nordpool
create table public.spot_prices (
  id uuid primary key default gen_random_uuid(),
  hour timestamptz not null,
  price_sek_kwh numeric(8,5) not null,
  price_area text not null default 'SE3',
  source text default 'nordpool',
  created_at timestamptz default now()
);
create index spot_prices_hour_area_idx on public.spot_prices (hour, price_area);

-- Grid tariffs per company
create table public.grid_tariffs (
  id uuid primary key default gen_random_uuid(),
  grid_company text not null,
  hour_of_day int not null check (hour_of_day between 0 and 23),
  is_weekend bool not null default false,
  tariff_sek_kwh numeric(8,5) not null,
  valid_from date not null,
  valid_to date
);

-- Virtual households
create table public.household_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  house_type text not null default 'villa',
  area_m2 int,
  price_area text default 'SE3',
  grid_company text,
  car_model text,
  battery_kwh numeric(6,2),
  daily_km int,
  commuter_type text default 'pendlare',
  created_at timestamptz default now()
);

-- Virtual chargers (one per household)
create table public.virtual_chargers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.household_profiles(id) on delete cascade,
  current_soc numeric(5,2) default 80,
  status text default 'idle',
  created_at timestamptz default now()
);

-- Charging events (raw data for ML)
create table public.charging_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.household_profiles(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  kwh_charged numeric(8,3),
  kwh_discharged numeric(8,3),
  avg_price_sek numeric(8,5),
  event_type text not null,
  created_at timestamptz default now()
);

-- ZenOS decision logs
create table public.optimization_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.household_profiles(id) on delete cascade,
  logged_at timestamptz not null default now(),
  decision text not null,
  spot_price_sek numeric(8,5),
  soc_pct numeric(5,2),
  reason text
);

-- Simulation runs
create table public.simulation_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.household_profiles(id) on delete cascade,
  started_at timestamptz default now(),
  ended_at timestamptz,
  period_from date not null,
  period_to date not null,
  optimization_mode text not null,
  scenarios int default 1,
  total_saved_sek numeric(10,2),
  avg_price_paid numeric(8,5),
  status text default 'pending'
);

-- Enable RLS on all tables
alter table public.spot_prices enable row level security;
alter table public.grid_tariffs enable row level security;
alter table public.household_profiles enable row level security;
alter table public.virtual_chargers enable row level security;
alter table public.charging_events enable row level security;
alter table public.optimization_logs enable row level security;
alter table public.simulation_runs enable row level security;

-- Public access policies (internal tool, no auth)
do $$
declare t text;
begin
  for t in select unnest(array[
    'spot_prices','grid_tariffs','household_profiles','virtual_chargers',
    'charging_events','optimization_logs','simulation_runs'
  ])
  loop
    execute format('create policy "Public read %1$s" on public.%1$I for select using (true);', t);
    execute format('create policy "Public insert %1$s" on public.%1$I for insert with check (true);', t);
    execute format('create policy "Public update %1$s" on public.%1$I for update using (true);', t);
    execute format('create policy "Public delete %1$s" on public.%1$I for delete using (true);', t);
  end loop;
end $$;