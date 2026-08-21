#!/usr/bin/env node
/**
 * Benchmarks workflow execution throughput and scheduling lag.
 *
 * Usage:
 *   node benchmark_workflow_executions.mjs [options]
 *
 * Options:
 *   --workflow-id <id>   Workflow ID to run (default: new-workflow-1)
 *   --count <n>          Number of executions to schedule (default: 1000)
 *   --concurrency <n>    HTTP concurrency for scheduling (default: 50)
 *   --kibana <url>       Kibana base URL (default: http://localhost:5601)
 *   --es <url>           Elasticsearch base URL (default: http://localhost:9200)
 *   --user <u:p>         Basic auth credentials (default: elastic:changeme)
 *   --output <file>      Report output path (default: benchmark_report_<timestamp>.json)
 *   --poll-interval <ms> How often to poll ES for completion (default: 5000)
 */

import { writeFileSync } from 'fs';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const get = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
};

const WORKFLOW_ID = get('--workflow-id', 'new-workflow-1');
const COUNT = parseInt(get('--count', '1000'), 10);
const CONCURRENCY = parseInt(get('--concurrency', '50'), 10);
const KIBANA_URL = get('--kibana', 'http://localhost:5601');
const ES_URL = get('--es', 'http://localhost:9200');
const [USER, PASS] = get('--user', 'elastic:changeme').split(':');
const POLL_INTERVAL_MS = parseInt(get('--poll-interval', '5000'), 10);
const OUTPUT = get(
  '--output',
  `benchmark_report_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);

const EXECUTIONS_INDEX = '.workflows-executions';
const API_VERSION = '2023-10-31';

const authHeader = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;
const kibanaHeaders = {
  Authorization: authHeader,
  'Content-Type': 'application/json',
  'kbn-xsrf': 'true',
  'elastic-api-version': API_VERSION,
};
const esHeaders = { Authorization: authHeader, 'Content-Type': 'application/json' };

// ── Helpers ───────────────────────────────────────────────────────────────────

const esPost = (path, body) =>
  fetch(`${ES_URL}${path}`, { method: 'POST', headers: esHeaders, body: JSON.stringify(body) }).then(
    (r) => r.json()
  );

const now = () => new Date().toISOString();
const log = (msg) => process.stdout.write(`[${now()}] ${msg}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Pre-flight check ──────────────────────────────────────────────────────────

async function waitForKibana() {
  log('Checking Kibana is ready…');
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${KIBANA_URL}/api/status`, { headers: { Authorization: authHeader } });
      if (r.ok) {
        const body = await r.json();
        const level = body?.status?.overall?.level;
        if (level === 'available') {
          log(`Kibana is available (${body?.version?.number})`);
          return;
        }
        log(`Kibana not ready yet (status: ${level}), retrying…`);
      } else {
        log(`Kibana health check returned HTTP ${r.status}, retrying…`);
      }
    } catch (e) {
      log(`Kibana unreachable (${e.message}), retrying…`);
    }
    await sleep(Math.min(2000 * attempt, 10_000));
  }
}

// ── Phase 1: Schedule executions ──────────────────────────────────────────────

const scheduleUrl = `${KIBANA_URL}/api/workflows/workflow/${WORKFLOW_ID}/run`;
const scheduleBody = JSON.stringify({ inputs: {} });

// Retryable: network errors and 5xx. Non-retryable: 4xx (bad request, disabled workflow, etc.)
async function scheduleOne() {
  const MAX_RETRIES = 5;
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s, 2s, 4s
    try {
      const res = await fetch(scheduleUrl, { method: 'POST', headers: kibanaHeaders, body: scheduleBody });
      if (res.ok) {
        const { workflowExecutionId } = await res.json();
        return workflowExecutionId;
      }
      const text = await res.text();
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      if (res.status < 500) throw err; // 4xx — non-retryable
      lastErr = err;
    } catch (e) {
      if (e.message.startsWith('HTTP 4')) throw e; // propagate 4xx immediately
      lastErr = e;
    }
  }
  throw lastErr;
}

async function scheduleAll() {
  log(`Scheduling ${COUNT} executions for workflow "${WORKFLOW_ID}" (concurrency=${CONCURRENCY})`);
  const scheduledIds = [];
  const errorMessages = new Map(); // message -> count
  let errors = 0;
  const scheduleStart = Date.now();

  for (let start = 0; start < COUNT; start += CONCURRENCY) {
    const batch = [];
    for (let j = start; j < Math.min(start + CONCURRENCY, COUNT); j++) {
      batch.push(
        scheduleOne().catch((e) => {
          errors++;
          const msg = e.message ?? String(e);
          errorMessages.set(msg, (errorMessages.get(msg) ?? 0) + 1);
          return null;
        })
      );
    }
    const results = await Promise.all(batch);
    for (const id of results) {
      if (id) scheduledIds.push(id);
    }
    const pct = Math.round((Math.min(start + CONCURRENCY, COUNT) / COUNT) * 100);
    process.stdout.write(`\r  ${Math.min(start + CONCURRENCY, COUNT)}/${COUNT} (${pct}%) — ok:${scheduledIds.length} err:${errors}`);
  }

  if (errors > 0) {
    process.stdout.write('\n');
    for (const [msg, count] of errorMessages) {
      process.stderr.write(`  [schedule error x${count}] ${msg}\n`);
    }
  }

  const scheduleMs = Date.now() - scheduleStart;
  process.stdout.write('\n');
  log(`Scheduled ${scheduledIds.length} executions in ${(scheduleMs / 1000).toFixed(1)}s (${errors} errors)`);

  return { scheduledIds, errors, errorMessages, scheduleMs };
}

// ── Phase 2: Poll until all terminal ─────────────────────────────────────────

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'error'];

async function waitForCompletion(scheduledIds, benchmarkStart) {
  log(`Waiting for all ${scheduledIds.length} executions to reach a terminal status…`);

  const idSet = new Set(scheduledIds);
  const terminalStatuses = TERMINAL_STATUSES;

  while (true) {
    const r = await esPost(`/${EXECUTIONS_INDEX}/_search`, {
      size: 0,
      query: {
        bool: {
          filter: [
            { term: { workflowId: WORKFLOW_ID } },
            { terms: { id: scheduledIds } },
          ],
        },
      },
      aggs: {
        by_status: { terms: { field: 'status', size: 20 } },
        terminal: {
          filter: { terms: { status: terminalStatuses } },
        },
      },
    });

    const aggs = r.aggregations ?? {};
    const terminalCount = aggs.terminal?.doc_count ?? 0;
    const statusBreakdown = (aggs.by_status?.buckets ?? [])
      .map((b) => `${b.key}:${b.doc_count}`)
      .join(' ');

    const elapsed = ((Date.now() - benchmarkStart) / 1000).toFixed(0);
    process.stdout.write(
      `\r  ${elapsed}s elapsed — terminal:${terminalCount}/${scheduledIds.length}  [${statusBreakdown}]   `
    );

    if (terminalCount >= scheduledIds.length) {
      process.stdout.write('\n');
      log('All executions reached terminal status.');
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// ── Phase 3: Compute metrics ──────────────────────────────────────────────────

async function computeMetrics(scheduledIds) {
  log('Computing metrics…');

  const r = await esPost(`/${EXECUTIONS_INDEX}/_search`, {
    size: 0,
    query: {
      bool: {
        filter: [
          { term: { workflowId: WORKFLOW_ID } },
          { terms: { id: scheduledIds } },
        ],
      },
    },
    aggs: {
      by_status: { terms: { field: 'status', size: 20 } },

      completed: {
        filter: { term: { status: 'completed' } },
        aggs: {
          duration_stats: { stats: { field: 'duration' } },

          scheduling_lag: {
            scripted_metric: {
              init_script: 'state.lags = []',
              map_script: `
                if (doc['startedAt'].size() > 0 && doc['createdAt'].size() > 0) {
                  long lag = doc['startedAt'].value.toInstant().toEpochMilli()
                           - doc['createdAt'].value.toInstant().toEpochMilli();
                  state.lags.add(lag);
                }
              `,
              combine_script: 'return state.lags',
              reduce_script: `
                List all = [];
                for (s in states) { all.addAll(s); }
                if (all.isEmpty()) return null;
                Collections.sort(all);
                long sum = 0;
                for (long l : all) sum += l;
                return [
                  'count': all.size(),
                  'min_ms': all.get(0),
                  'max_ms': all.get(all.size() - 1),
                  'avg_ms': (double)sum / all.size(),
                  'p50_ms': all.get((int)(all.size() * 0.50)),
                  'p75_ms': all.get((int)(all.size() * 0.75)),
                  'p95_ms': all.get((int)(all.size() * 0.95)),
                  'p99_ms': all.get((int)(all.size() * 0.99))
                ]
              `,
            },
          },

          e2e_latency: {
            scripted_metric: {
              init_script: 'state.lats = []',
              map_script: `
                if (doc['finishedAt'].size() > 0 && doc['createdAt'].size() > 0) {
                  long lat = doc['finishedAt'].value.toInstant().toEpochMilli()
                           - doc['createdAt'].value.toInstant().toEpochMilli();
                  state.lats.add(lat);
                }
              `,
              combine_script: 'return state.lats',
              reduce_script: `
                List all = [];
                for (s in states) { all.addAll(s); }
                if (all.isEmpty()) return null;
                Collections.sort(all);
                long sum = 0;
                for (long l : all) sum += l;
                return [
                  'count': all.size(),
                  'min_ms': all.get(0),
                  'max_ms': all.get(all.size() - 1),
                  'avg_ms': (double)sum / all.size(),
                  'p50_ms': all.get((int)(all.size() * 0.50)),
                  'p75_ms': all.get((int)(all.size() * 0.75)),
                  'p95_ms': all.get((int)(all.size() * 0.95)),
                  'p99_ms': all.get((int)(all.size() * 0.99))
                ]
              `,
            },
          },

          started_at_min: { min: { field: 'startedAt' } },
          started_at_max: { max: { field: 'startedAt' } },
          finished_at_min: { min: { field: 'finishedAt' } },
          finished_at_max: { max: { field: 'finishedAt' } },
          created_at_min: { min: { field: 'createdAt' } },
          created_at_max: { max: { field: 'createdAt' } },

          throughput_over_time: {
            date_histogram: {
              field: 'finishedAt',
              fixed_interval: '30s',
              min_doc_count: 1,
            },
          },
        },
      },

      failed: {
        filter: { terms: { status: ['failed', 'error', 'cancelled'] } },
        aggs: {
          by_status: { terms: { field: 'status', size: 10 } },
        },
      },
    },
  });

  const aggs = r.aggregations ?? {};
  const comp = aggs.completed ?? {};
  const lag = comp.scheduling_lag?.value;
  const e2e = comp.e2e_latency?.value;
  const dur = comp.duration_stats ?? {};
  const completedCount = comp.doc_count ?? 0;
  const failedCount = aggs.failed?.doc_count ?? 0;

  const finMin = comp.finished_at_min?.value;
  const finMax = comp.finished_at_max?.value;
  const completionSpanMs = finMin && finMax ? finMax - finMin : null;
  const avgRps =
    completionSpanMs && completedCount > 1
      ? (completedCount - 1) / (completionSpanMs / 1000)
      : null;

  const throughputBuckets = (comp.throughput_over_time?.buckets ?? []).map((b) => ({
    window_start: b.key_as_string,
    completed: b.doc_count,
    rps: parseFloat((b.doc_count / 30).toFixed(2)),
  }));

  const peakRps =
    throughputBuckets.length > 0
      ? Math.max(...throughputBuckets.map((b) => b.rps))
      : null;

  const ms = (v) => (v != null ? Math.round(v) : null);
  const s2 = (v) => (v != null ? parseFloat((v / 1000).toFixed(2)) : null);

  return {
    status_breakdown: Object.fromEntries(
      (aggs.by_status?.buckets ?? []).map((b) => [b.key, b.doc_count])
    ),
    failed_breakdown: Object.fromEntries(
      (aggs.failed?.by_status?.buckets ?? []).map((b) => [b.key, b.doc_count])
    ),
    throughput: {
      completed: completedCount,
      failed: failedCount,
      completion_span_s: s2(completionSpanMs),
      avg_rps: avgRps != null ? parseFloat(avgRps.toFixed(2)) : null,
      peak_rps_30s_bucket: peakRps,
      over_time: throughputBuckets,
    },
    scheduling_lag: lag
      ? {
          description: 'createdAt → startedAt  (time task waited in queue)',
          count: lag.count,
          min_s: s2(lag.min_ms),
          avg_s: s2(lag.avg_ms),
          p50_s: s2(lag.p50_ms),
          p75_s: s2(lag.p75_ms),
          p95_s: s2(lag.p95_ms),
          p99_s: s2(lag.p99_ms),
          max_s: s2(lag.max_ms),
        }
      : null,
    execution_duration: {
      description: 'startedAt → finishedAt  (actual task run time)',
      count: dur.count ?? 0,
      min_s: s2(dur.min),
      avg_s: s2(dur.avg),
      max_s: s2(dur.max),
    },
    e2e_latency: e2e
      ? {
          description: 'createdAt → finishedAt  (total wall-clock per execution)',
          count: e2e.count,
          min_s: s2(e2e.min_ms),
          avg_s: s2(e2e.avg_ms),
          p50_s: s2(e2e.p50_ms),
          p75_s: s2(e2e.p75_ms),
          p95_s: s2(e2e.p95_ms),
          p99_s: s2(e2e.p99_ms),
          max_s: s2(e2e.max_ms),
        }
      : null,
    timestamps: {
      created_at_min: comp.created_at_min?.value_as_string ?? null,
      created_at_max: comp.created_at_max?.value_as_string ?? null,
      started_at_min: comp.started_at_min?.value_as_string ?? null,
      started_at_max: comp.started_at_max?.value_as_string ?? null,
      finished_at_min: comp.finished_at_min?.value_as_string ?? null,
      finished_at_max: comp.finished_at_max?.value_as_string ?? null,
    },
  };
}

// ── Phase 4: TM snapshot ──────────────────────────────────────────────────────

async function tmSnapshot() {
  const [runR, prR] = await Promise.all([
    esPost('/.kibana_task_manager/_search', {
      size: 0,
      query: { term: { 'task.taskType': 'workflow:run' } },
      aggs: { by_status: { terms: { field: 'task.status', size: 10 } } },
    }),
    esPost('/.kibana_task_manager/_search', {
      size: 1,
      query: { term: { 'task.taskType': 'taskManager:parallel-runner' } },
      _source: ['task.status', 'task.attempts'],
    }),
  ]);

  const byStatus = Object.fromEntries(
    (runR.aggregations?.by_status?.buckets ?? []).map((b) => [b.key, b.doc_count])
  );

  const prDoc = prR.hits?.hits?.[0]?._source?.task ?? null;
  const parallelRunner = prDoc
    ? { status: prDoc.status, attempts: prDoc.attempts ?? 0 }
    : null;

  return { by_status: byStatus, parallel_runner: parallelRunner };
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  await waitForKibana();

  const benchmarkStart = Date.now();
  const benchmarkStartIso = new Date(benchmarkStart).toISOString();

  // 1. Schedule
  const { scheduledIds, errors: scheduleErrors, errorMessages, scheduleMs } = await scheduleAll();

  if (scheduledIds.length === 0) {
    log('ERROR: No executions were scheduled successfully. Aborting.');
    process.exit(1);
  }

  const afterScheduleIso = new Date().toISOString();

  // 2. Wait
  await waitForCompletion(scheduledIds, benchmarkStart);

  const benchmarkEndMs = Date.now();
  const totalWallMs = benchmarkEndMs - benchmarkStart;

  // 3. Metrics
  const metrics = await computeMetrics(scheduledIds);
  const tmSnap = await tmSnapshot();

  // 4. Report
  const report = {
    benchmark: {
      workflow_id: WORKFLOW_ID,
      requested_count: COUNT,
      scheduled_count: scheduledIds.length,
      schedule_errors: scheduleErrors,
      schedule_error_breakdown: scheduleErrors > 0
        ? Object.fromEntries(errorMessages)
        : undefined,
      schedule_duration_s: parseFloat((scheduleMs / 1000).toFixed(1)),
      total_wall_time_s: parseFloat((totalWallMs / 1000).toFixed(1)),
      started_at: benchmarkStartIso,
      scheduling_finished_at: afterScheduleIso,
      finished_at: new Date(benchmarkEndMs).toISOString(),
    },
    task_manager_snapshot: tmSnap,
    ...metrics,
  };

  writeFileSync(OUTPUT, JSON.stringify(report, null, 2));
  log(`Report written to ${OUTPUT}`);

  // ── Rich console report ───────────────────────────────────────────────────

  const fmt = (v, unit = 's') => (v != null ? `${v}${unit}` : 'n/a');
  const pct = (a, b) => (b ? `~${Math.round((1 - a / b) * 100)}%` : 'n/a');
  const num = (n) => (n != null ? n.toLocaleString() : 'n/a');

  const idle = tmSnap.by_status.idle ?? 0;
  const running = tmSnap.by_status.running ?? 0;
  const internalParallelism = running || '?';
  const pr = tmSnap.parallel_runner;

  const t = metrics.throughput;
  const l = metrics.scheduling_lag;
  const d = metrics.execution_duration;
  const e = metrics.e2e_latency;

  // Theoretical max = internalParallelism / avg_exec_duration
  const theoreticalMax =
    running > 0 && d.avg_s ? parseFloat((running / d.avg_s).toFixed(1)) : null;
  const gap = theoreticalMax && t.avg_rps
    ? pct(t.avg_rps, theoreticalMax)
    : 'n/a';

  const steadyBucket = t.peak_rps_30s_bucket;
  const steadyBucketCount = steadyBucket != null ? Math.round(steadyBucket * 30) : null;

  const col = (label, value, w = 24) => `  ${label.padEnd(w)}${value}`;

  console.log('\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  BENCHMARK REPORT');
  console.log(`  Workflow: ${WORKFLOW_ID}  |  Requested: ${num(COUNT)}  |  Wall time: ${fmt((totalWallMs / 1000).toFixed(1))}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n### Concurrency (at report time)');
  console.log(
    `  workflow:run tasks in TM: ${num(idle)} idle + ${num(running)} running` +
    (running > 0 ? ` — exactly internalParallelism: ${internalParallelism} in action` : '')
  );
  if (pr) {
    const survived = pr.attempts > 1 ? ` = survived ${pr.attempts - 1} restart${pr.attempts > 2 ? 's' : ''}` : '';
    console.log(`  taskManager:parallel-runner: ${pr.status} (long-lived system task, ${pr.attempts} attempt${pr.attempts !== 1 ? 's' : ''}${survived})`);
  }

  console.log('\n### Throughput');
  console.log(col('Metric', 'Value'));
  console.log(col('──────', '─────'));
  console.log(col('Completed', `${num(t.completed)} / ${num(scheduledIds.length)}`));
  console.log(col('Failed / errored', num(t.failed)));
  console.log(col('Avg RPS', t.avg_rps != null ? `~${t.avg_rps} executions/s` : 'n/a'));
  console.log(col('Peak RPS (30s bucket)', steadyBucket != null ? `~${steadyBucket}/s (${steadyBucketCount} per 30s)` : 'n/a'));
  if (theoreticalMax != null) {
    console.log(col('Theoretical max', `~${theoreticalMax}/s (${internalParallelism} concurrent ÷ ${d.avg_s}s each)`));
    console.log(col('Gap vs theoretical', `${gap} — overhead from claim loop, ES fetch, markTaskAsRunning`));
  }

  if (l) {
    console.log('\n### Scheduling lag  (createdAt → startedAt — time task waited in queue)');
    console.log(col('min', fmt(l.min_s)));
    console.log(col('avg', fmt(l.avg_s)));
    console.log(col('p50', fmt(l.p50_s)));
    console.log(col('p75', fmt(l.p75_s)));
    console.log(col('p95', fmt(l.p95_s)));
    console.log(col('p99', fmt(l.p99_s)));
    console.log(col('max', fmt(l.max_s)));
    if (t.avg_rps && l.avg_s) {
      const drainMin = ((scheduledIds.length / t.avg_rps) / 60).toFixed(0);
      console.log(`\n  The lag grows linearly with queue depth — at ${t.avg_rps}/s throughput,`);
      console.log(`  ${num(scheduledIds.length)} tasks = ~${drainMin} min drain time.`);
      console.log(`  Tasks scheduled last waited up to ${fmt(l.max_s)}, matching observed p99 of ${fmt(l.p99_s)}.`);
    }
  }

  console.log('\n### Execution duration  (startedAt → finishedAt — actual run time)');
  console.log(col('min', fmt(d.min_s)));
  console.log(col('avg', fmt(d.avg_s)));
  console.log(col('max', fmt(d.max_s)));

  if (e) {
    console.log('\n### E2E latency  (createdAt → finishedAt — total wall-clock per execution)');
    console.log(col('min', fmt(e.min_s)));
    console.log(col('avg', fmt(e.avg_s)));
    console.log(col('p50', fmt(e.p50_s)));
    console.log(col('p75', fmt(e.p75_s)));
    console.log(col('p95', fmt(e.p95_s)));
    console.log(col('p99', fmt(e.p99_s)));
    console.log(col('max', fmt(e.max_s)));
  }

  console.log('\n### Throughput over time (30s buckets)');
  const maxBucketRps = Math.max(...t.over_time.map((b) => b.rps), 0);
  for (const b of t.over_time) {
    const barLen = maxBucketRps > 0 ? Math.round((b.rps / maxBucketRps) * 30) : 0;
    const bar = '█'.repeat(barLen);
    const ts = b.window_start.slice(11, 19);
    console.log(`  ${ts}  ${String(b.completed).padStart(5)} done  (${String(b.rps).padStart(5)}/s)  ${bar}`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
})();
