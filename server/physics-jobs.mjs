import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const JOB_LOG_DIR = path.resolve(process.cwd(), 'logs', 'jobs');
const RUNTIME_CONFIG_PATH = path.resolve(process.cwd(), 'config', 'loongenv-runtime.json');
const PROJECT_VENV_PYTHON = path.resolve(process.cwd(), '.venv-backend', 'Scripts', 'python.exe');
const DEFAULT_SYSTEM_PYTHON = 'C:\\Users\\yhzhu\\AppData\\Local\\Programs\\Python\\Python311\\python.exe';
const DEFAULT_BACKEND_SITE_PACKAGES = path.resolve(process.cwd(), '.venv-backend', 'Lib', 'site-packages');
const PYTHON_ENTRY = path.resolve(process.cwd(), 'server', 'python_backend', 'entry.py');

const jobs = new Map();
const runtimeConfig = JSON.parse(fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf8'));
const optimizationDefaults = runtimeConfig.optimization.defaults;
const optimizationLimits = runtimeConfig.optimization.limits;

function ensureJobLogDir() {
  fs.mkdirSync(JOB_LOG_DIR, {recursive: true});
}

function writeJobLog(jobId, line) {
  ensureJobLogDir();
  const logPath = path.resolve(JOB_LOG_DIR, `${jobId}.log`);
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  return logPath;
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

function toSafeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizePayload(rawPayload = {}) {
  return {
    task_type: typeof rawPayload.task_type === 'string' ? rawPayload.task_type : 'full_task',
    scene_prompt: typeof rawPayload.scene_prompt === 'string' ? rawPayload.scene_prompt : '',
    task_prompt: typeof rawPayload.task_prompt === 'string' ? rawPayload.task_prompt : '',
    objective_prompt: typeof rawPayload.objective_prompt === 'string' ? rawPayload.objective_prompt : '',
    scene_xml: typeof rawPayload.scene_xml === 'string' ? rawPayload.scene_xml : '',
    objective_weights: rawPayload.objective_weights ?? {precision: 28, stability: 28, vibration: 22, cycle: 14, energy: 8},
    controller_gains: Array.isArray(rawPayload.controller_gains) ? rawPayload.controller_gains : [],
    trajectory_hint: rawPayload.trajectory_hint ?? null,
    jobs: Math.max(optimizationLimits.jobs_min, Math.min(optimizationLimits.jobs_max, toSafeNumber(rawPayload.jobs, optimizationDefaults.jobs))),
    rounds: Math.max(optimizationLimits.rounds_min, Math.min(optimizationLimits.rounds_max, toSafeNumber(rawPayload.rounds, optimizationDefaults.rounds))),
    trials_per_round: Math.max(
      optimizationLimits.trials_per_round_min,
      Math.min(optimizationLimits.trials_per_round_max, toSafeNumber(rawPayload.trials_per_round, optimizationDefaults.trials_per_round)),
    ),
    seed: toSafeNumber(rawPayload.seed, Date.now()),
    ff_mode: rawPayload.ff_mode,
    computed_torque: rawPayload.computed_torque,
    ideal_actuation: rawPayload.ideal_actuation,
  };
}

function serializeState(job) {
  return {
    ok: true,
    job_id: job.id,
    task_type: job.taskType,
    status: job.status,
    phase: job.phase,
    message: job.message,
    done: job.done,
    total: job.total,
    best: job.best,
    engine: job.engine,
    error: job.error,
    started_at: job.startedAt,
    elapsed_ms: Date.now() - job.startedAt,
  };
}

function resolvePythonRuntime() {
  const configuredLauncher = process.env.LOONGENV_PYTHON_LAUNCHER?.trim();
  const configuredArgs = (process.env.LOONGENV_PYTHON_ARGS || '').split(' ').filter(Boolean);

  if (configuredLauncher) {
    return {launcher: configuredLauncher, argsPrefix: configuredArgs};
  }

  if (fs.existsSync(PROJECT_VENV_PYTHON)) {
    return {launcher: PROJECT_VENV_PYTHON, argsPrefix: []};
  }

  return {launcher: DEFAULT_SYSTEM_PYTHON, argsPrefix: []};
}

function resolveBackendSitePackages() {
  const configured = process.env.LOONGENV_BACKEND_SITE_PACKAGES?.trim();
  if (configured) {
    return configured;
  }
  if (fs.existsSync(DEFAULT_BACKEND_SITE_PACKAGES)) {
    return DEFAULT_BACKEND_SITE_PACKAGES;
  }
  return '';
}

function createJob(payload) {
  const normalized = normalizePayload(payload);
  const id = randomUUID();
  const job = {
    id,
    taskType: normalized.task_type,
    status: 'running',
    phase: 'queued',
    message: '任务已提交，等待后端权威物理处理。',
    done: 0,
    total: normalized.task_type === 'tune_controller' ? normalized.rounds * normalized.trials_per_round : 100,
    best: null,
    engine: 'pending',
    error: null,
    startedAt: Date.now(),
    logs: [],
    result: null,
    process: null,
  };
  jobs.set(id, job);
  writeJobLog(id, `JOB_START type=${job.taskType}`);
  writeJobLog(
    id,
    `REQUESTED_CONTROL_MODE ff_mode=${String(normalized.ff_mode)} computed_torque=${String(Boolean(normalized.computed_torque)).toLowerCase()} ideal_actuation=${String(Boolean(normalized.ideal_actuation)).toLowerCase()}`,
  );

  const pythonRuntime = resolvePythonRuntime();
  const backendSitePackages = resolveBackendSitePackages();
  const child = spawn(pythonRuntime.launcher, [...pythonRuntime.argsPrefix, PYTHON_ENTRY], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      LOONGENV_BACKEND_SITE_PACKAGES: backendSitePackages,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  job.process = child;
  writeJobLog(id, `PYTHON ${pythonRuntime.launcher}`);
  if (backendSitePackages) {
    writeJobLog(id, `SITE_PACKAGES ${backendSitePackages}`);
  }

  const handleJsonLine = (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      writeJobLog(id, `STDOUT ${line}`);
      return;
    }
    if (!event || typeof event !== 'object') return;

    if (event.event === 'started') {
      job.phase = String(event.phase ?? 'bootstrap');
      job.message = String(event.message ?? job.message);
      job.engine = String(event.engine ?? 'unknown');
      writeJobLog(id, `ENGINE ${job.engine} phase=${job.phase}`);
      return;
    }

    if (event.event === 'progress') {
      job.phase = String(event.phase ?? job.phase);
      job.message = String(event.message ?? job.message);
      job.done = toSafeNumber(event.done, job.done);
      job.total = Math.max(job.total, toSafeNumber(event.total, job.total));
      if (event.best) job.best = event.best;
      return;
    }

    if (event.event === 'log') {
      const entry = {
        timestamp: String(event.timestamp ?? new Date().toISOString()),
        level: String(event.level ?? 'INFO'),
        code: String(event.code ?? 'EVENT'),
        message: String(event.message ?? ''),
      };
      job.logs.push(entry);
      job.logs = job.logs.slice(-200);
      writeJobLog(id, `${entry.level} ${entry.code} ${entry.message}`);
      return;
    }

    if (event.event === 'completed') {
      job.status = 'completed';
      job.phase = 'completed';
      job.message = String(event.message ?? '任务已完成。');
      job.result = event.result ?? null;
      job.engine = String(event.engine ?? job.engine);
      if (event.best) job.best = event.best;
      writeJobLog(id, 'JOB_DONE');
      return;
    }

    if (event.event === 'error') {
      job.status = 'error';
      job.phase = 'error';
      job.message = String(event.message ?? '任务执行失败。');
      job.error = job.message;
      writeJobLog(id, `JOB_ERROR ${job.error}`);
    }
  };

  let stdoutBuffer = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8');
    let newlineIndex = stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) handleJsonLine(line);
      newlineIndex = stdoutBuffer.indexOf('\n');
    }
  });

  let stderrBuffer = '';
  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString('utf8');
  });

  child.on('error', (error) => {
    job.status = 'error';
    job.phase = 'spawn-error';
    job.error = error.message;
    job.message = `无法启动 Python 后端：${error.message}`;
    writeJobLog(id, `SPAWN_ERROR ${error.message}`);
  });

  child.on('exit', (code) => {
    if (job.status === 'running') {
      if (code === 0 && job.result) {
        job.status = 'completed';
        job.phase = 'completed';
      } else {
        job.status = 'error';
        job.phase = 'exit-error';
        job.error = stderrBuffer.trim() || `python exited with code ${code}`;
        job.message = `Python 后端异常退出：${job.error}`;
        writeJobLog(id, `EXIT_ERROR code=${code} stderr=${job.error}`);
      }
    }
  });

  child.stdin.write(JSON.stringify({...normalized, job_id: id}));
  child.stdin.end();

  return job;
}

function stopJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return {ok: false, error: 'job not found'};
  if (job.process && !job.process.killed) {
    try {
      job.process.kill();
    } catch {}
  }
  job.status = 'stopped';
  job.phase = 'stopped';
  job.message = '任务已停止。';
  writeJobLog(jobId, 'JOB_STOP');
  return {ok: true};
}

export function createPhysicsJobHandler() {
  ensureJobLogDir();

  return async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/api/jobs' && req.method === 'POST') {
      const payload = await readBody(req);
      const job = createJob(payload);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ok: true, job_id: job.id}));
      return;
    }

    const match = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(status|logs|result|replay|stop)$/);
    if (!match) {
      next();
      return;
    }

    const [, jobId, action] = match;
    const job = jobs.get(jobId);
    if (!job) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ok: false, error: 'job not found'}));
      return;
    }

    if (action === 'status' && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(serializeState(job)));
      return;
    }

    if (action === 'logs' && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ok: true, logs: job.logs}));
      return;
    }

    if (action === 'result' && req.method === 'GET') {
      res.statusCode = job.result ? 200 : 202;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(job.result ? {ok: true, result: job.result} : {ok: false, status: job.status}));
      return;
    }

    if (action === 'replay' && req.method === 'GET') {
      res.statusCode = job.result?.replay ? 200 : 202;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(job.result?.replay ? {ok: true, replay: job.result.replay, scene_xml: job.result.scene_xml} : {ok: false, status: job.status}));
      return;
    }

    if (action === 'stop' && req.method === 'POST') {
      const result = stopJob(jobId);
      res.statusCode = result.ok ? 200 : 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return;
    }

    next();
  };
}
