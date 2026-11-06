/**
 * Seguridad del servidor: contraseña de acceso, sesiones firmadas, límite de intentos,
 * cabeceras HTTP, validación de comandos del WebSocket y límites de uso.
 * Funciones puras siempre que es posible, para poder probarlas con tests.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Request, Response, NextFunction } from 'express';

// ---------------- Configuración ----------------

export interface ConfigSeguridad {
  /** contraseña de acceso; vacía = acceso libre (solo para uso local) */
  clave: string;
  /** clave HMAC con la que se firman las sesiones */
  claveFirma: Buffer;
  sesionHoras: number;
  maxConexiones: number;
  maxConexionesIp: number;
}

export function leerConfig(env: NodeJS.ProcessEnv = process.env): ConfigSeguridad {
  const clave = (env.CLAVE_ACCESO ?? '').trim();
  // Si no se fija SECRETO_SESION se genera uno al arrancar (las sesiones caducan al reiniciar).
  const secreto = env.SECRETO_SESION?.trim() || randomBytes(32).toString('hex');
  // La firma depende también de la contraseña: si se cambia, las sesiones antiguas dejan de valer.
  const claveFirma = createHmac('sha256', secreto).update(`clave:${clave}`).digest();
  const num = (v: string | undefined, def: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : def;
  };
  return {
    clave,
    claveFirma,
    sesionHoras: num(env.SESION_HORAS, 12, 0.1, 24 * 30),
    maxConexiones: num(env.MAX_CONEXIONES, 60, 1, 10000),
    maxConexionesIp: num(env.MAX_CONEXIONES_IP, 15, 1, 10000),
  };
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

// ---------------- Contraseña y sesiones ----------------

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Comparación en tiempo constante (no revela cuántos caracteres coinciden). */
export function claveCorrecta(intento: unknown, clave: string): boolean {
  if (typeof intento !== 'string' || intento.length > 512 || !clave) return false;
  return timingSafeEqual(sha256(intento), sha256(clave));
}

const b64 = (b: Buffer) => b.toString('base64url');

/** Token de sesión: "v1.<caducidad>.<firma>". No contiene la contraseña. */
export function crearToken(claveFirma: Buffer, caducaMs: number): string {
  const cuerpo = `v1.${Math.floor(caducaMs)}`;
  return `${cuerpo}.${b64(createHmac('sha256', claveFirma).update(cuerpo).digest())}`;
}

export function tokenValido(token: string | undefined, claveFirma: Buffer, ahoraMs = Date.now()): boolean {
  if (!token || token.length > 200) return false;
  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== 'v1') return false;
  const caduca = Number(partes[1]);
  if (!Number.isFinite(caduca) || caduca <= ahoraMs) return false;
  const esperada = createHmac('sha256', claveFirma).update(`v1.${partes[1]}`).digest();
  let recibida: Buffer;
  try {
    recibida = Buffer.from(partes[2], 'base64url');
  } catch {
    return false;
  }
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

export const COOKIE = 'gd_sesion';

export function leerCookies(cabecera: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!cabecera) return out;
  for (const trozo of cabecera.split(';')) {
    const i = trozo.indexOf('=');
    if (i < 0) continue;
    const k = trozo.slice(0, i).trim();
    const v = trozo.slice(i + 1).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function cookieSesion(token: string, maxAgeS: number, segura: boolean, path = '/'): string {
  return `${COOKIE}=${token}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeS)}${segura ? '; Secure' : ''}`;
}

export function cookieBorrar(segura: boolean, path = '/'): string {
  return `${COOKIE}=; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=0${segura ? '; Secure' : ''}`;
}

/** Solo se permite volver a rutas internas sencillas (evita redirecciones abiertas). */
export function destinoSeguro(volver: unknown): string {
  if (typeof volver !== 'string') return '/';
  return /^\/[a-z0-9\-]*$/i.test(volver) ? volver : '/';
}

// ---------------- Límite de intentos de acceso ----------------

/** Bloquea una IP tras `max` fallos en `ventanaMs` durante `bloqueoMs`. */
export class LimitadorIntentos {
  private fallos = new Map<string, { n: number; desde: number; hasta: number }>();
  constructor(private max = 5, private ventanaMs = 15 * 60_000, private bloqueoMs = 15 * 60_000) {}

  /** ms que quedan de bloqueo para esa IP (0 = puede intentarlo). */
  bloqueado(ip: string, ahora = Date.now()): number {
    const f = this.fallos.get(ip);
    return f && f.hasta > ahora ? f.hasta - ahora : 0;
  }

  fallo(ip: string, ahora = Date.now()) {
    let f = this.fallos.get(ip);
    if (!f || ahora - f.desde > this.ventanaMs) f = { n: 0, desde: ahora, hasta: 0 };
    f.n++;
    if (f.n >= this.max) f.hasta = ahora + this.bloqueoMs;
    this.fallos.set(ip, f);
    if (this.fallos.size > 10_000) this.limpiar(ahora);
  }

  exito(ip: string) {
    this.fallos.delete(ip);
  }

  limpiar(ahora = Date.now()) {
    for (const [ip, f] of this.fallos) if (f.hasta <= ahora && ahora - f.desde > this.ventanaMs) this.fallos.delete(ip);
  }
}

// ---------------- Cabeceras HTTP ----------------

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // las etiquetas 3D y los gráficos usan estilos en línea
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  // 'self' (no 'none'): index.html usa <base href> para funcionar bajo un prefijo
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function cabecerasSeguridad(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // same-origin (no 'no-referrer'): con no-referrer el navegador envía «Origin: null» en los POST propios
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), xr-spatial-tracking=(self)');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

// ---------------- IP del cliente y origen ----------------

const PRIVADA = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

/**
 * IP del cliente en una petición de upgrade del WebSocket. Solo se fía de X-Forwarded-For
 * si la conexión llega desde una red privada (el proxy de Dokploy/Traefik), nunca de Internet.
 */
export function ipCliente(req: IncomingMessage): string {
  const remota = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  const xff = req.headers['x-forwarded-for'];
  if (PRIVADA.test(remota) && typeof xff === 'string' && xff.trim()) {
    const lista = xff.split(',').map((x) => x.trim()).filter(Boolean);
    return (lista[lista.length - 1] ?? remota).replace(/^::ffff:/, '');
  }
  return remota;
}

/** El WebSocket solo se acepta desde páginas servidas por el propio servidor. */
export function origenPermitido(req: IncomingMessage): boolean {
  const origen = req.headers.origin;
  if (!origen) return true; // clientes que no son navegadores: siguen necesitando la sesión
  // Sec-Fetch-Site lo pone el propio navegador y ninguna página puede falsificarlo. Si dice
  // "same-origin" la petición viene de esta web aunque un proxy haya cambiado la cabecera Host.
  const sitio = req.headers['sec-fetch-site'];
  if (sitio === 'same-origin') return true;
  if (sitio === 'cross-site' || sitio === 'same-site') return false;
  if (origen === 'null') return false;
  let host: string;
  try {
    host = new URL(origen).host.toLowerCase();
  } catch {
    return false;
  }
  const hosts = [req.headers.host, req.headers['x-forwarded-host']]
    .flatMap((h) => (Array.isArray(h) ? h : [h]))
    .filter((h): h is string => typeof h === 'string')
    .flatMap((h) => h.split(','))
    .map((h) => h.trim().toLowerCase());
  return hosts.includes(host);
}

// ---------------- Validación de comandos del WebSocket ----------------

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

/** Cubo de fichas: `ritmo` mensajes por segundo con ráfagas de hasta `rafaga`. */
export class CuboFichas {
  private fichas: number;
  private ultimo: number;
  constructor(private ritmo = 10, private rafaga = 20, ahora = Date.now()) {
    this.fichas = rafaga;
    this.ultimo = ahora;
  }
  tomar(ahora = Date.now()): boolean {
    const transcurrido = Math.max(0, ahora - this.ultimo);
    this.fichas = Math.min(this.rafaga, this.fichas + (transcurrido / 1000) * this.ritmo);
    this.ultimo = ahora;
    if (this.fichas < 1) return false;
    this.fichas -= 1;
    return true;
  }
}

// ---------------- Página de acceso ----------------

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function paginaAcceso(opts: { error?: string; volver?: string; base?: string } = {}): string {
  const volver = destinoSeguro(opts.volver);
  const base = escHtml(opts.base ?? '/');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex, nofollow"/>
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml"/>
<title>Acceso · Gemelos digitales</title>
<style>
  :root { --fondo:#F5F3EE; --tinta:#0E1A2B; --teal:#0B7373; --naranja:#E8731A; --linea:#e1dccf; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--fondo);
    color:var(--tinta); font:16px/1.4 "Segoe UI", Inter, system-ui, -apple-system, sans-serif; padding:16px; }
  form { background:#fbfaf7; border:1.5px solid var(--linea); border-radius:18px; padding:32px; width:min(420px,100%);
    box-shadow:0 4px 16px rgba(14,26,43,.08); display:flex; flex-direction:column; gap:14px; }
  .k { color:var(--teal); font-weight:700; letter-spacing:.06em; text-transform:uppercase; font-size:14px; }
  h1 { margin:0; font-size:28px; line-height:1.15; }
  p { margin:0; color:#3b4757; }
  label { font-weight:700; }
  input { font:inherit; font-size:18px; padding:12px 14px; border:1.5px solid var(--linea); border-radius:10px; background:#fff; color:inherit; }
  input:focus { outline:3px solid rgba(11,115,115,.25); border-color:var(--teal); }
  button { font:inherit; font-weight:700; font-size:17px; padding:12px; border:0; border-radius:10px; background:var(--teal); color:#fff; cursor:pointer; }
  button:hover { background:#0d8a8a; }
  .err { background:#fbe7d6; color:#7a3a07; border-left:5px solid var(--naranja); padding:10px 12px; border-radius:10px; font-weight:600; }
</style></head>
<body>
  <form method="post" action="${base}acceso" autocomplete="on">
    <div class="k">Industria 5.0</div>
    <h1>Gemelos digitales</h1>
    <p>Introduce la contraseña de acceso a la demo.</p>
    ${opts.error ? `<div class="err" role="alert">${escHtml(opts.error)}</div>` : ''}
    <label for="clave">Contraseña</label>
    <input id="clave" name="clave" type="password" autocomplete="current-password" required maxlength="256" autofocus/>
    <input type="hidden" name="volver" value="${escHtml(volver)}"/>
    <button type="submit">Entrar</button>
  </form>
</body></html>`;
}
