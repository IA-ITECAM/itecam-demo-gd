/**
 * Servidor único: sirve el frontend compilado, una API mínima y el WebSocket de tiempo real.
 * Un proceso, un puerto (8080).
 */
import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { MODELS } from '../../twins/registry.gen';
import { TwinRunner } from '../../core/engine';
import { reloj } from '../../core/clock';
import { cargarDatos, type EstadoDatos } from './public-data';

const PORT = Number(process.env.PORT ?? 8080);
const SEED = Number(process.env.SEMILLA ?? 2026);
const PUBLIC_DIR = process.env.PUBLIC_DIR ?? resolve(process.cwd(), 'dist/public');
const FPS = 10;

// ---------- Gemelos ----------
const runners = new Map<string, TwinRunner>();
for (const m of MODELS) runners.set(m.config.id, new TwinRunner(m, SEED));
const clientes = new Map<string, Set<WebSocket>>();
for (const id of runners.keys()) clientes.set(id, new Set());

let datos: EstadoDatos = { fuente: 'simulados', activado: false, detalle: 'Datos simulados (semilla fija)', ctx: runners.values().next().value!.live.ctx };

async function actualizarDatos(activar: boolean) {
  datos = await cargarDatos(activar);
  for (const r of runners.values()) r.setContexto(datos.ctx);
  console.log(`[datos] ${datos.fuente}: ${datos.detalle}`);
  broadcastAll({ type: 'datos', data: infoDatos() });
}
const infoDatos = () => ({ fuente: datos.fuente, activado: datos.activado, detalle: datos.detalle, precios: datos.ctx.precios, temperaturas: datos.ctx.temperaturas });

// ---------- HTTP ----------
const app = express();
app.disable('x-powered-by');
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, gemelos: [...runners.keys()] });
});
app.get('/api/gemelos', (_req, res) => {
  res.json(MODELS.map((m) => m.config).sort((a, b) => a.orden - b.orden));
});
app.get('/api/datos', (_req, res) => {
  res.json(infoDatos());
});

if (existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: '1h' }));
  const indexHtml = join(PUBLIC_DIR, 'index.html');
  // Rutas de la SPA: "/", "/mecanizado", "/almacen", "/alimentacion"…
  app.get(/^\/(?!api\/|ws).*/, (_req, res) => res.sendFile(indexHtml));
} else {
  app.get('/', (_req, res) => {
    res.type('text').send('Frontend no compilado. Ejecuta "npm run build" o usa "npm run dev:web".');
  });
}

const server = createServer(app);

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(id: string, msg: unknown) {
  const txt = JSON.stringify(msg);
  for (const ws of clientes.get(id) ?? []) if (ws.readyState === WebSocket.OPEN) ws.send(txt);
}
function broadcastAll(msg: unknown) {
  for (const id of clientes.keys()) broadcast(id, msg);
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

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  const id = url.searchParams.get('gemelo') ?? '';
  const r = runners.get(id);
  if (!r) {
    send(ws, { type: 'error', mensaje: `Gemelo desconocido: ${id}` });
    ws.close();
    return;
  }
  clientes.get(id)!.add(ws);
  send(ws, { type: 'hola', config: r.config, datos: infoDatos() });
  send(ws, { type: 'series', data: r.series });
  send(ws, frame(id));

  ws.on('message', async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    try {
      if (msg.cmd === 'datosPublicos') {
        await actualizarDatos(!!msg.args?.v);
        return;
      }
      const reply = r.command(String(msg.cmd), msg.args ?? {});
      if (reply) {
        // Las crisis y el comparador interesan a todos los que miran el gemelo
        if (reply.type === 'resiliencia' || reply.type === 'comparador') broadcast(id, reply);
        else send(ws, reply);
      }
      broadcast(id, frame(id));
    } catch (e) {
      console.error(e);
      send(ws, { type: 'error', mensaje: (e as Error).message });
    }
  });
  ws.on('close', () => clientes.get(id)!.delete(ws));
});

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
    r.tick(realDt);
    broadcast(id, frame(id));
    if (lastSeriesVersion.get(id) !== r.seriesVersion) {
      lastSeriesVersion.set(id, r.seriesVersion);
      broadcast(id, { type: 'series', data: r.series });
    }
  }
}, 1000 / FPS);

server.listen(PORT, () => {
  console.log(`Gemelos digitales ITECAM en http://localhost:${PORT}  (semilla ${SEED})`);
  console.log(`Gemelos: ${[...runners.keys()].join(', ')}`);
  if (process.env.DATOS_PUBLICOS === '1') void actualizarDatos(true);
});

const shutdown = () => {
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
