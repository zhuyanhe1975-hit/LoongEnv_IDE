import fs from 'node:fs';
import path from 'node:path';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const DEFAULT_LOG_PATH = path.resolve(process.cwd(), 'logs', 'servo-optimization.log');
const workerPath = path.resolve(process.cwd(), 'server', 'servo-optimizer-worker.mjs');
const jobs = new Map();

function ensureLogFile(logPath = DEFAULT_LOG_PATH) {
  fs.mkdirSync(path.dirname(logPath), {recursive: true});
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, '# LoongEnv servo optimization log\n', 'utf8');
  }
}

function appendOptimizationLog(message, logPath = DEFAULT_LOG_PATH) {
  ensureLogFile(logPath);
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
}

function normalizeJobPayload(rawPayload = {}) {
  const jobsCount = Math.max(1, Math.min(8, Number(rawPayload.jobs ?? 8) || 8));
  const rounds = Math.max(1, Math.min(12, Number(rawPayload.rounds ?? 5) || 5));
  const trialsPerRound = Math.max(4, Math.min(128, Number(rawPayload.trialsPerRound ?? 24) || 24));
  const totalTrials = rounds * trialsPerRound;
  return {
    jobs: jobsCount,
    rounds,
    trialsPerRound,
    totalTrials,
    seed: Number(rawPayload.seed ?? Date.now()) || Date.now(),
    objectiveWeights: rawPayload.objectiveWeights ?? {precision: 28, stability: 28, vibration: 22, cycle: 14, energy: 8},
    baseJoints: Array.isArray(rawPayload.baseJoints) ? rawPayload.baseJoints : [],
  };
}

function serializeBestTrial(best) {
  if (!best) return null;
  return {
    trial: best.trial,
    score: Number(best.score.toFixed(4)),
    metrics: {
      peakError: Number(best.metrics.peakError.toFixed(5)),
      meanError: Number(best.metrics.meanError.toFixed(5)),
      peakVelocity: Number(best.metrics.peakVelocity.toFixed(5)),
      peakTorque: Number(best.metrics.peakTorque.toFixed(3)),
      settleTime: Number(best.metrics.settleTime.toFixed(4)),
      stable: Boolean(best.metrics.stable),
    },
    params: best.joints.reduce((accumulator, joint) => {
      accumulator[joint.name] = {kp: joint.kp, ki: joint.ki, kd: joint.kd};
      return accumulator;
    }, {}),
    joints: best.joints,
  };
}

function createJob(payload) {
  const config = normalizeJobPayload(payload);
  const jobId = randomUUID();
  const state = {
    id: jobId,
    status: 'running',
    startedAt: Date.now(),
    done: 0,
    total: config.totalTrials,
    jobs: config.jobs,
    rounds: config.rounds,
    trialsPerRound: config.trialsPerRound,
    best: null,
    recentTrials: [],
    workersDone: 0,
    workers: [],
    error: null,
    config,
  };
  jobs.set(jobId, state);
  appendOptimizationLog(`JOB_START id=${jobId} total=${config.totalTrials} jobs=${config.jobs}`);

  const baseTrials = Math.floor(config.totalTrials / config.jobs);
  const remainder = config.totalTrials % config.jobs;
  let cursor = 0;

  for (let workerIndex = 0; workerIndex < config.jobs; workerIndex += 1) {
    const trials = baseTrials + (workerIndex < remainder ? 1 : 0);
    if (trials <= 0) continue;
    const child = fork(workerPath, [], {stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
    state.workers.push(child);

    child.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'trial') {
        state.done += 1;
        const trialSnapshot = {
          trial: message.trial,
          workerId: message.workerId,
          score: Number(message.score.toFixed(4)),
          metrics: message.metrics,
        };
        state.recentTrials.push(trialSnapshot);
        state.recentTrials = state.recentTrials.slice(-20);
        if (!state.best || message.score < state.best.score) {
          state.best = {
            trial: message.trial,
            score: message.score,
            joints: message.joints,
            metrics: message.metrics,
          };
          appendOptimizationLog(
            `JOB_BEST id=${jobId} trial=${message.trial} score=${message.score.toFixed(4)} peakError=${message.metrics.peakError.toFixed(5)} peakTorque=${message.metrics.peakTorque.toFixed(3)}`,
          );
        }
        return;
      }

      if (message.type === 'done') {
        state.workersDone += 1;
        if (message.best && (!state.best || message.best.score < state.best.score)) {
          state.best = message.best;
        }
        if (state.workersDone >= state.workers.length) {
          state.status = 'completed';
          appendOptimizationLog(`JOB_DONE id=${jobId} done=${state.done}/${state.total}`);
        }
        return;
      }

      if (message.type === 'error') {
        state.status = 'error';
        state.error = message.error || 'worker failed';
        appendOptimizationLog(`JOB_ERROR id=${jobId} worker=${message.workerId} error=${state.error}`);
      }
    });

    child.on('exit', (code) => {
      if (code !== 0 && state.status === 'running') {
        state.status = 'error';
        state.error = `worker exited with code ${code}`;
        appendOptimizationLog(`JOB_EXIT_ERROR id=${jobId} code=${code}`);
      }
    });

    child.send({
      type: 'start',
      payload: {
        workerId: `worker-${workerIndex + 1}`,
        trials,
        trialStart: cursor,
        totalTrials: config.totalTrials,
        seed: config.seed + workerIndex * 97,
        objectiveWeights: config.objectiveWeights,
        baseJoints: config.baseJoints,
        initialJoints: workerIndex === 0 ? config.baseJoints : null,
      },
    });
    cursor += trials;
  }

  return state;
}

function stopJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return {ok: false, error: 'job not found'};
  job.status = 'stopped';
  for (const worker of job.workers) {
    try {
      worker.kill();
    } catch {}
  }
  appendOptimizationLog(`JOB_STOP id=${jobId} done=${job.done}/${job.total}`);
  return {ok: true};
}

function getJobSnapshot(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    ok: true,
    job_id: job.id,
    status: job.status,
    done: job.done,
    total: job.total,
    jobs: job.jobs,
    rounds: job.rounds,
    trials_per_round: job.trialsPerRound,
    elapsed_ms: Date.now() - job.startedAt,
    best: serializeBestTrial(job.best),
    recent_trials: job.recentTrials,
    error: job.error,
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export function createServoOptimizationHandler() {
  ensureLogFile();

  return async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/servo-optimize/start' && req.method === 'POST') {
      const payload = await readBody(req);
      const job = createJob(payload);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ok: true, job_id: job.id}));
      return;
    }

    if (url.pathname === '/api/servo-optimize/status' && req.method === 'GET') {
      const jobId = url.searchParams.get('job_id') ?? '';
      const snapshot = getJobSnapshot(jobId);
      res.statusCode = snapshot ? 200 : 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(snapshot ?? {ok: false, error: 'job not found'}));
      return;
    }

    if (url.pathname === '/api/servo-optimize/stop' && req.method === 'POST') {
      const payload = await readBody(req);
      const result = stopJob(String(payload.job_id ?? ''));
      res.statusCode = result.ok ? 200 : 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return;
    }

    next();
  };
}
