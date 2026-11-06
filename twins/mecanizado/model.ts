/**
 * Gemelo de mecanizado: almacén → corte → torno (+ torno alternativo) → montaje → envío.
 * Piezas discretas, tiempos de ciclo variables, averías MTBF/MTTR, transporte interno
 * con carro (el recorrido depende de la distribución en planta) y turnos.
 */
import { makeRng, cycle, chance, poisson, nuevoFallos, avanzarFallos, semillaEquipo, type Fallos } from '../../core/rng';
import { newLedger, addEnergy } from '../../core/kpis';
import { enVentana, horaDecimal, siguienteHora } from '../../core/clock';
import { contextoSimulado, precioElec, esValle } from '../../core/energy';
import type { BaseState, BaseView, CommonParams, Equipo, Alerta, TwinModel, EstadoEquipo } from '../../core/types';
import { crisisActiva, planActivo } from '../../core/types';
import { config, LAYOUTS, NOMBRES, RUTA, type Layout, type PuestoId } from './config';

type MaqId = 'corte' | 'torno' | 'torno2' | 'montaje';
const MAQUINAS: { id: MaqId; etapa: number }[] = [
  { id: 'corte', etapa: 1 },
  { id: 'torno', etapa: 2 },
  { id: 'torno2', etapa: 2 },
  { id: 'montaje', etapa: 3 },
];
const ETAPA_PUESTO: PuestoId[] = ['almacen', 'corte', 'torno', 'montaje', 'envio'];
const CICLO_IDEAL_TORNO = 60; // s, ciclo de diseño para el OEE
const WIP_MAX = 30;
const SLA_S = 4 * 3600; // plazo comprometido (h de operación)
/** Tope de pedidos sin lanzar: acota memoria y CPU si la simulación se deja correr días con poca capacidad. */
const MAX_BACKLOG = 3000;

export interface MecParams extends CommonParams {
  layout: Layout;
  turnos: 1 | 2;
  demandaDia: number;
  operarios: number;
  costeHora: number;
  plusTurno2: number;
  fijoHora: number;
  ciclo: Record<MaqId, number>;
  cv: number;
  mtbfH: Record<MaqId, number>;
  mttrMin: Record<MaqId, number>;
  scrap: number;
  torno2Activo: boolean;
  carros: number;
  velCarro: number;
  manipulacion: number;
  suministroHora: number;
  stockMax: number;
  /** stock de seguridad que solo se usa con el plan de la crisis del proveedor */
  seguridad: number;
  kw: Record<MaqId, [number, number]>; // [en espera, trabajando]
  auxKw: number;
  sinAverias: boolean;
  /** paradas registradas (MES) que se reproducen en la calibración: [máquina, desde, hasta] en workT */
  paradasForzadas: [MaqId, number, number][] | null;
}

interface Pieza {
  id: number;
  etapa: number;
  est: 'cola' | 'proceso' | 'espera' | 'transito';
  orderW: number;
  dueW: number;
  desde: PuestoId;
  hacia: PuestoId;
  dur: number;
  el: number;
}

interface Maq {
  id: MaqId;
  etapa: number;
  pieza: number | null;
  rem: number;
  up: boolean;
  downRem: number;
  hechas: number;
  ocupEma: number;
  kw: number;
  fallos: Fallos;
}

export interface MecState extends BaseState<MecParams> {
  piezas: Record<number, Pieza>;
  colas: number[][];
  colaCarro: number[];
  carros: { pieza: number | null }[];
  maq: Maq[];
  backlog: { orderW: number; dueW: number }[];
  dues: number[];
  stock: number;
  seguridad: number;
  nextId: number;
  enviadas: number;
  auxKw: number;
  proveedorCortado: boolean;
}

export interface MecView extends BaseView {
  layout: Layout;
  posiciones: Record<PuestoId, [number, number]>;
  ruta: { puntos: [number, number][]; longitud: number };
  /** [id, x, z, tipo] tipo: 0 cola, 1 proceso, 2 tránsito, 3 espera de carro */
  piezas: number[];
  stock: number;
  seguridad: number;
  stockMax: number;
  seguridadMax: number;
  backlog: number;
  torno2Activo: boolean;
  enviadas: number;
}

