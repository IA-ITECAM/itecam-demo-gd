/**
 * Servidor único: sirve el frontend compilado, una API mínima y el WebSocket de tiempo real.
 * Un proceso, un puerto (8080). Con CLAVE_ACCESO definida, todo exige iniciar sesión.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { MODELS } from '../../twins/registry.gen';
import { TwinRunner } from '../../core/engine';
import { reloj } from '../../core/clock';
import { cargarDatos, type EstadoDatos } from './public-data';
import {
  leerConfig,
  claveCorrecta,
  crearToken,
  tokenValido,
  leerCookies,
  cookieSesion,
  cookieBorrar,
  destinoSeguro,
  LimitadorIntentos,
  cabecerasSeguridad,
  ipCliente,
  origenPermitido,
  validarMensaje,
  COMANDOS_PESADOS,
  CuboFichas,
  paginaAcceso,
  COOKIE,
} from './seguridad';

const PORT = Number(process.env.PORT ?? 8080);
const SEED = Number(process.env.SEMILLA ?? 2026);
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? resolve(process.cwd(), 'dist/public');
const FPS = 10;
const SEG = leerConfig();
const CON_CLAVE = SEG.clave.length > 0;

// ---------- Gemelos ----------
const runners = new Map<string, TwinRunner>();
for (const m of MODELS) runners.set(m.config.id, new TwinRunner(m, SEED));
const clientes = new Map<string, Set<WebSocket>>();
for (const id of runners.keys()) clientes.set(id, new Set());

let datos: EstadoDatos = { fuente: 'simulados', activado: false, detalle: 'Datos simulados (semilla fija)', ctx: runners.values().next().value!.live.ctx };
let datosEnCurso = false;
let ultimaConsultaDatos = 0;

async function actualizarDatos(activar: boolean) {
  datosEnCurso = true;
  ultimaConsultaDatos = Date.now();
  try {
    datos = await cargarDatos(activar);
    for (const r of runners.values()) r.setContexto(datos.ctx);
    console.log(`[datos] ${datos.fuente}: ${datos.detalle}`);
  } finally {
    datosEnCurso = false;
    broadcastAll({ type: 'datos', data: infoDatos() });
  }
}
const infoDatos = () => ({ fuente: datos.fuente, activado: datos.activado, detalle: datos.detalle, precios: datos.ctx.precios, temperaturas: datos.ctx.temperaturas });

// ---------- Sesión ----------
const sesionValida = (req: IncomingMessage) => !CON_CLAVE || tokenValido(leerCookies(req.headers.cookie)[COOKIE], SEG.claveFirma);
const caducidadSesion = (req: IncomingMessage): number => {
  if (!CON_CLAVE) return Infinity;
  const tok = leerCookies(req.headers.cookie)[COOKIE] ?? '';
  return Number(tok.split('.')[1]) || 0;
};
const intentos = new LimitadorIntentos();
setInterval(() => intentos.limpiar(), 10 * 60_000).unref();

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
// Solo se confía en X-Forwarded-* si la petición llega desde una red privada (proxy de Dokploy/Traefik).
app.set('trust proxy', process.env.CONFIAR_PROXY ?? 'loopback, linklocal, uniquelocal');
app.use(cabecerasSeguridad);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.get('/favicon.svg', (_req, res, next) => {
  const f = join(PUBLIC_DIR, 'favicon.svg');
  if (existsSync(f)) res.sendFile(f);
  else next();
});

app.get('/acceso', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (sesionValida(req)) return res.redirect(303, destinoSeguro(req.query.volver));
  res.type('html').send(paginaAcceso({ volver: String(req.query.volver ?? '/') }));
});

app.post('/acceso', express.urlencoded({ extended: false, limit: '2kb', parameterLimit: 5 }), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const volver = destinoSeguro(req.body?.volver);
  if (!CON_CLAVE) return res.redirect(303, volver);
  if (!origenPermitido(req)) return res.status(403).type('html').send(paginaAcceso({ error: 'Origen no permitido.', volver }));
  const ip = req.ip ?? 'desconocida';
  const espera = intentos.bloqueado(ip);
  if (espera > 0) {
    const min = Math.ceil(espera / 60_000);
    return res.status(429).type('html').send(paginaAcceso({ error: `Demasiados intentos. Vuelve a probar dentro de ${min} min.`, volver }));
  }
  if (claveCorrecta(req.body?.clave, SEG.clave)) {
    intentos.exito(ip);
    const maxAge = SEG.sesionHoras * 3600;
    res.setHeader('Set-Cookie', cookieSesion(crearToken(SEG.claveFirma, Date.now() + maxAge * 1000), maxAge, req.secure));
    return res.redirect(303, volver);
  }
  intentos.fallo(ip);
  console.warn(`[acceso] contraseña incorrecta desde ${ip}`);
  await new Promise((r) => setTimeout(r, 600)); // frena los ataques de fuerza bruta
  res.status(401).type('html').send(paginaAcceso({ error: 'Contraseña incorrecta.', volver }));
});

app.get('/salir', (req, res) => {
  res.setHeader('Set-Cookie', cookieBorrar(req.secure));
  res.redirect(303, CON_CLAVE ? '/acceso' : '/');
});

// A partir de aquí todo exige sesión (si hay contraseña configurada)
app.use((req: Request, res: Response, next: NextFunction) => {
  if (sesionValida(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesión necesaria' });
  if (req.method === 'GET' && req.accepts('html')) {
    return res.redirect(302, `/acceso?volver=${encodeURIComponent(destinoSeguro(req.path))}`);
  }
  res.status(401).end();
});

app.get('/api/sesion', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ autenticacion: CON_CLAVE });
});
app.get('/api/gemelos', (_req, res) => {
  res.json(MODELS.map((m) => m.config).sort((a, b) => a.orden - b.orden));
});
app.get('/api/datos', (_req, res) => {
  res.json(infoDatos());
});

if (existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h', dotfiles: 'ignore' }));
  const indexHtml = join(PUBLIC_DIR, 'index.html');
  // Rutas de la SPA: "/", "/mecanizado", "/almacen", "/alimentacion"…
  app.get(/^\/(?!api\/|ws)[a-z0-9\-]*$/i, (_req, res) => res.sendFile(indexHtml, { headers: { 'Cache-Control': 'no-store' } }));
} else {
  app.get('/', (_req, res) => {
    res.type('text').send('Frontend no compilado. Ejecuta "npm run build" o usa "npm run dev:web".');
  });
}
app.use((_req, res) => res.status(404).type('text').send('No encontrado'));
// Errores: nunca se devuelven detalles internos al navegador
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[http]', err.message);
  res.status(500).type('text').send('Error interno');
});

const server = createServer(app);
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

// ---------- WebSocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false, clientTracking: false });
let conexiones = 0;
const conexionesIp = new Map<string, number>();

function rechazar(socket: Duplex, codigo: number, texto: string) {
  try {
    socket.write(`HTTP/1.1 ${codigo} ${texto}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } finally {
    socket.destroy();
  }
}

server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => socket.destroy());
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') return rechazar(socket, 404, 'Not Found');
  if (!origenPermitido(req)) return rechazar(socket, 403, 'Forbidden');
  if (!sesionValida(req)) return rechazar(socket, 401, 'Unauthorized');
  const id = url.searchParams.get('gemelo') ?? '';
  if (!runners.has(id)) return rechazar(socket, 404, 'Not Found');
  const ip = ipCliente(req);
  if (conexiones >= SEG.maxConexiones || (conexionesIp.get(ip) ?? 0) >= SEG.maxConexionesIp) {
    return rechazar(socket, 503, 'Service Unavailable');
  }
  wss.handleUpgrade(req, socket, head, (ws) => alConectar(ws, req, id, ip));
});

const ABIERTO = WebSocket.OPEN;
const MAX_BUFFER = 2 * 1024 * 1024;

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === ABIERTO) ws.send(JSON.stringify(msg));
}
/** Envía a todos los que miran un gemelo, saltándose a los clientes lentos (evita acumular memoria). */
function broadcast(id: string, msg: unknown, prescindible = false) {
  const txt = JSON.stringify(msg);
  for (const ws of clientes.get(id) ?? []) {
    if (ws.readyState !== ABIERTO) continue;
    if (prescindible && ws.bufferedAmount > MAX_BUFFER) continue;
    ws.send(txt);
  }
}
function broadcastAll(msg: unknown) {
  for (const id of clientes.keys()) broadcast(id, msg);
}

