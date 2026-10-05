/** Local opt-in observations. Never put bodies, URLs, tokens or errors here. */
declare global { interface Window { __DND_PERFORMANCE__?: boolean } }

export const clientPerformanceEnabled = () => typeof window !== 'undefined' && window.__DND_PERFORMANCE__ === true;
export function emitClientPerformance(phase: string, values: Record<string, number>, requestId?: string) {
  if (!clientPerformanceEnabled()) return;
  const numeric = Object.fromEntries(Object.entries(values).filter(([key,value]) => /^[a-z][a-z0-9_]{0,63}$/.test(key) && Number.isFinite(value) && value >= 0));
  window.dispatchEvent(new CustomEvent('dnd:performance', {detail: {phase, values: numeric, ...(requestId ? {requestId} : {})}}));
}
export async function measureClientPhase<T>(phase: string, work: () => Promise<T>): Promise<T> {
  if (!clientPerformanceEnabled()) return work();
  const start = performance.now();
  try { return await work(); }
  finally { emitClientPerformance(phase, {duration_ms: performance.now() - start}); }
}
export function numericServerPerformance(raw: unknown): Record<string, number> {
  if (typeof raw !== 'string' || raw.length > 8192) return {};
  try { const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([key,value]) => /^[a-z][a-z0-9_]{0,63}$/.test(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0));
  } catch {return {};}
}
