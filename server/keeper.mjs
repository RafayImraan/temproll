import { listSchedules, recordExecutionAttempt } from './store.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Local dry-run only: records due work idempotently, never signs or sends a transaction. */
export async function processDueSchedules(now = Math.floor(Date.now() / 1000)) {
  const schedules = await listSchedules();
  const results = [];
  for (const schedule of schedules) {
    if (schedule.state !== 'scheduled' || now < schedule.firstDue) continue;
    const installment = Math.floor((now - schedule.firstDue) / schedule.intervalSeconds);
    const dueAt = schedule.firstDue + installment * schedule.intervalSeconds;
    if (schedule.endAt && dueAt > schedule.endAt) continue;
    results.push(await recordExecutionAttempt(schedule.id, installment));
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const results = await processDueSchedules();
  const newAttempts = results.filter((item) => !item.duplicate).length;
  const duplicates = results.length - newAttempts;
  process.stdout.write(`Local keeper dry-run: ${newAttempts} due attempt(s) recorded, ${duplicates} duplicate job(s) ignored. No transaction was signed or sent.\n`);
}
