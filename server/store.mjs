import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const storePath = resolve(process.env.PAYROLL_STORE_PATH || '.local/payroll-records.json');
const initial = { schedules: [], runs: [] };
let transactionTail = Promise.resolve();

async function transaction(fn) {
  const work = transactionTail.then(async () => {
    const db = await readStore();
    const result = await fn(db);
    await writeStore(db);
    return result;
  });
  transactionTail = work.catch(() => {});
  return work;
}

async function readStore() {
  try {
    const value = JSON.parse(await readFile(storePath, 'utf8'));
    if (!Array.isArray(value.schedules)) throw new TypeError('Invalid local payroll store');
    return { schedules: value.schedules, runs: Array.isArray(value.runs) ? value.runs : [] };
  }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(initial); throw error; }
}

async function writeStore(value) {
  await mkdir(dirname(storePath), { recursive: true });
  const temp = `${storePath}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temp, storePath);
}

export async function listSchedules() { return (await readStore()).schedules; }
export async function listRuns() { return (await readStore()).runs; }

export async function cancelSchedule(id) {
  return transaction((db) => {
    const record = db.schedules.find((item) => item.id === id);
    if (!record) throw new RangeError('Schedule not found');
    if (record.state !== 'scheduled') throw new Error('Schedule is not active');
    record.state = 'cancelled';
    record.cancelledAt = new Date().toISOString();
    return record;
  });
}

export async function createSchedule(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Schedule body required');
  const { recipient, token, amountBaseUnits, intervalSeconds, firstDue, endAt = 0 } = input;
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient || '') || !/^0x[0-9a-fA-F]{40}$/.test(token || '')) throw new TypeError('recipient and token must be EVM addresses');
  if (!/^\d+$/.test(String(amountBaseUnits)) || BigInt(amountBaseUnits) <= 0n) throw new TypeError('amountBaseUnits must be a positive integer string');
  if (BigInt(amountBaseUnits) > (1n << 128n) - 1n) throw new TypeError('amountBaseUnits exceeds the contract uint128 limit');
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds <= 0 || intervalSeconds > 0xffff_ffff_ffff_ffff) throw new TypeError('intervalSeconds must fit a positive uint64');
  if (!Number.isSafeInteger(firstDue) || firstDue <= Math.floor(Date.now() / 1000) || firstDue > 0xffff_ffff_ffff_ffff) throw new TypeError('firstDue must be a future uint64 Unix timestamp');
  if (!Number.isSafeInteger(endAt) || endAt < 0 || endAt > 0xffff_ffff_ffff_ffff) throw new TypeError('endAt must be zero or a uint64 Unix timestamp');
  const record = { id: randomUUID(), recipient, token, amountBaseUnits: String(amountBaseUnits), intervalSeconds, firstDue, endAt, state: 'scheduled', source: 'local', createdAt: new Date().toISOString() };
  return transaction((db) => { db.schedules.push(record); return record; });
}

export async function recordExecutionAttempt(scheduleId, installment, state = 'blocked-no-chain-config') {
  if (!Number.isSafeInteger(installment) || installment < 0) throw new TypeError('Invalid installment');
  return transaction((db) => {
    const schedule = db.schedules.find((item) => item.id === scheduleId);
    if (!schedule) throw new RangeError('Schedule not found');
    const key = `${scheduleId}:${installment}`;
    const existing = db.runs.find((run) => run.idempotencyKey === key);
    if (existing) return { duplicate: true, run: existing };
    const run = { id: randomUUID(), scheduleId, installment, idempotencyKey: key, state, source: 'local-dry-run', createdAt: new Date().toISOString() };
    db.runs.push(run);
    return { duplicate: false, run };
  });
}
