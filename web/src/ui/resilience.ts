import type { ResilienceResult } from '../../../core/engine';
import { lineChart, C, Chart } from './charts';
import { fmt, esc } from './format';

/** Modal con la curva de resiliencia: sin crisis, sin plan y con plan ensayado en el gemelo. */
export class ResilienceModal {
  root: HTMLDivElement;
  private chart: Chart | null = null;
  private last: ResilienceResult | null = null;
  onAplicarPlan: () => void = () => {};
  /** la página lo actualiza con cada fotograma: si la crisis ha terminado, no se puede aplicar el plan */
  crisisActiva = true;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'modal hidden';
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    parent.appendChild(this.root);
  }

  get hasData() {
    return !!this.last;
  }

  open(res?: ResilienceResult, planAplicado = false) {
    if (res) this.last = res;
    const r = this.last;
    if (!r) return;
    const esProd = r.metrica === 'produccion';
    const salvado = Math.max(0, r.salvado);
    const unidad = esProd ? r.unidad.replace('/h', '') : '€';
    this.root.innerHTML = `
      <div class="modal-box medio">
        <div class="modal-head">
          <div>
            <h2>Curva de resiliencia · ${esc(r.crisis.titulo)}</h2>
            <p>Si la crisis empieza ahora (${esc(r.reloj)}), así evolucionan ${esProd ? 'la producción' : 'el coste de la energía'} durante las próximas horas. Misma semilla en las tres ramas.</p>
          </div>
          <button class="cerrar" title="Cerrar (Esc)">×</button>
        </div>
        <div class="res-grid">
          <div class="res-chart"><canvas></canvas></div>
          <div class="res-side">
            <div class="res-num">
              <span>${esProd ? 'Producción que no se pierde gracias al plan' : 'Coste que se evita gracias al plan'}</span>
              <div class="big-num">+${fmt(salvado, 0)} ${esc(unidad)}</div>
            </div>
            <div class="res-num mal">
              <span>${esProd ? 'Pérdida sin plan' : 'Sobrecoste sin plan'}</span>
              <div class="big-num">${fmt(Math.max(0, r.perdidaSinPlan), 0)} ${esc(unidad)}</div>
              <span>${esProd ? 'Con plan' : 'Con plan'}: ${fmt(Math.max(0, r.perdidaConPlan), 0)} ${esc(unidad)}</span>
            </div>
            <div class="info"><b>Plan ensayado en el gemelo:</b><br/>${esc(r.crisis.plan)}</div>
            <button class="btn primario plan-btn" ${planAplicado || !this.crisisActiva ? 'disabled' : ''}>${!this.crisisActiva ? 'La crisis ya ha terminado' : planAplicado ? 'Plan aplicado en vivo ✓' : 'Aplicar el plan en vivo'}</button>
          </div>
        </div>
      </div>`;
    this.root.querySelector('.cerrar')!.addEventListener('click', () => this.close());
    this.root.querySelector('.plan-btn')!.addEventListener('click', (e) => {
      this.onAplicarPlan();
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      b.textContent = 'Plan aplicado en vivo ✓';
    });
    this.root.classList.remove('hidden');
    this.chart?.destroy();
    const canvas = this.root.querySelector('canvas')!;
    this.chart = lineChart(
      canvas,
      [
        { label: 'Sin crisis (referencia)', data: r.sinCrisis, borderColor: C.gris, borderDash: [6, 6], borderWidth: 2, fill: false },
        { label: 'Crisis sin plan', data: r.sinPlan, borderColor: C.naranja, borderWidth: 3.5, fill: false },
        {
          label: esProd ? 'Crisis con plan ensayado (zona sombreada = producción que no se pierde)' : 'Crisis con plan ensayado (zona sombreada = coste evitado)',
          data: r.conPlan,
          borderColor: C.teal,
          borderWidth: 3.5,
          fill: { target: 1, above: esProd ? C.tealSuave : 'rgba(0,0,0,0)', below: esProd ? 'rgba(0,0,0,0)' : C.tealSuave },
        },
      ],
      { yTitulo: r.unidad, xTitulo: 'Horas desde el inicio de la crisis', leyenda: true, maxTicksX: 12 },
    );
    this.chart.data.labels = r.horas.map((h) => (Number.isInteger(h) ? `${h} h` : `${fmt(h, 2)}`));
    // Marca el final de la crisis
    this.chart.update('none');
  }

  close() {
    this.root.classList.add('hidden');
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }
}
