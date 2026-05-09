CREATE OR REPLACE FUNCTION public.ml_kpis()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with s as (select * from public.ml_household_stats()),
  v2h_per_day as (
    select simulation_id, date(logged_at) as d,
           count(distinct extract(hour from logged_at)) filter (where decision='v2h') as h
    from public.optimization_logs
    where simulation_id is not null
    group by 1,2
  )
  select json_build_object(
    'total_sims', (select count(distinct simulation_id) from public.optimization_logs),
    'total_households', (select count(distinct household_id) from public.optimization_logs),
    'avg_v2h_hours_per_day', (select round(avg(h)::numeric,1) from v2h_per_day),
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
$function$;