// Los comandos pesados se espacian por gemelo y como mucho quedan 3 en espera.
const proximoPesado = new Map<string, number>();
const enEsperaPesados = new Map<string, number>();
function programarPesado(id: string, fn: () => void): boolean {
  const ahora = Date.now();
  const pendientes = enEsperaPesados.get(id) ?? 0;
  if (pendientes >= 3) return false;
  const cuando = Math.max(ahora, proximoPesado.get(id) ?? 0);
  proximoPesado.set(id, cuando + 800);
  enEsperaPesados.set(id, pendientes + 1);
  setTimeout(() => {
    enEsperaPesados.set(id, (enEsperaPesados.get(id) ?? 1) - 1);
    fn();
  }, cuando - ahora);
  return true;
}

const lastSeriesVersion = new Map<string, number>();

function frame(id: string) {
  const r = runners.get(id)!;
  return {
    type: 'frame',
    t: r.state.t,
    reloj: reloj(r.state.t),
    velocidad: r.speed,
    pausa: r.paused,
    escenario: r.escenario,
    kpis: r.kpis(),
    ritmo: r.ritmo(),
    crisis: r.crisisInfo(),
    datos: datos.fuente,
    view: r.model.view(r.state),
  };
}

interface Conexion {
  vivo: boolean;
  caduca: number;
}
const meta = new WeakMap<WebSocket, Conexion>();

