import type { SceneKit, KitOptions } from './scene-kit';
import type { Conexion } from '../net';

/** API que la página del gemelo ofrece al panel específico de cada gemelo. */
export interface TwinApi {
  socket: Conexion;
  send(cmd: string, args?: Record<string, unknown>): void;
  /** se llama con cada mensaje del servidor */
  on(h: (msg: any) => void): void;
  /** última vista recibida */
  lastView(): any;
  lastFrame(): any;
  series(): any[];
}

export interface TwinSceneHandle {
  /** se llama con cada vista nueva del servidor (10 Hz) */
  update(view: any, frame: any): void;
  /** se llama en cada fotograma (60 fps) para animaciones suaves */
  frame?(dt: number): void;
  /** pestaña específica del gemelo en el panel lateral */
  panel?: { titulo: string; render(el: HTMLElement, api: TwinApi): void };
}

export interface TwinClient {
  /** tamaño del suelo y posición inicial de la cámara */
  kitOptions: KitOptions;
  build(kit: SceneKit): TwinSceneHandle;
}
