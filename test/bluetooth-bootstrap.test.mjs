import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLUETOOTH_BOOTSTRAP_PROTOCOL_VERSION,
  BluetoothBootstrapServer,
} from '../remote/bluetooth-bootstrap.mjs';

class FakeCharacteristic {
  static RESULT_SUCCESS = 0;
  static RESULT_INVALID_OFFSET = 7;
  static RESULT_UNLIKELY_ERROR = 14;

  constructor(options) {
    Object.assign(this, options);
  }
}

class FakePrimaryService {
  constructor(options) {
    Object.assign(this, options);
  }
}

function fakeBleno() {
  return {
    state: 'poweredOn',
    Characteristic: FakeCharacteristic,
    PrimaryService: FakePrimaryService,
    setServicesAsync: async function setServices(services) { this.services = services; },
    startAdvertisingAsync: async function startAdvertising(name, uuids) {
      this.advertising = { name, uuids };
    },
    stopAdvertisingAsync: async function stopAdvertising() { this.advertising = undefined; },
  };
}

function readCharacteristic(characteristic, handle = 'phone') {
  return new Promise((resolve, reject) => {
    characteristic.onReadRequest(handle, 0, (code, value) => {
      if (code !== FakeCharacteristic.RESULT_SUCCESS) reject(new Error(`read failed: ${code}`));
      else resolve(JSON.parse(value.toString('utf8')));
    });
  });
}

test('BLE bootstrap exposes non-secret info and consumes one secure challenge', async () => {
  const bleno = fakeBleno();
  const logs = [];
  const server = new BluetoothBootstrapServer({
    relayUrl: 'https://relay.example.test/',
    deviceId: 'office-pc',
    phoneToken: 'phone-token-for-bluetooth-test',
    ttlMs: 30_000,
    bleno,
    logger: (event) => logs.push(event),
  });
  await server.start();
  assert.equal(bleno.advertising.name, 'DSH-office-pc');
  const [info, service] = [await readCharacteristic(bleno.services[0].characteristics[0]), bleno.services[0]];
  assert.equal(info.protocol_version, BLUETOOTH_BOOTSTRAP_PROTOCOL_VERSION);
  assert.equal(info.device_id, 'office-pc');
  assert.equal(info.relay_url, 'https://relay.example.test');
  assert.equal('phone_token' in info, false);

  const [, request, response] = service.characteristics;
  let notified;
  response.onSubscribe('phone', 512, (value) => { notified = JSON.parse(value.toString('utf8')); });
  const challenge = 'challenge-for-test-123456';
  let resultCode;
  request.onWriteRequest('phone', Buffer.from(JSON.stringify({
    protocol_version: BLUETOOTH_BOOTSTRAP_PROTOCOL_VERSION,
    nonce: info.nonce,
    challenge,
  })), 0, false, (code) => { resultCode = code; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resultCode, FakeCharacteristic.RESULT_SUCCESS);
  assert.equal(notified.phone_token, 'phone-token-for-bluetooth-test');
  assert.equal(notified.challenge, challenge);
  assert.equal((await readCharacteristic(response)).phone_token, 'phone-token-for-bluetooth-test');

  let secondCode;
  request.onWriteRequest('phone', Buffer.from(JSON.stringify({
    protocol_version: BLUETOOTH_BOOTSTRAP_PROTOCOL_VERSION,
    nonce: info.nonce,
    challenge,
  })), 0, false, (code) => { secondCode = code; });
  assert.equal(secondCode, FakeCharacteristic.RESULT_UNLIKELY_ERROR);
  assert.equal(logs.some((event) => event.event === 'bluetooth_bootstrap_rejected' && event.errorCode !== 'InvalidRequest'), false);
  await server.stop();
  assert.equal(bleno.advertising, undefined);
});

test('BLE bootstrap rejects insecure relay URLs and malformed challenges', () => {
  assert.throws(() => new BluetoothBootstrapServer({
    relayUrl: 'http://relay.example.test',
    deviceId: 'office-pc',
    phoneToken: 'phone-token-for-bluetooth-test',
    bleno: fakeBleno(),
  }), /HTTPS relay URL/u);
  assert.throws(() => new BluetoothBootstrapServer({
    relayUrl: 'https://relay.example.test',
    deviceId: 'office-pc',
    phoneToken: 'short',
    bleno: fakeBleno(),
  }), /phoneToken/u);
});

test('BLE bootstrap refuses a response that cannot fit one GATT attribute', async () => {
  const server = new BluetoothBootstrapServer({
    relayUrl: 'https://relay.example.test',
    deviceId: 'office-pc',
    phoneToken: 't'.repeat(512),
    ttlMs: 30_000,
    bleno: fakeBleno(),
  });
  await assert.rejects(() => server.start(), /512-byte GATT limit/u);
});
