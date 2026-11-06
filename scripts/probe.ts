// Script de sondeo para ajustar parámetros (no forma parte de la app).
import { TwinRunner } from '../core/engine';
import { MODELS } from '../twins/registry.gen';

const id = process.argv[2] ?? 'mecanizado';
const m = MODELS.find((x) => x.config.id === id)!;
const r = new TwinRunner(m, 2026);
const f = (k: any) => JSON.stringify(Object.fromEntries(Object.entries(k).map(([a, b]) => [a, typeof b === 'number' ? +b.toFixed(2) : b])));
let t0 = performance.now();
r.advance(8 * 3600);
console.log('live 8h', f(r.kpis()), 'ritmo', r.ritmo().toFixed(1), (performance.now() - t0).toFixed(0) + 'ms');
t0 = performance.now();
const c = r.comparar();
for (const e of c.escenarios) console.log('cmp', e.id, f(e.kpis));
console.log('comparar ms', (performance.now() - t0).toFixed(0));
for (const cr of m.config.crisis) {
  t0 = performance.now();
  const res = r.resiliencia(cr.id);
  console.log('crisis', cr.id, 'salvado', res.salvado.toFixed(1), 'perdSin', res.perdidaSinPlan.toFixed(1), 'perdCon', res.perdidaConPlan.toFixed(1), (performance.now() - t0).toFixed(0) + 'ms');
  console.log('   sin', res.sinPlan.map((x) => x.toFixed(0)).join(' '));
  console.log('   con', res.conPlan.map((x) => x.toFixed(0)).join(' '));
}
const extra = process.argv[3];
if (extra) {
  t0 = performance.now();
  const out: any = r.command(extra, {});
  console.log(extra, (performance.now() - t0).toFixed(0) + 'ms', JSON.stringify(out?.data?.resumen ?? out?.data)?.slice(0, 600));
  if (out?.data?.iteraciones) for (const it of out.data.iteraciones) console.log(it.nombre, it.detalle, it.error.toFixed(1));
}
