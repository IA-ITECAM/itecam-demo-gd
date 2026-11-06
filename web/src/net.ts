/** Cliente WebSocket con reconexión automática. */
import { url, rutaActual } from './base';

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
export type Handler = (msg: any) => void;

export class TwinSocket {
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
