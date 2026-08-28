#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { RemoteBridge } from './bridge.mjs';
import { BluetoothBootstrapServer } from './bluetooth-bootstrap.mjs';

const DEFAULT_POLL_WAIT_MS = 25_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 35_000;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const TASK_ID_PATTERN = /^[0-9a-f-]{1,64}$/u;
const TOKEN_PATTERN = /^[^\s]{16,512}$/u;

export class RelayHttpError extends Error {
  constructor(statusCode, body) {
    super(typeof body?.summary === 'string' ? body.summary : 'Relay request failed.');
    this.name = 'RelayHttpError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function randomToken() {
  return randomBytes(24).toString('hex');
}

export function normalizeRelayUrl(raw, { allowInsecureHttp = false } = {}) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('relay URL is required');
  const url = new URL(raw.trim());
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('relay URL must use https (or explicit http for local development)');
  if (url.protocol === 'http:' && !allowInsecureHttp) throw new Error('Refusing an http relay URL without --allow-insecure-http');
  if (!url.hostname || url.username || url.password || url.search || url.hash) throw new Error('relay URL must contain only scheme, host and optional port');
  return url.toString().replace(/\/$/u, '');
}

export async function requestRelay(relayUrl, path, {
  method = 'GET',
  body,
  token,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${relayUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let decoded = {};
    if (text) {
      try {
        const value = JSON.parse(text);
        decoded = isRecord(value) ? value : {};
      } catch {
        throw new RelayHttpError(502, { summary: 'Relay returned invalid JSON.', error_code: 'InvalidJson' });
      }
    }
    if (!response.ok) throw new RelayHttpError(response.status, decoded);
    return decoded;
  } catch (error) {
    if (error instanceof RelayHttpError) throw error;
    if (error?.name === 'AbortError') throw new RelayHttpError(504, { summary: 'Relay request timed out.', error_code: 'RelayTimeout' });
    throw new RelayHttpError(503, { summary: 'Relay connection failed.', error_code: 'RelayUnavailable' });
  } finally {
    clearTimeout(timer);
  }
}

function validateDeviceId(value) {
  if (typeof value !== 'string' || !DEVICE_ID_PATTERN.test(value)) throw new Error('deviceId must contain 1-64 letters, numbers, _ or -');
  return value;
}

function validateToken(value, name) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) throw new Error(`${name} must contain 16-512 non-whitespace characters`);
  return value;
}

function validateTaskId(value) {
  if (typeof value !== 'string' || !TASK_ID_PATTERN.test(value)) throw new Error('task_id is invalid');
  return value;
}

function errorResponse(error) {
  return {
    status: 'error',
    summary: error instanceof Error ? error.message : 'The Agent could not execute the command.',
    next_actions: ['Inspect the computer Agent process and local DSH state.', 'Do not blindly replay a command after a transport failure.'],
    artifacts: [],
    error_code: error?.code ?? 'AgentCommandError',
  };
}

export async function dispatchCommand(bridge, command) {
  if (!isRecord(command) || typeof command.action !== 'string') throw new Error('Agent received an invalid command envelope');
  const payload = isRecord(command.payload) ? command.payload : {};
  switch (command.action) {
    case 'status':
      return bridge.status();
    case 'list':
      return {
        status: 'success',
        summary: 'Returned the bounded local task history.',
        next_actions: ['Poll a running task by id.'],
        artifacts: [],
        tasks: bridge.listTasks(),
      };
    case 'submit':
      return bridge.startTask(payload);
    case 'get':
      return bridge.getTask(validateTaskId(payload.task_id));
    case 'cancel':
      return bridge.cancelTask(validateTaskId(payload.task_id));
    default:
      throw new Error(`Unsupported Agent action: ${command.action}`);
  }
}

