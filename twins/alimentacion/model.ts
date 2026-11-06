/**
 * Gemelo de alimentación: dosificación → horno túnel → enfriamiento → acumulación → envasado → paletizado.
 * Producción continua 24 h. El foco es el consumo energético por equipo, el coste y las emisiones.
 */
import { makeRng, cycle, chance, poisson, nuevoFallos, avanzarFallos, semillaEquipo, type Fallos } from '../../core/rng';
import { newLedger, addEnergy } from '../../core/kpis';
import { contextoSimulado, precioElec, temperatura, esValle, PRECIO_GAS } from '../../core/energy';
import type { BaseState, BaseView, CommonParams, Equipo, Alerta, TwinModel, EstadoEquipo } from '../../core/types';
import { crisisActiva, planActivo } from '../../core/types';
import { config, LINEA, NOMBRES, type EquipoId } from './config';

export type Tecnologia = 'actual' | 'gasNuevo' | 'electrico';

interface PerfilHorno {
  fuente: 'gas' | 'elec';
  idleKw: number;
  varKw: number;
  residenciaMin: number;
  frioIdle: number;
  frioVar: number;
  fijoHora: number;
}

export const TECNOLOGIAS: Record<Tecnologia, PerfilHorno> = {
  actual: { fuente: 'gas', idleKw: 190, varKw: 150, residenciaMin: 8, frioIdle: 45, frioVar: 25, fijoHora: 18 },
  gasNuevo: { fuente: 'gas', idleKw: 150, varKw: 135, residenciaMin: 8, frioIdle: 45, frioVar: 25, fijoHora: 26 },
  electrico: { fuente: 'elec', idleKw: 55, varKw: 80, residenciaMin: 9, frioIdle: 28, frioVar: 16, fijoHora: 30 },
};

const TRANSFER1_S = 30;
const TRANSFER2_S = 20;
const ENFRIAMIENTO_S = 12 * 60;
const BUFFER_MAX = 50;
const CAJAS_PALE = 40;
const SLA_S = 2 * 3600;

export interface AliParams extends CommonParams {
  tecnologia: Tecnologia;
  ritmo: number; // cajas/h nominal
  ritmoMax: number;
  demandaHora: number;
  cicloEnvasado: number;
  mtbfEnvasadoH: number;
  mttrEnvasadoMin: number;
  mtbfHornoH: number;
  mttrHornoMin: number;
  operarios: number;
  costeHora: number;
  suministroHora: number;
  stockMax: number;
  merma: number;
}

type Seccion = 0 | 1 | 2 | 3 | 4 | 5; // 0 transfer1, 1 horno, 2 transfer2, 3 frío, 4 acumulación, 5 envasado

interface Bandeja {
  id: number;
  sec: Seccion;
  el: number;
  t0: number;
}

interface Maquina {
  up: boolean;
  downRem: number;
  forzada: boolean;
  kw: number;
  ocupEma: number;
  fallos: Fallos;
}

export interface AliState extends BaseState<AliParams> {
  bandejas: Bandeja[];
  nextId: number;
  feedAcc: number;
  stock: number;
  seguridad: number;
  maq: Record<EquipoId, Maquina>;
  envasando: Bandeja | null;
  envRem: number;
  cajasPale: number;
  pales: number;
  dues: number[];
  pedidos: number;
  factorRitmo: number;
  auxKw: number;
}

export interface AliView extends BaseView {
  /** [id, x, sección] */
  bandejas: number[];
  cajasPale: number;
  pales: number;
  stock: number;
  stockMax: number;
  tecnologia: Tecnologia;
  kwTotal: number;
  precio: number;
  fuenteHorno: 'gas' | 'elec';
  factorRitmo: number;
}

const EQUIPOS: EquipoId[] = ['dosificado', 'horno', 'enfriamiento', 'envasado', 'paletizado'];

