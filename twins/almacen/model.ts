/**
 * Gemelo de almacén: pedidos con picos de demanda, ubicaciones de entrada,
 * flota de AGV con baterías, averías y cargadores, rutas por pasillos.
 */
import { makeRng, rand, chance, poisson, int, uniform, nuevoFallos, avanzarFallos, semillaEquipo, type Fallos } from '../../core/rng';
import { newLedger, addEnergy, kpisFrom } from '../../core/kpis';
import { enVentana, horaDecimal, siguienteHora } from '../../core/clock';
import { contextoSimulado, precioElec } from '../../core/energy';
import type { BaseState, BaseView, CommonParams, Equipo, Alerta, TwinModel, EstadoEquipo } from '../../core/types';
import { crisisActiva, planActivo } from '../../core/types';
import { config, FILAS_Z, BLOQUES_X, TRANSVERSALES_X, MUELLES_RECEPCION, MUELLES_EXPEDICION, CARGADORES, RESERVA } from './config';

type P2 = [number, number];
const SLA_S = 45 * 60;
const MANIPULACION_S = 40;

export interface AlmParams extends CommonParams {
  flota: number;
  pedidosHora: number;
  entradasHora: number;
  velocidad: number;
  slottingABC: boolean;
  cargaOportunidad: boolean;
  umbralCarga: number;
  mtbfH: number;
  mttrMin: number;
  costeAgvHora: number;
  personal: number;
  costeHora: number;
  penalizacion: number;
  luzKw: number;
  cargaKw: number;
}

type AgvEstado = 'libre' | 'aparcando' | 'a_recoger' | 'manipulando' | 'cargado' | 'a_cargar' | 'cargando' | 'averiado';

interface Tarea {
  id: number;
  tipo: 'pedido' | 'ubicacion';
  desde: P2;
  hacia: P2;
  creado: number;
  due: number;
  bloqueado: boolean;
  reserva: boolean;
}

interface Agv {
  id: number;
  tipo: 'agv' | 'manual';
  x: number;
  z: number;
  rot: number;
  path: P2[];
  estado: AgvEstado;
  bat: number;
  tarea: Tarea | null;
  timer: number;
  downRem: number;
  forzada: boolean;
  cargador: number;
  libreDesde: number;
  hechas: number;
  ocupEma: number;
  km: number;
  prev: AgvEstado;
  fallos: Fallos;
}

export interface AlmState extends BaseState<AlmParams> {
  seed: number;
  agvs: Agv[];
  pendientes: Tarea[];
  nextId: number;
  cargadores: (number | null)[];
  completadosRecientes: number;
  bloqueados: number;
  luzKw: number;
  cargaKw: number;
}

export interface AlmView extends BaseView {
  /** [id, x, z, rot, estadoCode, bat, cargado, tipo] */
  agvs: number[];
  pedidosPendientes: number;
  ubicacionesPendientes: number;
  bloqueados: number;
  expedidos: number;
  flota: number;
  cargadores: number[];
}

export const ESTADO_CODE: Record<AgvEstado, number> = { libre: 0, aparcando: 0, a_recoger: 1, manipulando: 1, cargado: 2, a_cargar: 3, cargando: 3, averiado: 4 };

function defaultParams(): AlmParams {
  return {
    ctx: contextoSimulado(),
    flota: 5,
    pedidosHora: 60,
    entradasHora: 18,
    velocidad: 1.2,
    slottingABC: false,
    cargaOportunidad: false,
    umbralCarga: 25,
    mtbfH: 10,
    mttrMin: 30,
    costeAgvHora: 9,
    personal: 3,
    costeHora: 24,
    penalizacion: 6,
    luzKw: 18,
    cargaKw: 3.5,
  };
}