const manhattan = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

export function rutaLayout(layout: Layout) {
  const pos = LAYOUTS[layout];
  const puntos: [number, number][] = [];
  let longitud = 0;
  for (let i = 0; i < RUTA.length; i++) {
    const b = pos[RUTA[i]];
    if (i > 0) {
      const a = pos[RUTA[i - 1]];
      puntos.push([b[0], a[1]]);
      longitud += manhattan(a, b);
    }
    puntos.push(b);
  }
  return { puntos, longitud };
}

function defaultParams(): MecParams {
  return {
    ctx: contextoSimulado(),
    layout: 'funcional',
    turnos: 1,
    demandaDia: 250,
    operarios: 4,
    costeHora: 28,
    plusTurno2: 0.25,
    fijoHora: 15,
    ciclo: { corte: 50, torno: 70, torno2: 110, montaje: 60 },
    cv: 0.15,
    mtbfH: { corte: 6, torno: 3, torno2: 8, montaje: 8 },
    mttrMin: { corte: 12, torno: 25, torno2: 15, montaje: 10 },
    scrap: 0.015,
    torno2Activo: false,
    carros: 1,
    velCarro: 1.5,
    manipulacion: 4,
    suministroHora: 45,
    // Colchón pequeño (≈1,2 h de consumo): si el proveedor falla, la célula se para pronto
    stockMax: 40,
    seguridad: 50,
    kw: { corte: [4, 15], torno: [5, 22], torno2: [3, 16], montaje: [2, 6] },
    auxKw: 20,
    sinAverias: false,
    paradasForzadas: null,
  };
}

function init(p: MecParams, seed: number): MecState {
  return {
    t: 0,
    workT: 0,
    rng: makeRng(seed),
    p,
    L: newLedger(),
    crisis: null,
    piezas: {},
    colas: [[], [], [], [], []],
    colaCarro: [],
    carros: Array.from({ length: 3 }, () => ({ pieza: null })),
    maq: MAQUINAS.map((m, i) => ({ ...m, pieza: null, rem: 0, up: true, downRem: 0, hechas: 0, ocupEma: 0, kw: 0, fallos: nuevoFallos(semillaEquipo(seed, i + 1), p.mtbfH[m.id] * 3600) })),
    backlog: [],
    dues: [],
    stock: p.stockMax * 0.8,
    seguridad: p.seguridad,
    proveedorCortado: false,
    nextId: 1,
    enviadas: 0,
    auxKw: p.auxKw,
  };
}

const finTurno = (p: MecParams) => (p.turnos === 2 ? 22 : 14);
const torno2Habilitado = (s: MecState) => s.p.torno2Activo || planActivo(s, 'averia') || planActivo(s, 'demanda');
const numCarros = (s: MecState) => Math.min(3, s.p.carros + (planActivo(s, 'demanda') ? 1 : 0));

function forzadaParada(s: MecState, id: MaqId): boolean {
  if (id === 'torno' && crisisActiva(s, 'averia')) return true;
  const pf = s.p.paradasForzadas;
  if (pf) for (const [m, a, b] of pf) if (m === id && s.workT >= a && s.workT < b) return true;
  return false;
}

