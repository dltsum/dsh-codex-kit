#!/usr/bin/env node

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_RELAY_CONFIG = Object.freeze({
  host: '127.0.0.1',
  port: 8788,
  maxBodyBytes: 64 * 1024,
  maxTaskChars: 16_000,
  maxPendingCommands: 8,
  maxQueuedCommands: 16,
  maxPollWaitMs: 25_000,
  commandTimeoutMs: 30_000,
  maxDevices: 128,
  corsOrigin: undefined,
  stateFile: join(process.cwd(), '.dsh-relay', 'state.json'),
});

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const TASK_ID_PATTERN = /^[0-9a-f-]{1,64}$/u;
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export class RelayError extends Error {
  constructor(statusCode, code, message, nextActions = []) {
    super(message);
    this.name = 'RelayError';
    this.statusCode = statusCode;
    this.code = code;
    this.nextActions = nextActions;
  }
}

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest();
}

function equalDigest(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right)
    && left.length === right.length
    && timingSafeEqual(left, right);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function writeJson(response, statusCode, payload, corsOrigin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin;
    headers.Vary = 'Origin';
  }
  response.writeHead(statusCode, headers);
  response.end(`${JSON.stringify(payload)}\n`);
}

function errorPayload(error) {
  if (error instanceof RelayError) {
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
    summary: 'The relay could not complete the request.',
    next_actions: ['Inspect the relay process log for the local failure.', 'Retry only after checking the device state.'],
    artifacts: [],
    error_code: 'InternalError',
  };
}

function readJson(request, maxBytes) {
  return new Promise((resolveBody, reject) => {
    let total = 0;
    let settled = false;
    const chunks = [];
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        fail(new RelayError(413, 'BodyTooLarge', 'Request body is too large.', ['Send a smaller task or poll body.']));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', (error) => fail(error));
    request.on('end', () => {
      if (settled) return;
      settled = true;
      if (chunks.length === 0) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new RelayError(400, 'InvalidJson', 'Request body must be valid JSON.', ['Send a JSON object.']));
      }
    });
  });
}

function bearerToken(request) {
  const header = request.headers.authorization;
  const match = typeof header === 'string' ? header.match(/^Bearer\s+([A-Za-z0-9_-]+)$/u) : undefined;
  return match?.[1];
}

function requireString(value, name, minimum = 1, maximum = 256) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new RelayError(400, 'InvalidInput', `${name} is invalid.`, [`Provide ${name} with ${minimum}-${maximum} characters.`]);
  }
  return value;
}

function validateDeviceId(value) {
  const id = requireString(value, 'device_id', 1, 64);
  if (!DEVICE_ID_PATTERN.test(id)) throw new RelayError(400, 'InvalidDeviceId', 'device_id may contain only letters, numbers, _ and -.', ['Use a stable short device id.']);
  return id;
}

function validateToken(value, name) {
  const token = requireString(value, name, 16, 512);
  if (/\s/u.test(token)) throw new RelayError(400, 'InvalidToken', `${name} must not contain whitespace.`, ['Use a random URL-safe or hexadecimal token.']);
  return token;
}

function validateTaskBody(body, maxTaskChars) {
  if (!isRecord(body)) throw new RelayError(400, 'InvalidBody', 'Request body must be a JSON object.', ['Send the documented task object.']);
  const task = requireString(body.task, 'task', 1, maxTaskChars).trim();
  if (!task) throw new RelayError(400, 'TaskRequired', 'The task cannot be empty.', ['Send a non-empty task.']);
  if (task.includes('\0')) throw new RelayError(400, 'InvalidTask', 'The task contains a NUL character.', ['Remove binary data from the task.']);
  if (body.code !== undefined && typeof body.code !== 'boolean') throw new RelayError(400, 'InvalidCodeMode', 'code must be boolean when supplied.', ['Use code=true only intentionally.']);
  return { task, code: body.code === true };
}

function validateTaskId(value) {
  if (typeof value !== 'string' || !TASK_ID_PATTERN.test(value)) throw new RelayError(400, 'InvalidTaskId', 'The task id is invalid.', ['Use a task id returned by the relay.']);
  return value;
}

