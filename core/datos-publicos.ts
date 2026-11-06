/**
 * Datos públicos opcionales (sin clave):
 *  - Precio horario de la electricidad en España (PVPC) — API REData de Red Eléctrica.
 *  - Temperatura exterior horaria — Open-Meteo.
 * Si algo falla (sin red, formato inesperado…) se devuelven los datos simulados.
 * Funciona igual en el servidor (Node) y en el navegador: ambas APIs permiten CORS.
 */
import { contextoSimulado, type ContextoEnergia } from './energy';

export type FuenteDatos = 'simulados' | 'públicos';

export interface EstadoDatos {
  fuente: FuenteDatos;
  activado: boolean;
  detalle: string;
  ctx: ContextoEnergia;
  actualizado?: string;
}

// Coordenadas de referencia: Tomelloso (Ciudad Real)
const LAT = 39.16;
const LON = -3.02;

/** Cabeceras extra (el servidor añade un User-Agent; en el navegador no se envían para evitar el preflight CORS). */
let cabecerasExtra: Record<string, string> = {};
export function configurarCabeceras(c: Record<string, string>) {
  cabecerasExtra = { ...c };
}

async function getJson(url: string, timeoutMs = 6000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json', ...cabecerasExtra } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

const fechaMadrid = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());

/** Devuelve 24 precios (€/kWh) del PVPC de hoy. */
export async function preciosREData(): Promise<number[]> {
  const d = fechaMadrid();
  const url = `https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?start_date=${d}T00:00&end_date=${d}T23:59&time_trunc=hour`;
  const j = await getJson(url);
  const series: any[] = j?.included ?? [];
  const pvpc = series.find((s) => /pvpc/i.test(s?.attributes?.title ?? '') || s?.type === 'PVPC') ?? series[0];
  const values: any[] = pvpc?.attributes?.values ?? [];
  if (values.length < 20) throw new Error('REData: respuesta incompleta');
  // Puede venir en periodos de 15 min o de 1 h: se promedia por hora local.
  const acc = Array.from({ length: 24 }, () => ({ s: 0, n: 0 }));
  for (const v of values) {
    const hh = Number(String(v.datetime).slice(11, 13));
    if (Number.isFinite(hh) && Number.isFinite(v.value)) {
      acc[hh].s += v.value / 1000; // €/MWh -> €/kWh
      acc[hh].n++;
    }
  }
  const out = acc.map((a) => (a.n ? a.s / a.n : NaN));
  if (out.some((x) => !Number.isFinite(x) || x <= 0 || x > 2)) throw new Error('REData: valores fuera de rango');
  return out;
}

/** Devuelve 24 temperaturas (°C) de hoy. */
export async function temperaturasOpenMeteo(): Promise<number[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=temperature_2m&forecast_days=1&timezone=Europe%2FMadrid`;
  const j = await getJson(url);
  const temps: number[] = j?.hourly?.temperature_2m ?? [];
  if (temps.length < 24 || temps.some((x) => !Number.isFinite(x))) throw new Error('Open-Meteo: respuesta incompleta');
  return temps.slice(0, 24);
}

export async function cargarDatos(activado: boolean): Promise<EstadoDatos> {
  const sim = contextoSimulado();
  if (!activado) return { fuente: 'simulados', activado: false, detalle: 'Datos simulados (semilla fija)', ctx: sim };
  const ctx = contextoSimulado();
  const partes: string[] = [];
  let algunoPublico = false;
  try {
    ctx.precios = await preciosREData();
    partes.push('precio eléctrico: REData (PVPC hoy)');
    algunoPublico = true;
  } catch (e) {
    partes.push(`precio eléctrico: simulado (${(e as Error).message})`);
  }
  try {
    ctx.temperaturas = await temperaturasOpenMeteo();
    partes.push('temperatura: Open-Meteo (Tomelloso)');
    algunoPublico = true;
  } catch (e) {
    partes.push(`temperatura: simulada (${(e as Error).message})`);
  }
  return {
    fuente: algunoPublico ? 'públicos' : 'simulados',
    activado: true,
    detalle: partes.join(' · '),
    ctx: algunoPublico ? ctx : sim,
    actualizado: new Date().toISOString(),
  };
}