function step(s: MecState, dt: number) {
  const p = s.p;
  // Fuera de turno la planta está parada: el reloj salta al inicio del siguiente turno.
  if (!enVentana(s.t, 6, finTurno(p))) {
    s.t = siguienteHora(s.t, 6);
    return;
  }
  s.t += dt;
  s.workT += dt;
  const L = s.L;
  L.workS += dt;
  const r = s.rng;

  // --- Pedidos (se reciben de 06:00 a 14:00)
  if (enVentana(s.t, 6, 14)) {
    const factor = crisisActiva(s, 'demanda') ? 2 : 1;
    const n = poisson(r, (p.demandaDia / 8) * factor, dt);
    for (let i = 0; i < n; i++) {
      if (s.backlog.length < MAX_BACKLOG) s.backlog.push({ orderW: s.workT, dueW: s.workT + SLA_S });
      s.dues.push(s.workT + SLA_S);
    }
  }
  while (s.dues.length && s.dues[0] <= s.workT) {
    s.dues.shift();
    L.servDen++;
  }

  // --- Suministro de material
  if (crisisActiva(s, 'proveedor')) s.proveedorCortado = true;
  else {
    // Al acabar la crisis llega el camión retrasado y el almacén se repone de golpe
    if (s.proveedorCortado) {
      s.proveedorCortado = false;
      s.stock = p.stockMax;
      s.seguridad = p.seguridad;
    }
    s.stock = Math.min(p.stockMax, s.stock + (p.suministroHora * dt) / 3600);
  }

  // --- Lanzamiento de piezas (CONWIP)
  let wip = s.colaCarro.length + s.colas.reduce((a, c) => a + c.length, 0) + s.carros.filter((c) => c.pieza !== null).length + s.maq.filter((m) => m.pieza !== null).length;
  while (s.backlog.length && wip < WIP_MAX) {
    if (s.stock >= 1) s.stock -= 1;
    else if (planActivo(s, 'proveedor') && s.seguridad >= 1) s.seguridad -= 1;
    else break;
    const o = s.backlog.shift()!;
    const id = s.nextId++;
    s.piezas[id] = { id, etapa: 0, est: 'espera', orderW: o.orderW, dueW: o.dueW, desde: 'almacen', hacia: 'corte', dur: 0, el: 0 };
    s.colaCarro.push(id);
    wip++;
  }

  // --- Máquinas
  const precio = precioElec(p.ctx, s.t) * (crisisActiva(s, 'energia') ? 3 : 1);
  const ahorro = planActivo(s, 'energia');
  const t2 = torno2Habilitado(s);
  for (const m of s.maq) {
    const habilitada = m.id !== 'torno2' || t2;
    const forzada = forzadaParada(s, m.id);
    if (forzada) m.up = false;
    else if (!m.up) {
      m.downRem -= dt;
      if (m.downRem <= 0 || p.paradasForzadas) m.up = true;
    }
    if (m.id === 'torno') {
      L.oPlan += dt;
      if (m.up) L.oUp += dt;
    }
    let ocupada = false;
    if (m.up && habilitada) {
      if (m.pieza === null && s.colas[m.etapa].length) {
        m.pieza = s.colas[m.etapa].shift()!;
        s.piezas[m.pieza].est = 'proceso';
        s.piezas[m.pieza].desde = m.id;
        m.rem = cycle(r, p.ciclo[m.id], p.cv);
      }
      if (m.pieza !== null) {
        ocupada = true;
        m.rem -= dt;
        // Avería aleatoria (solo mientras trabaja)
        const rep = !p.sinAverias && !p.paradasForzadas ? avanzarFallos(m.fallos, dt, p.mtbfH[m.id] * 3600, p.mttrMin[m.id] * 60) : 0;
        if (rep > 0) {
          m.up = false;
          m.downRem = rep;
        } else if (m.rem <= 0) {
          const pz = s.piezas[m.pieza];
          m.pieza = null;
          m.hechas++;
          if (m.id === 'torno') {
            L.processed++;
            L.oIdeal += CICLO_IDEAL_TORNO;
          }
          if (m.id === 'torno2') L.processed++;
          if ((m.id === 'torno' || m.id === 'montaje') && chance(r, p.scrap)) {
            delete s.piezas[pz.id];
            L.scrap++;
          } else {
            pz.est = 'espera';
            pz.desde = m.id;
            pz.hacia = ETAPA_PUESTO[m.etapa + 1];
            s.colaCarro.push(pz.id);
          }
        }
      }
    }
    m.ocupEma += ((ocupada ? 1 : 0) - m.ocupEma) * Math.min(1, dt / 1200);
    const [idle, busy] = p.kw[m.id];
    let kw = !habilitada ? 0 : ocupada ? busy : m.up ? idle : idle * 0.5;
    if (ahorro && !ocupada) kw *= 0.4;
    m.kw = kw;
    addEnergy(L, kw, dt, 'elec', precio);
  }
  // Consumos auxiliares (compresor, aspiración, iluminación)
  s.auxKw = ahorro ? (esValle(p.ctx, s.t) ? p.auxKw : 6) : p.auxKw;
  addEnergy(L, s.auxKw, dt, 'elec', precio);

  // --- Transporte interno con carro
  const pos = LAYOUTS[p.layout];
  const nc = numCarros(s);
  for (let i = 0; i < s.carros.length; i++) {
    const c = s.carros[i];
    if (c.pieza === null) {
      if (i < nc && s.colaCarro.length) {
        const id = s.colaCarro.shift()!;
        const pz = s.piezas[id];
        if (!pz) continue;
        c.pieza = id;
        pz.est = 'transito';
        pz.dur = manhattan(pos[pz.desde], pos[pz.hacia]) / p.velCarro + p.manipulacion;
        pz.el = 0;
      }
      continue;
    }
    const pz = s.piezas[c.pieza];
    pz.el += dt;
    if (pz.el >= pz.dur) {
      c.pieza = null;
      if (pz.hacia === 'envio') {
        L.good++;
        s.enviadas++;
        L.leadSum += s.workT - pz.orderW;
        L.leadN++;
        L.servNum++;
        delete s.piezas[pz.id];
      } else {
        pz.etapa = ETAPA_PUESTO.indexOf(pz.hacia);
        pz.est = 'cola';
        s.colas[pz.etapa].push(pz.id);
      }
    }
  }

  // --- Costes de mano de obra y fijos
  const plus = horaDecimal(s.t) >= 14 ? 1 + p.plusTurno2 : 1;
  L.laborCost += (p.operarios * p.costeHora * plus * dt) / 3600;
  L.fixedCost += (p.fijoHora * dt) / 3600;
}

