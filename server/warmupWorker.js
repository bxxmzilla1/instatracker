import { getSupabaseAdmin } from './supabaseAdmin.js';
import { runAccountWarmup, WARMUP_STEP_COUNT } from './bskyWarmup.js';

const RUN_STALE_MS = 15000;
const EXECUTOR_ID = 'server';
// One account at a time: accounts share one IP, so parallel warm-ups get rate
// limited. The server only steps in when no other executor is active.
const WARMUP_CONCURRENCY = 1;

function rowToRelay(row) {
  if (!row?.host || !row?.port) return undefined;
  return {
    type: row.type || 'http',
    host: String(row.host),
    port: String(row.port),
    user: row.username || undefined,
    pass: row.password || undefined,
  };
}

function parseWarmupRow(row) {
  const statusRaw = row.status ?? 'waiting';
  const status =
    statusRaw === 'running' || statusRaw === 'done' || statusRaw === 'error'
      ? statusRaw
      : 'waiting';
  return {
    accountKey: row.account_key,
    handle: row.handle ?? '',
    kind: row.kind === 'slave' ? 'slave' : 'follow',
    status,
    step: Number(row.step ?? 0),
    totalSteps: Number(row.total_steps ?? WARMUP_STEP_COUNT),
    label: row.label ?? '',
    error: row.error ?? undefined,
    owner: row.owner ?? undefined,
    active: row.active ?? false,
    updatedAt: Number(row.updated_at ?? 0),
    claimedBy: row.claimed_by ?? undefined,
    queueOrder: row.queue_order != null ? Number(row.queue_order) : undefined,
  };
}

async function upsertWarmupRun(db, run) {
  await db.from('bsky_warmup_runs').upsert({
    account_key: run.accountKey,
    handle: run.handle,
    kind: run.kind,
    status: run.status,
    step: run.step,
    total_steps: run.totalSteps,
    label: run.label,
    error: run.error ?? null,
    owner: run.owner ?? null,
    active: run.active,
    updated_at: run.updatedAt,
    claimed_by: run.claimedBy ?? null,
    queue_order: run.queueOrder ?? null,
  });
}

function needsExecutor(run, now) {
  if (!run.active) return false;
  if (run.status === 'done' || run.status === 'error') return false;
  if (run.status === 'waiting') return true;
  if (run.status === 'running') {
    const claimFresh =
      run.claimedBy &&
      run.claimedBy !== EXECUTOR_ID &&
      now - run.updatedAt < RUN_STALE_MS;
    if (claimFresh) return false;
    return now - run.updatedAt >= RUN_STALE_MS;
  }
  return false;
}

async function resolveCredentials(db, run) {
  const prefix = run.kind === 'slave' ? 'slave:' : 'follow:';
  const id = run.accountKey.startsWith(prefix) ? run.accountKey.slice(prefix.length) : run.accountKey;

  let proxyRow = null;
  async function loadProxy(proxyId) {
    if (!proxyId) return undefined;
    const { data } = await db.from('bsky_proxies').select('*').eq('id', proxyId).maybeSingle();
    proxyRow = data;
    return rowToRelay(data);
  }

  if (run.kind === 'slave') {
    const { data } = await db.from('bsky_slave_accounts').select('*').eq('id', id).maybeSingle();
    if (!data?.password) return null;
    return {
      identifier: (data.handle ?? '').trim().replace(/^@/, ''),
      password: data.password.trim(),
      proxy: await loadProxy(data.proxy_id),
    };
  }

  const { data } = await db.from('bsky_accounts').select('*').eq('id', id).maybeSingle();
  if (!data?.password || !data?.identifier) return null;
  return {
    identifier: data.identifier.trim().replace(/^@/, ''),
    password: data.password.trim(),
    service: data.service ?? undefined,
    proxy: await loadProxy(data.proxy_id),
  };
}

function countFreshRunning(runs, now) {
  return runs.filter(
    (r) => r.active && r.status === 'running' && now - r.updatedAt < RUN_STALE_MS,
  ).length;
}

