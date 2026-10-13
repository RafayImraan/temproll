import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('API requires bearer auth and validates schedule input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'payroll-api-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server/api.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, API_PORT: String(port), PAYROLL_API_TOKEN: 'test-only-token', PAYROLL_STORE_PATH: join(dir, 'db.json') },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { const response = await fetch(`${base}/health`); if (response.ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(ready, true, 'API starts');
    const unauth = await fetch(`${base}/api/schedules`);
    assert.equal(unauth.status, 401);
    const auth = { authorization: 'Bearer test-only-token', 'content-type': 'application/json' };
    const foreignOrigin = await fetch(`${base}/api/schedules`, { headers: { ...auth, origin: 'https://attacker.invalid' } });
    assert.equal(foreignOrigin.status, 403);
    const invalid = await fetch(`${base}/api/schedules`, { method: 'POST', headers: auth, body: JSON.stringify({ amountBaseUnits: '0' }) });
    assert.equal(invalid.status, 400);
    const wrongContentType = await fetch(`${base}/api/schedules`, { method: 'POST', headers: { authorization: 'Bearer test-only-token', 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(wrongContentType.status, 415);
    const malformed = await fetch(`${base}/api/schedules`, { method: 'POST', headers: auth, body: '{broken' });
    assert.equal(malformed.status, 400);
    const sensitiveMarker = 'private-salary-witness-test-marker';
    const good = await fetch(`${base}/api/schedules`, { method: 'POST', headers: auth, body: JSON.stringify({ recipient: '0x0000000000000000000000000000000000000001', token: '0x0000000000000000000000000000000000000002', amountBaseUnits: '23', intervalSeconds: 3600, firstDue: Math.floor(Date.now() / 1000) + 60, salaryWitness: sensitiveMarker }) });
    assert.equal(good.status, 201);
    const createdResponse = await good.text();
    assert.equal(createdResponse.includes(sensitiveMarker), false);
    const created = JSON.parse(createdResponse).schedule;
    assert.equal(created.source, 'local');
    const cancelled = await fetch(`${base}/api/schedules/${created.id}`, { method: 'DELETE', headers: auth });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).schedule.state, 'cancelled');
    const repeatedCancel = await fetch(`${base}/api/schedules/${created.id}`, { method: 'DELETE', headers: auth });
    assert.equal(repeatedCancel.status, 409);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
