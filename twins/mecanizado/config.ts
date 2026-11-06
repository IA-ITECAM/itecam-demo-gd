import type { TwinConfig } from '../../core/types';

export type Layout = 'funcional' | 'linea';
export type PuestoId = 'almacen' | 'corte' | 'torno' | 'torno2' | 'montaje' | 'envio';

/** Posiciones (x, z en metros) de cada puesto en cada distribución de planta. */
export const LAYOUTS: Record<Layout, Record<PuestoId, [number, number]>> = {
  funcional: {
    almacen: [-17, -6],
    corte: [10, -7],
    torno: [-9, 7],
    torno2: [-1, 10],
    montaje: [13, 6],
    envio: [-17, 3],
  },
  linea: {
    almacen: [-16, -1],
    corte: [-8, -1],
    torno: [0, -1],
    torno2: [0, 6],
    montaje: [8, -1],
    envio: [16, -1],
  },
};

export const NOMBRES: Record<PuestoId, string> = {
  almacen: 'Almacén de barra',
  corte: 'Sierra de corte',
  torno: 'Torno CNC',
  torno2: 'Torno alternativo',
  montaje: 'Montaje',
  envio: 'Envío',
};

/** Recorrido de la pieza (sin el torno alternativo). */
export const RUTA: PuestoId[] = ['almacen', 'corte', 'torno', 'montaje', 'envio'];

export const config: TwinConfig = {
  id: 'mecanizado',
  orden: 1,
  titulo: 'Mecanizado',
  subtitulo: 'Pyme metalmecánica',
  sector: 'Metalmecánica',
  descripcion:
    'Célula con almacén, corte, torno, montaje y envío. Tiempos de ciclo variables, averías, colas visibles, cambio de distribución y calibración contra datos reales.',
  unidad: 'pieza',
  unidadPlural: 'piezas',
  equipoCritico: 'torno',
  crisis: [
    {
      id: 'averia',
      titulo: 'Avería del torno',
      detalle: 'El torno CNC, la máquina crítica, queda parado 2,5 h.',
      plan: 'Redirigir las piezas al torno alternativo, ya validado en el gemelo (más lento, pero produce).',
      metrica: 'produccion',
      duracionH: 2.5,
    },
    {
      id: 'proveedor',
      titulo: 'El proveedor no entrega',
      detalle: 'No llega barra de acero durante 5 h.',
      plan: 'Usar el stock de seguridad que se dimensionó con el gemelo (+150 piezas de material).',
      metrica: 'produccion',
      duracionH: 5,
    },
    {
      id: 'demanda',
      titulo: 'Pico de demanda',
      detalle: 'Entra el doble de pedidos durante 3 h.',
      plan: 'Abrir el torno alternativo y añadir un segundo carro de transporte interno.',
      metrica: 'produccion',
      duracionH: 3,
    },
    {
      id: 'energia',
      titulo: 'Sube el precio de la energía',
      detalle: 'La electricidad cuesta el triple durante 6 h.',
      plan: 'Apagar equipos en espera y desplazar consumos auxiliares (compresor, aspiración) a horas valle.',
      metrica: 'coste',
      duracionH: 6,
    },
  ],
  comparador: {
    titulo: 'Crece la demanda de una referencia',
    pregunta: 'La demanda de la referencia pasa de 250 a 480 piezas al día. ¿Cómo la atendemos?',
    horizonte: 'Proyección de 5 días · misma semilla en los tres escenarios',
    escenarios: [
      { id: 'base', titulo: 'Base', detalle: 'Sin cambios: 1 turno y la misma célula.' },
      { id: 'A', titulo: 'A · Segundo turno', detalle: 'Se añade turno de tarde (con plus). Sin inversión.' },
      {
        id: 'B',
        titulo: 'B · Nueva célula',
        detalle: 'Célula en línea con segundo torno y montaje más rápido. Más inversión (amortizada en el coste).',
      },
    ],
  },
};

export default config;