function defaultParams(): AliParams {
  return {
    ctx: contextoSimulado(),
    tecnologia: 'actual',
    ritmo: 300,
    ritmoMax: 340,
    demandaHora: 285,
    cicloEnvasado: 10.4,
    mtbfEnvasadoH: 4,
    mttrEnvasadoMin: 12,
    mtbfHornoH: 30,
    mttrHornoMin: 40,
    operarios: 6,
    costeHora: 26,
    suministroHora: 320,
    stockMax: 900,
    merma: 0.01,
  };
}

function init(p: AliParams, seed: number): AliState {
  const maq = {} as Record<EquipoId, Maquina>;
  EQUIPOS.forEach((e, i) => {
    const mtbf = (e === 'horno' ? p.mtbfHornoH : p.mtbfEnvasadoH) * 3600;
    maq[e] = { up: true, downRem: 0, forzada: false, kw: 0, ocupEma: 0, fallos: nuevoFallos(semillaEquipo(seed, i + 1), mtbf) };
  });
  return {
    t: 0,
    workT: 0,
    rng: makeRng(seed),
    p,
    L: newLedger(),
    crisis: null,
    bandejas: [],
    nextId: 1,
    feedAcc: 0,
    stock: p.stockMax,
    seguridad: 700,
    maq,
    envasando: null,
    envRem: 0,
    cajasPale: 0,
    pales: 0,
    dues: [],
    pedidos: 0,
    factorRitmo: 1,
    auxKw: 12,
  };
}

const residencia = (p: AliParams) => TECNOLOGIAS[p.tecnologia].residenciaMin * 60;

function hornoParado(s: AliState): boolean {
  if (crisisActiva(s, 'averia')) {
    // Con plan: reparación exprés en 45 min
    if (!s.crisis!.plan) return true;
    return s.workT - s.crisis!.w0 < 45 * 60;
  }
  return !s.maq.horno.up;
}