/**
 * Process the next orphaned warm-up job (waiting or stale running).
 * Skips when a browser/client executor is actively heartbeating or 5 are already running.
 */
export async function processWarmupQueue() {
  const db = getSupabaseAdmin();
  if (!db) return { processed: 0, reason: 'no_supabase' };

  const { data, error } = await db.from('bsky_warmup_runs').select('*');
  if (error) throw new Error(error.message);

  const now = Date.now();
  const runs = (data ?? []).map(parseWarmupRow);
  const freshClient = runs.some(
    (r) =>
      r.active &&
      r.status === 'running' &&
      r.claimedBy &&
      r.claimedBy !== EXECUTOR_ID &&
      now - r.updatedAt < RUN_STALE_MS,
  );
  if (freshClient) return { processed: 0, reason: 'client_active' };

  if (countFreshRunning(runs, now) >= WARMUP_CONCURRENCY) {
    return { processed: 0, reason: 'at_capacity' };
  }

  const next = runs
    .filter((r) => needsExecutor(r, now))
    .sort((a, b) => {
      const orderA = a.queueOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.queueOrder ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.updatedAt - b.updatedAt;
    })[0];
  if (!next) return { processed: 0, reason: 'idle' };

  const creds = await resolveCredentials(db, next);
  if (!creds) {
    await upsertWarmupRun(db, {
      ...next,
      status: 'error',
      label: 'Failed',
      error: 'Missing credentials',
      active: false,
      updatedAt: now,
      claimedBy: EXECUTOR_ID,
    });
    return { processed: 1, accountKey: next.accountKey, error: 'missing_credentials' };
  }

  const startFromStepIndex = Math.max(0, Math.min(next.step, WARMUP_STEP_COUNT - 1));
  let lastStep = next.step;

  await upsertWarmupRun(db, {
    ...next,
    status: 'running',
    label: startFromStepIndex > 0 ? 'Resuming warm-up…' : 'Signing in…',
    active: true,
    updatedAt: now,
    claimedBy: EXECUTOR_ID,
  });

  const heartbeat = setInterval(() => {
    void upsertWarmupRun(db, {
      ...next,
      status: 'running',
      step: lastStep,
      totalSteps: WARMUP_STEP_COUNT,
      label: next.label || 'Running…',
      active: true,
      updatedAt: Date.now(),
      claimedBy: EXECUTOR_ID,
    });
  }, 2000);

  try {
    const res = await runAccountWarmup(
      creds,
      {
        onProgress: async (p) => {
          lastStep = p.step;
          next.label = p.label;
          await upsertWarmupRun(db, {
            ...next,
            status: 'running',
            step: p.step,
            totalSteps: p.totalSteps,
            label: p.label,
            active: true,
            updatedAt: Date.now(),
            claimedBy: EXECUTOR_ID,
          });
        },
      },
      { startFromStepIndex },
    );

    if (!res.ok) {
      await upsertWarmupRun(db, {
        ...next,
        status: 'error',
        step: lastStep,
        totalSteps: WARMUP_STEP_COUNT,
        label: 'Failed',
        error: res.error ?? 'warm-up failed',
        active: false,
        updatedAt: Date.now(),
        claimedBy: EXECUTOR_ID,
      });
      await db.from('bsky_warmup_runs').delete().eq('account_key', next.accountKey);
      return { processed: 1, accountKey: next.accountKey, error: res.error };
    }

    await db.from('bsky_warmup_runs').delete().eq('account_key', next.accountKey);
    return { processed: 1, accountKey: next.accountKey, ok: true };
  } finally {
    clearInterval(heartbeat);
  }
}

/** Drain the queue until no waiting/stale jobs remain (respects maxMs budget). */
export async function processWarmupQueueUntilIdle(maxMs = 280_000) {
  const started = Date.now();
  const results = [];
  while (Date.now() - started < maxMs) {
    const result = await processWarmupQueue();
    results.push(result);
    if (!result.processed) break;
  }
  return { results, elapsedMs: Date.now() - started };
}