function posPieza(s: MecState, pz: Pieza, idx: number): [number, number, number] {
  const pos = LAYOUTS[s.p.layout];
  switch (pz.est) {
    case 'cola': {
      const b = pos[ETAPA_PUESTO[pz.etapa]];
      return [b[0] - 1.6 - (idx % 4) * 0.55, b[1] + 1.9 + Math.floor(idx / 4) * 0.55, 0];
    }
    case 'proceso': {
      const b = pos[pz.desde];
      return [b[0], b[1], 1];
    }
    case 'espera': {
      const b = pos[pz.desde];
      return [b[0] + 1.6 + (idx % 3) * 0.55, b[1] + 1.9 + Math.floor(idx / 3) * 0.55, 3];
    }
    case 'transito': {
      const a = pos[pz.desde];
      const b = pos[pz.hacia];
      const d1 = Math.abs(b[0] - a[0]);
      const d2 = Math.abs(b[1] - a[1]);
      const tot = d1 + d2 || 1;
      const f = Math.min(1, pz.el / Math.max(1e-6, pz.dur - s.p.manipulacion)) * tot;
      if (f <= d1) return [a[0] + Math.sign(b[0] - a[0]) * f, a[1], 2];
      return [b[0], a[1] + Math.sign(b[1] - a[1]) * (f - d1), 2];
    }
  }
}

