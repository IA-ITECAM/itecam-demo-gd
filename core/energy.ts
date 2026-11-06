import { horaEntera } from './clock';

/** Precio horario simulado de la electricidad (€/kWh): valle de madrugada, puntas de mañana y tarde. */
export const PRECIOS_SIMULADOS: number[] = [
  0.085, 0.08, 0.078, 0.076, 0.078, 0.082, 0.092, 0.11, // 0-7
  0.15, 0.17, 0.205, 0.215, 0.21, 0.19, 0.155, 0.145, // 8-15
  0.15, 0.17, 0.215, 0.235, 0.225, 0.19, 0.14, 0.11, // 16-23
];

/** Temperatura exterior simulada (°C), día templado de otoño. */
export const TEMPERATURAS_SIMULADAS: number[] = [
  9, 8.5, 8, 7.6, 7.3, 7.2, 7.5, 8.4, 10, 12, 14, 15.8, 17.2, 18.2, 18.8, 19, 18.6, 17.5, 15.8, 14, 12.6, 11.5, 10.6, 9.8,
];

export const PRECIO_GAS = 0.055; // €/kWh

export interface ContextoEnergia {
  precios: number[];
  temperaturas: number[];
}

export const contextoSimulado = (): ContextoEnergia => ({
  precios: [...PRECIOS_SIMULADOS],
  temperaturas: [...TEMPERATURAS_SIMULADAS],
});

export const precioElec = (ctx: ContextoEnergia, t: number) => ctx.precios[horaEntera(t)] ?? 0.15;
export const temperatura = (ctx: ContextoEnergia, t: number) => ctx.temperaturas[horaEntera(t)] ?? 15;

/** ¿Hora valle? (precio dentro del 30 % más barato del día) */
export function esValle(ctx: ContextoEnergia, t: number): boolean {
  const ord = [...ctx.precios].sort((a, b) => a - b);
  return precioElec(ctx, t) <= ord[Math.floor(ord.length * 0.3)];
}