function cloneResponse(value) {
  if (!isRecord(value)) throw new RelayError(502, 'InvalidAgentResponse', 'The computer Agent returned an invalid response.', ['Check the Agent process and retry.']);
  return value;
}

function responseStatusCode(action, value) {
  if (value.status === 'error') return 502;
  return action === 'submit' ? 202 : 200;
}

function stateHash(buffer) {
  return buffer.toString('hex');
}

export class RelayServer {
  #adminDigest;

  constructor(options = {}) {
    this.config = Object.freeze({
      host: options.host ?? DEFAULT_RELAY_CONFIG.host,
      port: options.port ?? DEFAULT_RELAY_CONFIG.port,
      maxBodyBytes: options.maxBodyBytes ?? DEFAULT_RELAY_CONFIG.maxBodyBytes,
      maxTaskChars: options.maxTaskChars ?? DEFAULT_RELAY_CONFIG.maxTaskChars,
      maxPendingCommands: options.maxPendingCommands ?? DEFAULT_RELAY_CONFIG.maxPendingCommands,
      maxQueuedCommands: options.maxQueuedCommands ?? DEFAULT_RELAY_CONFIG.maxQueuedCommands,
      maxPollWaitMs: options.maxPollWaitMs ?? DEFAULT_RELAY_CONFIG.maxPollWaitMs,
      commandTimeoutMs: options.commandTimeoutMs ?? DEFAULT_RELAY_CONFIG.commandTimeoutMs,
      maxDevices: options.maxDevices ?? DEFAULT_RELAY_CONFIG.maxDevices,
      corsOrigin: options.corsOrigin ?? DEFAULT_RELAY_CONFIG.corsOrigin,
      stateFile: options.stateFile ?? DEFAULT_RELAY_CONFIG.stateFile,
    });
    const adminToken = validateToken(options.adminToken, 'admin_token');
    this.#adminDigest = digest(adminToken);
    this.logger = typeof options.logger === 'function' ? options.logger : () => {};
    this.devices = new Map();
    this.#loadState();
  }

