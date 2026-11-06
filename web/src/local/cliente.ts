/**
 * Conexión con la simulación local (Web Worker) para la versión estática.
 * Ofrece la misma interfaz que la conexión WebSocket con el servidor.
 */
import type { Conexion, Handler } from '../net';

let worker: Worker | null = null;
const destinos = new Map<string, (msg: any) => void>();
let contador = 0;

/** Un único worker para toda la página: al navegar entre gemelos se conserva su estado. */
function obtenerWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module', name: 'simulacion' });
    worker.onmessage = (e: MessageEvent<{ cliente: string; msg: unknown }>) => destinos.get(e.data.cliente)?.(e.data.msg);
    worker.onerror = (e) => console.error('Error en la simulación local', e.message);
  }
  return worker;
}

export class ConexionLocal implements Conexion {
  private id = `c${++contador}`;
  private handlers = new Set<Handler>();
  onStatus: (ok: boolean) => void = () => {};

  constructor(gemelo: string) {
    destinos.set(this.id, (msg) => {
      for (const h of this.handlers) h(msg);
    });
    obtenerWorker().postMessage({ tipo: 'abrir', cliente: this.id, gemelo });
    // La "conexión" es inmediata; se avisa cuando la página ya ha asignado onStatus
    setTimeout(() => this.onStatus(true), 0);
  }

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(cmd: string, args: Record<string, unknown> = {}) {
    obtenerWorker().postMessage({ tipo: 'cmd', cliente: this.id, raw: JSON.stringify({ cmd, args }) });
  }

  close() {
    obtenerWorker().postMessage({ tipo: 'cerrar', cliente: this.id });
    destinos.delete(this.id);
    this.handlers.clear();
  }
}

/** Estado de los datos (simulados / públicos) para el menú. */
export function pedirDatosLocal(): Promise<any> {
  const id = `d${++contador}`;
  return new Promise((res) => {
    destinos.set(id, (msg) => {
      destinos.delete(id);
      res(msg?.data);
    });
    obtenerWorker().postMessage({ tipo: 'datos', cliente: id });
  });
}
