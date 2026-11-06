import { kpisFrom, type Kpis } from './kpis';
import { reloj } from './clock';
import type { ContextoEnergia } from './energy';
import type { BaseState, CrisisDef, CrisisId, ScenarioDef, ScenarioId, TwinModel } from './types';
import { crisisActiva } from './types';

/** Segundos simulados por segundo real para cada velocidad. */
export const VELOCIDADES: Record<number, number> = { 1: 30, 5: 150, 20: 600 };
/** Periodo de muestreo de las series (s de operación). */
export const MUESTREO_S = 300;
const MAX_PASOS_TICK = 2000;

export interface SeriesPoint {
  w: number;
  reloj: string;
  /** ritmo de producción de la última hora (ud/h) */
  prod: number;
  /** potencias por equipo (kW), incluye `total` */
  kw: Record<string, number>;
  coste: number;
}

export interface ResilienceResult {
  crisis: CrisisDef;
  metrica: 'produccion' | 'coste';
  unidad: string;
  horas: number[];
  sinCrisis: number[];
  sinPlan: number[];
  conPlan: number[];
  /** unidades (o €) que el plan evita perder */
  salvado: number;
  perdidaSinPlan: number;
  perdidaConPlan: number;
  reloj: string;
}

export interface CompareResult {
  titulo: string;
  pregunta: string;
  horizonte: string;
  escenarios: (ScenarioDef & { kpis: Kpis })[];
}

export interface CrisisInfo {
  id: CrisisId;
  titulo: string;
  plan: boolean;
  textoPlan: string;
  restanteMin: number;
}

export const clone = <T>(x: T): T => structuredClone(x);

/**
 * Ejecuta un gemelo: reloj, velocidad, pausa, escenario visible, crisis,
 * bifurcaciones para la curva de resiliencia y proyecciones del comparador.
 */
export class TwinRunner<P extends { ctx: ContextoEnergia } = any> {
  state!: BaseState<P>;
  speed = 1;
  paused = false;
  escenario: ScenarioId = 'base';
  live: P;
  series: SeriesPoint[] = [];
  seriesVersion = 0;
  private acc = 0;
  private hist: { w: number; good: number }[] = [];
  private nextSample = 0;
  private lastCoste = { w: 0, c: 0 };
  private compareCache = new Map<string, CompareResult>();

  constructor(public model: TwinModel<P, any, any>, public seed: number) {
    this.live = model.defaultParams();
    this.reset();
  }

  get config() {
    return this.model.config;
  }

  paramsEscenario(id: ScenarioId): P {
    return id === 'base' ? clone(this.live) : this.model.scenarioParams(id, clone(this.live));
  }

  reset() {
    this.state = this.model.init(this.paramsEscenario(this.escenario), this.seed);
    this.acc = 0;
    this.series = [];
    this.hist = [];
    this.nextSample = 0;
    this.lastCoste = { w: 0, c: 0 };
    this.sample();
    this.seriesVersion++;
  }

  setContexto(ctx: ContextoEnergia) {
    this.live.ctx = clone(ctx);
    this.state.p.ctx = clone(ctx);
    this.compareCache.clear();
  }

  /** Avanza la simulación `realDt` segundos reales. */
  tick(realDt: number) {
    if (this.paused) return;
    const dt = this.model.dt;
    this.acc += realDt * (VELOCIDADES[this.speed] ?? 30);
    let n = 0;
    while (this.acc >= dt && n < MAX_PASOS_TICK) {
      this.model.step(this.state, dt);
      this.acc -= dt;
      n++;
      this.afterStep();
    }
    if (n >= MAX_PASOS_TICK) this.acc = 0;
  }

  /** Avanza un número de pasos (para tests). */
  advance(steps: number) {
    for (let i = 0; i < steps; i++) {
      this.model.step(this.state, this.model.dt);
      this.afterStep();
    }
  }

  private afterStep() {
    const s = this.state;
    if (s.crisis && !crisisActiva(s)) s.crisis = null;
    if (s.workT >= this.nextSample) this.sample();
  }

  private sample() {
    const s = this.state;
    this.hist.push({ w: s.workT, good: s.L.good });
    while (this.hist.length > 2 && this.hist[1].w <= s.workT - 3600) this.hist.shift();
    const h0 = this.hist[0];
    const dw = s.workT - h0.w;
    const prod = dw > 0 ? ((s.L.good - h0.good) * 3600) / dw : 0;
    const dwc = s.workT - this.lastCoste.w;
    const coste = dwc > 0 ? ((s.L.energyCost - this.lastCoste.c) * 3600) / dwc : 0;
    this.lastCoste = { w: s.workT, c: s.L.energyCost };
    this.series.push({ w: s.workT, reloj: reloj(s.t), prod, kw: this.model.potencias(s), coste });
    if (this.series.length > 144) this.series.shift();
    this.nextSample = s.workT + MUESTREO_S;
    this.seriesVersion++;
  }

  ritmo(): number {
    return this.series.length ? this.series[this.series.length - 1].prod : 0;
  }

  kpis(): Kpis {
    return kpisFrom(this.state.L, this.state.t);
  }

  crisisInfo(): CrisisInfo | null {
    const c = this.state.crisis;
    if (!c) return null;
    const def = this.config.crisis.find((d) => d.id === c.id)!;
    return { id: c.id, titulo: def.titulo, plan: c.plan, textoPlan: def.plan, restanteMin: (c.wHasta - this.state.workT) / 60 };
  }