function step(s: AliState, dt: number) {
  const p = s.p;
  const r = s.rng;
  const L = s.L;
  s.t += dt;
  s.workT += dt;
  L.workS += dt;

  // --- Pedidos
  const fDem = crisisActiva(s, 'demanda') ? 1.6 : 1;
  const n = poisson(r, p.demandaHora * fDem, dt);
  for (let i = 0; i < n; i++) s.dues.push(s.workT + SLA_S);
  s.pedidos += n;
  while (s.dues.length && s.dues[0] <= s.workT) {
    s.dues.shift();
    L.servDen++;
  }

  // --- Materia prima
  if (!crisisActiva(s, 'proveedor')) s.stock = Math.min(p.stockMax, s.stock + (p.suministroHora * dt) / 3600);

  // --- Cadencia
  let ritmo = p.ritmo;
  if (planActivo(s, 'demanda')) ritmo = p.ritmoMax;
  const caro = crisisActiva(s, 'energia') && !esValle(p.ctx, s.t);
  if (caro && !s.crisis!.plan) ritmo *= 0.55; // sin plan: se recorta producción en horas caras
  if (crisisActiva(s, 'averia') && s.crisis!.plan && !hornoParado(s)) ritmo *= 0.7; // modo degradado
  s.factorRitmo = ritmo / p.ritmo;

  // --- Horno: averías aleatorias
  const h = s.maq.horno;
  if (!h.up) {
    h.downRem -= dt;
    if (h.downRem <= 0) h.up = true;
  } else if (!crisisActiva(s, 'averia')) {
    const rep = avanzarFallos(h.fallos, dt, p.mtbfHornoH * 3600, p.mttrHornoMin * 60);
    if (rep > 0) {
      h.up = false;
      h.downRem = rep;
      mermarHorno(s, 0.5);
    }
  }
  const hornoOff = hornoParado(s);

  // --- Alimentación de bandejas
  const enAcum = s.bandejas.filter((b) => b.sec === 4).length;
  let sinMaterial = false;
  if (!hornoOff && enAcum < BUFFER_MAX) {
    s.feedAcc += (ritmo * dt) / 3600;
    while (s.feedAcc >= 1) {
      if (s.stock >= 1) s.stock -= 1;
      else if (planActivo(s, 'proveedor') && s.seguridad >= 1) s.seguridad -= 1;
      else {
        sinMaterial = true;
        s.feedAcc = Math.min(s.feedAcc, 1);
        break;
      }
      s.feedAcc -= 1;
      s.bandejas.push({ id: s.nextId++, sec: 0, el: 0, t0: s.workT });
    }
  } else s.feedAcc = 0;

  // --- Avance de bandejas
  const R = residencia(p);
  const dur: Record<number, number> = { 0: TRANSFER1_S, 1: R, 2: TRANSFER2_S, 3: ENFRIAMIENTO_S };
  for (const b of s.bandejas) {
    if (b.sec >= 4) continue;
    if (b.sec === 1 && hornoOff) continue; // la cinta del horno se detiene
    b.el += dt;
    if (b.el >= dur[b.sec]) {
      b.sec = (b.sec + 1) as Seccion;
      b.el = 0;
    }
  }
  // Tiempo en horno (referencia OEE: el horno es el equipo crítico)
  L.oPlan += dt;
  if (!hornoOff) L.oUp += dt;
  const enHorno = s.bandejas.filter((b) => b.sec === 1).length;
  const capHorno = (R * p.ritmo) / 3600; // bandejas a ritmo nominal
  L.oIdeal += dt * Math.min(1, enHorno / capHorno);

  // --- Envasadora
  const env = s.maq.envasado;
  if (!env.up) {
    env.downRem -= dt;
    if (env.downRem <= 0) env.up = true;
  }
  let envasando = false;
  if (env.up) {
    if (!s.envasando) {
      const i = s.bandejas.findIndex((b) => b.sec === 4);
      if (i >= 0) {
        s.envasando = s.bandejas[i];
        s.envasando.sec = 5;
        s.envRem = cycle(r, p.cicloEnvasado, 0.08);
      }
    }
    if (s.envasando) {
      envasando = true;
      s.envRem -= dt;
      const rep = avanzarFallos(env.fallos, dt, p.mtbfEnvasadoH * 3600, p.mttrEnvasadoMin * 60);
      if (rep > 0) {
        env.up = false;
        env.downRem = rep;
      } else if (s.envRem <= 0) {
        const b = s.envasando;
        s.envasando = null;
        s.bandejas.splice(s.bandejas.indexOf(b), 1);
        L.processed++;
        if (chance(r, p.merma)) L.scrap++;
        else {
          L.good++;
          L.servNum++;
          L.leadSum += s.workT - b.t0;
          L.leadN++;
          s.cajasPale++;
          if (s.cajasPale >= CAJAS_PALE) {
            s.cajasPale = 0;
            s.pales++;
          }
        }
      }
    }
  }

  // --- Energía por equipo
  const perfil = TECNOLOGIAS[p.tecnologia];
  const precioE = precioElec(p.ctx, s.t) * (crisisActiva(s, 'energia') ? 3 : 1);
  const precioG = PRECIO_GAS;
  const carga = Math.min(1.2, enHorno / capHorno);
  const tExt = temperatura(p.ctx, s.t);
  const fTemp = 1 + 0.02 * (tExt - 15);
  const enFrio = s.bandejas.filter((b) => b.sec === 3).length;
  const cargaFrio = Math.min(1.2, enFrio / ((ENFRIAMIENTO_S * p.ritmo) / 3600));
  let frioKw = (perfil.frioIdle + perfil.frioVar * cargaFrio) * fTemp;
  if (planActivo(s, 'energia') && !esValle(p.ctx, s.t)) frioKw *= 0.55; // acumulación térmica: el frío se hace en valle
  if (planActivo(s, 'energia') && esValle(p.ctx, s.t)) frioKw *= 1.25;
  const kw: Record<EquipoId, number> = {
    dosificado: s.feedAcc > 0 || (!hornoOff && !sinMaterial) ? 6 : 2,
    horno: hornoOff ? perfil.idleKw * 0.35 : perfil.idleKw + perfil.varKw * carga,
    enfriamiento: frioKw,
    envasado: envasando ? 18 : env.up ? 5 : 2,
    paletizado: envasando ? 8 : 2,
  };
  for (const e of EQUIPOS) {
    s.maq[e].kw = kw[e];
    const fuente = e === 'horno' ? perfil.fuente : 'elec';
    addEnergy(L, kw[e], dt, fuente, fuente === 'gas' ? precioG : precioE);
  }
  s.auxKw = 12;
  addEnergy(L, s.auxKw, dt, 'elec', precioE);
  // Utilización (media móvil)
  const ocup: Record<EquipoId, number> = {
    dosificado: hornoOff || sinMaterial ? 0 : s.factorRitmo,
    horno: hornoOff ? 0 : Math.min(1, carga),
    enfriamiento: Math.min(1, cargaFrio),
    envasado: envasando ? 1 : 0,
    paletizado: envasando ? 0.6 : 0,
  };
  for (const e of EQUIPOS) s.maq[e].ocupEma += (ocup[e] - s.maq[e].ocupEma) * Math.min(1, dt / 600);
  s.maq.dosificado.forzada = sinMaterial;

  // --- Costes
  L.laborCost += (p.operarios * p.costeHora * dt) / 3600;
  L.fixedCost += (perfil.fijoHora * dt) / 3600;
}

