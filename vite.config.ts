import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import type {IncomingMessage, ServerResponse} from 'http';
import {createServoOptimizationHandler} from './server/servo-optimization.mjs';
import {createPhysicsJobHandler} from './server/physics-jobs.mjs';

const DEBUG_LOG_PATH = path.resolve(__dirname, 'logs', 'simulation-debug.log');

function ensureDebugLogFile() {
  fs.mkdirSync(path.dirname(DEBUG_LOG_PATH), {recursive: true});
  if (!fs.existsSync(DEBUG_LOG_PATH)) {
    fs.writeFileSync(DEBUG_LOG_PATH, '# LoongEnv simulation debug log\n', 'utf8');
  }
}

function appendDebugLog(rawBody: string) {
  ensureDebugLogFile();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = {message: rawBody};
  }

  const timestamp = typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString();
  const level = typeof payload.level === 'string' ? payload.level.toUpperCase() : 'INFO';
  const code = typeof payload.code === 'string' ? payload.code : 'EVENT';
  const joint = typeof payload.joint === 'string' ? payload.joint : 'system';
  const message = typeof payload.message === 'string' ? payload.message : 'Simulation event';
  const observed = typeof payload.observed === 'number' ? payload.observed.toFixed(6) : '-';
  const limit = typeof payload.limit === 'number' ? payload.limit.toFixed(6) : '-';

  const line = `[${timestamp}] [${level}] [${code}] [${joint}] observed=${observed} limit=${limit} ${message}\n`;
  fs.appendFileSync(DEBUG_LOG_PATH, line, 'utf8');
}

function createDebugLogHandler() {
  ensureDebugLogFile();

  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url !== '/api/debug-log') {
      next();
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ok: false, error: 'Method not allowed'}));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      appendDebugLog(body);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ok: true, path: DEBUG_LOG_PATH}));
    });
  };
}

function debugLogPlugin() {
  const handler = createDebugLogHandler();
  const optimizationHandler = createServoOptimizationHandler();
  const physicsJobHandler = createPhysicsJobHandler();
  return {
    name: 'loongenv-debug-log',
    configureServer(server: {middlewares: {use: (fn: typeof handler) => void}}) {
      server.middlewares.use(handler);
      server.middlewares.use(optimizationHandler);
      server.middlewares.use(physicsJobHandler);
    },
    configurePreviewServer(server: {middlewares: {use: (fn: typeof handler) => void}}) {
      server.middlewares.use(handler);
      server.middlewares.use(optimizationHandler);
      server.middlewares.use(physicsJobHandler);
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), debugLogPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '127.0.0.1',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
