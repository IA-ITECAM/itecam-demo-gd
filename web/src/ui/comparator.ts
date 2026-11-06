import type { CompareResult } from '../../../core/engine';
import { KPI_META } from '../../../core/kpis';
import type { TwinConfig, ScenarioId } from '../../../core/types';
import { fmt, esc } from './format';

/** Comparador "¿qué pasa si…?": Base, Escenario A y Escenario B. */
export class ComparatorModal {
  root: HTMLDivElement;
  onVer3D: (id: ScenarioId) => void = () => {};

  constructor(parent: HTMLElement, private cfg: TwinConfig) {
    this.root = document.createElement('div');
    this.root.className = 'modal hidden';
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close();
    });
    parent.appendChild(this.root);
  }

  loading() {
    const c = this.cfg.comparador;
    this.root.innerHTML = `<div class="modal-box"><div class="modal-head"><div><h2>¿Qué pasa si…? ${esc(c.titulo)}</h2><p>${esc(c.pregunta)}</p></div><button class="cerrar">×</button></div>
      <div class="cargando"><div class="spinner"></div> Simulando los tres escenarios con la misma semilla…</div></div>`;
    this.root.querySelector('.cerrar')!.addEventListener('click', () => this.close());
    this.root.classList.remove('hidden');
  }

  private unidad(u: string) {
    return u.replace('ud/día', `${this.cfg.unidadPlural}/día`).replace('/ud', `/${this.cfg.unidad}`);
  }

  open(res: CompareResult, escenarioVivo: ScenarioId) {
    const cols = res.escenarios;
    const filas = KPI_META.map((m) => {
      const vals = cols.map((c) => c.kpis[m.key] as number);
      const max = Math.max(...vals.map(Math.abs), 1e-9);
      const best = m.mejor === 'up' ? Math.max(...vals) : Math.min(...vals);
      const worst = m.mejor === 'up' ? Math.min(...vals) : Math.max(...vals);
      // Si las diferencias son pequeñas (< 6 %), se consideran parecidas y no se marcan
      const parecidos = Math.abs(best - worst) <= Math.max(Math.abs(best), Math.abs(worst)) * 0.06;
      return { m, vals, max, best, worst, parecidos };
    });
    const html = cols
      .map((c, ci) => {
        const kpis = filas
          .map(({ m, vals, max, best, worst, parecidos }) => {
            const v = vals[ci];
            const tol = Math.abs(best) * 0.01;
            const cls = parecidos ? 'parecido' : Math.abs(v - best) <= tol ? 'mejor' : Math.abs(v - worst) <= tol ? 'peor' : '';
            return `<div class="cmp-kpi">
              <div class="cmp-kpi-l"><span>${esc(m.label)} <span class="dir" title="${m.mejor === 'up' ? 'Más es mejor' : 'Menos es mejor'}">${m.mejor === 'up' ? '↑' : '↓'}</span></span>
                <span class="cmp-kpi-v">${fmt(v, m.dec)} <small>${esc(this.unidad(m.unidad))}</small></span></div>
              <div class="cmp-bar"><i class="${cls}" style="width:${Math.max(2, (Math.abs(v) / max) * 100).toFixed(1)}%"></i></div>
            </div>`;
          })
          .join('');
        return `<div class="cmp-col ${c.id === 'base' ? 'base' : ''}">
          <h3>${esc(c.titulo)}</h3>
          <p class="det">${esc(c.detalle)}</p>
          ${kpis}
          <button class="btn ${escenarioVivo === c.id ? 'on' : ''}" data-ver="${c.id}">${c.id === 'base' ? (escenarioVivo === 'base' ? 'En 3D: situación actual' : 'Volver a la situación actual') : escenarioVivo === c.id ? 'Viéndolo en 3D' : 'Ver en 3D'}</button>
        </div>`;
      })
      .join('');
    this.root.innerHTML = `
      <div class="modal-box">
        <div class="modal-head">
          <div><h2>¿Qué pasa si…? ${esc(res.titulo)}</h2><p>${esc(res.pregunta)} <span class="nota">· ${esc(res.horizonte)}</span></p></div>
          <button class="cerrar" title="Cerrar (Esc)">×</button>
        </div>
        <div class="cmp-cols">${html}</div>
        <div class="cmp-leyenda"><span><b>↑</b> más es mejor</span><span><b>↓</b> menos es mejor</span>
          <span><i class="dot" style="background:var(--teal)"></i> mejor valor</span><span><i class="dot" style="background:var(--naranja)"></i> peor valor</span><span><i class="dot" style="background:#9fc9c6"></i> parecidos (diferencia &lt; 6 %)</span></div>
        <div class="cmp-msg">El gemelo <span>no decide</span>: muestra las consecuencias de cada opción.</div>
      </div>`;
    this.root.querySelector('.cerrar')!.addEventListener('click', () => this.close());
    this.root.querySelectorAll<HTMLButtonElement>('[data-ver]').forEach((b) =>
      b.addEventListener('click', () => {
        this.onVer3D(b.dataset.ver as ScenarioId);
        this.close();
      }),
    );
    this.root.classList.remove('hidden');
  }

  close() {
    this.root.classList.add('hidden');
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }
}
