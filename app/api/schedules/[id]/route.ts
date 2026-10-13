import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (request.headers.get('origin') !== request.nextUrl.origin) return NextResponse.json({ error: 'Same-origin request required.' }, { status: 403 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid schedule ID.' }, { status: 400 });
  const token = process.env.PAYROLL_API_TOKEN;
  if (!token || (process.env.NODE_ENV === 'production' && process.env.PAYROLL_DASHBOARD_PROXY_ENABLED !== 'true')) return NextResponse.json({ error: 'Local schedule API unavailable.', source: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  try {
    const base = process.env.PAYROLL_API_URL || 'http://127.0.0.1:8787';
    const upstream = await fetch(`${base}/api/schedules/${id}`, { method: 'DELETE', cache: 'no-store', headers: { authorization: `Bearer ${token}` } });
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch {
    return NextResponse.json({ error: 'Local schedule API unavailable.', source: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