function view(s: MecState): MecView {
  const p = s.p;
  const piezas: number[] = [];
  const contEspera: Record<string, number> = {};
  for (let e = 0; e < s.colas.length; e++) {
    s.colas[e].slice(0, 24).forEach((id, i) => {
      const [x, z, k] = posPieza(s, s.piezas[id], i);
      piezas.push(id, x, z, k);
    });
  }
  for (const id of s.colaCarro) {
    const pz = s.piezas[id];
    if (!pz) continue;
    const i = (contEspera[pz.desde] = (contEspera[pz.desde] ?? -1) + 1);
    if (i >= 18) continue;
    const [x, z, k] = posPieza(s, pz, i);
    piezas.push(id, x, z, k);
  }
  for (const m of s.maq) if (m.pieza !== null) piezas.push(m.pieza, ...posPieza(s, s.piezas[m.pieza], 0));
  for (const c of s.carros) if (c.pieza !== null && s.piezas[c.pieza]) piezas.push(c.pieza, ...posPieza(s, s.piezas[c.pieza], 0));

  const t2 = torno2Habilitado(s);
  const enTurno = enVentana(s.t, 6, finTurno(p));
  const equipos: Equipo[] = [];
  const usandoSeguridad = s.stock < 1 && planActivo(s, 'proveedor') && s.seguridad >= 1;
  const sinMaterial = s.stock < 1 && !usandoSeguridad;
  const wip = Object.keys(s.piezas).length;
  equipos.push({
    id: 'almacen',
    nombre: NOMBRES.almacen,
    estado: sinMaterial ? 'sin_material' : usandoSeguridad || s.stock < 10 ? 'alerta' : 'trabajando',
    util: s.stock / p.stockMax,
    kw: 0,
    cola: s.backlog.length,
    extra: {
      'Stock de material': `${Math.floor(s.stock)} uds`,
      'Stock de seguridad': usandoSeguridad ? `${Math.floor(s.seguridad)} uds (en uso)` : `${Math.floor(s.seguridad)} uds (reservado)`,
      'Pedidos pendientes': s.backlog.length,
      Suministro: crisisActiva(s, 'proveedor') ? 'INTERRUMPIDO' : `${p.suministroHora} uds/h`,
    },
  });
  for (const m of s.maq) {
    const hab = m.id !== 'torno2' || t2;
    let estado: EstadoEquipo = !enTurno ? 'fuera_turno' : !hab ? 'inactivo' : !m.up ? 'averia' : m.pieza !== null ? 'trabajando' : 'esperando';
    const cola = s.colas[m.etapa].length;
    if (estado === 'trabajando' && cola > 12) estado = 'alerta';
    equipos.push({
      id: m.id,
      nombre: NOMBRES[m.id],
      estado,
      util: m.ocupEma,
      kw: m.kw,
      cola: m.id === 'torno2' ? 0 : cola,
      extra: {
        'Tiempo de ciclo': `${p.ciclo[m.id].toFixed(0)} s ± ${(p.cv * 100).toFixed(0)} %`,
        MTBF: `${p.mtbfH[m.id]} h`,
        MTTR: `${p.mttrMin[m.id]} min`,
        'Piezas hechas': m.hechas,
      },
    });
  }
  equipos.push({
    id: 'envio',
    nombre: NOMBRES.envio,
    estado: 'trabajando',
    util: 0,
    kw: 0,
    extra: { 'Piezas enviadas': s.enviadas, 'Carros en uso': `${numCarros(s)}` },
  });

  const alertas: Alerta[] = [];
  const torno = s.maq[1];
  if (!torno.up) alertas.push({ nivel: 'critico', texto: 'Torno CNC averiado' });
  if (s.colas[2].length > 12) alertas.push({ nivel: 'aviso', texto: `Cola en el torno: ${s.colas[2].length} piezas` });
  if (sinMaterial) alertas.push({ nivel: 'critico', texto: 'Sin material en almacén' });
  else if (usandoSeguridad) alertas.push({ nivel: 'aviso', texto: `Usando stock de seguridad: ${Math.floor(s.seguridad)} uds` });
  else if (s.stock < 10) alertas.push({ nivel: 'aviso', texto: 'Stock de material bajo' });
  if (s.backlog.length > 40) alertas.push({ nivel: 'aviso', texto: `${s.backlog.length} pedidos sin lanzar` });
  if (crisisActiva(s, 'energia')) alertas.push({ nivel: 'aviso', texto: 'Precio de la energía ×3' });
  if (t2) alertas.push({ nivel: 'info', texto: 'Torno alternativo en marcha' });
  if (!enTurno) alertas.push({ nivel: 'info', texto: 'Fuera de turno' });

  const { narrativa, foco } = explicar(s, { sinMaterial, usandoSeguridad, wip, enTurno, t2 });
  return {
    equipos,
    alertas,
    narrativa,
    foco,
    layout: p.layout,
    posiciones: LAYOUTS[p.layout],
    ruta: rutaLayout(p.layout),
    piezas,
    stock: s.stock,
    seguridad: s.seguridad,
    stockMax: p.stockMax,
    seguridadMax: p.seguridad,
    backlog: s.backlog.length,
    torno2Activo: t2,
    enviadas: s.enviadas,
  };
}