function nuevoAgv(id: number, tipo: Agv['tipo'], seed: number, mtbfS: number): Agv {
  const [x, z] = tipo === 'manual' ? [-24, -19] : [-10 + ((id * 4) % 22), -19];
  return { id, tipo, x, z, rot: 0, path: [], estado: 'libre', bat: 100 - ((id * 13) % 30), tarea: null, timer: 0, downRem: 0, forzada: false, cargador: -1, libreDesde: 0, hechas: 0, ocupEma: 0, km: 0, prev: 'libre', fallos: nuevoFallos(semillaEquipo(seed, id), mtbfS) };
}

function init(p: AlmParams, seed: number): AlmState {
  return {
    t: 0,
    workT: 0,
    rng: makeRng(seed),
    p,
    L: newLedger(),
    crisis: null,
    agvs: Array.from({ length: p.flota }, (_, i) => nuevoAgv(i + 1, 'agv', seed, p.mtbfH * 3600)),
    seed,
    pendientes: [],
    nextId: 1,
    cargadores: CARGADORES.map(() => null),
    completadosRecientes: 0,
    bloqueados: 0,
    luzKw: p.luzKw,
    cargaKw: 0,
  };
}

/** Ruta por pasillos: mismo pasillo → recto; si no, por el transversal más cercano. */
export function ruta(a: P2, b: P2): P2[] {
  if (Math.abs(a[1] - b[1]) < 0.01) return [b];
  let best = TRANSVERSALES_X[0];
  let bd = Infinity;
  for (const cx of TRANSVERSALES_X) {
    const d = Math.abs(a[0] - cx) + Math.abs(b[0] - cx);
    if (d < bd) {
      bd = d;
      best = cx;
    }
  }
  return [[best, a[1]], [best, b[1]], b];
}

function ubicacion(s: AlmState): P2 {
  const r = s.rng;
  const fila = int(r, 0, FILAS_Z.length - 1);
  const arriba = chance(r, 0.5);
  const z = FILAS_Z[fila] + (arriba ? -3 : 3);
  let x: number;
  if (s.p.slottingABC && chance(r, 0.75)) {
    // referencias rápidas (A) cerca de expedición
    x = 18 - 10 * Math.sqrt(rand(r));
  } else {
    const [a, b] = BLOQUES_X[int(r, 0, 1)];
    x = uniform(r, a + 1, b - 1);
  }
  return [Math.round(x * 2) / 2, z];
}

const enTurno = (t: number) => enVentana(t, 6, 22);

function demandaHora(s: AlmState): number {
  const h = horaDecimal(s.t);
  let f = 1;
  if (h >= 10 && h < 12) f = 1.6;
  else if (h >= 17 && h < 19) f = 1.5;
  else if (h < 8 || h >= 20.5) f = 0.6;
  if (crisisActiva(s, 'demanda')) f *= 2;
  return s.p.pedidosHora * f;
}

function moverPorRuta(a: Agv, dist: number): boolean {
  while (dist > 0 && a.path.length) {
    const [tx, tz] = a.path[0];
    const dx = tx - a.x;
    const dz = tz - a.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) a.rot = Math.atan2(dx, dz);
    if (d <= dist) {
      a.x = tx;
      a.z = tz;
      dist -= d;
      a.km += d / 1000;
      a.path.shift();
    } else {
      a.x += (dx / d) * dist;
      a.z += (dz / d) * dist;
      a.km += dist / 1000;
      dist = 0;
    }
  }
  return a.path.length === 0;
}

function umbral(s: AlmState) {
  if (planActivo(s, 'energia')) return 15;
  return s.p.umbralCarga;
}

function asignarCargador(s: AlmState, a: Agv): boolean {
  const i = s.cargadores.findIndex((c) => c === null);
  if (i < 0) return false;
  s.cargadores[i] = a.id;
  a.cargador = i;
  a.estado = 'a_cargar';
  a.path = ruta([a.x, a.z], CARGADORES[i]);
  return true;
}

function liberarCargador(s: AlmState, a: Agv) {
  if (a.cargador >= 0) s.cargadores[a.cargador] = null;
  a.cargador = -1;
}

