#!/usr/bin/env node

import { randomBytes } from 'node:crypto';

export const BLUETOOTH_BOOTSTRAP_PROTOCOL_VERSION = 1;
export const BLUETOOTH_SERVICE_UUID = 'd5c0d5c0-0001-4d53-9f0d-445348000001';
export const BLUETOOTH_INFO_CHARACTERISTIC_UUID = 'd5c0d5c0-0001-4d53-9f0d-445348000002';
export const BLUETOOTH_REQUEST_CHARACTERISTIC_UUID = 'd5c0d5c0-0001-4d53-9f0d-445348000003';
export const BLUETOOTH_RESPONSE_CHARACTERISTIC_UUID = 'd5c0d5c0-0001-4d53-9f0d-445348000004';

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const TOKEN_PATTERN = /^[^\s]{16,512}$/u;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{16,256}$/u;
const MAX_ATTRIBUTE_BYTES = 512;
const DEFAULT_TTL_MS = 120_000;
const DEFAULT_NAME_PREFIX = 'DSH';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateDeviceId(value) {
  if (typeof value !== 'string' || !DEVICE_ID_PATTERN.test(value)) throw new Error('deviceId must contain 1-64 letters, numbers, _ or -');
  return value;
}

function validateToken(value, name) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) throw new Error(`${name} must contain 16-512 non-whitespace characters`);
  return value;
}

function normalizeRelayUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('relayUrl is required for Bluetooth bootstrap');
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:') throw new Error('Bluetooth bootstrap requires an HTTPS relay URL');
  if (!url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error('relayUrl must contain only https scheme, host and optional port');
  }
  return url.toString().replace(/\/$/u, '');
}

function boundedName(value, deviceId) {
  const fallback = `${DEFAULT_NAME_PREFIX}-${deviceId.slice(0, 18)}`;
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const ascii = candidate.replace(/[^\x20-\x7E]/gu, '-');
  return ascii.slice(0, 26) || fallback;
}

function encodeJson(value) {
  const encoded = Buffer.from(JSON.stringify(value), 'utf8');
  if (encoded.length > MAX_ATTRIBUTE_BYTES) throw new Error('Bluetooth bootstrap payload exceeds the 512-byte GATT limit');
  return encoded;
}

function decodeJson(data) {
  if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_ATTRIBUTE_BYTES) throw new Error('Bluetooth bootstrap request is invalid');
  let value;
  try {
    value = JSON.parse(data.toString('utf8'));
  } catch {
    throw new Error('Bluetooth bootstrap request is not valid JSON');
  }
  if (!isRecord(value)) throw new Error('Bluetooth bootstrap request must be a JSON object');
  return value;
}

function normalizeReadArguments(handleOrOffset, offsetOrCallback, callback) {
  // @stoprocent/bleno uses (handle, offset, callback). Keeping the legacy
  // (offset, callback) shape here makes the protocol testable with older
  // bleno-compatible adapters without weakening the security checks.
  if (typeof offsetOrCallback === 'function') {
    return { handle: undefined, offset: handleOrOffset, callback: offsetOrCallback };
  }
  return { handle: handleOrOffset, offset: offsetOrCallback, callback };
}

function resultCode(bleno, name) {
  return bleno.Characteristic?.[name] ?? 0;
}

async function invokeBleno(target, asyncName, callbackName, args = []) {
  if (typeof target?.[asyncName] === 'function') return target[asyncName](...args);
  if (typeof target?.[callbackName] !== 'function') throw new Error(`Bluetooth library does not implement ${asyncName}`);
  return new Promise((resolve, reject) => {
    target[callbackName](...args, (error) => error ? reject(error) : resolve());
  });
}

async function loadBleno() {
  try {
    const module = await import('@stoprocent/bleno');
    return module.default ?? module;
  } catch {
    throw new Error('Bluetooth bootstrap needs the optional @stoprocent/bleno package; run npm run remote:bluetooth-install first.');
  }
}

