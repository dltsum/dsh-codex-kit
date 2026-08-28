#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_BRIDGE_CONFIG = Object.freeze({
  host: '127.0.0.1',
  port: 8787,
  maxJobs: 4,
  maxHistory: 32,
  maxTaskChars: 16_000,
  maxOutputChars: 256 * 1024,
  maxBodyBytes: 32 * 1024,
  maxRuntimeMs: 30 * 60 * 1000,
  corsOrigin: undefined,
});

const ACTIVE_STATES = new Set(['queued', 'running']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export class BridgeError extends Error {
  constructor(statusCode, code, message, nextActions = []) {
    super(message);
    this.name = 'BridgeError';
    this.statusCode = statusCode;
    this.code = code;
    this.nextActions = nextActions;
  }
}

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest();
}

function equalDigest(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorPayload(error) {
  if (error instanceof BridgeError) {
    return {
      status: 'error',
      summary: error.message,
      next_actions: error.nextActions,
      artifacts: [],
      error_code: error.code,
    };
  }
  return {
    status: 'error',
    summary: 'The bridge could not complete the request.',
    next_actions: ['Inspect the bridge process log for the local failure.', 'Retry only after checking the task state.'],
    artifacts: [],
    error_code: 'InternalError',
  };
}

function writeJson(res, statusCode, payload, corsOrigin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers.Vary = 'Origin';
  }
  res.writeHead(statusCode, headers);
  res.end(`${JSON.stringify(payload)}\n`);
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let settled = false;
    const chunks = [];
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        fail(new BridgeError(413, 'BodyTooLarge', 'Request body is too large.', ['Send a smaller task (maximum 16,000 characters).']));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (error) => fail(error));
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(value);
      } catch {
        reject(new BridgeError(400, 'InvalidJson', 'Request body must be valid JSON.', ['Send a JSON object.']));
      }
    });
  });
}

function validateTask(body, maxTaskChars) {
  if (!isRecord(body)) {
    throw new BridgeError(400, 'InvalidBody', 'Request body must be a JSON object.', ['Send {"task":"..."}.']);
  }
  if (typeof body.task !== 'string') {
    throw new BridgeError(400, 'TaskRequired', 'The task field must be a string.', ['Send a natural-language task in the task field.']);
  }
  const task = body.task.trim();
  if (!task) {
    throw new BridgeError(400, 'TaskRequired', 'The task cannot be empty.', ['Enter a task before submitting.']);
  }
  if (task.length > maxTaskChars) {
    throw new BridgeError(413, 'TaskTooLarge', `The task is limited to ${maxTaskChars} characters.`, ['Split the task into smaller steps.']);
  }
  if (task.includes('\0')) {
    throw new BridgeError(400, 'InvalidTask', 'The task contains a NUL character.', ['Remove binary data from the task.']);
  }
  if (body.code !== undefined && typeof body.code !== 'boolean') {
    throw new BridgeError(400, 'InvalidCodeMode', 'The code field must be boolean when supplied.', ['Use code=true only when Code Mode is intentional.']);
  }
  return { task, code: body.code === true };
}

function taskNextActions(status) {
  if (status === 'queued' || status === 'running') return ['Poll GET /v1/tasks/{id} for output and completion.'];
  if (status === 'cancelled') return ['Review the partial output before submitting a follow-up task.'];
  if (status === 'timed_out') return ['Split the task or raise the local runtime limit before retrying.'];
  if (status === 'succeeded') return ['Review the output and artifacts on the phone or desktop.'];
  return ['Inspect the output and bridge log, then retry only if the task is safe to repeat.'];
}

function publicTask(job, includeOutput = true) {
  const value = {
    id: job.id,
    status: job.status,
    summary: job.summary,
    next_actions: taskNextActions(job.status),
    artifacts: [],
    output_truncated: job.outputTruncated,
    exit_code: job.exitCode,
    created_at: new Date(job.createdAt).toISOString(),
    updated_at: new Date(job.updatedAt).toISOString(),
  };
  if (includeOutput) value.output = job.output;
  return value;
}

