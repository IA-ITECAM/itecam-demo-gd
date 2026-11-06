// Sondeo de la dinámica de una crisis en vivo (no forma parte de la app).
// Uso: npx tsx scripts/probe-crisis.ts <gemelo> <crisis> [horaInicio=2] [plan=0]
import { TwinRunner } from '../core/engine';
import { MODELS } from '../twins/registry.gen';
import { reloj } from '../core/clock';

const [id = 'mecanizado', crisis = 'proveedor', h0 = '2', plan = '0'] = process.argv.slice(2);
const r = new TwinRunner(MODELS.find((m) => m.config.id === id)!, 2026);
r.advance(Number(h0) * 3600);
r.command('crisis', { id: crisis });
if (plan === '1') r.command('plan');
let lastGood = r.state.L.good;
for (let i = 0; i < 32; i++) {
  r.advance(900);
  const s: any = r.state;
  const v: any = r.model.view(s);
  const prod = ((s.L.good - lastGood) * 4).toFixed(0);
  lastGood = s.L.good;
  const extra = id === 'mecanizado'
    ? `stock ${s.stock.toFixed(0).padStart(3)} seg ${s.seguridad.toFixed(0).padStart(3)} backlog ${String(s.backlog.length).padStart(3)} wip ${String(Object.keys(s.piezas).length).padStart(2)}`
    : `pend ${String(v.pedidosPendientes).padStart(3)} bloq ${String(v.bloqueados).padStart(3)} ubic ${String(v.ubicacionesPendientes).padStart(3)} agv ${v.agvs.length / 8}`;
  console.log(`${reloj(s.t)}  crisis:${s.crisis ? (s.crisis.plan ? 'PLAN' : 'sí  ') : 'no  '}  prod ${prod.padStart(3)}/h  ${extra}  · ${v.alertas.map((a: any) => a.texto).join(' | ')}`);
}
