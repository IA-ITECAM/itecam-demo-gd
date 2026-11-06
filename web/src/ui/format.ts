const nf = new Map<number, Intl.NumberFormat>();
export function fmt(n: number | undefined | null, dec = 0): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  let f = nf.get(dec);
  if (!f) {
    f = new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    nf.set(dec, f);
  }
  return f.format(n);
}

export function fmtMin(min: number): string {
  if (!Number.isFinite(min)) return '—';
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