  private aplicarCrisis(s: BaseState<P>, id: CrisisId, plan: boolean) {
    const def = this.config.crisis.find((d) => d.id === id);
    if (!def) throw new Error(`Crisis desconocida: ${id}`);
    s.crisis = { id, w0: s.workT, wHasta: s.workT + def.duracionH * 3600, plan };
    this.model.onCrisis?.(s);
  }

  /**
   * Bifurca el estado actual en tres ramas (sin crisis, crisis sin plan, crisis con plan),
   * las simula hacia delante con la misma semilla y devuelve la curva de resiliencia.
   */
  resiliencia(id: CrisisId): ResilienceResult {
    const def = this.config.crisis.find((d) => d.id === id);
    if (!def) throw new Error(`Crisis desconocida: ${id}`);
    const H = this.model.horizonteResilienciaH * 3600;
    const bin = 900;
    const dt = this.model.dt;
    const metrica = def.metrica;
    const valor = (s: BaseState<P>) => (metrica === 'produccion' ? s.L.good : s.L.energyCost);
    const rama = (modo: 'ninguna' | 'sin' | 'con') => {
      const s = clone(this.state);
      if (modo === 'ninguna') s.crisis = null;
      else this.aplicarCrisis(s, id, modo === 'con');
      const w0 = s.workT;
      const out: number[] = [];
      let last = valor(s);
      let next = w0 + bin;
      let guard = 0;
      while (s.workT < w0 + H && guard++ < 2_000_000) {
        this.model.step(s, dt);
        if (s.crisis && !crisisActiva(s)) s.crisis = null;
        if (s.workT >= next) {
          const v = valor(s);
          out.push(((v - last) * 3600) / bin);
          last = v;
          next += bin;
        }
      }
      return out;
    };
    const sinCrisis = rama('ninguna');
    const sinPlan = rama('sin');
    const conPlan = rama('con');
    const horas = sinPlan.map((_, i) => ((i + 1) * bin) / 3600);
    const sum = (a: number[], b: number[]) => a.reduce((acc, v, i) => acc + (v - (b[i] ?? 0)) * (bin / 3600), 0);
    const signo = metrica === 'produccion' ? 1 : -1;
    // Para dibujar se suaviza con una media móvil de 3 tramos (45 min); los totales usan los datos brutos.
    const suave = (a: number[]) => a.map((_, i) => {
      const v = a.slice(Math.max(0, i - 1), i + 2);
      return v.reduce((x, y) => x + y, 0) / v.length;
    });
    return {
      crisis: def,
      metrica,
      unidad: metrica === 'produccion' ? `${this.config.unidadPlural}/h` : '€/h',
      horas,
      sinCrisis: suave(sinCrisis),
      sinPlan: suave(sinPlan),
      conPlan: suave(conPlan),
      salvado: signo * sum(conPlan, sinPlan),
      perdidaSinPlan: signo * sum(sinCrisis, sinPlan),
      perdidaConPlan: signo * sum(sinCrisis, conPlan),
      reloj: reloj(this.state.t),
    };
  }

  /** Lanza una crisis en el gemelo en vivo (sin plan) y devuelve su curva de resiliencia. */
  lanzarCrisis(id: CrisisId): ResilienceResult {
    const res = this.resiliencia(id);
    this.aplicarCrisis(this.state, id, false);
    return res;
  }

  aplicarPlan() {
    if (this.state.crisis) this.state.crisis.plan = true;
  }

  /** Proyecta los escenarios del comparador con la misma semilla. */
  comparar(): CompareResult {
    const key = JSON.stringify(this.live);
    const cached = this.compareCache.get(key);
    if (cached) return cached;
    const H = this.model.horizonteComparadorH * 3600;
    const cmp = this.config.comparador;
    const escenarios = cmp.escenarios.map((sc) => {
      const s = this.model.init(this.model.scenarioParams(sc.id, clone(this.live)), this.seed);
      let guard = 0;
      while (s.t < H && guard++ < 5_000_000) this.model.step(s, this.model.dt);
      return { ...sc, kpis: kpisFrom(s.L, s.t) };
    });
    const res: CompareResult = { titulo: cmp.titulo, pregunta: cmp.pregunta, horizonte: cmp.horizonte, escenarios };
    if (this.compareCache.size >= 32) this.compareCache.clear(); // memoria acotada
    this.compareCache.set(key, res);
    return res;
  }

  /** Ejecuta un comando del cliente. Devuelve un mensaje de respuesta o null. */
  command(cmd: string, args: any = {}): { type: string; [k: string]: unknown } | null {
    switch (cmd) {
      case 'velocidad':
        if (Object.hasOwn(VELOCIDADES, String(args?.v))) this.speed = Number(args.v);
        if (this.paused) this.paused = false;
        return null;
      case 'pausa':
        this.paused = typeof args.v === 'boolean' ? args.v : !this.paused;
        return null;
      case 'reiniciar':
        this.reset();
        return null;
      case 'escenario':
        if (['base', 'A', 'B'].includes(args?.id)) {
          this.escenario = args.id;
          this.reset();
        }
        return null;
      case 'crisis':
        return { type: 'resiliencia', data: this.lanzarCrisis(args.id) };
      case 'plan':
        this.aplicarPlan();
        return null;
      case 'finCrisis':
        this.state.crisis = null;
        return null;
      case 'comparar':
        return { type: 'comparador', data: this.comparar() };
      default: {
        if (!this.model.command) return null;
        const data = this.model.command(this.state, cmd, args, { live: this.live, seed: this.seed });
        this.compareCache.clear();
        return { type: 'respuesta', cmd, data };
      }
    }
  }
}
