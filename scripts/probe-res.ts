// Pérdida/salvado de cada crisis según la hora a la que se lanza (no forma parte de la app).
import { TwinRunner } from '../core/engine';
import { MODELS } from '../twins/registry.gen';
const m = MODELS.find((x) => x.config.id === process.argv[2])!;
for (const h of [0.1, 1, 2, 4, 6, 10]) {
  const r = new TwinRunner(m, 2026);
  r.advance(h * 3600);
  console.log(`t=${h}h`, m.config.crisis.map((c) => { const x = r.resiliencia(c.id); return `${c.id}: pierde ${x.perdidaSinPlan.toFixed(0)} salva ${x.salvado.toFixed(0)}`; }).join(' | '));
}