/** Qué está pasando ahora, en una frase, y qué equipos mirar. */
function explicar(
  s: MecState,
  e: { sinMaterial: boolean; usandoSeguridad: boolean; wip: number; enTurno: boolean; t2: boolean },
): { narrativa: string; foco: string[] } {
  const c = s.crisis && crisisActiva(s) ? s.crisis : null;
  const plan = !!c?.plan;
  const colaTorno = s.colas[2].length;
  const min = c ? Math.max(0, Math.round((c.wHasta - s.workT) / 60)) : 0;
  if (!e.enTurno) return { narrativa: 'Fuera de turno: la célula está parada hasta las 06:00.', foco: [] };
  if (c?.id === 'proveedor') {
    if (e.sinMaterial && e.wip > 0)
      return { narrativa: `Se ha acabado el material${plan ? ' (también el de seguridad)' : ''}: la célula termina las ${e.wip} piezas en curso y se va a parar.`, foco: ['almacen'] };
    if (e.sinMaterial)
      return { narrativa: `Célula parada por falta de material. Los pedidos se acumulan (${s.backlog.length} sin lanzar) hasta que llegue el camión, dentro de ${min} min.`, foco: ['almacen'] };
    if (e.usandoSeguridad)
      return { narrativa: `Plan en marcha: la célula sigue trabajando con el stock de seguridad. Quedan ${Math.floor(s.seguridad)} piezas; si se agotan antes de que llegue el camión, se parará.`, foco: ['almacen'] };
    return {
      narrativa: `El proveedor no entrega. Quedan ${Math.floor(s.stock)} piezas de material en el almacén${plan ? ` y ${Math.floor(s.seguridad)} de seguridad` : ''}: cuando se acaben, la célula se parará.`,
      foco: ['almacen'],
    };
  }
  if (c?.id === 'averia') {
    if (plan) return { narrativa: `El torno CNC sigue averiado (${min} min más), pero el torno alternativo trabaja: sale producción, aunque más despacio.`, foco: ['torno', 'torno2'] };
    return { narrativa: `El torno CNC está averiado (${min} min más). Las piezas se acumulan delante (cola de ${colaTorno}) y casi no sale producción.`, foco: ['torno'] };
  }
  if (c?.id === 'demanda') {
    if (plan) return { narrativa: `Pico de pedidos con el plan: torno alternativo y segundo carro en marcha; la producción sube para absorberlo (${s.backlog.length} pedidos pendientes).`, foco: ['torno', 'torno2', 'almacen'] };
    return { narrativa: `Entra el doble de pedidos, pero la célula ya trabaja al máximo: los pedidos pendientes crecen (${s.backlog.length}). Mira el almacén y la cola del torno.`, foco: ['almacen', 'torno'] };
  }
  if (c?.id === 'energia') {
    const kw = s.auxKw + s.maq.reduce((a, m) => a + m.kw, 0);
    const eur = kw * precioElec(s.p.ctx, s.t) * 3;
    return {
      narrativa: plan
        ? `Electricidad ×3 con el plan: equipos en espera apagados y consumos auxiliares a horas valle. Ahora: ${kw.toFixed(0)} kW (${eur.toFixed(1)} €/h).`
        : `La electricidad cuesta el triple: la producción no cambia, pero sí el coste. Ahora: ${kw.toFixed(0)} kW (${eur.toFixed(1)} €/h). Mira el KPI «Energía».`,
      foco: [],
    };
  }
  if (!s.maq[1].up) return { narrativa: 'Avería imprevista del torno CNC: mira cómo crece su cola mientras se repara.', foco: ['torno'] };
  if (e.sinMaterial) return { narrativa: 'Falta material: la célula espera a que llegue más barra.', foco: ['almacen'] };
  if (colaTorno > 12) return { narrativa: `El torno CNC es el cuello de botella: su cola ha llegado a ${colaTorno} piezas.`, foco: ['torno'] };
  if (e.t2) return { narrativa: 'Funcionamiento normal, con el torno alternativo también en marcha.', foco: [] };
  return { narrativa: 'Funcionamiento normal. El torno CNC marca el ritmo de la célula: es el cuello de botella.', foco: [] };
}