function alConectar(ws: WebSocket, req: IncomingMessage, id: string, ip: string) {
  const r = runners.get(id)!;
  conexiones++;
  conexionesIp.set(ip, (conexionesIp.get(ip) ?? 0) + 1);
  meta.set(ws, { vivo: true, caduca: caducidadSesion(req) });
  clientes.get(id)!.add(ws);
  const cubo = new CuboFichas(10, 20);
  let descartados = 0;

  // Sin este manejador, un frame malformado lanzaría una excepción y tumbaría el proceso.
  ws.on('error', () => ws.terminate());
  ws.on('pong', () => {
    const m = meta.get(ws);
    if (m) m.vivo = true;
  });
  ws.on('close', () => {
    clientes.get(id)!.delete(ws);
    conexiones--;
    const n = (conexionesIp.get(ip) ?? 1) - 1;
    if (n <= 0) conexionesIp.delete(ip);
    else conexionesIp.set(ip, n);
  });

  send(ws, { type: 'hola', config: r.config, datos: infoDatos() });
  send(ws, { type: 'series', data: r.series });
  send(ws, frame(id));

  ws.on('message', (raw, esBinario) => {
    if (esBinario) return;
    if (!cubo.tomar()) {
      if (++descartados > 200) ws.close(1008, 'Demasiados mensajes');
      return;
    }
    const msg = validarMensaje(String(raw));
    if (!msg) return;
    try {
      if (msg.cmd === 'datosPublicos') {
        if (datosEnCurso || Date.now() - ultimaConsultaDatos < 15_000) {
          send(ws, { type: 'aviso', mensaje: 'Los datos públicos se acaban de consultar. Espera unos segundos.' });
          send(ws, { type: 'datos', data: infoDatos() });
          return;
        }
        void actualizarDatos(msg.args.v === true);
        return;
      }
      const ejecutar = () => {
        try {
          const reply = r.command(msg.cmd, msg.args);
          if (reply) {
            // Las crisis y el comparador interesan a todos los que miran el gemelo
            if (reply.type === 'resiliencia' || reply.type === 'comparador') broadcast(id, reply);
            else send(ws, reply);
          }
          broadcast(id, frame(id));
        } catch (e) {
          console.error('[ws]', (e as Error).message);
          send(ws, { type: 'error', mensaje: 'No se pudo ejecutar la orden.' });
        }
      };
      if (COMANDOS_PESADOS.has(msg.cmd)) {
        if (!programarPesado(id, ejecutar)) send(ws, { type: 'aviso', mensaje: 'Hay cálculos en curso. Inténtalo en un momento.' });
      } else ejecutar();
    } catch (e) {
      console.error('[ws]', (e as Error).message);
    }
  });
}

// Latido: cierra conexiones muertas y las de sesiones caducadas
setInterval(() => {
  const ahora = Date.now();
  for (const subs of clientes.values()) {
    for (const ws of subs) {
      const m = meta.get(ws);
      if (!m) continue;
      if (m.caduca <= ahora) {
        ws.close(4401, 'Sesión caducada');
        continue;
      }
      if (!m.vivo) {
        ws.terminate();
        continue;
      }
      m.vivo = false;
      ws.ping();
    }
  }
}, 30_000).unref();

// ---------- Bucle de simulación ----------
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const realDt = Math.min(0.5, (now - last) / 1000);
  last = now;
  for (const [id, r] of runners) {
    const subs = clientes.get(id)!;
    // Un gemelo sin nadie mirándolo se queda congelado: la demo es reproducible.
    if (subs.size === 0) continue;
    try {
      r.tick(realDt);
      broadcast(id, frame(id), true);
      if (lastSeriesVersion.get(id) !== r.seriesVersion) {
        lastSeriesVersion.set(id, r.seriesVersion);
        broadcast(id, { type: 'series', data: r.series }, true);
      }
    } catch (e) {
      console.error(`[sim ${id}]`, (e as Error).message);
    }
  }
}, 1000 / FPS);

server.listen(PORT, () => {
  console.log(`Gemelos digitales ITECAM en http://localhost:${PORT}  (semilla ${SEED})`);
  console.log(`Gemelos: ${[...runners.keys()].join(', ')}`);
  if (CON_CLAVE) {
    console.log(`Acceso protegido con contraseña (sesiones de ${SEG.sesionHoras} h).`);
    if (SEG.clave.length < 12) console.warn('AVISO: CLAVE_ACCESO tiene menos de 12 caracteres. Usa una más larga en un servidor público.');
  } else {
    console.warn('AVISO: CLAVE_ACCESO no está definida: el acceso es LIBRE. No lo publiques así en Internet.');
  }
  if (process.env.DATOS_PUBLICOS === '1') void actualizarDatos(true);
});

const shutdown = () => {
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
