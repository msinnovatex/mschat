import { performance } from 'node:perf_hooks';

const baseUrl = String(process.env.MSCHAT_BASE_URL || '').replace(/\/$/, '');
const requests = Math.min(500, Math.max(1, Number.parseInt(process.env.MSCHAT_SMOKE_REQUESTS || '20', 10) || 20));
const concurrency = Math.min(20, Math.max(1, Number.parseInt(process.env.MSCHAT_SMOKE_CONCURRENCY || '5', 10) || 5));

if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
  console.error('Set MSCHAT_BASE_URL to the deployed MS Chat origin, e.g. https://your-app.vercel.app');
  process.exit(2);
}
if (new URL(baseUrl).pathname !== '/') {
  console.error('MSCHAT_BASE_URL must be an origin, without a path.');
  process.exit(2);
}

const results = [];
let next = 0;
async function worker() {
  while (true) {
    const index = next++;
    if (index >= requests) return;
    const endpoint = index % 2 === 0 ? '/api/health' : '/api/auth/me';
    const started = performance.now();
    try {
      const response = await fetch(baseUrl + endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
        cache: 'no-store'
      });
      const latencyMs = performance.now() - started;
      const expected = endpoint === '/api/health' ? response.status === 200 : response.status === 401;
      results.push({ endpoint, status: response.status, latencyMs, expected });
      await response.body?.cancel();
    } catch (error) {
      results.push({ endpoint, status: 'NETWORK_ERROR', latencyMs: performance.now() - started, expected: false });
      console.error(endpoint + ': ' + String(error?.name || 'request failed'));
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()));
const sorted = results.map(item => item.latencyMs).sort((a, b) => a - b);
const percentile = p => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]) : null;
const failures = results.filter(item => !item.expected);
const statusCounts = Object.fromEntries([...new Set(results.map(item => String(item.status)))].map(status => [status, results.filter(item => String(item.status) === status).length]));
console.log(JSON.stringify({
  baseUrl,
  requests: results.length,
  concurrency: Math.min(concurrency, requests),
  statusCounts,
  latencyMs: { min: sorted.length ? Math.round(sorted[0]) : null, p50: percentile(0.5), p95: percentile(0.95), max: sorted.length ? Math.round(sorted[sorted.length - 1]) : null },
  failures: failures.length,
  note: 'Unauthenticated smoke/load check only; does not validate authenticated messaging, database write throughput, Gmail, R2 uploads, or Web Push.'
}, null, 2));
if (failures.length) process.exitCode = 1;