function potencias(s: MecState): Record<string, number> {
  const out: Record<string, number> = {};
  let total = s.auxKw;
  for (const m of s.maq) {
    out[m.id] = m.kw;
    total += m.kw;
  }
  out.aux = s.auxKw;
  out.total = total;
  return out;
}

// ---------------- Calibración ----------------

/** Ejecuta `horas` de operación y devuelve la producción por hora y el registro de paradas. */
export function producirHoras(p: MecParams, seed: number, horas: number) {
  const s = init(p, seed);
  const serie: number[] = [];
  const paradas: [MaqId, number, number][] = [];
  const abiertas: Partial<Record<MaqId, number>> = {};
  let last = 0;
  let next = 3600;
  let guard = 0;
  while (serie.length < horas && guard++ < 1e6) {
    step(s, 1);
    for (const m of s.maq) {
      if (!m.up && abiertas[m.id] === undefined) abiertas[m.id] = s.workT;
      if (m.up && abiertas[m.id] !== undefined) {
        paradas.push([m.id, abiertas[m.id]!, s.workT]);
        delete abiertas[m.id];
      }
    }
    if (s.workT >= next) {
      serie.push(s.L.good - last);
      last = s.L.good;
      next += 3600;
    }
  }
  return { serie, paradas };
}

const errorRel = (a: number[], b: number[]) => {
  const mean = a.reduce((x, y) => x + y, 0) / a.length || 1;
  return (a.reduce((acc, v, i) => acc + Math.abs(v - b[i]), 0) / a.length / mean) * 100;
};

const cacheCal = new Map<string, ReturnType<typeof calibrarSinCache>>();
export function calibrar(live: MecParams) {
  const key = JSON.stringify(live);
  if (!cacheCal.has(key)) {
    if (cacheCal.size >= 8) cacheCal.clear();
    cacheCal.set(key, calibrarSinCache(live));
  }
  return cacheCal.get(key)!;
}

