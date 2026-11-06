/**
 * Web Worker de la versión estática: ejecuta la simulación en el navegador, fuera del hilo
 * de la interfaz, para que los cálculos pesados (comparador, resiliencia) no congelen el 3D.
 * Los gemelos se descubren solos: cada twins/<id>/model.ts se incluye automáticamente.
 */
import { SimHub } from '../../../core/hub';
import type { TwinModel } from '../../../core/types';

const modulos = import.meta.glob<{ default: TwinModel }>('../../../twins/*/model.ts', { eager: true });
const SEMILLA = 2026;

const ctx = self as unknown as {
  postMessage(m: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

const hub = new SimHub(
  Object.values(modulos).map((m) => m.default),
  SEMILLA,
  (cliente, msg) => ctx.postMessage({ cliente, msg }),
);
hub.iniciar();

type Entrada =
  | { tipo: 'abrir'; cliente: string; gemelo: string }
  | { tipo: 'cerrar'; cliente: string }
  | { tipo: 'cmd'; cliente: string; raw: string }
  | { tipo: 'datos'; cliente: string };

ctx.onmessage = (e: MessageEvent<Entrada>) => {
  const d = e.data;
  if (!d || typeof d !== 'object' || typeof d.cliente !== 'string') return;
  switch (d.tipo) {
    case 'abrir':
      hub.abrir(d.cliente, String(d.gemelo));
      break;
    case 'cerrar':
      hub.cerrar(d.cliente);
      break;
    case 'cmd':
      void hub.comando(d.cliente, String(d.raw));
      break;
    case 'datos':
      ctx.postMessage({ cliente: d.cliente, msg: { type: 'datos', data: hub.infoDatos() } });
      break;
  }
};
