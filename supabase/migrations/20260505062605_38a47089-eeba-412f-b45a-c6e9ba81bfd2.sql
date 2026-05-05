
CREATE OR REPLACE FUNCTION public.ml_v2h_heatmap()
RETURNS TABLE(weekday int, hour_of_day int, v2h_pct numeric, total bigint)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT
    EXTRACT(DOW FROM logged_at)::int AS weekday,
    EXTRACT(HOUR FROM logged_at)::int AS hour_of_day,
    ROUND(COUNT(*) FILTER (WHERE decision='v2h') * 100.0 / NULLIF(COUNT(*),0), 1)::numeric AS v2h_pct,
    COUNT(*)::bigint AS total
  FROM public.optimization_logs
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

CREATE OR REPLACE FUNCTION public.ml_best_v2h_hour()
RETURNS TABLE(hour_of_day int, v2h_pct numeric)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH per_hour AS (
    SELECT EXTRACT(HOUR FROM logged_at)::int AS h,
      COUNT(*) FILTER (WHERE decision='v2h') * 100.0 / NULLIF(COUNT(*),0) AS p
    FROM public.optimization_logs
    GROUP BY 1
  )
  SELECT h, ROUND(p::numeric, 1) FROM per_hour ORDER BY p DESC NULLS LAST LIMIT 1;
$$;
