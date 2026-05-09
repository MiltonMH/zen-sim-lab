CREATE OR REPLACE FUNCTION public.ml_kpis()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with s as (select * from public.ml_household_stats()),
  per_sim as (
    select simulation_id,
      count(distinct date_trunc('hour', logged_at)) filter (where decision='v2h') as v2h_hours,
      count(distinct date(logged_at)) as days
    from public.optimization_logs
    where simulation_id is not null
    group by simulation_id
  )
  select json_build_object(
    'total_sims', (select count(distinct simulation_id) from public.optimization_logs),
    'total_households', (select count(distinct household_id) from public.optimization_logs),
    'avg_v2h_hours_per_day', (select round(avg(v2h_hours::numeric / nullif(days,0))::numeric,1) from per_sim),
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