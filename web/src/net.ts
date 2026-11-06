/**
 * Conexión de la interfaz con la simulación:
 *  - versión servidor: WebSocket con reconexión automática (TwinSocket);
 *  - versión estática (GitHub Pages): Web Worker en el propio navegador (ConexionLocal).
 */
import { url, rutaActual } from './base';
import { ConexionLocal, pedirDatosLocal } from './local/cliente';

/** true en el build estático (npm run build:pages). */
export const MODO_ESTATICO = import.meta.env.VITE_MODO === 'estatico';

export type Handler = (msg: any) => void;

export interface Conexion {
  on(h: Handler): () => void;
  send(cmd: string, args?: Record<string, unknown>): void;
  close(): void;
  onStatus: (ok: boolean) => void;
}

export function crearConexion(gemelo: string): Conexion {
  return MODO_ESTATICO ? new ConexionLocal(gemelo) : new TwinSocket(gemelo);
}

/** Estado de los datos (simulados / públicos) para el menú. */
export async function infoDatos(): Promise<any> {
  if (MODO_ESTATICO) return pedirDatosLocal();
  const r = await fetch(url('api/datos'));
  return r.json();
}

/** ¿Hay contraseña de acceso? (solo en la versión con servidor) */
export async function hayAutenticacion(): Promise<boolean> {
  if (MODO_ESTATICO) return false;
  const r = await fetch(url('api/sesion'), { cache: 'no-store' });
  return r.ok ? !!(await r.json())?.autenticacion : false;
}

export function irAlAcceso() {
  location.href = `${url('acceso')}?volver=${encodeURIComponent(rutaActual())}`;
}

/** Si la API responde 401, la sesión ha caducado. */
export async function comprobarSesion() {
  try {
    const r = await fetch(url('api/sesion'), { cache: 'no-store', credentials: 'same-origin' });
    if (r.status === 401) irAlAcceso();
  } catch {
    /* sin red: se seguirá reintentando */
  }
}
export class TwinSocket implements Conexion {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private closed = false;
  private retry = 0;
  onStatus: (ok: boolean) => void = () => {};

  constructor(private gemelo: string) {
    this.connect();
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${url('ws')}?gemelo=${encodeURIComponent(this.gemelo)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus(true);
    };
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = (ev) => {
      this.onStatus(false);
      if (this.closed) return;
      // 4401 = sesión caducada: se vuelve a la pantalla de acceso
      if (ev.code === 4401) return irAlAcceso();
      this.retry = Math.min(this.retry + 1, 6);
      // Si el servidor rechaza la conexión, puede ser porque la sesión ha caducado
      if (this.retry >= 2) void comprobarSesion();
      setTimeout(() => this.connect(), 300 * this.retry);
    };
  }

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(cmd: string, args: Record<string, unknown> = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ cmd, args }));
  }

  close() {
    this.closed = true;
    this.handlers.clear();
    this.ws?.close();
  }
}
