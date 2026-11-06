import type { RngState } from './rng';
import type { Ledger, Kpis } from './kpis';
import type { ContextoEnergia } from './energy';

export type CrisisId = 'averia' | 'proveedor' | 'demanda' | 'energia';
export type ScenarioId = 'base' | 'A' | 'B';

export interface CrisisDef {
  id: CrisisId;
  titulo: string;
  detalle: string;
  /** El plan "ensayado en el gemelo" que se aplica en la rama "con plan" */
  plan: string;
  /** Qué se dibuja en la curva de resiliencia */
  metrica: 'produccion' | 'coste';
  duracionH: number;
}

export interface ScenarioDef {
  id: ScenarioId;
  titulo: string;
  detalle: string;
}

/** Configuración compartida servidor/cliente de un gemelo. */
export interface TwinConfig {
  id: string;
  orden: number;
  titulo: string;
  subtitulo: string;
  descripcion: string;
  sector: string;
  unidad: string;
  unidadPlural: string;
  /** Equipo crítico (para la ficha y la crisis de avería) */
  equipoCritico: string;
  crisis: CrisisDef[];
  comparador: {
    titulo: string;
    pregunta: string;
    horizonte: string;
    escenarios: ScenarioDef[];
  };
}

export interface CommonParams {
  ctx: ContextoEnergia;
}

export interface ActiveCrisis {
  id: CrisisId;
  /** inicio y fin medidos en tiempo de operación (workT) */
  w0: number;
  wHasta: number;
  plan: boolean;
}

export interface BaseState<P> {
  /** tiempo de reloj simulado (s desde Día 1 06:00) */
  t: number;
  /** tiempo de operación acumulado (s); en plantas 24 h coincide con t */
  workT: number;
  rng: RngState;
  p: P;
  L: Ledger;
  crisis: ActiveCrisis | null;
}

export type EstadoEquipo =
  | 'trabajando'
  | 'esperando'
  | 'averia'
  | 'sin_material'
  | 'inactivo'
  | 'fuera_turno'
  | 'cargando'
  | 'alerta';

export interface Equipo {
  id: string;
  nombre: string;
  estado: EstadoEquipo;
  /** utilización 0..1 */
  util: number;
  kw: number;
  cola?: number;
  /** datos adicionales para la ficha */
  extra?: Record<string, string | number>;
}

export interface Alerta {
  nivel: 'info' | 'aviso' | 'critico';
  texto: string;
}

export interface BaseView {
  equipos: Equipo[];
  alertas: Alerta[];
}

export interface CommandContext<P> {
  /** parámetros "vivos" del escenario base: lo que se cambie aquí sobrevive a un reinicio */
  live: P;
  seed: number;
}

export interface TwinModel<P extends CommonParams = any, S extends BaseState<P> = BaseState<P>, V extends BaseView = BaseView> {
  config: TwinConfig;
  /** paso de simulación (s) */
  dt: number;
  /** horizonte del comparador (h de reloj) */
  horizonteComparadorH: number;
  /** horizonte de la curva de resiliencia (h de operación) */
  horizonteResilienciaH: number;
  defaultParams(): P;
  scenarioParams(id: ScenarioId, live: P): P;
  init(p: P, seed: number): S;
  step(s: S, dt: number): void;
  view(s: S): V;
  /** potencia instantánea por equipo (kW) para las gráficas; debe incluir `total` */
  potencias(s: S): Record<string, number>;
  /** efectos inmediatos al empezar una crisis (opcional) */
  onCrisis?(s: S): void;
  /** comandos específicos del gemelo (layout, flota, calibración…) */
  command?(s: S, cmd: string, args: any, ctx: CommandContext<P>): unknown;
}

/** ¿Está activa la crisis `id` en este instante? */
export const crisisActiva = (s: BaseState<any>, id?: CrisisId) =>
  !!s.crisis && s.workT < s.crisis.wHasta && (id === undefined || s.crisis.id === id);

/** ¿Está activa la crisis `id` con el plan aplicado? */
export const planActivo = (s: BaseState<any>, id: CrisisId) => crisisActiva(s, id) && !!s.crisis?.plan;

export type { Kpis, Ledger };
