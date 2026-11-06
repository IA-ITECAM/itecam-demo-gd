/**
 * Protocolo de mensajes entre la interfaz y la simulación (WebSocket en el servidor
 * o Web Worker en la versión estática): lista blanca de comandos y su validación.
 * Sin dependencias de Node ni del navegador.
 */

type Validador = (a: any) => Record<string, unknown> | null;
const sinArgs: Validador = () => ({});
const de = <T>(lista: readonly T[], v: unknown) => (lista as readonly unknown[]).includes(v);

/** Lista blanca de comandos con sus argumentos permitidos. Todo lo demás se descarta. */
export const COMANDOS: Record<string, Validador> = {
  velocidad: (a) => (de([1, 5, 20], Number(a?.v)) ? { v: Number(a.v) } : null),
  pausa: (a) => (typeof a?.v === 'boolean' ? { v: a.v } : {}),
  reiniciar: sinArgs,
  escenario: (a) => (de(['base', 'A', 'B'], a?.id) ? { id: a.id } : null),
  crisis: (a) => (de(['averia', 'proveedor', 'demanda', 'energia'], a?.id) ? { id: a.id } : null),
  plan: sinArgs,
  finCrisis: sinArgs,
  comparar: sinArgs,
  layout: (a) => (de(['funcional', 'linea'], a?.v) ? { v: a.v } : null),
  calibrar: sinArgs,
  flota: (a) => {
    const n = Number(a?.n);
    return Number.isInteger(n) && n >= 1 && n <= 14 ? { n } : null;
  },
  barrido: sinArgs,
  datosPublicos: (a) => ({ v: a?.v === true }),
};

/** Comandos que cuestan CPU (simulan horas o días): se espacian. */
export const COMANDOS_PESADOS = new Set(['crisis', 'comparar', 'calibrar', 'barrido']);

export function validarMensaje(raw: string): { cmd: string; args: Record<string, unknown> } | null {
  if (raw.length > 2048) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const { cmd, args } = msg as { cmd?: unknown; args?: unknown };
  if (typeof cmd !== 'string' || !Object.hasOwn(COMANDOS, cmd)) return null;
  const limpio = COMANDOS[cmd](args && typeof args === 'object' ? args : {});
  return limpio ? { cmd, args: limpio } : null;
}

// ---------------- Prefijo de publicación ----------------

/**
 * Normaliza BASE_PATH: "" o "/" → "/"; "gemelos", "/gemelos" o "/gemelos/" → "/gemelos/".
 * Devuelve null si contiene caracteres no permitidos.
 */
export function normalizarBase(v: string | undefined): string | null {
  const limpio = (v ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!limpio) return '/';
  if (!/^[a-z0-9._~-]+(\/[a-z0-9._~-]+)*$/i.test(limpio) || limpio.split('/').some((s) => s === '.' || s === '..')) return null;
  return `/${limpio}/`;
}