/** Se pierde una fracción del producto que hay dentro del horno. */
function mermarHorno(s: AliState, frac: number) {
  const dentro = s.bandejas.filter((b) => b.sec === 1);
  for (const b of dentro) {
    if (chance(s.rng, frac)) {
      s.bandejas.splice(s.bandejas.indexOf(b), 1);
      s.L.scrap++;
      s.L.processed++;
    }
  }
}

function onCrisis(s: AliState) {
  if (s.crisis?.id === 'averia') mermarHorno(s, 1);
}

function posBandeja(s: AliState, b: Bandeja, idxAcum: number): number {
  const R = residencia(s.p);
  switch (b.sec) {
    case 0:
      return LINEA.dosificado + 1.5 + (LINEA.horno.x0 - LINEA.dosificado - 1.5) * (b.el / TRANSFER1_S);
    case 1:
      return LINEA.horno.x0 + (LINEA.horno.x1 - LINEA.horno.x0) * (b.el / R);
    case 2:
      return LINEA.horno.x1 + (LINEA.enfriamiento.x0 - LINEA.horno.x1) * (b.el / TRANSFER2_S);
    case 3:
      return LINEA.enfriamiento.x0 + (LINEA.enfriamiento.x1 - LINEA.enfriamiento.x0) * (b.el / ENFRIAMIENTO_S);
    case 4:
      return LINEA.buffer.x1 - idxAcum * 0.5;
    default:
      return LINEA.envasado;
  }
}

