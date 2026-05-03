-- ML Analys helper functions

create or replace function public.ml_decision_category(_decision text, _reason text)
returns text language sql immutable as $$
  select case
    when _decision = 'charge' then 'charging'
    when _decision = 'v2h' then 'v2h'
    when coalesce(_reason,'') like '%cable_disconnected%' or coalesce(_reason,'') like '%morning_guarantee%' then 'away'
    else 'pause'
  end;
$$;

create or replace function public.ml_hourly_distribution(_household uuid default null)
returns table(hour_of_day int, charging_pct numeric, v2h_pct numeric, away_pct numeric, pause_pct numeric, total bigint)
language sql stable set search_path = public as $$
  with cat as (
    select extract(hour from logged_at)::int as h,
           public.ml_decision_category(decision, reason) as cat
    from public.optimization_logs
    where _household is null or household_id = _household
  ), agg as (
    select h, cat, count(*)::bigint c from cat group by h, cat
  ), tot as (
    select h, sum(c) t from agg group by h
  )
  select tot.h,
    round(coalesce(sum(c) filter (where cat='charging'),0)*100.0/nullif(tot.t,0), 1),
    round(coalesce(sum(c) filter (where cat='v2h'),0)*100.0/nullif(tot.t,0), 1),
    round(coalesce(sum(c) filter (where cat='away'),0)*100.0/nullif(tot.t,0), 1),
    round(coalesce(sum(c) filter (where cat='pause'),0)*100.0/nullif(tot.t,0), 1),
    tot.t
  from agg join tot using (h)
  group by tot.h, tot.t order by tot.h;
$$;

create or replace function public.ml_household_stats()
returns table(
  household_id uuid, name text, total_days bigint,
  v2h_hours_per_day numeric, charge_hours_per_day numeric,
  morning_guarantee_pct numeric, v2h_coverage_pct numeric,
  cable_in_min numeric, cable_out_min numeric,
  charge_start_min numeric, avg_sek_per_day numeric
)
language sql stable set search_path = public as $$
  with base as (
    select ol.*, date(ol.logged_at) as d,
      extract(hour from ol.logged_at)::int as h,
      (extract(hour from ol.logged_at)*60 + extract(minute from ol.logged_at))::int as min_of_day,
      hp.name, hp.leave_time, hp.max_soc_pct
    from public.optimization_logs ol
    join public.household_profiles hp on hp.id = ol.household_id
  ),
  daily as (
    select household_id, name, d,
      count(*) filter (where decision='v2h') as v2h_h,
      count(*) filter (where decision='charge') as charge_h,
      sum(coalesce(v2h_saving_sek,0)) as sek
    from base group by household_id, name, d
  ),
  morning as (
    select household_id, d,
      bool_or(h = leave_time and soc_pct >= max_soc_pct - 10) as ok,
      bool_or(h = leave_time) as had_leave
    from base group by household_id, d
  ),
  cable_in as (select household_id, d, min(min_of_day) as m from base where reason like '%cable_connected%' group by 1,2),
  cable_out as (select household_id, d, min(min_of_day) as m from base where reason like '%cable_disconnected%' group by 1,2),
  charge_start as (select household_id, d, min(min_of_day) as m from base where decision='charge' group by 1,2)
  select
    daily.household_id, daily.name,
    count(*)::bigint as total_days,
    round(avg(v2h_h)::numeric, 2) as v2h_hours_per_day,
    round(avg(charge_h)::numeric, 2) as charge_hours_per_day,
    round(100.0 * count(*) filter (where m_ok) / nullif(count(*) filter (where m_had),0), 1) as morning_guarantee_pct,
    round(100.0 * count(*) filter (where v2h_h > 0) / nullif(count(*),0), 1) as v2h_coverage_pct,
    round(avg(ci.m)::numeric, 0) as cable_in_min,
    round(avg(co.m)::numeric, 0) as cable_out_min,
    round(avg(cs.m)::numeric, 0) as charge_start_min,
    round(avg(sek)::numeric, 2) as avg_sek_per_day
  from daily
  left join (select household_id, d, ok as m_ok, had_leave as m_had from morning) m
    on m.household_id = daily.household_id and m.d = daily.d
  left join cable_in ci on ci.household_id = daily.household_id and ci.d = daily.d
  left join cable_out co on co.household_id = daily.household_id and co.d = daily.d
  left join charge_start cs on cs.household_id = daily.household_id and cs.d = daily.d
  group by daily.household_id, daily.name
  order by v2h_hours_per_day desc nulls last;
$$;

create or replace function public.ml_kpis()
returns json language sql stable set search_path = public as $$
  with s as (select * from public.ml_household_stats())
  select json_build_object(
    'total_sims', (select count(distinct simulation_id) from public.optimization_logs),
    'total_households', (select count(distinct household_id) from public.optimization_logs),
    'avg_v2h_hours_per_day', (select round(avg(v2h_hours_per_day)::numeric,1) from s),
    'avg_cable_in_min', (select round(avg(cable_in_min)::numeric,0) from s),
    'avg_cable_out_min', (select round(avg(cable_out_min)::numeric,0) from s),
    'avg_charge_start_min', (select round(avg(charge_start_min)::numeric,0) from s),
    'v2h_coverage_pct', (select round(avg(v2h_coverage_pct)::numeric,1) from s),
    'morning_guarantee_pct', (select round(avg(morning_guarantee_pct)::numeric,1) from s),
    'avg_v2h_start_min', (
      select round(avg(m)::numeric,0) from (
        select household_id, date(logged_at) as d, min((extract(hour from logged_at)*60+extract(minute from logged_at))::int) as m
        from public.optimization_logs where decision='v2h' group by 1,2
      ) x
    )
  );
$$;

create or replace function public.ml_challenges()
returns json language sql stable set search_path = public as $$
  with leave_rows as (
    select ol.soc_pct, hp.max_soc_pct
    from public.optimization_logs ol
    join public.household_profiles hp on hp.id = ol.household_id
    where extract(hour from ol.logged_at) = hp.leave_time
  ),
  evening as (
    select date(logged_at) as d, household_id,
      bool_or(decision='v2h') as had_v2h,
      max(coalesce(spot_price_sek,0)) as max_p
    from public.optimization_logs
    where extract(hour from logged_at) between 16 and 22
    group by 1,2
  ),
  daily_price as (
    select date(hour) as d, max(price_sek_kwh) - min(price_sek_kwh) as spread
    from public.spot_prices group by 1
  )
  select json_build_object(
    'morning_missed_pct',
      (select round(100.0 * count(*) filter (where soc_pct < max_soc_pct - 10) / nullif(count(*),0), 1) from leave_rows),
    'forgot_charge_pct',
      (select round(100.0 * count(*) filter (where soc_pct < 45) / nullif(count(*),0), 1) from leave_rows),
    'missed_v2h_pct',
      (select round(100.0 * count(*) filter (where not had_v2h and max_p > 1.5) / nullif(count(*) filter (where max_p > 1.5),0), 1) from evening),
    'extreme_hours_count',
      (select count(*) from public.optimization_logs where spot_price_sek > 2.0),
    'extreme_v2h_pct',
      (select round(100.0 * count(*) filter (where decision='v2h') / nullif(count(*),0), 1) from public.optimization_logs where spot_price_sek > 2.0),
    'flat_days_count',
      (select count(*) from daily_price where spread < 0.08)
  );
$$;