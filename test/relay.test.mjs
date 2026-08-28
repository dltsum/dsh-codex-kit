import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { dispatchCommand } from '../remote/agent.mjs';
import { createRelayRequestHandler, RelayServer } from '../remote/relay-server.mjs';

async function startRelay(relay) {
  const server = createServer(createRelayRequestHandler(relay));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function call(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  return { response, body: await response.json() };
}

test('relay registers devices with hash-only state and forwards a fixed status action', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-relay-test-'));
  const stateFile = join(directory, 'state.json');
  const adminToken = 'admin-token-for-relay-test';
  const agentToken = 'agent-token-for-relay-test';
  const phoneToken = 'phone-token-for-relay-test';
  const relay = new RelayServer({ adminToken, stateFile, commandTimeoutMs: 2_000, maxPollWaitMs: 100 });
  const { server, url } = await startRelay(relay);
  try {
    const registered = await call(url, '/v1/agent/register', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ device_id: 'workstation', agent_token: agentToken, phone_token: phoneToken }),
    });
    assert.equal(registered.response.status, 200);
    assert.equal(registered.body.device_id, 'workstation');
    assert.equal(typeof registered.body.agent_session_token, 'string');
    const persisted = readFileSync(stateFile, 'utf8');
    assert.equal(persisted.includes(agentToken), false);
    assert.equal(persisted.includes(phoneToken), false);
    assert.match(persisted, /agent_token_hash/u);
    assert.match(persisted, /phone_token_hash/u);

    const paired = await call(url, '/v1/devices/workstation/v1/pair', {
      method: 'POST',
      body: JSON.stringify({ token: phoneToken }),
    });
    assert.equal(paired.response.status, 200);
    const phoneAuth = { authorization: `Bearer ${paired.body.session_token}` };
    const agentAuth = { authorization: `Bearer ${registered.body.agent_session_token}` };

    const pollPromise = call(url, '/v1/agent/poll', {
      method: 'POST',
      headers: agentAuth,
      body: JSON.stringify({ device_id: 'workstation', wait_ms: 1000 }),
    });
    const statusPromise = call(url, '/v1/devices/workstation/v1/status', { headers: phoneAuth });
    const poll = await pollPromise;
    assert.equal(poll.response.status, 200);
    assert.equal(poll.body.command.action, 'status');
    assert.deepEqual(poll.body.command.payload, {});

    const response = await call(url, '/v1/agent/respond', {
      method: 'POST',
      headers: agentAuth,
      body: JSON.stringify({
        device_id: 'workstation',
        request_id: poll.body.command.request_id,
        response: { status: 'success', summary: 'fake status', next_actions: [], artifacts: [], bridge: { paired: false }, tasks: [] },
      }),
    });
    assert.equal(response.response.status, 200);
    const status = await statusPromise;
    assert.equal(status.response.status, 200);
    assert.equal(status.body.summary, 'fake status');

    const unauthorized = await call(url, '/v1/devices/workstation/v1/status');
    assert.equal(unauthorized.response.status, 401);
    const unknown = await call(url, '/v1/devices/workstation/v1/admin');
    assert.equal(unknown.response.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Agent dispatch accepts only the fixed local bridge actions', async () => {
  const fakeBridge = {
    status: () => ({ status: 'success', summary: 'ok', next_actions: [], artifacts: [] }),
    listTasks: () => [],
    startTask: (payload) => ({ status: 'queued', summary: payload.task, next_actions: [], artifacts: [], id: 'task-1' }),
    getTask: (id) => ({ status: 'succeeded', summary: id, next_actions: [], artifacts: [], id }),
    cancelTask: (id) => ({ status: 'cancelled', summary: id, next_actions: [], artifacts: [], id }),
  };
  assert.equal((await dispatchCommand(fakeBridge, { action: 'status' })).summary, 'ok');
  assert.equal((await dispatchCommand(fakeBridge, { action: 'submit', payload: { task: 'safe task' } })).id, 'task-1');
  await assert.rejects(dispatchCommand(fakeBridge, { action: 'exec', payload: { command: 'whoami' } }), /Unsupported Agent action/u);
});

test('re-registering a device rejects old pending work instead of replaying it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-relay-reregister-'));
  const relay = new RelayServer({
    adminToken: 'admin-token-for-reregister-test',
    stateFile: join(directory, 'state.json'),
    commandTimeoutMs: 2_000,
    maxPollWaitMs: 100,
  });
  try {
    relay.registerDevice({
      device_id: 'workstation',
      agent_token: 'agent-token-for-reregister-test',
      phone_token: 'phone-token-for-reregister-test',
    });
    const pending = relay.dispatch('workstation', 'status', {});
    const command = await relay.pollAgent('workstation', 100);
    assert.equal(command.action, 'status');
    relay.registerDevice({
      device_id: 'workstation',
      agent_token: 'agent-token-for-reregister-test-2',
      phone_token: 'phone-token-for-reregister-test-2',
    });
    await assert.rejects(pending, (error) => error?.code === 'DeviceReplaced');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