function view(s: AliState): AliView {
  const p = s.p;
  const bandejas: number[] = [];
  let acum = 0;
  for (const b of s.bandejas) {
    const x = posBandeja(s, b, b.sec === 4 ? acum++ : 0);
    bandejas.push(b.id, +x.toFixed(2), b.sec);
  }
  const hornoOff = hornoParado(s);
  const env = s.maq.envasado;
  const sinMat = s.maq.dosificado.forzada;
  const estado: Record<EquipoId, EstadoEquipo> = {
    dosificado: sinMat ? 'sin_material' : hornoOff ? 'esperando' : 'trabajando',
    horno: hornoOff ? 'averia' : 'trabajando',
    enfriamiento: 'trabajando',
    envasado: !env.up ? 'averia' : s.envasando ? (acum > 35 ? 'alerta' : 'trabajando') : 'esperando',
    paletizado: s.envasando ? 'trabajando' : 'esperando',
  };
  const perfil = TECNOLOGIAS[p.tecnologia];
  const precio = precioElec(p.ctx, s.t) * (crisisActiva(s, 'energia') ? 3 : 1);
  const equipos: Equipo[] = EQUIPOS.map((e) => {
    const m = s.maq[e];
    const fuente = e === 'horno' ? perfil.fuente : 'elec';
    const extra: Record<string, string | number> = {
      Fuente: fuente === 'gas' ? 'Gas natural' : 'Electricidad',
      'Coste ahora': `${((m.kw * (fuente === 'gas' ? PRECIO_GAS : precio))).toFixed(1)} €/h`,
    };
    if (e === 'dosificado') {
      extra['Materia prima'] = `${Math.floor(s.stock)} cajas`;
      extra['Stock de seguridad'] = planActivo(s, 'proveedor') ? `${Math.floor(s.seguridad)} (en uso)` : 'reservado';
      extra['Cadencia'] = `${Math.round(p.ritmo * s.factorRitmo)} cajas/h`;
    }
    if (e === 'horno') {
      extra['Tecnología'] = p.tecnologia === 'actual' ? 'Gas (antiguo)' : p.tecnologia === 'gasNuevo' ? 'Gas (nuevo)' : 'Eléctrico + bomba de calor';
      extra['Tiempo de cocción'] = `${perfil.residenciaMin} min`;
    }
    if (e === 'enfriamiento') extra['Temperatura exterior'] = `${temperatura(p.ctx, s.t).toFixed(1)} °C`;
    if (e === 'paletizado') {
      extra['Palés completos'] = s.pales;
      extra['Cajas en palé actual'] = `${s.cajasPale} / ${CAJAS_PALE}`;
    }
    return { id: e, nombre: NOMBRES[e], estado: estado[e], util: m.ocupEma, kw: m.kw, cola: e === 'envasado' ? acum : undefined, extra };
  });
  const alertas: Alerta[] = [];
  if (hornoOff) alertas.push({ nivel: 'critico', texto: 'Horno parado' });
  if (!env.up) alertas.push({ nivel: 'critico', texto: 'Envasadora averiada' });
  if (sinMat) alertas.push({ nivel: 'critico', texto: 'Sin materia prima' });
  else if (s.stock < 150 && !planActivo(s, 'proveedor')) alertas.push({ nivel: 'aviso', texto: 'Materia prima baja' });
  if (acum > 35) alertas.push({ nivel: 'aviso', texto: `Acumulación antes de envasado: ${acum}` });
  if (crisisActiva(s, 'energia')) alertas.push({ nivel: 'aviso', texto: s.crisis!.plan ? 'Precio ×3: frío desplazado a valle' : `Precio ×3: cadencia al ${Math.round(s.factorRitmo * 100)} %` });
  if (crisisActiva(s, 'demanda')) alertas.push({ nivel: 'aviso', texto: 'Pedidos +60 %' });
  const kwTotal = EQUIPOS.reduce((a, e) => a + s.maq[e].kw, s.auxKw);
  return {
    equipos,
    alertas,
    bandejas,
    cajasPale: s.cajasPale,
    pales: s.pales,
    stock: s.stock,
    stockMax: p.stockMax,
    tecnologia: p.tecnologia,
    kwTotal,
    precio,
    fuenteHorno: perfil.fuente,
    factorRitmo: s.factorRitmo,
  };
}

function potencias(s: AliState): Record<string, number> {
  const out: Record<string, number> = {};
  let total = s.auxKw;
  for (const e of EQUIPOS) {
    out[e] = +s.maq[e].kw.toFixed(1);
    total += s.maq[e].kw;
  }
  out.servicios = s.auxKw;
  out.total = +total.toFixed(1);
  return out;
}

const model: TwinModel<AliParams, AliState, AliView> = {
  config,
  dt: 1,
  horizonteComparadorH: 24,
  horizonteResilienciaH: 10,
  defaultParams,
  scenarioParams(id, live) {
    return { ...live, tecnologia: id === 'A' ? 'gasNuevo' : id === 'B' ? 'electrico' : 'actual' };
  },
  init,
  step,
  view,
  potencias,
  onCrisis,
};

export default model;
