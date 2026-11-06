/** Reloj simulado: t = 0 corresponde al Día 1, 06:00. */
export const T0_HORA = 6;

export const horaDecimal = (t: number) => (((T0_HORA + t / 3600) % 24) + 24) % 24;
export const horaEntera = (t: number) => Math.floor(horaDecimal(t));
export const dia = (t: number) => Math.floor((T0_HORA * 3600 + t) / 86400) + 1;

export function reloj(t: number): string {
  const h = horaDecimal(t);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `Día ${dia(t)} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Devuelve el t del próximo instante en que la hora del día vale `hora`. */
export function siguienteHora(t: number, hora: number): number {
  const h = horaDecimal(t);
  let delta = hora - h;
  if (delta <= 1e-9) delta += 24;
  return t + delta * 3600;
}

/** ¿Está la hora del día en la ventana [desde, hasta)? (admite ventanas que cruzan medianoche) */
export function enVentana(t: number, desde: number, hasta: number): boolean {
  const h = horaDecimal(t);
  return desde <= hasta ? h >= desde && h < hasta : h >= desde || h < hasta;
}
