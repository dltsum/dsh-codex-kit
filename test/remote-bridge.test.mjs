import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBridgeServer, RemoteBridge } from '../remote/bridge.mjs';

async function startTestServer(bridge) {
  const server = createBridgeServer(bridge);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function stopTestServer(server, bridge) {
  bridge.shutdown();
  await new Promise((resolve) => server.close(resolve));
}

async function call(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  return { response, body: await response.json() };
}

function delayedRunner(delayMs = 5) {
  return ({ task, onChunk, signal }) => new Promise((resolve) => {
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const timer = setTimeout(() => {
      onChunk(`fake output for: ${task}\n`);
      finish({ exitCode: 0 });
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      finish({ exitCode: 143 });
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

test('health is public while task data requires an in-memory pairing session', async () => {
  const bridge = new RemoteBridge({ pairingToken: 'pairing-token-for-test', runner: delayedRunner() });
  assert.equal(Object.prototype.hasOwnProperty.call(bridge.config, 'pairingToken'), false);
  const { server, url } = await startTestServer(bridge);
  try {
    const health = await call(url, '/v1/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, 'success');
    assert.equal(JSON.stringify(health.body).includes('pairing-token-for-test'), false);

    const unauthorized = await call(url, '/v1/status');
    assert.equal(unauthorized.response.status, 401);
    assert.equal(unauthorized.body.error_code, 'Unauthorized');

    const wrongPair = await call(url, '/v1/pair', {
      method: 'POST',
      body: JSON.stringify({ token: 'wrong-token' }),
    });
    assert.equal(wrongPair.response.status, 401);

    const paired = await call(url, '/v1/pair', {
      method: 'POST',
      body: JSON.stringify({ token: 'pairing-token-for-test' }),
    });
    assert.equal(paired.response.status, 200);
    assert.equal(typeof paired.body.session_token, 'string');
    assert.equal(paired.body.session_token.length > 20, true);

    const secondPair = await call(url, '/v1/pair', {
      method: 'POST',
      body: JSON.stringify({ token: 'pairing-token-for-test' }),
    });
    assert.equal(secondPair.response.status, 409);

    const status = await call(url, '/v1/status', {
      headers: { authorization: `Bearer ${paired.body.session_token}` },
    });
    assert.equal(status.response.status, 200);
    assert.equal(status.body.bridge.paired, true);
  } finally {
    await stopTestServer(server, bridge);
  }
});

test('submits a bounded task, streams bounded output through polling, and rejects shell-shaped input', async () => {
  const bridge = new RemoteBridge({ pairingToken: 'pairing-token-for-test', runner: delayedRunner(10) });
  const { server, url } = await startTestServer(bridge);
  try {
    const paired = await call(url, '/v1/pair', {
      method: 'POST',
      body: JSON.stringify({ token: 'pairing-token-for-test' }),
    });
    const auth = { authorization: `Bearer ${paired.body.session_token}` };
    const submitted = await call(url, '/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ task: 'explain the failing test', code: false }),
    });
    assert.equal(submitted.response.status, 202);
    assert.match(submitted.body.id, /^[0-9a-f-]{36}$/u);
    assert.equal(submitted.body.artifacts.length, 0);

    let latest;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      latest = await call(url, `/v1/tasks/${submitted.body.id}`, { headers: auth });
      if (latest.body.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(latest.body.status, 'succeeded');
    assert.match(latest.body.output, /fake output for: explain the failing test/u);

    const tooLarge = await call(url, '/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ task: 'x'.repeat(16_001) }),
    });
    assert.equal(tooLarge.response.status, 413);
    assert.equal(tooLarge.body.error_code, 'TaskTooLarge');

    const unknown = await call(url, '/v1/admin/exec', { headers: auth });
    assert.equal(unknown.response.status, 404);
  } finally {
    await stopTestServer(server, bridge);
  }
});

test('cancellation is explicit and does not turn into a successful result', async () => {
  const bridge = new RemoteBridge({ pairingToken: 'pairing-token-for-test', runner: delayedRunner(100) });
  const { server, url } = await startTestServer(bridge);
  try {
    const paired = await call(url, '/v1/pair', {
      method: 'POST',
      body: JSON.stringify({ token: 'pairing-token-for-test' }),
    });
    const auth = { authorization: `Bearer ${paired.body.session_token}` };
    const submitted = await call(url, '/v1/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ task: 'long task' }),
    });
    const cancelled = await call(url, `/v1/tasks/${submitted.body.id}/cancel`, {
      method: 'POST',
      headers: auth,
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.status, 'cancelled');
    assert.match(cancelled.body.summary, /[Cc]ancellation/u);
  } finally {
    await stopTestServer(server, bridge);
  }
});
