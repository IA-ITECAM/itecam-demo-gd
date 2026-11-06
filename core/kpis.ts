/**
 * Contabilidad común de KPIs.
 * Cada modelo acumula en un "libro" (Ledger) y los KPIs se derivan siempre igual.
 */

/** Factores de emisión estimados (kg CO2 por kWh). Valores genéricos de referencia. */
export const FACTOR_CO2 = { elec: 0.12, gas: 0.202 } as const;

export interface Ledger {
  /** segundos de operación planificada (en turno) */
  workS: number;
  /** términos OEE: tiempo planificado, tiempo disponible y tiempo ideal de producción */
  oPlan: number;
  oUp: number;
  oIdeal: number;
  /** unidades procesadas en el equipo de referencia y unidades buenas totales */
  processed: number;
  good: number;
  scrap: number;
  elecKWh: number;
  gasKWh: number;
  energyCost: number;
  laborCost: number;
  fixedCost: number;
  penaltyCost: number;
  /** nivel de servicio = servNum / servDen */
  servNum: number;
  servDen: number;
  /** plazo medio (s) = leadSum / leadN */
  leadSum: number;
  leadN: number;
}

export function newLedger(): Ledger {
  return {
    workS: 0, oPlan: 0, oUp: 0, oIdeal: 0, processed: 0, good: 0, scrap: 0,
    elecKWh: 0, gasKWh: 0, energyCost: 0, laborCost: 0, fixedCost: 0, penaltyCost: 0,
    servNum: 0, servDen: 0, leadSum: 0, leadN: 0,
  };
}

export interface Kpis {
  produccionHora: number;
  /** unidades por día de calendario */
  produccionDia: number;
  oee: number;
  disponibilidad: number;
  rendimiento: number;
  calidad: number;
  costeUnidad: number;
  energiaKWh: number;
  co2Kg: number;
  energiaUnidad: number;
  co2Unidad: number;
  servicio: number;
  plazo: number;
  unidades: number;
  costeEnergia: number;
}

export type KpiKey = keyof Kpis;

export interface KpiMeta {
  key: KpiKey;
  label: string;
  unidad: string;
  /** 'up' = más es mejor (↑), 'down' = menos es mejor (↓) */
  mejor: 'up' | 'down';
  dec: number;
}

/** KPIs que se muestran en el comparador, con su dirección de mejora. */
export const KPI_META: KpiMeta[] = [
  { key: 'produccionDia', label: 'Producción', unidad: 'ud/día', mejor: 'up', dec: 0 },
  { key: 'oee', label: 'OEE', unidad: '%', mejor: 'up', dec: 1 },
  { key: 'costeUnidad', label: 'Coste por unidad', unidad: '€/ud', mejor: 'down', dec: 2 },
  { key: 'energiaUnidad', label: 'Energía por unidad', unidad: 'kWh/ud', mejor: 'down', dec: 2 },
  { key: 'co2Unidad', label: 'Emisiones por unidad', unidad: 'kg CO₂/ud', mejor: 'down', dec: 3 },
  { key: 'servicio', label: 'Nivel de servicio', unidad: '%', mejor: 'up', dec: 1 },
  { key: 'plazo', label: 'Plazo medio', unidad: 'min', mejor: 'down', dec: 0 },
];

export const oee = (a: number, p: number, q: number) => a * p * q;

const safe = (n: number, d: number, def = 0) => (d > 0 ? n / d : def);

/** `calS`: segundos de calendario transcurridos (para la producción diaria). */
export function kpisFrom(L: Ledger, calS = 0): Kpis {
  const disponibilidad = safe(L.oUp, L.oPlan, 1);
  const rendimiento = Math.min(1, safe(L.oIdeal, L.oUp, 0));
  // calidad = piezas buenas / procesadas en el equipo de referencia
  const calidad = L.processed > 0 ? Math.max(0, 1 - L.scrap / L.processed) : 1;
  const energiaKWh = L.elecKWh + L.gasKWh;
  const co2Kg = L.elecKWh * FACTOR_CO2.elec + L.gasKWh * FACTOR_CO2.gas;
  const coste = L.energyCost + L.laborCost + L.fixedCost + L.penaltyCost;
  return {
    produccionHora: safe(L.good, L.workS / 3600),
    produccionDia: calS > 0 ? (L.good * 86400) / calS : safe(L.good, L.workS / 3600) * 24,
    oee: oee(disponibilidad, rendimiento, calidad) * 100,
    disponibilidad: disponibilidad * 100,
    rendimiento: rendimiento * 100,
    calidad: Math.min(1, calidad) * 100,
    costeUnidad: safe(coste, L.good),
    energiaKWh,
    co2Kg,
    energiaUnidad: safe(energiaKWh, L.good),
    co2Unidad: safe(co2Kg, L.good),
    servicio: Math.min(100, safe(L.servNum, L.servDen, 1) * 100),
    plazo: safe(L.leadSum, L.leadN) / 60,
    unidades: L.good,
    costeEnergia: L.energyCost,
  };
}

/** Acumula el consumo energético de un equipo durante dt segundos. */
export function addEnergy(L: Ledger, kw: number, dt: number, fuente: 'elec' | 'gas', precioKWh: number) {
  const kwh = (kw * dt) / 3600;
  if (fuente === 'elec') L.elecKWh += kwh;
  else L.gasKWh += kwh;
  L.energyCost += kwh * precioKWh;
}