export class RelayAgent {
  constructor(options = {}) {
    this.relayUrl = normalizeRelayUrl(options.relayUrl, { allowInsecureHttp: options.allowInsecureHttp === true });
    this.deviceId = validateDeviceId(options.deviceId ?? `dsh-${randomBytes(6).toString('hex')}`);
    this.agentToken = validateToken(options.agentToken ?? randomToken(), 'agentToken');
    this.phoneToken = validateToken(options.phoneToken ?? randomToken(), 'phoneToken');
    this.adminToken = options.adminToken === undefined ? undefined : validateToken(options.adminToken, 'adminToken');
    const pollWaitMs = Number(options.pollWaitMs ?? DEFAULT_POLL_WAIT_MS);
    if (!Number.isFinite(pollWaitMs)) throw new Error('pollWaitMs must be a finite number');
    this.pollWaitMs = Math.min(25_000, Math.max(1_000, pollWaitMs));
    const requestTimeoutMs = Number(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    if (!Number.isFinite(requestTimeoutMs)) throw new Error('requestTimeoutMs must be a finite number');
    this.requestTimeoutMs = Math.max(this.pollWaitMs + 5_000, requestTimeoutMs);
    this.bridge = options.bridge ?? new RemoteBridge({
      dshCommand: options.dshCommand,
      dshHome: options.dshHome,
      cwd: options.cwd,
      maxJobs: options.maxJobs,
      maxHistory: options.maxHistory,
      maxTaskChars: options.maxTaskChars,
      maxOutputChars: options.maxOutputChars,
      maxRuntimeMs: options.maxRuntimeMs,
    });
    this.logger = typeof options.logger === 'function' ? options.logger : () => {};
    this.sessionToken = undefined;
    this.stopRequested = false;
    this.registeredThisRun = false;
  }

  async authenticate() {
    this.registeredThisRun = false;
    try {
      const result = await requestRelay(this.relayUrl, '/v1/agent/auth', {
        method: 'POST',
        body: { device_id: this.deviceId, agent_token: this.agentToken },
        timeoutMs: this.requestTimeoutMs,
      });
      this.sessionToken = result.agent_session_token;
      return result;
    } catch (error) {
      if (!(error instanceof RelayHttpError) || ![401, 404].includes(error.statusCode) || !this.adminToken) throw error;
    }
    const result = await requestRelay(this.relayUrl, '/v1/agent/register', {
      method: 'POST',
      token: this.adminToken,
      body: {
        device_id: this.deviceId,
        agent_token: this.agentToken,
        phone_token: this.phoneToken,
      },
      timeoutMs: this.requestTimeoutMs,
    });
    this.registeredThisRun = true;
    this.sessionToken = result.agent_session_token;
    return result;
  }

  async run({ authenticated = false } = {}) {
    if (!authenticated) await this.authenticate();
    this.logger({ event: 'agent_authenticated', deviceId: this.deviceId });
    while (!this.stopRequested) {
      try {
        const poll = await requestRelay(this.relayUrl, '/v1/agent/poll', {
          method: 'POST',
          token: this.sessionToken,
          body: { device_id: this.deviceId, wait_ms: this.pollWaitMs },
          timeoutMs: this.requestTimeoutMs,
        });
        if (!poll.command) continue;
        let response;
        try {
          response = await dispatchCommand(this.bridge, poll.command);
        } catch (error) {
          response = errorResponse(error);
        }
        try {
          await requestRelay(this.relayUrl, '/v1/agent/respond', {
            method: 'POST',
            token: this.sessionToken,
            body: {
              device_id: this.deviceId,
              request_id: poll.command.request_id,
              response,
            },
            timeoutMs: this.requestTimeoutMs,
          });
        } catch (error) {
          this.logger({ event: 'response_transport_unknown', deviceId: this.deviceId, errorCode: error?.body?.error_code ?? 'RelayError' });
          // The command may already have completed locally. Never replay it automatically.
        }
      } catch (error) {
        if (this.stopRequested) break;
        this.logger({ event: 'poll_error', deviceId: this.deviceId, errorCode: error?.body?.error_code ?? 'RelayError' });
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        if (error instanceof RelayHttpError && [401, 404].includes(error.statusCode)) {
          try {
            await this.authenticate();
          } catch (reauthError) {
            this.logger({ event: 'reauth_error', deviceId: this.deviceId, errorCode: reauthError?.body?.error_code ?? 'RelayError' });
          }
        }
      }
    }
  }

  stop() {
    this.stopRequested = true;
    this.bridge.shutdown();
  }
}

function parseCli(argv) {
  const bluetoothEnv = (process.env.DSH_RELAY_BLUETOOTH ?? '').trim().toLowerCase();
  const bluetoothTtlEnv = process.env.DSH_RELAY_BLUETOOTH_TTL_MS;
  const options = {
    relayUrl: process.env.DSH_RELAY_URL,
    deviceId: process.env.DSH_RELAY_DEVICE_ID,
    agentToken: process.env.DSH_RELAY_AGENT_TOKEN,
    phoneToken: process.env.DSH_RELAY_PHONE_TOKEN,
    adminToken: process.env.DSH_RELAY_ADMIN_TOKEN,
    dshCommand: process.env.DSH_REMOTE_DSH_BIN,
    dshHome: process.env.DSH_REMOTE_DSH_HOME,
    cwd: process.env.DSH_REMOTE_CWD,
    allowInsecureHttp: false,
    pollWaitMs: DEFAULT_POLL_WAIT_MS,
    bluetooth: ['1', 'true', 'yes', 'on'].includes(bluetoothEnv),
    bluetoothName: process.env.DSH_RELAY_BLUETOOTH_NAME,
    bluetoothTtlMs: bluetoothTtlEnv === undefined ? undefined : Number(bluetoothTtlEnv),
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next) throw new Error(`${arg} requires a value`);
      return next;
    };
    if (arg === '--relay-url') options.relayUrl = value();
    else if (arg === '--device-id') options.deviceId = value();
    else if (arg === '--agent-token') options.agentToken = value();
    else if (arg === '--phone-token') options.phoneToken = value();
    else if (arg === '--admin-token') options.adminToken = value();
    else if (arg === '--dsh-bin') options.dshCommand = value();
    else if (arg === '--dsh-home') options.dshHome = value();
    else if (arg === '--cwd') options.cwd = value();
    else if (arg === '--poll-wait-ms') options.pollWaitMs = Number(value());
    else if (arg === '--bluetooth') options.bluetooth = true;
    else if (arg === '--bluetooth-name') options.bluetoothName = value();
    else if (arg === '--bluetooth-ttl-ms') options.bluetoothTtlMs = Number(value());
    else if (arg === '--allow-insecure-http') options.allowInsecureHttp = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

function usage() {
  return `DSH computer Agent\n\nUsage:\n  node remote/agent.mjs --relay-url https://relay.example --device-id my-pc [options]\n\nEnvironment alternatives:\n  DSH_RELAY_URL, DSH_RELAY_DEVICE_ID, DSH_RELAY_AGENT_TOKEN, DSH_RELAY_PHONE_TOKEN\n  DSH_RELAY_ADMIN_TOKEN, DSH_REMOTE_DSH_BIN, DSH_REMOTE_DSH_HOME, DSH_REMOTE_CWD\n  DSH_RELAY_BLUETOOTH, DSH_RELAY_BLUETOOTH_NAME, DSH_RELAY_BLUETOOTH_TTL_MS\n\nOptions:\n  --admin-token <token>     Used only to register a new device; prefer DSH_RELAY_ADMIN_TOKEN\n  --agent-token <token>     Computer credential; prefer DSH_RELAY_AGENT_TOKEN\n  --phone-token <token>     Token entered in the Android app; prefer DSH_RELAY_PHONE_TOKEN\n  --dsh-bin <path>          Override the dsh executable or bin.js path\n  --dsh-home <path>         Child-process DSH_HOME\n  --cwd <path>              Local DSH working directory\n  --poll-wait-ms <number>   Long-poll wait (1000-25000)\n  --bluetooth                Advertise a one-time secure BLE bootstrap session\n  --bluetooth-name <name>    Optional BLE display name (max 26 ASCII bytes)\n  --bluetooth-ttl-ms <ms>    Bootstrap window (30000-900000; default 120000)\n  --allow-insecure-http     Local development only; internet deployments must use HTTPS\n`;
}

export async function startCli(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.help) {
    console.log(usage());
    return undefined;
  }
  const agentTokenWasGenerated = !options.agentToken;
  const phoneTokenWasGenerated = !options.phoneToken;
  const agent = new RelayAgent(options);
  const result = await agent.authenticate();
  console.log(`DSH Agent authenticated for device ${agent.deviceId}.`);
  if (agentTokenWasGenerated) console.log(`Generated agent token (record it securely or set DSH_RELAY_AGENT_TOKEN): ${agent.agentToken}`);
  if (phoneTokenWasGenerated && (!options.bluetooth || agent.registeredThisRun)) {
    console.log(`${options.bluetooth ? 'Generated phone token (save it securely for future Agent restarts; Bluetooth will transfer it to the paired phone)' : 'Phone pairing token (record it securely or set DSH_RELAY_PHONE_TOKEN)'}: ${agent.phoneToken}`);
  }
  if (result?.summary) console.log(result.summary);
  let bluetooth;
  if (options.bluetooth) {
    if (phoneTokenWasGenerated && !agent.registeredThisRun) {
      agent.stop();
      throw new Error('Bluetooth bootstrap needs the phone token already registered for this device; set DSH_RELAY_PHONE_TOKEN and retry.');
    }
    try {
      bluetooth = new BluetoothBootstrapServer({
        relayUrl: agent.relayUrl,
        deviceId: agent.deviceId,
        phoneToken: agent.phoneToken,
        displayName: options.bluetoothName,
        ttlMs: options.bluetoothTtlMs,
      });
      await bluetooth.start();
      console.log('Bluetooth bootstrap is active for one pairing. The phone will receive the relay URL and token over secure GATT; Internet control still uses HTTPS relay.');
    } catch (error) {
      agent.stop();
      throw error;
    }
  }
  const stop = () => {
    void bluetooth?.stop();
    agent.stop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await agent.run({ authenticated: true });
  return agent;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startCli().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Unable to start the DSH Agent.');
    process.exitCode = 1;
  });
}