function reconciliarFlota(s: AlmState) {
  const agvs = s.agvs.filter((a) => a.tipo === 'agv');
  const objetivo = s.p.flota;
  if (agvs.length < objetivo) {
    let id = Math.max(0, ...agvs.map((a) => a.id)) + 1;
    while (s.agvs.filter((a) => a.tipo === 'agv').length < objetivo) s.agvs.push(nuevoAgv(id++, 'agv', s.seed, s.p.mtbfH * 3600));
  } else if (agvs.length > objetivo) {
    // se retiran los AGV libres con id más alto
    const sobran = agvs.length - objetivo;
    const quitables = agvs.filter((a) => a.estado === 'libre' || a.estado === 'aparcando' || a.estado === 'cargando').sort((x, y) => y.id - x.id).slice(0, sobran);
    for (const a of quitables) {
      liberarCargador(s, a);
      s.agvs.splice(s.agvs.indexOf(a), 1);
    }
  }
  // Carretilla manual de apoyo (plan de la crisis de avería)
  // Con el plan de avería entran dos carretillas manuales (una por AGV averiado); con el del pico, una.
  const objetivoManual = planActivo(s, 'averia') ? 2 : planActivo(s, 'demanda') ? 1 : 0;
  const manuales = s.agvs.filter((a) => a.tipo === 'manual');
  for (let i = manuales.length; i < objetivoManual; i++) s.agvs.push(nuevoAgv(98 + i, 'manual', s.seed, 1e12));
  for (const m of manuales.slice(objetivoManual)) if (!m.tarea) s.agvs.splice(s.agvs.indexOf(m), 1);
}

function completar(s: AlmState, a: Agv) {
  const t = a.tarea!;
  a.tarea = null;
  a.hechas++;
  const L = s.L;
  if (t.tipo === 'pedido') {
    L.processed++;
    // Error de preparación (0,4 %): determinista por pedido para no desincronizar el generador entre ramas
    if ((Math.imul(t.id, 2654435761) >>> 0) % 1000 < 4) {
      L.scrap++; // error de preparación: no cuenta como bueno
      return;
    }
    L.good++;
    s.completadosRecientes++;
    L.leadSum += s.workT - t.creado;
    L.leadN++;
    if (s.workT <= t.due) L.servNum++;
    else L.penaltyCost += s.p.penalizacion;
  }
}

