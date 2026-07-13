-- Dashboard overview periods RPC (run in Supabase SQL Editor)
-- Mirrors lib/supabase/fsm-schema.sql dashboard RPC section

CREATE OR REPLACE FUNCTION public.overview_job_status_display(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE UPPER(COALESCE(p_status, 'PENDING'))
    WHEN 'COMPLETED' THEN 'Completed'
    WHEN 'IN_PROGRESS' THEN 'In Progress'
    WHEN 'INPROGRESS' THEN 'In Progress'
    WHEN 'PENDING' THEN 'Created'
    WHEN 'CREATED' THEN 'Created'
    ELSE COALESCE(p_status, 'PENDING')
  END;
$$;

CREATE OR REPLACE FUNCTION public.overview_classify_bucket(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN UPPER(COALESCE(p_status, '')) LIKE '%COMPLET%'
      OR LOWER(public.overview_job_status_display(p_status)) LIKE '%complete%'
      THEN 'completed'
    WHEN UPPER(COALESCE(p_status, '')) IN ('CREATED', 'PENDING')
      OR LOWER(public.overview_job_status_display(p_status)) LIKE '%created%'
      THEN 'pending'
    WHEN UPPER(COALESCE(p_status, '')) LIKE '%PROGRESS%'
      OR LOWER(public.overview_job_status_display(p_status)) LIKE '%progress%'
      THEN 'inProgress'
    ELSE 'other'
  END;
$$;

CREATE OR REPLACE FUNCTION public._dashboard_overview_previous_count(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(*)::BIGINT
  FROM jobs
  WHERE deleted_at IS NULL
    AND created_at >= (p_start - (p_end - p_start))
    AND created_at < p_start;
$$;

CREATE OR REPLACE FUNCTION public._dashboard_overview_period_slice(
  p_period TEXT,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_previous_count BIGINT,
  p_now TIMESTAMPTZ,
  p_twenty_four_hours_ago TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $slice$
DECLARE
  labels TEXT[];
  n_buckets INT;
  completed_arr BIGINT[];
  pending_arr BIGINT[];
  in_progress_arr BIGINT[];
  rec RECORD;
  idx INT;
  bucket_idx INT;
  total_tasks BIGINT := 0;
  active_workers BIGINT := 0;
  pending_tasks BIGINT := 0;
  completed_tasks BIGINT := 0;
  active_jobs_count BIGINT := 0;
  new_jobs_count BIGINT := 0;
  unassigned_count BIGINT := 0;
  high_priority_count BIGINT := 0;
  overdue_scheduled_count BIGINT := 0;
  unique_customers BIGINT := 0;
  task_growth INT;
  distribution JSON;
  top_status_raw TEXT;
  top_status_count BIGINT := 0;
  top_status_pct TEXT;
  completion_rate_pct TEXT;
  status_upper TEXT;
  is_done BOOLEAN;
BEGIN
  IF p_period = 'Today' THEN
    labels := ARRAY(
      SELECT (g::TEXT || ':00')
      FROM generate_series(0, 23) AS g
    );
    n_buckets := 24;
  ELSIF p_period = 'This Week' THEN
    labels := ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    n_buckets := 7;
  ELSIF p_period = 'This Month' THEN
    labels := ARRAY['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
    n_buckets := 5;
  ELSE
    labels := ARRAY['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    n_buckets := 12;
  END IF;

  completed_arr := array_fill(0::BIGINT, ARRAY[n_buckets]);
  pending_arr := array_fill(0::BIGINT, ARRAY[n_buckets]);
  in_progress_arr := array_fill(0::BIGINT, ARRAY[n_buckets]);

  FOR rec IN
    SELECT *
    FROM _overview_jobs_enriched
    WHERE created_at >= p_start
      AND created_at <= p_end
  LOOP
    total_tasks := total_tasks + 1;

    status_upper := UPPER(COALESCE(rec.status, ''));

    IF status_upper IN ('CREATED', 'PENDING', 'IN_PROGRESS')
      OR rec.job_status_display IN ('Created', 'In Progress') THEN
      pending_tasks := pending_tasks + 1;
    END IF;

    IF status_upper LIKE '%COMPLET%'
      OR rec.job_status_display IN ('Completed', 'Job Complete') THEN
      completed_tasks := completed_tasks + 1;
    END IF;

    IF status_upper LIKE '%PROGRESS%' OR rec.job_status_display = 'In Progress' THEN
      active_jobs_count := active_jobs_count + 1;
    END IF;

    IF (status_upper IN ('CREATED', 'PENDING') OR rec.job_status_display = 'Created')
      AND rec.created_at >= p_twenty_four_hours_ago THEN
      new_jobs_count := new_jobs_count + 1;
    END IF;

    IF rec.technician_ids IS NULL OR cardinality(rec.technician_ids) = 0 THEN
      unassigned_count := unassigned_count + 1;
    END IF;

    IF UPPER(COALESCE(rec.priority, '')) LIKE '%HIGH%'
      OR UPPER(COALESCE(rec.priority, '')) LIKE '%URGENT%'
      OR rec.priority IN ('4', 'H') THEN
      high_priority_count := high_priority_count + 1;
    END IF;

    is_done :=
      status_upper LIKE '%COMPLET%'
      OR rec.job_status_display IN ('Completed', 'Job Complete')
      OR status_upper = 'CANCELLED'
      OR rec.job_status_display = 'Cancelled';

    IF NOT is_done
      AND rec.scheduled_end IS NOT NULL
      AND rec.scheduled_end < p_now THEN
      overdue_scheduled_count := overdue_scheduled_count + 1;
    END IF;

  END LOOP;

  FOR rec IN
    SELECT *
    FROM _overview_jobs_enriched
    WHERE created_at >= p_start
      AND created_at <= p_end
  LOOP
    IF p_period = 'Today' THEN
      bucket_idx := EXTRACT(HOUR FROM rec.created_at)::INT;
    ELSIF p_period = 'This Week' THEN
      idx := EXTRACT(DOW FROM rec.created_at)::INT;
      bucket_idx := CASE WHEN idx = 0 THEN 6 ELSE idx - 1 END;
    ELSIF p_period = 'This Month' THEN
      bucket_idx := LEAST(FLOOR((EXTRACT(DAY FROM rec.created_at) - 1) / 7)::INT, 4);
    ELSE
      bucket_idx := EXTRACT(MONTH FROM rec.created_at)::INT - 1;
    END IF;

    IF bucket_idx < 0 OR bucket_idx >= n_buckets THEN
      CONTINUE;
    END IF;

    idx := bucket_idx + 1;
    IF rec.chart_bucket = 'completed' THEN
      completed_arr[idx] := completed_arr[idx] + 1;
    ELSIF rec.chart_bucket = 'pending' THEN
      pending_arr[idx] := pending_arr[idx] + 1;
    ELSIF rec.chart_bucket = 'inProgress' THEN
      in_progress_arr[idx] := in_progress_arr[idx] + 1;
    END IF;
  END LOOP;

  SELECT COUNT(DISTINCT customer_id)::BIGINT
  INTO unique_customers
  FROM _overview_jobs_enriched
  WHERE created_at >= p_start
    AND created_at <= p_end
    AND customer_id IS NOT NULL;

  SELECT COALESCE(
    (
      SELECT json_object_agg(status_raw, cnt)
      FROM (
        SELECT status_raw, COUNT(*)::BIGINT AS cnt
        FROM _overview_jobs_enriched
        WHERE created_at >= p_start
          AND created_at <= p_end
        GROUP BY status_raw
      ) d
    ),
    '{}'::JSON
  )
  INTO distribution;

  SELECT status_raw, cnt
  INTO top_status_raw, top_status_count
  FROM (
    SELECT status_raw, COUNT(*)::BIGINT AS cnt
    FROM _overview_jobs_enriched
    WHERE created_at >= p_start
      AND created_at <= p_end
    GROUP BY status_raw
    ORDER BY cnt DESC, status_raw ASC
    LIMIT 1
  ) t;

  IF p_previous_count = 0 THEN
    task_growth := CASE WHEN total_tasks > 0 THEN 100 ELSE 0 END;
  ELSE
    task_growth := ROUND(((total_tasks - p_previous_count)::NUMERIC / p_previous_count) * 100)::INT;
  END IF;

  IF total_tasks > 0 AND top_status_count > 0 THEN
    top_status_pct := ROUND((top_status_count::NUMERIC / total_tasks) * 100, 1)::TEXT;
  ELSE
    top_status_pct := NULL;
  END IF;

  IF total_tasks > 0 THEN
    completion_rate_pct := ROUND((completed_tasks::NUMERIC / total_tasks) * 100, 1)::TEXT;
  ELSE
    completion_rate_pct := '0';
  END IF;

  SELECT COUNT(DISTINCT tech_id)::BIGINT
  INTO active_workers
  FROM _overview_jobs_enriched je
  CROSS JOIN LATERAL unnest(
    CASE
      WHEN je.technician_ids IS NULL THEN ARRAY[]::UUID[]
      ELSE je.technician_ids
    END
  ) AS tech_id
  WHERE je.created_at >= p_start
    AND je.created_at <= p_end
    AND (
      UPPER(COALESCE(je.status, '')) LIKE '%PROGRESS%'
      OR je.job_status_display = 'In Progress'
    );

  RETURN json_build_object(
    'labels', labels,
    'completed', completed_arr,
    'pending', pending_arr,
    'inProgress', in_progress_arr,
    'distribution', distribution,
    'stats', json_build_object(
      'totalTasks', total_tasks,
      'activeWorkers', COALESCE(active_workers, 0),
      'pendingTasks', pending_tasks,
      'completedTasks', completed_tasks,
      'activeJobsCount', active_jobs_count,
      'newJobsCount', new_jobs_count,
      'taskGrowth', task_growth
    ),
    'insights', json_build_object(
      'periodTotal', total_tasks,
      'topStatusRaw', top_status_raw,
      'topStatusCount', COALESCE(top_status_count, 0),
      'topStatusPct', top_status_pct,
      'completedCount', completed_tasks,
      'completionRatePct', completion_rate_pct,
      'unassignedCount', unassigned_count,
      'inProgressInPeriod', active_jobs_count,
      'highPriorityCount', high_priority_count,
      'overdueScheduledCount', overdue_scheduled_count,
      'uniqueCustomers', COALESCE(unique_customers, 0)
    )
  );
END;
$slice$;

CREATE OR REPLACE FUNCTION public.dashboard_overview_periods_json()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $func$
DECLARE
  v_today_start TIMESTAMPTZ;
  v_today_end TIMESTAMPTZ;
  v_week_start TIMESTAMPTZ;
  v_month_start TIMESTAMPTZ;
  v_year_start TIMESTAMPTZ;
  v_now TIMESTAMPTZ;
  v_24h_ago TIMESTAMPTZ;
  v_prev_today BIGINT;
  v_prev_week BIGINT;
  v_prev_month BIGINT;
  v_prev_year BIGINT;
BEGIN
  v_now := NOW();
  v_today_start := date_trunc('day', v_now);
  v_today_end := v_today_start + INTERVAL '1 day' - INTERVAL '1 millisecond';
  v_week_start := date_trunc('week', v_now);
  v_month_start := date_trunc('month', v_now);
  v_year_start := date_trunc('year', v_now);
  v_24h_ago := v_now - INTERVAL '24 hours';

  CREATE TEMP TABLE _overview_jobs_enriched ON COMMIT DROP AS
  SELECT
    j.id,
    j.status,
    j.created_at,
    j.scheduled_end,
    j.priority,
    j.customer_id,
    public.overview_job_status_display(j.status) AS job_status_display,
    public.overview_classify_bucket(j.status) AS chart_bucket,
    COALESCE(NULLIF(TRIM(j.status::TEXT), ''), 'UNKNOWN') AS status_raw,
    COALESCE(tj.tech_ids, ARRAY[]::UUID[]) AS technician_ids
  FROM jobs j
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(DISTINCT tj.technician_id) AS tech_ids
    FROM technician_jobs tj
    WHERE tj.job_id = j.id
      AND tj.deleted_at IS NULL
  ) tj ON true
  WHERE j.deleted_at IS NULL
    AND j.created_at >= v_year_start
    AND j.created_at <= v_today_end;

  v_prev_today := public._dashboard_overview_previous_count(v_today_start, v_today_end);
  v_prev_week := public._dashboard_overview_previous_count(v_week_start, v_today_end);
  v_prev_month := public._dashboard_overview_previous_count(v_month_start, v_today_end);
  v_prev_year := public._dashboard_overview_previous_count(v_year_start, v_today_end);

  RETURN json_build_object(
    'Today', public._dashboard_overview_period_slice(
      'Today', v_today_start, v_today_end, v_prev_today, v_now, v_24h_ago
    ),
    'This Week', public._dashboard_overview_period_slice(
      'This Week', v_week_start, v_today_end, v_prev_week, v_now, v_24h_ago
    ),
    'This Month', public._dashboard_overview_period_slice(
      'This Month', v_month_start, v_today_end, v_prev_month, v_now, v_24h_ago
    ),
    'This Year', public._dashboard_overview_period_slice(
      'This Year', v_year_start, v_today_end, v_prev_year, v_now, v_24h_ago
    )
  );
END;
$func$;
