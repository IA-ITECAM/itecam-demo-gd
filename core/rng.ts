/**
 * Generador pseudoaleatorio con semilla (mulberry32).
 * El estado es un objeto plano: se puede clonar (structuredClone) para
 * bifurcar una simulación y obtener exactamente la misma secuencia.
 */
export interface RngState {
  s: number;
}

export function makeRng(seed: number): RngState {
  return { s: (seed >>> 0) || 0x9e3779b9 };
}

export function rand(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const uniform = (r: RngState, a: number, b: number) => a + (b - a) * rand(r);

export function normal(r: RngState, mu: number, sd: number): number {
  const u1 = Math.max(rand(r), 1e-12);
  const u2 = rand(r);
  return mu + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Exponencial de media `mean`. */
export const expo = (r: RngState, mean: number) => -mean * Math.log(1 - rand(r));

export const chance = (r: RngState, p: number) => rand(r) < p;

export const int = (r: RngState, a: number, b: number) => a + Math.floor(rand(r) * (b - a + 1));

/** Tiempo de ciclo con variabilidad (normal truncada). */
export function cycle(r: RngState, mean: number, cv: number): number {
  return Math.max(mean * 0.4, normal(r, mean, mean * cv));
}

/**
 * Reloj de averías de un equipo con su propio generador ("números aleatorios comunes"):
 * así, al bifurcar una simulación (con/sin plan, escenarios A/B), las averías caen
 * en el mismo tiempo de funcionamiento en todas las ramas y la comparación es justa.
 */
export interface Fallos {
  rng: RngState;
  ttf: number;
}

export function nuevoFallos(seed: number, mtbfS: number): Fallos {
  const rng = makeRng(seed);
  return { rng, ttf: expo(rng, mtbfS) };
}

/** Descuenta `dt` s de funcionamiento. Si toca avería devuelve la duración de la reparación (s); si no, 0. */
export function avanzarFallos(f: Fallos, dt: number, mtbfS: number, mttrS: number): number {
  f.ttf -= dt;
  if (f.ttf > 0) return 0;
  f.ttf = expo(f.rng, mtbfS);
  return Math.max(1, expo(f.rng, mttrS));
}

/** Semilla derivada para un equipo concreto. */
export const semillaEquipo = (seed: number, k: number) => (Math.imul(seed ^ 0x5bd1e995, 2654435761) + k * 40503) >>> 0;

/** Número de llegadas Poisson en un paso dt (s) con una tasa por hora. */
export function poisson(r: RngState, ratePerHour: number, dt: number): number {
  const lambda = (ratePerHour * dt) / 3600;
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand(r);
  } while (p > L && k < 50);
  return k - 1;
}
