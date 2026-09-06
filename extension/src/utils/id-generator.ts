let counter = 0;

export function generateId(prefix = 'pii'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  const seq = (counter++).toString(36).padStart(4, '0');
  return `${prefix}-${ts}-${rand}-${seq}`;
}
