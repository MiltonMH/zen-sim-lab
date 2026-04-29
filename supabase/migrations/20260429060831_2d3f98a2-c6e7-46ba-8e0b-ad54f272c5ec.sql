create or replace function public.spot_prices_years()
returns table (
  year int,
  rows bigint,
  avg_price numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    extract(year from (hour at time zone 'Europe/Stockholm'))::int as year,
    count(*)::bigint as rows,
    avg(price_sek_kwh)::numeric as avg_price
  from public.spot_prices
  group by 1
  order by 1;
$$;

create or replace function public.spot_prices_months(_year int)
returns table (
  month int,
  rows bigint,
  avg_price numeric,
  max_price numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    extract(month from (hour at time zone 'Europe/Stockholm'))::int as month,
    count(*)::bigint as rows,
    avg(price_sek_kwh)::numeric as avg_price,
    max(price_sek_kwh)::numeric as max_price
  from public.spot_prices
  where extract(year from (hour at time zone 'Europe/Stockholm'))::int = _year
  group by 1
  order by 1;
$$;

create or replace function public.spot_prices_days(_year int, _month int)
returns table (
  day int,
  rows bigint,
  avg_price numeric,
  min_price numeric,
  max_price numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    extract(day from (hour at time zone 'Europe/Stockholm'))::int as day,
    count(*)::bigint as rows,
    avg(price_sek_kwh)::numeric as avg_price,
    min(price_sek_kwh)::numeric as min_price,
    max(price_sek_kwh)::numeric as max_price
  from public.spot_prices
  where extract(year from (hour at time zone 'Europe/Stockholm'))::int = _year
    and extract(month from (hour at time zone 'Europe/Stockholm'))::int = _month
  group by 1
  order by 1;
$$;