function calibrarSinCache(live: MecParams) {
  const HORAS = 24;
  // "Realidad": la planta real, con sus paradas (incluye dos paradas largas por cambio de utillaje)
  const real: MecParams = { ...structuredClone(live), layout: 'linea', suministroHora: 80, stockMax: 200, turnos: 1, demandaDia: 520, mtbfH: { ...live.mtbfH, torno: 2.5 } };
  const realRun = producirHoras(real, 7, HORAS);
  const paradas = realRun.paradas;
  paradas.push(['torno', 9.2 * 3600, 10.1 * 3600], ['montaje', 17.5 * 3600, 18.2 * 3600]);
  const realSerie = producirHoras({ ...real, paradasForzadas: paradas }, 7, HORAS).serie;

  // Gemelo "de catálogo": tiempos del fabricante, sin averías ni variabilidad realista
  const catalogo = { corte: 42, torno: 58, torno2: 95, montaje: 50 };
  const base: MecParams = { ...structuredClone(real), ciclo: { ...catalogo }, cv: 0.05, sinAverias: true, paradasForzadas: null };
  const iteraciones: { nombre: string; serie: number[]; error: number; ciclo: Record<string, number>; detalle: string }[] = [];
  const evaluar = (nombre: string, detalle: string, pp: MecParams) => {
    const serie = producirHoras(pp, 11, HORAS).serie;
    iteraciones.push({ nombre, detalle, serie, error: errorRel(realSerie, serie), ciclo: { ...pp.ciclo } });
    return iteraciones[iteraciones.length - 1].error;
  };
  evaluar('Gemelo sin calibrar', 'Tiempos de catálogo, sin averías', base);
  const conParadas: MecParams = { ...base, paradasForzadas: paradas };
  evaluar('Paradas reales', `Se cargan ${paradas.length} paradas registradas`, conParadas);
  // Ajuste del factor de tiempos de ciclo (búsqueda por sección áurea)
  const escala = (k: number): MecParams => ({
    ...conParadas,
    cv: 0.15,
    ciclo: { corte: catalogo.corte * k, torno: catalogo.torno * k, torno2: catalogo.torno2 * k, montaje: catalogo.montaje * k },
  });
  let a = 1.0;
  let b = 1.45;
  const g = 0.618;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = evaluar('Ajuste de ciclos', `factor ×${c.toFixed(2)}`, escala(c));
  let fd = evaluar('Ajuste de ciclos', `factor ×${d.toFixed(2)}`, escala(d));
  for (let i = 0; i < 4; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = evaluar('Ajuste de ciclos', `factor ×${c.toFixed(2)}`, escala(c));
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = evaluar('Ajuste de ciclos', `factor ×${d.toFixed(2)}`, escala(d));
    }
  }
  const kBest = fc < fd ? c : d;
  evaluar('Gemelo calibrado', `factor ×${kBest.toFixed(2)} + paradas reales`, escala(kBest));
  const paradasTorno = paradas.filter((x) => x[0] === 'torno');
  const mttr = paradasTorno.reduce((acc, x) => acc + (x[2] - x[1]), 0) / Math.max(1, paradasTorno.length) / 60;
  return {
    horas: realSerie.map((_, i) => i + 1),
    real: realSerie,
    iteraciones,
    resumen: {
      factor: kBest,
      cicloTorno: [catalogo.torno, catalogo.torno * kBest],
      paradas: paradas.length,
      mtbfTorno: (HORAS / Math.max(1, paradasTorno.length)).toFixed(1),
      mttrTorno: mttr.toFixed(0),
    },
  };
}

// ---------------- Modelo ----------------

const model: TwinModel<MecParams, MecState, MecView> = {
  config,
  dt: 1,
  horizonteComparadorH: 24 * 5,
  horizonteResilienciaH: 6,
  defaultParams,
  scenarioParams(id, live) {
    const p: MecParams = { ...live, demandaDia: 480, suministroHora: 68, stockMax: 140 };
    if (id === 'A') p.turnos = 2;
    if (id === 'B') {
      p.layout = 'linea';
      p.torno2Activo = true;
      p.ciclo = { ...live.ciclo, torno2: live.ciclo.torno, corte: live.ciclo.corte * 0.8, montaje: live.ciclo.montaje * 0.75 };
      p.kw = { ...live.kw, torno2: live.kw.torno };
      p.fijoHora = live.fijoHora + 35;
    }
    return p;
  },
  init,
  step,
  view,
  potencias,
  onCrisis(s) {
    // La avería se ve en el mismo instante en que se provoca
    if (s.crisis?.id === 'averia') s.maq[1].up = false;
  },
  command(s, cmd, args, ctx) {
    if (cmd === 'layout') {
      const v: Layout = args?.v === 'linea' ? 'linea' : 'funcional';
      s.p.layout = v;
      ctx.live.layout = v;
      return { layout: v, funcional: rutaLayout('funcional').longitud, linea: rutaLayout('linea').longitud };
    }
    if (cmd === 'calibrar') return calibrar(ctx.live);
    return null;
  },
};

export default model;
