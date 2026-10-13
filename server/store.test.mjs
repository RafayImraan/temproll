import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('schedule validation, persistence, and idempotent attempt records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'payroll-mvp-'));
  process.env.PAYROLL_STORE_PATH = join(dir, 'store.json');
  const { createSchedule, listSchedules, recordExecutionAttempt } = await import(`./store.mjs?${Date.now()}`);
  const input = { recipient: '0x0000000000000000000000000000000000000001', token: '0x0000000000000000000000000000000000000002', amountBaseUnits: '500000', intervalSeconds: 3600, firstDue: Math.floor(Date.now() / 1000) + 60 };
  await assert.rejects(() => createSchedule({ ...input, amountBaseUnits: '0' }), /positive/);
  const created = await createSchedule(input);
  assert.equal((await listSchedules()).length, 1);
  const [first, duplicate] = await Promise.all([recordExecutionAttempt(created.id, 0), recordExecutionAttempt(created.id, 0)]);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.run.id, first.run.id);
  await rm(dir, { recursive: true, force: true });
});

test('local keeper records due work once and never marks a payment as settled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'payroll-keeper-'));
  process.env.PAYROLL_STORE_PATH = join(dir, 'store.json');
  const { createSchedule, listRuns } = await import(`./store.mjs?keeper=${Date.now()}`);
  const { processDueSchedules } = await import(`./keeper.mjs?keeper=${Date.now()}`);
  const now = Math.floor(Date.now() / 1000);
  const schedule = await createSchedule({ recipient: '0x0000000000000000000000000000000000000001', token: '0x0000000000000000000000000000000000000002', amountBaseUnits: '100', intervalSeconds: 60, firstDue: now + 60 });
  assert.equal((await processDueSchedules(now + 59)).length, 0);
  const result = await processDueSchedules(now + 61);
  assert.equal(result.length, 1);
  assert.equal(result[0].duplicate, false);
  assert.equal(result[0].run.state, 'blocked-no-chain-config');
  assert.equal((await processDueSchedules(now + 62))[0].duplicate, true);
  assert.equal((await listRuns()).length, 1);
  assert.equal((await (await import(`./store.mjs?keeper=${Date.now()}`)).listSchedules())[0].state, 'scheduled');
  assert.equal(schedule.state, 'scheduled');
  await rm(dir, { recursive: true, force: true });
});