  #loadState() {
    if (!existsSync(this.config.stateFile)) return;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(this.config.stateFile, 'utf8'));
    } catch (error) {
      throw new Error(`Relay state file cannot be read: ${error instanceof Error ? error.message : 'invalid JSON'}`);
    }
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.devices)) {
      throw new Error('Relay state file has an unsupported schema. Back it up and repair it before starting.');
    }
    for (const [id, value] of Object.entries(parsed.devices)) {
      if (!DEVICE_ID_PATTERN.test(id) || !isRecord(value) || !TOKEN_HASH_PATTERN.test(value.agent_token_hash) || !TOKEN_HASH_PATTERN.test(value.phone_token_hash)) {
        throw new Error(`Relay state contains an invalid device record: ${id}`);
      }
      this.devices.set(id, this.#newDevice(id, Buffer.from(value.agent_token_hash, 'hex'), Buffer.from(value.phone_token_hash, 'hex'), value.updated_at));
    }
  }

  #newDevice(id, agentTokenDigest, phoneTokenDigest, updatedAt = new Date().toISOString()) {
    return {
      id,
      agentTokenDigest,
      phoneTokenDigest,
      updatedAt,
      agentSessionDigest: undefined,
      phoneSessionDigest: undefined,
      queue: [],
      waiters: [],
      pending: new Map(),
    };
  }

  #clearDeviceRuntime(device) {
    for (const waiter of device.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(undefined);
    }
    device.waiters.length = 0;
    for (const [requestId, pending] of device.pending.entries()) {
      clearTimeout(pending.timer);
      device.pending.delete(requestId);
      pending.reject(new RelayError(409, 'DeviceReplaced', 'The computer Agent was re-registered; this command was not replayed.', ['Inspect the task state and submit again only if it is safe.']));
    }
    device.queue.length = 0;
  }

  #saveState() {
    const directory = dirname(resolve(this.config.stateFile));
    mkdirSync(directory, { recursive: true });
    const state = {
      version: 1,
      devices: Object.fromEntries([...this.devices.entries()].map(([id, device]) => [id, {
        agent_token_hash: stateHash(device.agentTokenDigest),
        phone_token_hash: stateHash(device.phoneTokenDigest),
        updated_at: device.updatedAt,
      }])),
    };
    const temporary = `${resolve(this.config.stateFile)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
    try {
      renameSync(temporary, resolve(this.config.stateFile));
    } catch (error) {
      if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(error?.code)) {
        try { unlinkSync(temporary); } catch { /* preserve the original error */ }
        throw error;
      }
      // Windows cannot always atomically replace an existing file via rename.
      // The target is the explicit relay state path, never a broad directory.
      writeFileSync(resolve(this.config.stateFile), serialized, { encoding: 'utf8', mode: 0o600 });
      try { unlinkSync(temporary); } catch { /* the replacement already succeeded */ }
    }
  }

  #getDevice(id) {
    const device = this.devices.get(id);
    if (!device) throw new RelayError(404, 'DeviceNotFound', 'The device id is not registered on this relay.', ['Register the computer Agent first.']);
    return device;
  }

  #requireAdmin(request) {
    const token = bearerToken(request);
    if (!token || !equalDigest(this.#adminDigest, digest(token))) {
      throw new RelayError(401, 'Unauthorized', 'An administrator token is required for device registration.', ['Use the relay administrator token without putting it in logs.']);
    }
  }

  #requireAgent(request, id) {
    const device = this.#getDevice(id);
    const token = bearerToken(request);
    if (!device.agentSessionDigest || !token || !equalDigest(device.agentSessionDigest, digest(token))) {
      throw new RelayError(401, 'AgentUnauthorized', 'The computer Agent session is not valid.', ['Authenticate the Agent again with its device token.']);
    }
    return device;
  }

  #requirePhone(request, id) {
    const device = this.#getDevice(id);
    const token = bearerToken(request);
    if (!device.phoneSessionDigest || !token || !equalDigest(device.phoneSessionDigest, digest(token))) {
      throw new RelayError(401, 'PhoneUnauthorized', 'The phone session is not valid.', ['Pair the phone with the device token again.']);
    }
    return device;
  }

  requireAdmin(request) {
    this.#requireAdmin(request);
  }

  requireAgent(request, id) {
    return this.#requireAgent(request, id);
  }

  requirePhone(request, id) {
    return this.#requirePhone(request, id);
  }

  registerDevice(body) {
    if (this.devices.size >= this.config.maxDevices && !this.devices.has(body?.device_id)) {
      throw new RelayError(429, 'DeviceLimit', 'This relay has reached its device limit.', ['Remove an unused device record before registering another.']);
    }
    const id = validateDeviceId(body?.device_id);
    const agentToken = validateToken(body?.agent_token, 'agent_token');
    const phoneToken = validateToken(body?.phone_token, 'phone_token');
    const previous = this.devices.get(id);
    const device = this.#newDevice(id, digest(agentToken), digest(phoneToken));
    this.devices.set(id, device);
    try {
      this.#saveState();
    } catch (error) {
      if (previous) this.devices.set(id, previous);
      else this.devices.delete(id);
      throw new RelayError(500, 'StateWriteFailed', 'The relay could not save the device hash record.', ['Check the relay state directory permissions.']);
    }
    if (previous) this.#clearDeviceRuntime(previous);
    const agentSessionToken = randomBytes(32).toString('base64url');
    device.agentSessionDigest = digest(agentSessionToken);
    return {
      status: 'success',
      summary: 'Computer Agent registered; device secrets are stored only as hashes.',
      next_actions: ['Keep the phone pairing token private.', 'Start the Agent long-poll loop.'],
      artifacts: [],
      device_id: id,
      agent_session_token: agentSessionToken,
    };
  }

  authenticateAgent(body) {
    const id = validateDeviceId(body?.device_id);
    const device = this.#getDevice(id);
    const token = validateToken(body?.agent_token, 'agent_token');
    if (!equalDigest(device.agentTokenDigest, digest(token))) throw new RelayError(401, 'AgentUnauthorized', 'The Agent token is not valid.', ['Use the token registered for this device.']);
    const sessionToken = randomBytes(32).toString('base64url');
    device.agentSessionDigest = digest(sessionToken);
    return {
      status: 'success',
      summary: 'Computer Agent authenticated.',
      next_actions: ['Start polling for commands.'],
      artifacts: [],
      device_id: id,
      agent_session_token: sessionToken,
    };
  }

  pairPhone(id, candidate) {
    const device = this.#getDevice(id);
    const token = validateToken(candidate, 'token');
    if (!equalDigest(device.phoneTokenDigest, digest(token))) throw new RelayError(401, 'PairingFailed', 'The phone pairing token is not valid.', ['Copy the phone token printed by the Agent.']);
    const sessionToken = randomBytes(32).toString('base64url');
    device.phoneSessionDigest = digest(sessionToken);
    return {
      status: 'success',
      summary: 'Phone paired with the remote device.',
      next_actions: ['Use the returned session only in phone memory.', 'Submit a task through the device API.'],
      artifacts: [],
      session_token: sessionToken,
    };
  }

  async pollAgent(id, waitMs) {
    const device = this.#getDevice(id);
    const boundedWait = Math.min(this.config.maxPollWaitMs, Math.max(1, Number(waitMs) || this.config.maxPollWaitMs));
    if (device.queue.length > 0) return device.queue.shift();
    return new Promise((resolvePoll) => {
      const waiter = {
        resolve: resolvePoll,
        timer: setTimeout(() => {
          const index = device.waiters.indexOf(waiter);
          if (index >= 0) device.waiters.splice(index, 1);
          resolvePoll(undefined);
        }, boundedWait),
      };
      device.waiters.push(waiter);
    });
  }

  async dispatch(id, action, payload) {
    const device = this.#getDevice(id);
    if (device.pending.size >= this.config.maxPendingCommands) {
      throw new RelayError(429, 'CommandLimit', 'Too many commands are waiting for this computer.', ['Wait for an earlier request to finish.']);
    }
    if (device.queue.length >= this.config.maxQueuedCommands && device.waiters.length === 0) {
      throw new RelayError(429, 'QueueLimit', 'The computer Agent command queue is full.', ['Wait for the Agent to poll before retrying.']);
    }
    const requestId = randomUUID();
    const command = { request_id: requestId, action, payload };
    const responsePromise = new Promise((resolveResponse, rejectResponse) => {
      const pending = {
        resolve: resolveResponse,
        reject: rejectResponse,
        timer: setTimeout(() => {
          device.pending.delete(requestId);
          rejectResponse(new RelayError(504, 'AgentTimeout', 'The computer Agent did not respond before the relay timeout.', ['Check the Agent internet connection and retry only if safe.']));
        }, this.config.commandTimeoutMs),
      };
      device.pending.set(requestId, pending);
    });
    const waiter = device.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(command);
    } else {
      device.queue.push(command);
    }
    return cloneResponse(await responsePromise);
  }

  respondAgent(id, requestId, response) {
    const device = this.#getDevice(id);
    const pending = device.pending.get(requestId);
    if (!pending) throw new RelayError(404, 'RequestNotFound', 'The relay no longer has this command request.', ['Do not replay an expired response.']);
    clearTimeout(pending.timer);
    device.pending.delete(requestId);
    pending.resolve(cloneResponse(response));
    return {
      status: 'success',
      summary: 'Agent response accepted.',
      next_actions: [],
      artifacts: [],
    };
  }

  phoneTaskAction(id, action, payload) {
    return this.dispatch(id, action, payload);
  }

  health() {
    return {
      status: 'success',
      summary: 'DSH internet relay is reachable.',
      next_actions: ['Pair a phone through its device namespace.'],
      artifacts: [],
    };
  }
}

export function createRelayRequestHandler(relay, options = {}) {
  const corsOrigin = options.corsOrigin ?? relay.config.corsOrigin;
  return async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (origin && origin !== corsOrigin) throw new RelayError(403, 'OriginNotAllowed', 'This relay does not allow the supplied browser origin.', ['Use the native Android client or configure one exact CORS origin.']);
      if (request.method === 'OPTIONS') {
        if (!corsOrigin) throw new RelayError(403, 'CorsDisabled', 'CORS is disabled by default.', ['Use the native Android client.']);
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
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        writeJson(response, 200, relay.health(), corsOrigin);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/agent/register') {
        relay.requireAdmin(request);
      }
      if (request.method === 'POST' && url.pathname === '/v1/agent/register') {
        const body = await readJson(request, relay.config.maxBodyBytes);
        writeJson(response, 200, relay.registerDevice(body), corsOrigin);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/agent/auth') {
        const body = await readJson(request, relay.config.maxBodyBytes);
        writeJson(response, 200, relay.authenticateAgent(body), corsOrigin);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/agent/poll') {
        const body = await readJson(request, relay.config.maxBodyBytes);
        const id = validateDeviceId(body?.device_id);
        relay.requireAgent(request, id);
        const command = await relay.pollAgent(id, body?.wait_ms);
        if (!command) {
          writeJson(response, 200, { status: 'idle', summary: 'No command is waiting for this device.', next_actions: ['Poll again.'], artifacts: [] }, corsOrigin);
        } else {
          writeJson(response, 200, { status: 'success', summary: 'One command is ready for the Agent.', next_actions: ['Execute only the documented action.'], artifacts: [], command }, corsOrigin);
        }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/agent/respond') {
        const body = await readJson(request, relay.config.maxBodyBytes);
        const id = validateDeviceId(body?.device_id);
        relay.requireAgent(request, id);
        const requestId = requireString(body?.request_id, 'request_id', 1, 64);
        writeJson(response, 200, relay.respondAgent(id, requestId, body?.response), corsOrigin);
        return;
      }

      const deviceMatch = url.pathname.match(/^\/v1\/devices\/([A-Za-z0-9_-]{1,64})(\/.*)?$/u);
      if (!deviceMatch) throw new RelayError(404, 'NotFound', 'The requested relay endpoint does not exist.', ['Use /v1/health, /v1/agent/*, or /v1/devices/{id}/v1/* endpoints.']);
      const id = validateDeviceId(deviceMatch[1]);
      const rest = deviceMatch[2] ?? '';
      if (request.method === 'POST' && rest === '/v1/pair') {
        const body = await readJson(request, relay.config.maxBodyBytes);
        writeJson(response, 200, relay.pairPhone(id, body?.token), corsOrigin);
        return;
      }
      relay.requirePhone(request, id);
      if (request.method === 'GET' && rest === '/v1/status') {
        const value = await relay.phoneTaskAction(id, 'status', {});
        writeJson(response, responseStatusCode('status', value), value, corsOrigin);
        return;
      }
      if (request.method === 'GET' && rest === '/v1/tasks') {
        const value = await relay.phoneTaskAction(id, 'list', {});
        writeJson(response, responseStatusCode('list', value), value, corsOrigin);
        return;
      }
      if (request.method === 'POST' && rest === '/v1/tasks') {
        const body = await readJson(request, relay.config.maxBodyBytes);
        const task = validateTaskBody(body, relay.config.maxTaskChars);
        const value = await relay.phoneTaskAction(id, 'submit', task);
        writeJson(response, responseStatusCode('submit', value), value, corsOrigin);
        return;
      }
      const cancelMatch = rest.match(/^\/v1\/tasks\/([0-9a-f-]{1,64})\/cancel$/u);
      if (cancelMatch && request.method === 'POST') {
        const value = await relay.phoneTaskAction(id, 'cancel', { task_id: validateTaskId(cancelMatch[1]) });
        writeJson(response, responseStatusCode('cancel', value), value, corsOrigin);
        return;
      }
      const taskMatch = rest.match(/^\/v1\/tasks\/([0-9a-f-]{1,64})$/u);
      if (taskMatch && request.method === 'GET') {
        const value = await relay.phoneTaskAction(id, 'get', { task_id: validateTaskId(taskMatch[1]) });
        writeJson(response, responseStatusCode('get', value), value, corsOrigin);
        return;
      }
      if (taskMatch && request.method === 'DELETE') {
        const value = await relay.phoneTaskAction(id, 'cancel', { task_id: validateTaskId(taskMatch[1]) });
        writeJson(response, responseStatusCode('cancel', value), value, corsOrigin);
        return;
      }
      throw new RelayError(404, 'NotFound', 'The requested device endpoint does not exist.', ['Use the documented status, task, or cancellation paths.']);
    } catch (error) {
      if (error?.code === 'ECONNRESET') return;
      const statusCode = error instanceof RelayError ? error.statusCode : 500;
      writeJson(response, statusCode, errorPayload(error), corsOrigin);
    }
  };
}

export function createRelayServer(relay, options = {}) {
  return createServer(createRelayRequestHandler(relay, options));
}

function parseCli(argv) {
  const options = {
    host: process.env.DSH_RELAY_HOST ?? DEFAULT_RELAY_CONFIG.host,
    port: Number(process.env.DSH_RELAY_PORT ?? DEFAULT_RELAY_CONFIG.port),
    adminToken: process.env.DSH_RELAY_ADMIN_TOKEN,
    stateFile: process.env.DSH_RELAY_STATE_FILE ?? DEFAULT_RELAY_CONFIG.stateFile,
    tlsCert: process.env.DSH_RELAY_TLS_CERT,
    tlsKey: process.env.DSH_RELAY_TLS_KEY,
    allowPublic: false,
    behindProxy: false,
    corsOrigin: undefined,
    help: false,
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
    else if (arg === '--admin-token') options.adminToken = value();
    else if (arg === '--state-file') options.stateFile = value();
    else if (arg === '--tls-cert') options.tlsCert = value();
    else if (arg === '--tls-key') options.tlsKey = value();
    else if (arg === '--allow-public') options.allowPublic = true;
    else if (arg === '--behind-proxy') options.behindProxy = true;
    else if (arg === '--cors-origin') options.corsOrigin = value();
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) throw new Error('port must be an integer from 1 to 65535');
  if ((options.tlsCert && !options.tlsKey) || (!options.tlsCert && options.tlsKey)) throw new Error('--tls-cert and --tls-key must be supplied together');
  return options;
}

function usage() {
  return `DSH HTTPS relay\n\nUsage:\n  node remote/relay-server.mjs [options]\n\nOptions:\n  --host <address>          Default 127.0.0.1; public bind needs --allow-public\n  --port <number>           Default 8788\n  --admin-token <token>     Prefer DSH_RELAY_ADMIN_TOKEN\n  --state-file <path>       Hash-only device state file\n  --tls-cert <path>         TLS certificate (required for direct public bind)\n  --tls-key <path>          TLS private key\n  --allow-public             Confirm a non-loopback bind\n  --behind-proxy             Non-loopback HTTP is behind an HTTPS reverse proxy\n  --cors-origin <origin>    Allow one exact browser origin; disabled by default\n`;
}

export async function startCli(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.help) {
    console.log(usage());
    return undefined;
  }
  if (!LOOPBACK_HOSTS.has(options.host) && !options.allowPublic) throw new Error('Refusing a non-loopback relay bind without --allow-public.');
  if (!LOOPBACK_HOSTS.has(options.host) && !options.tlsCert && !options.behindProxy) throw new Error('A public relay needs TLS certificates or an HTTPS reverse proxy; use --behind-proxy only when the proxy terminates TLS.');
  const relay = new RelayServer(options);
  const handler = createRelayRequestHandler(relay, options);
  const server = options.tlsCert
    ? createSecureServer({ cert: readFileSync(options.tlsCert), key: readFileSync(options.tlsKey) }, handler)
    : createServer(handler);
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port, options.host, resolveListen);
  });
  const address = server.address();
  const shownAddress = typeof address === 'object' && address
    ? `${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}`
    : `${options.host}:${options.port}`;
  const scheme = options.tlsCert || options.behindProxy ? 'https' : 'http';
  console.log(`DSH relay listening on ${scheme}://${shownAddress}`);
  console.log('Only hash-only device records are persisted; task text and output stay in memory while a command is active.');
  const stop = () => server.close(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return { relay, server };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startCli().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unable to start the relay.');
    process.exitCode = 1;
  });
}