function step(s: AlmState, dt: number) {
  const p = s.p;
  if (!enTurno(s.t)) {
    // Noche: el almacén cierra, se cargan las baterías y se reanuda a las 06:00
    s.t = siguienteHora(s.t, 6);
    for (const a of s.agvs) {
      a.bat = 100;
      if (a.estado === 'cargando' || a.estado === 'a_cargar') {
        liberarCargador(s, a);
        a.estado = 'libre';
        a.path = [];
      }
    }
    return;
  }
  s.t += dt;
  s.workT += dt;
  const L = s.L;
  L.workS += dt;
  const r = s.rng;
  reconciliarFlota(s);

  // --- Llegadas de pedidos
  const n = poisson(r, demandaHora(s), dt);
  const sinStockFrac = crisisActiva(s, 'proveedor') ? Math.min(0.45, ((s.workT - s.crisis!.w0) / 3600) * 0.18) : 0;
  for (let i = 0; i < n; i++) {
    const bloqueado = chance(r, sinStockFrac);
    const reserva = bloqueado && planActivo(s, 'proveedor');
    s.pendientes.push({
      id: s.nextId++,
      tipo: 'pedido',
      desde: reserva ? RESERVA : ubicacion(s),
      hacia: MUELLES_EXPEDICION[int(r, 0, MUELLES_EXPEDICION.length - 1)],
      creado: s.workT,
      due: s.workT + SLA_S,
      bloqueado: bloqueado && !reserva,
      reserva,
    });
    L.servDen++;
  }
  // --- Camiones de entrada (ubicaciones)
  if (!crisisActiva(s, 'proveedor') && enVentana(s.t, 6, 20)) {
    const m = poisson(r, p.entradasHora, dt);
    for (let i = 0; i < m; i++) {
      s.pendientes.push({ id: s.nextId++, tipo: 'ubicacion', desde: MUELLES_RECEPCION[int(r, 0, MUELLES_RECEPCION.length - 1)], hacia: ubicacion(s), creado: s.workT, due: Infinity, bloqueado: false, reserva: false });
    }
  }
  // Fin de la rotura de stock: se desbloquean; con plan, los bloqueados pasan a la reserva
  for (const t of s.pendientes) {
    if (t.bloqueado && (!crisisActiva(s, 'proveedor') || planActivo(s, 'proveedor'))) {
      t.bloqueado = false;
      if (planActivo(s, 'proveedor')) {
        t.reserva = true;
        t.desde = RESERVA;
      }
    }
  }
  s.bloqueados = s.pendientes.filter((t) => t.bloqueado).length;

  // --- Asignación de tareas (pedidos primero; ubicaciones si llevan mucho esperando o no hay pedidos)
  const libres = s.agvs.filter((a) => a.bat >= umbral(s) && (a.estado === 'libre' || a.estado === 'aparcando' || (a.estado === 'cargando' && a.bat > 45 && (p.cargaOportunidad || a.bat > 80))) && a.downRem <= 0);
  if (libres.length && s.pendientes.length) {
    const elegibles = s.pendientes
      .filter((t) => !t.bloqueado)
      .sort((x, y) => {
        const px = x.tipo === 'pedido' || s.workT - x.creado > 1800 ? 0 : 1;
        const py = y.tipo === 'pedido' || s.workT - y.creado > 1800 ? 0 : 1;
        return px - py || x.creado - y.creado;
      });
    for (const t of elegibles) {
      if (!libres.length) break;
      let bi = 0;
      let bd = Infinity;
      libres.forEach((a, i) => {
        const d = Math.abs(a.x - t.desde[0]) + Math.abs(a.z - t.desde[1]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      const a = libres.splice(bi, 1)[0];
      if (a.estado === 'cargando') liberarCargador(s, a);
      s.pendientes.splice(s.pendientes.indexOf(t), 1);
      a.tarea = t;
      a.estado = 'a_recoger';
      a.path = ruta([a.x, a.z], t.desde);
    }
  }

  // --- Movimiento y estados de cada AGV
  const precio = precioElec(p.ctx, s.t) * (crisisActiva(s, 'energia') ? 3 : 1);
  const enCrisisAveria = crisisActiva(s, 'averia');
  let cargaKw = 0;
  for (const a of s.agvs) {
    const esAgv = a.tipo === 'agv';
    // Fin de avería forzada
    if (a.forzada && !enCrisisAveria) {
      a.forzada = false;
      a.downRem = 0;
    }
    if (a.estado === 'averiado') {
      if (!a.forzada) a.downRem -= dt;
      if (a.downRem <= 0 && !a.forzada) {
        const prev = a.tarea ? a.prev : 'libre';
        a.estado = prev === 'manipulando' || prev === 'cargado' || prev === 'a_recoger' ? prev : 'libre';
        if (a.tarea && a.estado === 'cargado') a.path = ruta([a.x, a.z], a.tarea.hacia);
        if (a.tarea && a.estado === 'a_recoger') a.path = ruta([a.x, a.z], a.tarea.desde);
        a.libreDesde = s.workT;
      }
    }
    let ocupado = false;
    const v = (a.tipo === 'manual' ? 0.9 : p.velocidad) * (a.estado === 'cargado' ? 0.85 : 1);
    switch (a.estado) {
      case 'libre':
        if (esAgv && a.bat < umbral(s) && asignarCargador(s, a)) break;
        if (esAgv && p.cargaOportunidad && a.bat < 70 && !crisisActiva(s, 'energia') && asignarCargador(s, a)) break;
        if (s.workT - a.libreDesde > 60 && (Math.abs(a.z + 19) > 0.1)) {
          a.estado = 'aparcando';
          const px = a.tipo === 'manual' ? -24 : -14 + ((a.id * 4) % 28);
          a.path = ruta([a.x, a.z], [px, -19]);
        }
        break;
      case 'aparcando':
        if (moverPorRuta(a, v * dt)) a.estado = 'libre';
        if (esAgv && a.bat < umbral(s)) asignarCargador(s, a);
        break;
      case 'a_recoger':
        ocupado = true;
        if (moverPorRuta(a, v * dt)) {
          a.estado = 'manipulando';
          a.timer = MANIPULACION_S;
        }
        break;
      case 'manipulando':
        ocupado = true;
        a.timer -= dt;
        if (a.timer <= 0) {
          if (a.path.length === 0 && a.tarea && Math.abs(a.x - a.tarea.hacia[0]) + Math.abs(a.z - a.tarea.hacia[1]) < 0.1) {
            completar(s, a);
            a.estado = 'libre';
            a.libreDesde = s.workT;
          } else if (a.tarea) {
            a.estado = 'cargado';
            a.path = ruta([a.x, a.z], a.tarea.hacia);
          }
        }
        break;
      case 'cargado':
        ocupado = true;
        if (moverPorRuta(a, v * dt)) {
          a.estado = 'manipulando';
          a.timer = MANIPULACION_S;
        }
        break;
      case 'a_cargar':
        if (moverPorRuta(a, v * dt)) a.estado = 'cargando';
        break;
      case 'cargando':
        a.bat = Math.min(100, a.bat + (100 / 3600) * dt);
        cargaKw += p.cargaKw;
        if (a.bat >= 92) {
          liberarCargador(s, a);
          a.estado = 'libre';
          a.libreDesde = s.workT;
        }
        break;
    }
    // Batería
    if (esAgv) {
      const moviendo = a.estado === 'a_recoger' || a.estado === 'cargado' || a.estado === 'a_cargar' || a.estado === 'aparcando';
      if (a.estado !== 'cargando') a.bat = Math.max(0, a.bat - (moviendo ? 100 / 10800 : a.estado === 'manipulando' ? 100 / 14000 : 100 / 90000) * dt);
      if (a.bat <= 0 && a.estado !== 'averiado') {
        a.prev = a.estado;
        a.estado = 'averiado';
        a.downRem = 1800;
        a.bat = 30;
      }
    }
    // Averías aleatorias
    if (esAgv && ocupado) {
      const rep = avanzarFallos(a.fallos, dt, p.mtbfH * 3600, p.mttrMin * 60);
      if (rep > 0) {
        a.prev = a.estado;
        a.estado = 'averiado';
        a.downRem = rep;
      }
    }
    // OEE de flota
    if (esAgv) {
      L.oPlan += dt;
      if (a.estado !== 'averiado' && a.estado !== 'cargando' && a.estado !== 'a_cargar') L.oUp += dt;
      if (ocupado) L.oIdeal += dt;
    }
    a.ocupEma += ((ocupado ? 1 : 0) - a.ocupEma) * Math.min(1, dt / 900);
  }
  s.cargaKw = cargaKw;

  // --- Energía y costes
  const luz = planActivo(s, 'energia') ? p.luzKw * 0.5 : p.luzKw;
  s.luzKw = luz;
  addEnergy(L, cargaKw + luz, dt, 'elec', precio);
  const nAgv = s.agvs.filter((a) => a.tipo === 'agv').length;
  const nManual = s.agvs.filter((a) => a.tipo === 'manual').length;
  L.fixedCost += ((nAgv * p.costeAgvHora + nManual * 32) * dt) / 3600;
  L.laborCost += (p.personal * p.costeHora * dt) / 3600;
}

function onCrisis(s: AlmState) {
  if (s.crisis?.id === 'averia') {
    // Fallan los dos AGV más ocupados
    const cands = s.agvs.filter((a) => a.tipo === 'agv' && a.estado !== 'averiado').sort((x, y) => y.ocupEma - x.ocupEma).slice(0, 2);
    for (const a of cands) {
      if (a.estado === 'cargando' || a.estado === 'a_cargar') liberarCargador(s, a);
      a.estado = 'averiado';
      a.forzada = true;
      a.downRem = 1;
      if (a.tarea) {
        // la tarea vuelve a la cola (si iba cargado, el palé se recoge donde se quedó)
        const t = a.tarea;
        if (a.path.length && t) t.desde = [a.x, a.z];
        s.pendientes.unshift(t);
        a.tarea = null;
        a.path = [];
      }
    }
  }
}

const ESTADO_EQUIPO: Record<AgvEstado, EstadoEquipo> = {
  libre: 'esperando',
  aparcando: 'esperando',
  a_recoger: 'trabajando',
  manipulando: 'trabajando',
  cargado: 'trabajando',
  a_cargar: 'cargando',
  cargando: 'cargando',
  averiado: 'averia',
};
const TEXTO_AGV: Record<AgvEstado, string> = {
  libre: 'Libre',
  aparcando: 'Libre (aparcando)',
  a_recoger: 'Libre → a recoger',
  manipulando: 'Cargando/descargando palé',
  cargado: 'Cargado',
  a_cargar: 'Yendo a cargar batería',
  cargando: 'Cargando batería',
  averiado: 'Averiado',
};

function view(s: AlmState): AlmView {
  const agvs: number[] = [];
  const equipos: Equipo[] = [];
  for (const a of s.agvs) {
    const cargado = a.estado === 'cargado' || (a.estado === 'manipulando' && a.path.length === 0 && !!a.tarea && Math.abs(a.x - a.tarea.desde[0]) + Math.abs(a.z - a.tarea.desde[1]) < 0.1);
    agvs.push(a.id, +a.x.toFixed(2), +a.z.toFixed(2), +a.rot.toFixed(3), ESTADO_CODE[a.estado], Math.round(a.bat), cargado || a.estado === 'cargado' ? 1 : 0, a.tipo === 'manual' ? 1 : 0);
    equipos.push({
      id: `agv${a.id}`,
      nombre: a.tipo === 'manual' ? 'Carretilla manual' : `AGV ${a.id}`,
      estado: ESTADO_EQUIPO[a.estado],
      util: a.ocupEma,
      kw: a.estado === 'cargando' ? s.p.cargaKw : 0,
      extra: {
        Estado: TEXTO_AGV[a.estado],
        Batería: a.tipo === 'manual' ? '—' : `${Math.round(a.bat)} %`,
        'Tarea actual': a.tarea ? (a.tarea.tipo === 'pedido' ? `Pedido #${a.tarea.id}${a.tarea.reserva ? ' (reserva)' : ''}` : `Ubicación #${a.tarea.id}`) : '—',
        'Tareas hechas': a.hechas,
        'Recorrido': `${a.km.toFixed(1)} km`,
      },
    });
  }
  const ped = s.pendientes.filter((t) => t.tipo === 'pedido').length;
  const ubi = s.pendientes.length - ped;
  const nAgv = s.agvs.filter((a) => a.tipo === 'agv').length;
  const averiados = s.agvs.filter((a) => a.estado === 'averiado').length;
  const libres = s.agvs.filter((a) => a.estado === 'libre' || a.estado === 'aparcando').length;
  equipos.push({
    id: 'recepcion',
    nombre: 'Recepción',
    estado: crisisActiva(s, 'proveedor') ? 'sin_material' : ubi > 15 ? 'alerta' : 'trabajando',
    util: Math.min(1, ubi / 20),
    kw: 0,
    cola: ubi,
    extra: { 'Palés por ubicar': ubi, Camiones: crisisActiva(s, 'proveedor') ? 'NO LLEGAN' : `${s.p.entradasHora} palés/h`, 'Pedidos sin stock': s.bloqueados },
  });
  equipos.push({
    id: 'expedicion',
    nombre: 'Expedición',
    estado: ped > 25 ? 'alerta' : 'trabajando',
    util: Math.min(1, ped / 30),
    kw: 0,
    cola: ped,
    extra: { 'Pedidos pendientes': ped, 'Pedidos expedidos': s.L.good, 'Demanda actual': `${Math.round(demandaHora(s))} pedidos/h` },
  });
  equipos.push({
    id: 'cargadores',
    nombre: 'Cargadores',
    estado: s.cargadores.some((c) => c !== null) ? 'cargando' : 'esperando',
    util: s.cargadores.filter((c) => c !== null).length / s.cargadores.length,
    kw: s.cargaKw,
    extra: { 'En uso': `${s.cargadores.filter((c) => c !== null).length} de ${s.cargadores.length}`, Iluminación: `${s.luzKw.toFixed(0)} kW` },
  });

  const alertas: Alerta[] = [];
  if (averiados) alertas.push({ nivel: 'critico', texto: `${averiados} AGV averiado${averiados > 1 ? 's' : ''}` });
  if (s.bloqueados) alertas.push({ nivel: 'critico', texto: `${s.bloqueados} pedidos sin stock` });
  if (ped > 25) alertas.push({ nivel: 'aviso', texto: `${ped} pedidos en cola` });
  if (crisisActiva(s, 'demanda')) alertas.push({ nivel: 'aviso', texto: 'Pico de demanda: pedidos ×2' });
  if (crisisActiva(s, 'energia')) alertas.push({ nivel: 'aviso', texto: 'Precio de la energía ×3' });
  if (s.agvs.some((a) => a.tipo === 'manual')) alertas.push({ nivel: 'info', texto: 'Carretilla manual de apoyo activa' });
  if (libres === nAgv && ped === 0) alertas.push({ nivel: 'info', texto: 'Flota libre' });

  return {
    equipos,
    alertas,
    agvs,
    pedidosPendientes: ped,
    ubicacionesPendientes: ubi,
    bloqueados: s.bloqueados,
    expedidos: s.L.good,
    flota: s.p.flota,
    cargadores: s.cargadores.map((c) => (c === null ? 0 : 1)),
  };
}

function potencias(s: AlmState): Record<string, number> {
  return { cargadores: s.cargaKw, iluminacion: s.luzKw, total: s.cargaKw + s.luzKw };
}

// ---------- Barrido "¿cuántos AGV necesito?" ----------
const cacheBarrido = new Map<string, unknown>();
export function barrido(live: AlmParams, seed: number) {
  const key = JSON.stringify(live) + seed;
  if (cacheBarrido.has(key)) return cacheBarrido.get(key);
  const flotas = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12];
  const servicio: number[] = [];
  const coste: number[] = [];
  const pedidos: number[] = [];
  for (const n of flotas) {
    const s = init({ ...structuredClone(live), flota: n }, seed);
    while (s.t < 24 * 3600) step(s, 1);
    const k = kpisFrom(s.L, s.t);
    servicio.push(k.servicio);
    coste.push(k.costeUnidad);
    pedidos.push(k.unidades);
  }
  const res = { flotas, servicio, coste, pedidos };
  cacheBarrido.set(key, res);
  return res;
}

const model: TwinModel<AlmParams, AlmState, AlmView> = {
  config,
  dt: 1,
  horizonteComparadorH: 24,
  horizonteResilienciaH: 6,
  defaultParams,
  scenarioParams(id, live) {
    const p = { ...live, flota: 5 };
    if (id === 'A') p.flota = 7;
    if (id === 'B') {
      p.slottingABC = true;
    }
    return p;
  },
  init,
  step,
  view,
  potencias,
  onCrisis,
  command(s, cmd, args, ctx) {
    if (cmd === 'flota') {
      const n = Math.max(1, Math.min(14, Math.round(Number(args?.n) || 5)));
      s.p.flota = n;
      ctx.live.flota = n;
      return { flota: n };
    }
    if (cmd === 'barrido') return barrido({ ...ctx.live, flota: 5 }, ctx.seed);
    return null;
  },
};

export default model;
