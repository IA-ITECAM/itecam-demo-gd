/**
 * Simulación sin servidor (versión estática, p. ej. GitHub Pages): gestiona los gemelos,
 * quién mira cada uno y el bucle de tiempo real. Habla el mismo protocolo que el servidor
 * por WebSocket, así que la interfaz no distingue una versión de otra.
 * Se ejecuta en un Web Worker; no depende del DOM ni de Node.
 */
import { TwinRunner } from './engine';
import type { TwinModel } from './types';
import { validarMensaje } from './protocolo';
import { cargarDatos, type EstadoDatos } from './datos-publicos';
import { contextoSimulado } from './energy';

/** Entrega un mensaje a un cliente (una pestaña o vista de la interfaz). */
export type Emisor = (cliente: string, msg: unknown) => void;

export class SimHub {
  readonly runners = new Map<string, TwinRunner>();
  private subs = new Map<string, Set<string>>();
  private gemeloDe = new Map<string, string>();
  private versionSeries = new Map<string, number>();
  private datos: EstadoDatos = { fuente: 'simulados', activado: false, detalle: 'Datos simulados (semilla fija)', ctx: contextoSimulado() };
  private datosEnCurso = false;
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private ultimo = 0;

  constructor(models: TwinModel[], seed: number, private emitir: Emisor, private fps = 10) {
    for (const m of models) {
      this.runners.set(m.config.id, new TwinRunner(m, seed));
      this.subs.set(m.config.id, new Set());
    }
  }

  infoDatos() {
    const d = this.datos;
    return { fuente: d.fuente, activado: d.activado, detalle: d.detalle, precios: d.ctx.precios, temperaturas: d.ctx.temperaturas };
  }

  /** Un cliente empieza a mirar un gemelo. */
  abrir(cliente: string, gemelo: string): boolean {
    const r = this.runners.get(gemelo);
    if (!r) {
      this.emitir(cliente, { type: 'error', mensaje: 'Gemelo desconocido' });
      return false;
    }
    this.cerrar(cliente);
    this.subs.get(gemelo)!.add(cliente);
    this.gemeloDe.set(cliente, gemelo);
    this.emitir(cliente, { type: 'hola', config: r.config, datos: this.infoDatos() });
    this.emitir(cliente, { type: 'series', data: r.series });
    this.emitir(cliente, r.mensajeFrame(this.datos.fuente));
    return true;
  }

  cerrar(cliente: string) {
    const g = this.gemeloDe.get(cliente);
    if (g) this.subs.get(g)?.delete(cliente);
    this.gemeloDe.delete(cliente);
  }

  private difundir(gemelo: string, msg: unknown) {
    for (const c of this.subs.get(gemelo) ?? []) this.emitir(c, msg);
  }

  private difundirTodos(msg: unknown) {
    for (const g of this.subs.keys()) this.difundir(g, msg);
  }

  /** Procesa un mensaje del cliente (JSON con {cmd, args}), validado con la misma lista blanca que el servidor. */
  async comando(cliente: string, raw: string): Promise<void> {
    const gemelo = this.gemeloDe.get(cliente);
    const msg = validarMensaje(raw);
    if (!gemelo || !msg) return;
    const r = this.runners.get(gemelo)!;
    if (msg.cmd === 'datosPublicos') {
      if (this.datosEnCurso) return this.emitir(cliente, { type: 'datos', data: this.infoDatos() });
      this.datosEnCurso = true;
      try {
        this.datos = await cargarDatos(msg.args.v === true);
        for (const x of this.runners.values()) x.setContexto(this.datos.ctx);
      } finally {
        this.datosEnCurso = false;
        this.difundirTodos({ type: 'datos', data: this.infoDatos() });
      }
      return;
    }
    try {
      const reply = r.command(msg.cmd, msg.args);
      if (reply) {
        if (reply.type === 'resiliencia' || reply.type === 'comparador') this.difundir(gemelo, reply);
        else this.emitir(cliente, reply);
      }
      this.difundir(gemelo, r.mensajeFrame(this.datos.fuente));
    } catch {
      this.emitir(cliente, { type: 'error', mensaje: 'No se pudo ejecutar la orden.' });
    }
  }

  /** Avanza `realDt` segundos reales los gemelos que alguien está mirando y envía sus fotogramas. */
  tick(realDt: number) {
    for (const [id, r] of this.runners) {
      if (this.subs.get(id)!.size === 0) continue; // sin espectadores, el gemelo se congela
      r.tick(realDt);
      this.difundir(id, r.mensajeFrame(this.datos.fuente));
      if (this.versionSeries.get(id) !== r.seriesVersion) {
        this.versionSeries.set(id, r.seriesVersion);
        this.difundir(id, { type: 'series', data: r.series });
      }
    }
  }

  iniciar() {
    if (this.temporizador) return;
    this.ultimo = performance.now();
    this.temporizador = setInterval(() => {
      const ahora = performance.now();
      const dt = Math.min(0.5, (ahora - this.ultimo) / 1000);
      this.ultimo = ahora;
      this.tick(dt);
    }, 1000 / this.fps);
  }

  detener() {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }
}