function resolveDshInvocation(explicitCommand) {
  if (explicitCommand) return { file: explicitCommand, prefix: [] };
  const configured = process.env.DSH_REMOTE_DSH_BIN;
  if (configured) return { file: configured, prefix: [] };
  if (process.platform !== 'win32') return { file: 'dsh', prefix: [] };

  const pathEntries = (process.env.PATH ?? '')
    .split(delimiter)
    .map((entry) => entry.replace(/^"|"$/gu, ''));
  const dshShim = pathEntries.map((entry) => join(entry, 'dsh.cmd')).find(existsSync);
  if (dshShim) {
    const bin = join(dirname(dshShim), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (existsSync(bin)) return { file: process.execPath, prefix: [bin] };
  }
  return { file: 'dsh.cmd', prefix: [] };
}

export function createDshRunner({ command, dshHome, cwd } = {}) {
  return ({ task, code, signal, onChunk }) => new Promise((resolve, reject) => {
    const invocation = resolveDshInvocation(command);
    const args = [...invocation.prefix, '--profile', 'skillopt-headless', task];
    const env = {
      ...process.env,
      ...(dshHome ? { DSH_HOME: dshHome } : {}),
      ...(code ? { DSH_TOOLS_MODE: 'code' } : {}),
    };
    let settled = false;
    let child;
    try {
      child = spawn(invocation.file, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => {
      if (!child.killed) child.kill();
    };
    child.stdout?.on('data', (chunk) => onChunk?.(chunk));
    child.stderr?.on('data', (chunk) => onChunk?.(chunk));
    child.once('error', (error) => finish(reject, error));
    child.once('close', (exitCode, signalName) => finish(resolve, { exitCode, signal: signalName }));
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
  });
}

export class RemoteBridge {
  #pairingToken;

  #pairingDigest;

  #sessionDigest;

  constructor(options = {}) {
    this.config = Object.freeze({
      host: options.host ?? DEFAULT_BRIDGE_CONFIG.host,
      port: options.port ?? DEFAULT_BRIDGE_CONFIG.port,
      maxJobs: options.maxJobs ?? DEFAULT_BRIDGE_CONFIG.maxJobs,
      maxHistory: options.maxHistory ?? DEFAULT_BRIDGE_CONFIG.maxHistory,
      maxTaskChars: options.maxTaskChars ?? DEFAULT_BRIDGE_CONFIG.maxTaskChars,
      maxOutputChars: options.maxOutputChars ?? DEFAULT_BRIDGE_CONFIG.maxOutputChars,
      maxBodyBytes: options.maxBodyBytes ?? DEFAULT_BRIDGE_CONFIG.maxBodyBytes,
      maxRuntimeMs: options.maxRuntimeMs ?? DEFAULT_BRIDGE_CONFIG.maxRuntimeMs,
      corsOrigin: options.corsOrigin ?? DEFAULT_BRIDGE_CONFIG.corsOrigin,
    });
    if (!Number.isInteger(this.config.maxJobs) || this.config.maxJobs < 1) throw new RangeError('maxJobs must be a positive integer');
    if (!Number.isInteger(this.config.maxHistory) || this.config.maxHistory < this.config.maxJobs) throw new RangeError('maxHistory must be at least maxJobs');
    if (!Number.isInteger(this.config.maxTaskChars) || this.config.maxTaskChars < 1) throw new RangeError('maxTaskChars must be positive');
    if (!Number.isInteger(this.config.maxOutputChars) || this.config.maxOutputChars < 1024) throw new RangeError('maxOutputChars must be at least 1024');
    if (!Number.isInteger(this.config.maxRuntimeMs) || this.config.maxRuntimeMs < 1000) throw new RangeError('maxRuntimeMs must be at least 1000');
    const pairingToken = options.pairingToken ?? randomBytes(24).toString('hex');
    if (typeof pairingToken !== 'string' || pairingToken.length < 16) throw new RangeError('pairingToken must be at least 16 characters');
    this.#pairingToken = pairingToken;
    this.#pairingDigest = digest(pairingToken);
    this.jobs = new Map();
    this.runner = options.runner ?? createDshRunner({ command: options.dshCommand, dshHome: options.dshHome, cwd: options.cwd });
    this.logger = typeof options.logger === 'function' ? options.logger : () => {};
    this.paired = false;
  }

  pairingTokenForOperator() {
    return this.#pairingToken;
  }

  pair(candidate) {
    if (this.paired) {
      throw new BridgeError(409, 'AlreadyPaired', 'This bridge is already paired until it is restarted.', ['Restart the bridge to create a new in-memory session.']);
    }
    if (typeof candidate !== 'string' || !equalDigest(this.#pairingDigest, digest(candidate))) {
      throw new BridgeError(401, 'PairingFailed', 'The pairing token is not valid.', ['Copy the token shown by the bridge process.']);
    }
    const sessionToken = randomBytes(32).toString('base64url');
    this.#sessionDigest = digest(sessionToken);
    this.paired = true;
    return {
      status: 'success',
      summary: 'Phone paired with the in-memory DSH bridge session.',
      next_actions: ['Store the session only in the app memory.', 'Use the status endpoint to inspect active tasks.'],
      artifacts: [],
      session_token: sessionToken,
    };
  }

  authenticate(request) {
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? header.match(/^Bearer\s+([A-Za-z0-9_-]+)$/u) : undefined;
    if (!this.paired || !match || !equalDigest(this.#sessionDigest, digest(match[1]))) {
      throw new BridgeError(401, 'Unauthorized', 'Pair the phone before using the control API.', ['POST /v1/pair with the one-time pairing token.']);
    }
  }

  #activeJobs() {
    return [...this.jobs.values()].filter((job) => ACTIVE_STATES.has(job.status));
  }

  #appendOutput(job, chunk) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
    if (!text) return;
    job.output += text;
    if (job.output.length > this.config.maxOutputChars) {
      job.output = job.output.slice(-this.config.maxOutputChars);
      job.outputTruncated = true;
    }
    job.updatedAt = Date.now();
  }

  #pruneHistory() {
    if (this.jobs.size <= this.config.maxHistory) return;
    const removable = [...this.jobs.values()]
      .filter((job) => !ACTIVE_STATES.has(job.status))
      .sort((left, right) => left.updatedAt - right.updatedAt);
    while (this.jobs.size > this.config.maxHistory && removable.length > 0) {
      this.jobs.delete(removable.shift().id);
    }
  }

  async #execute(job) {
    if (job.cancelRequested) {
      job.status = 'cancelled';
      job.summary = 'The task was cancelled before DSH started.';
      job.updatedAt = Date.now();
      return;
    }
    job.status = 'running';
    job.summary = 'DSH is running the task.';
    job.updatedAt = Date.now();
    const controller = new AbortController();
    job.controller = controller;
    const timeout = setTimeout(() => {
      job.timedOut = true;
      controller.abort();
    }, this.config.maxRuntimeMs);
    try {
      const result = await this.runner({
        task: job.task,
        code: job.code,
        signal: controller.signal,
        onChunk: (chunk) => this.#appendOutput(job, chunk),
      });
      job.exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : null;
      if (job.cancelRequested) {
        job.status = 'cancelled';
        job.summary = 'The task was cancelled from the phone.';
      } else if (job.timedOut) {
        job.status = 'timed_out';
        job.summary = 'The task exceeded the local runtime limit.';
      } else if (job.exitCode === 0) {
        job.status = 'succeeded';
        job.summary = 'DSH completed the task.';
      } else {
        job.status = 'failed';
        job.summary = `DSH exited with code ${job.exitCode ?? 'unknown'}.`;
      }
    } catch (error) {
      if (job.cancelRequested) {
        job.status = 'cancelled';
        job.summary = 'The task was cancelled from the phone.';
      } else if (job.timedOut) {
        job.status = 'timed_out';
        job.summary = 'The task exceeded the local runtime limit.';
      } else {
        job.status = 'failed';
        job.summary = 'The bridge could not start or finish the DSH task.';
        job.errorCode = error?.code === 'ENOENT' ? 'DshNotFound' : 'RunnerError';
        this.logger({ event: 'task_runner_error', jobId: job.id, errorCode: job.errorCode });
      }
    } finally {
      clearTimeout(timeout);
      job.controller = undefined;
      job.updatedAt = Date.now();
      this.#pruneHistory();
    }
  }

  startTask(input) {
    if (this.#activeJobs().length >= this.config.maxJobs) {
      throw new BridgeError(429, 'CapacityExceeded', `At most ${this.config.maxJobs} tasks may run at once.`, ['Wait for an active task to finish before submitting another.']);
    }
    const { task, code } = validateTask(input, this.config.maxTaskChars);
    const now = Date.now();
    const job = {
      id: randomUUID(),
      task,
      code,
      status: 'queued',
      summary: 'Task accepted; waiting for the local DSH process.',
      output: '',
      outputTruncated: false,
      exitCode: null,
      errorCode: undefined,
      createdAt: now,
      updatedAt: now,
      cancelRequested: false,
      timedOut: false,
      controller: undefined,
    };
    this.jobs.set(job.id, job);
    void this.#execute(job);
    return publicTask(job);
  }

  getTask(id) {
    const job = this.jobs.get(id);
    if (!job) throw new BridgeError(404, 'TaskNotFound', 'The task id is not known to this bridge.', ['Refresh the task list before retrying.']);
    return publicTask(job);
  }

  listTasks() {
    return [...this.jobs.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((job) => publicTask(job, false));
  }

  cancelTask(id) {
    const job = this.jobs.get(id);
    if (!job) throw new BridgeError(404, 'TaskNotFound', 'The task id is not known to this bridge.', ['Refresh the task list before retrying.']);
    if (ACTIVE_STATES.has(job.status)) {
      job.cancelRequested = true;
      job.status = 'cancelled';
      job.summary = 'Cancellation requested; stopping the local DSH process.';
      job.updatedAt = Date.now();
      job.controller?.abort();
    }
    return publicTask(job);
  }

  status() {
    return {
      status: 'success',
      summary: 'Local DSH bridge is ready.',
      next_actions: ['Submit a bounded task with POST /v1/tasks.', 'Poll the returned task id for output.'],
      artifacts: [],
      bridge: {
        paired: this.paired,
        active_jobs: this.#activeJobs().length,
        max_jobs: this.config.maxJobs,
        task_limit_chars: this.config.maxTaskChars,
        output_limit_chars: this.config.maxOutputChars,
      },
      tasks: this.listTasks(),
    };
  }

  shutdown() {
    for (const job of this.jobs.values()) {
      if (ACTIVE_STATES.has(job.status)) {
        job.cancelRequested = true;
        job.controller?.abort();
      }
    }
  }
}

export function createBridgeServer(bridge, options = {}) {
  const corsOrigin = options.corsOrigin ?? bridge.config.corsOrigin;
  return createServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (origin && origin !== corsOrigin) {
        throw new BridgeError(403, 'OriginNotAllowed', 'This bridge does not allow the supplied browser origin.', ['Use the native Android client or configure one exact CORS origin.']);
      }
      if (request.method === 'OPTIONS') {
        if (!corsOrigin) throw new BridgeError(403, 'CorsDisabled', 'CORS is disabled by default.', ['Use the native Android client over the local network.']);
        response.writeHead(204, {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
          'Cache-Control': 'no-store',
          Vary: 'Origin',
        });
        response.end();
        return;
      }

      const url = new URL(request.url ?? '/', 'http://localhost');
      const { pathname } = url;
      if (request.method === 'GET' && pathname === '/v1/health') {
        writeJson(response, 200, {
          status: 'success',
          summary: 'DSH remote bridge is reachable.',
          next_actions: ['Pair the phone before accessing task data.'],
          artifacts: [],
        }, corsOrigin);
        return;
      }
      if (request.method === 'POST' && pathname === '/v1/pair') {
        const body = await readJson(request, bridge.config.maxBodyBytes);
        writeJson(response, 200, bridge.pair(body.token), corsOrigin);
        return;
      }

      bridge.authenticate(request);
      if (request.method === 'GET' && pathname === '/v1/status') {
        writeJson(response, 200, bridge.status(), corsOrigin);
        return;
      }
      if (pathname === '/v1/tasks' && request.method === 'GET') {
        writeJson(response, 200, {
          status: 'success',
          summary: 'Returned the bounded local task history.',
          next_actions: ['Poll a running task by id.'],
          artifacts: [],
          tasks: bridge.listTasks(),
        }, corsOrigin);
        return;
      }
      if (pathname === '/v1/tasks' && request.method === 'POST') {
        const body = await readJson(request, bridge.config.maxBodyBytes);
        writeJson(response, 202, bridge.startTask(body), corsOrigin);
        return;
      }
      const taskMatch = pathname.match(/^\/v1\/tasks\/([0-9a-f-]+)$/u);
      if (taskMatch && request.method === 'GET') {
        writeJson(response, 200, bridge.getTask(taskMatch[1]), corsOrigin);
        return;
      }
      if (taskMatch && request.method === 'DELETE') {
        writeJson(response, 200, bridge.cancelTask(taskMatch[1]), corsOrigin);
        return;
      }
      if (pathname.endsWith('/cancel') && request.method === 'POST') {
        const id = pathname.slice('/v1/tasks/'.length, -'/cancel'.length);
        writeJson(response, 200, bridge.cancelTask(id), corsOrigin);
        return;
      }
      throw new BridgeError(404, 'NotFound', 'The requested bridge endpoint does not exist.', ['Use /v1/health, /v1/pair, /v1/status, or /v1/tasks.']);
    } catch (error) {
      if (error?.code === 'ECONNRESET') return;
      const statusCode = error instanceof BridgeError ? error.statusCode : 500;
      writeJson(response, statusCode, errorPayload(error), corsOrigin);
    }
  });
}

