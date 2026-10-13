import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { cancelSchedule, createSchedule, listRuns, listSchedules } from './store.mjs';

const port = Number(process.env.API_PORT || 8787);
const apiToken = process.env.PAYROLL_API_TOKEN;
const allowedOrigins = new Set((process.env.PAYROLL_API_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map((value) => value.trim()).filter(Boolean));
const buckets = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const MAX_WRITES = 12;

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', ...headers });
  res.end(JSON.stringify(data));
}

function tokenMatches(candidate) {
  if (!apiToken || !candidate) return false;
  const expected = createHash('sha256').update(apiToken).digest();
  const received = createHash('sha256').update(candidate).digest();
  return timingSafeEqual(expected, received);
}

function consumeRateLimit(req, res, write = false) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= WINDOW_MS) bucket = { start: now, all: 0, writes: 0 };
  bucket.all += 1;
  if (write) bucket.writes += 1;
  buckets.set(key, bucket);
  if (bucket.all > MAX_REQUESTS || bucket.writes > MAX_WRITES) {
    send(res, 429, { error: 'Rate limit exceeded. Retry in a minute.' }, { 'retry-after': '60' });
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) { send(res, 403, { error: 'Origin is not allowed.' }); return; }
  const corsHeaders = origin ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type' } : {};
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders).end(); return; }
  if (!consumeRateLimit(req, res, req.method !== 'GET')) return;
  if (req.url === '/health' && req.method === 'GET') { send(res, 200, { ok: true, mode: 'local' }, corsHeaders); return; }
  if (!apiToken) { send(res, 503, { error: 'API authentication is not configured.' }, corsHeaders); return; }
  const suppliedToken = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  if (!tokenMatches(suppliedToken)) { send(res, 401, { error: 'Unauthorized' }, corsHeaders); return; }
  try {
    if (req.url === '/api/schedules' && req.method === 'GET') { send(res, 200, { source: 'local', schedules: await listSchedules(), runs: await listRuns() }, corsHeaders); return; }
    if (req.url === '/api/schedules' && req.method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) { send(res, 415, { error: 'Content-Type must be application/json.' }, corsHeaders); return; }
      let raw = ''; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) { send(res, 413, { error: 'Request body too large.' }, corsHeaders); return; } raw += chunk; }
      const record = await createSchedule(JSON.parse(raw));
      send(res, 201, { source: 'local', schedule: record }, corsHeaders); return;
    }
    const cancelMatch = /^\/api\/schedules\/([0-9a-f-]{36})$/.exec(req.url || '');
    if (cancelMatch && req.method === 'DELETE') {
      const record = await cancelSchedule(cancelMatch[1]);
      send(res, 200, { source: 'local', schedule: record }, corsHeaders); return;
    }
    send(res, 404, { error: 'Not found' }, corsHeaders);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) { send(res, 400, { error: error.message }, corsHeaders); return; }
    if (error instanceof RangeError && error.message === 'Schedule not found') { send(res, 404, { error: error.message }, corsHeaders); return; }
    if (error instanceof Error && error.message === 'Schedule is not active') { send(res, 409, { error: error.message }, corsHeaders); return; }
    send(res, 500, { error: 'Internal error' }, corsHeaders);
  }
});

server.listen(port, '127.0.0.1', () => process.stdout.write(`Local payroll API listening on http://127.0.0.1:${port}\n`));
