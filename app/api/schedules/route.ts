import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
const apiBase = process.env.PAYROLL_API_URL || 'http://127.0.0.1:8787';

function unavailable() {
  return NextResponse.json({ error: 'Local schedule API unavailable.', source: 'unavailable', schedules: [] }, { status: 503, headers: { 'cache-control': 'no-store' } });
}

function enabled() {
  return process.env.NODE_ENV !== 'production' || process.env.PAYROLL_DASHBOARD_PROXY_ENABLED === 'true';
}

function sameOrigin(request: NextRequest) {
  return request.headers.get('origin') === request.nextUrl.origin;
}

async function forward(path: string, init?: RequestInit) {
  const token = process.env.PAYROLL_API_TOKEN;
  if (!enabled() || !token) return unavailable();
  try {
    const upstream = await fetch(`${apiBase}${path}`, { ...init, cache: 'no-store', headers: { authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch {
    return unavailable();
  }
}

export async function GET() {
  return forward('/api/schedules');
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Same-origin request required.' }, { status: 403 });
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 8192) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) return NextResponse.json({ error: 'Content-Type must be application/json.' }, { status: 415 });
  let body: string;
  try { body = await request.text(); } catch { return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }); }
  if (new TextEncoder().encode(body).byteLength > 8192) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });
  try { JSON.parse(body); } catch { return NextResponse.json({ error: 'Malformed JSON.' }, { status: 400 }); }
  return forward('/api/schedules', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
}