async function waitForPoweredOn(bleno, timeoutMs) {
  if (bleno.state === 'poweredOn') return;
  if (typeof bleno.waitForPoweredOnAsync === 'function') {
    await bleno.waitForPoweredOnAsync(timeoutMs);
    return;
  }
  if (typeof bleno.on !== 'function') throw new Error('Bluetooth library cannot observe adapter state');
  await new Promise((resolve, reject) => {
    let timer;
    const removeListener = () => {
      if (typeof bleno.off === 'function') bleno.off('stateChange', onState);
      else if (typeof bleno.removeListener === 'function') bleno.removeListener('stateChange', onState);
    };
    const onTimeout = () => {
      removeListener();
      reject(new Error('Bluetooth adapter did not become powered on before timeout'));
    };
    const onState = (state) => {
      if (state !== 'poweredOn') return;
      clearTimeout(timer);
      removeListener();
      resolve();
    };
    timer = setTimeout(onTimeout, timeoutMs);
    bleno.on('stateChange', onState);
  });
}

export class BluetoothBootstrapServer {
  constructor(options = {}) {
    this.relayUrl = normalizeRelayUrl(options.relayUrl);
    this.deviceId = validateDeviceId(options.deviceId);
    this.phoneToken = validateToken(options.phoneToken, 'phoneToken');
    this.displayName = boundedName(options.displayName, this.deviceId);
    this.ttlMs = Number(options.ttlMs ?? DEFAULT_TTL_MS);
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 30_000 || this.ttlMs > 15 * 60_000) throw new Error('Bluetooth bootstrap ttlMs must be between 30000 and 900000');
    this.logger = typeof options.logger === 'function' ? options.logger : () => {};
    this.bleno = options.bleno;
    this.started = false;
    this.used = false;
    this.nonce = randomBytes(16).toString('base64url');
    this.expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
    this.responseBytes = undefined;
    this.subscriptions = new Map();
    this.expiryTimer = undefined;
    this.shutdownTimer = undefined;
  }

  info() {
    return {
      protocol_version: BLUETOOTH_BOOTSTRAP_PROTOCOL_VERSION,
      device_id: this.deviceId,
      display_name: this.displayName,
      relay_url: this.relayUrl,
      nonce: this.nonce,
      expires_at: this.expiresAt,
    };
  }

  #key(handle) {
    return handle === undefined || handle === null ? 'default' : String(handle);
  }

  #readBytes(bytes, offset, callback) {
    const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    if (start > bytes.length) {
      callback(resultCode(this.bleno, 'RESULT_INVALID_OFFSET'), Buffer.alloc(0));
      return;
    }
    callback(resultCode(this.bleno, 'RESULT_SUCCESS'), bytes.subarray(start));
  }

  #infoRead = (handleOrOffset, offsetOrCallback, callback) => {
    const args = normalizeReadArguments(handleOrOffset, offsetOrCallback, callback);
    this.#readBytes(encodeJson(this.info()), args.offset, args.callback);
  };

  #responseRead = (handleOrOffset, offsetOrCallback, callback) => {
    const args = normalizeReadArguments(handleOrOffset, offsetOrCallback, callback);
    if (!this.responseBytes) {
      args.callback(resultCode(this.bleno, 'RESULT_UNLIKELY_ERROR'), Buffer.alloc(0));
      return;
    }
    this.#readBytes(this.responseBytes, args.offset, args.callback);
  };

  #requestWrite = (handle, data, offset, withoutResponse, callback) => {
    try {
      if ((offset !== undefined && offset !== 0) || this.used || Date.now() >= Date.parse(this.expiresAt)) throw new Error('Bluetooth bootstrap request is expired or already used');
      const body = decodeJson(data);
      if (body.protocol_version !== BLUETOOTH_BOOTSTRAP_PROTOCOL_VERSION || body.nonce !== this.nonce || typeof body.challenge !== 'string' || !CHALLENGE_PATTERN.test(body.challenge)) {
        throw new Error('Bluetooth bootstrap challenge does not match this session');
      }
      this.responseBytes = encodeJson({
        protocol_version: BLUETOOTH_BOOTSTRAP_PROTOCOL_VERSION,
        device_id: this.deviceId,
        relay_url: this.relayUrl,
        nonce: this.nonce,
        challenge: body.challenge,
        phone_token: this.phoneToken,
        expires_at: this.expiresAt,
      });
      this.used = true;
      callback(resultCode(this.bleno, 'RESULT_SUCCESS'));
      queueMicrotask(() => {
        const update = this.subscriptions.get(this.#key(handle));
        if (update) update(this.responseBytes);
      });
      this.logger({ event: 'bluetooth_bootstrap_consumed', deviceId: this.deviceId });
      this.shutdownTimer = setTimeout(() => { void this.stop(); }, 1_500);
    } catch (error) {
      callback(resultCode(this.bleno, 'RESULT_UNLIKELY_ERROR'));
      // Do not log request data or parser messages: a malformed request may
      // contain attacker-controlled bytes. Keep logs useful but credential-free.
      this.logger({ event: 'bluetooth_bootstrap_rejected', deviceId: this.deviceId, errorCode: 'InvalidRequest' });
    }
  };

  async start() {
    if (this.started) return this;
    if (this.used || Date.now() >= Date.parse(this.expiresAt)) throw new Error('Bluetooth bootstrap session is no longer reusable; create a new server instance.');
    this.bleno ??= await loadBleno();
    await waitForPoweredOn(this.bleno, 5_000);
    // Fail before advertising if the fixed-size GATT response cannot carry the
    // configured relay metadata, token, and a normal phone challenge.
    encodeJson({
      protocol_version: BLUETOOTH_BOOTSTRAP_PROTOCOL_VERSION,
      device_id: this.deviceId,
      relay_url: this.relayUrl,
      nonce: this.nonce,
      challenge: 'A'.repeat(32),
      phone_token: this.phoneToken,
      expires_at: this.expiresAt,
    });
    const Characteristic = this.bleno.Characteristic;
    const PrimaryService = this.bleno.PrimaryService;
    if (typeof Characteristic !== 'function' || typeof PrimaryService !== 'function') throw new Error('Bluetooth library does not expose GATT service constructors');

    const infoCharacteristic = new Characteristic({
      uuid: BLUETOOTH_INFO_CHARACTERISTIC_UUID,
      properties: ['read'],
      secure: ['read'],
      onReadRequest: this.#infoRead,
    });
    const requestCharacteristic = new Characteristic({
      uuid: BLUETOOTH_REQUEST_CHARACTERISTIC_UUID,
      properties: ['write'],
      secure: ['write'],
      onWriteRequest: this.#requestWrite,
    });
    const responseCharacteristic = new Characteristic({
      uuid: BLUETOOTH_RESPONSE_CHARACTERISTIC_UUID,
      properties: ['read', 'notify'],
      secure: ['read', 'notify'],
      onReadRequest: this.#responseRead,
      onSubscribe: (handle, maxValueSize, updateValueCallback) => {
        this.subscriptions.set(this.#key(handle), updateValueCallback);
      },
      onUnsubscribe: (handle) => {
        this.subscriptions.delete(this.#key(handle));
      },
    });
    const service = new PrimaryService({
      uuid: BLUETOOTH_SERVICE_UUID,
      characteristics: [infoCharacteristic, requestCharacteristic, responseCharacteristic],
    });
    await invokeBleno(this.bleno, 'setServicesAsync', 'setServices', [[service]]);
    await invokeBleno(this.bleno, 'startAdvertisingAsync', 'startAdvertising', [this.displayName, [BLUETOOTH_SERVICE_UUID]]);
    this.started = true;
    this.expiryTimer = setTimeout(() => { void this.stop(); }, this.ttlMs);
    this.logger({ event: 'bluetooth_bootstrap_started', deviceId: this.deviceId, expiresAt: this.expiresAt });
    return this;
  }

  async stop() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer);
    this.shutdownTimer = undefined;
    this.subscriptions.clear();
    if (!this.started) return;
    this.started = false;
    try {
      await invokeBleno(this.bleno, 'stopAdvertisingAsync', 'stopAdvertising');
    } finally {
      this.logger({ event: 'bluetooth_bootstrap_stopped', deviceId: this.deviceId });
    }
  }
}
