// The HTTP/SSE server can remain responsive while its capture worker is stuck.
// Judge worker liveness separately, instead of repeating an old 'capturing' flag.
export function captureHealth(capture, lastStatusAt, now = Date.now()) {
  const age = lastStatusAt === null ? 0 : Math.max(0, now - lastStatusAt);
  const result = { ...capture, statusAgeMs: age };
  if (!['starting', 'capturing'].includes(capture.state)) return result;
  if (age > 5000) return { ...result, state: 'stalled', error: 'Paket okuma yanıt vermiyor. Cube alarmı şu anda güvenilir değil.' };
  if (capture.state === 'capturing' && capture.processingLagMs > 5000) return { ...result, state: 'delayed',
    error: `Paket okuma ${Math.round(capture.processingLagMs / 1000)} sn geriden geliyor. Cube alarmı gecikebilir.` };
  return result;
}