function parseCli(argv) {
  const options = {
    host: process.env.DSH_REMOTE_HOST ?? DEFAULT_BRIDGE_CONFIG.host,
    port: Number(process.env.DSH_REMOTE_PORT ?? DEFAULT_BRIDGE_CONFIG.port),
    pairingToken: process.env.DSH_REMOTE_PAIRING_TOKEN,
    dshCommand: process.env.DSH_REMOTE_DSH_BIN,
    dshHome: process.env.DSH_REMOTE_DSH_HOME,
    allowLan: false,
    corsOrigin: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next) throw new Error(`${arg} requires a value`);
      return next;
    };
    if (arg === '--host') options.host = value();
    else if (arg === '--port') options.port = Number(value());
    else if (arg === '--pairing-token') options.pairingToken = value();
    else if (arg === '--dsh-bin') options.dshCommand = value();
    else if (arg === '--dsh-home') options.dshHome = value();
    else if (arg === '--cors-origin') options.corsOrigin = value();
    else if (arg === '--allow-lan') options.allowLan = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) throw new Error('port must be an integer from 1 to 65535');
  return options;
}

function usage() {
  return `DSH local remote bridge\n\nUsage:\n  node remote/bridge.mjs [options]\n\nOptions:\n  --host <address>          Default 127.0.0.1; use 0.0.0.0 only with --allow-lan\n  --port <number>           Default 8787\n  --pairing-token <token>   Prefer DSH_REMOTE_PAIRING_TOKEN to avoid shell history\n  --dsh-bin <path>          Override the dsh executable or bin.js path\n  --dsh-home <path>         Use an explicit DSH_HOME for the child process\n  --allow-lan                Required when host is not loopback\n  --cors-origin <origin>    Allow one exact browser origin; disabled by default\n`;
}

export async function startCli(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.help) {
    console.log(usage());
    return undefined;
  }
  if (!LOOPBACK_HOSTS.has(options.host) && !options.allowLan) {
    throw new Error('Refusing a non-loopback host without --allow-lan; keep the bridge local unless LAN access is intentional.');
  }
  const bridge = new RemoteBridge(options);
  const server = createBridgeServer(bridge, options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, resolve);
  });
  const address = server.address();
  const shownAddress = typeof address === 'object' && address
    ? `${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}`
    : `${options.host}:${options.port}`;
  console.log(`DSH remote bridge listening on http://${shownAddress}`);
  console.log(`Pairing token (shown once; not stored by the bridge): ${bridge.pairingTokenForOperator()}`);
  console.log('The bridge exposes only the fixed skillopt-headless task API. Press Ctrl+C to stop.');
  const stop = () => {
    bridge.shutdown();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return { bridge, server };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startCli().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unable to start the DSH remote bridge.');
    process.exitCode = 1;
  });
}
