import type { TwinConfig } from '../../core/types';

/** Geometría del almacén (m). El origen está en el centro de la nave. */
export const NAVE = { ancho: 64, fondo: 42 };
/** Centros (z) de las filas de estanterías y bloques (x) de cada fila. */
export const FILAS_Z = [-14, -8, -2, 4, 10];
export const BLOQUES_X: [number, number][] = [
  [-18, -2],
  [2, 18],
];
/** Pasillos (z) por los que circulan los AGV, incluidas las bandas superior e inferior. */
export const PASILLOS_Z = [-17, -11, -5, 1, 7, 13, 19];
/** Pasillos transversales (x). */
export const TRANSVERSALES_X = [-24, 0, 24];
export const MUELLES_RECEPCION: [number, number][] = [-17, -11, -5, 1, 7, 13].map((z) => [-29, z]);
export const MUELLES_EXPEDICION: [number, number][] = [-17, -11, -5, 1, 7, 13].map((z) => [29, z]);
export const CARGADORES: [number, number][] = [
  [-6, 19],
  [0, 19],
  [6, 19],
];
export const RESERVA: [number, number] = [-19, 19];

export const config: TwinConfig = {
  id: 'almacen',
  orden: 2,
  titulo: 'Almacén y logística',
  subtitulo: 'Centro de distribución',
  sector: 'Logística',
  descripcion:
    'Estanterías, recepción, expedición y una flota de AGV que se mueve por rutas. Picos de demanda, baterías, averías y la pregunta clave: ¿cuántos AGV necesito?',
  unidad: 'pedido',
  unidadPlural: 'pedidos',
  equipoCritico: 'agv1',
  crisis: [
    {
      id: 'averia',
      titulo: 'Avería de AGV',
      detalle: 'Dos AGV quedan averiados durante 2 h.',
      plan: 'Activar dos carretillas manuales de apoyo y reasignar las tareas por prioridad, como se ensayó en el gemelo.',
      metrica: 'produccion',
      duracionH: 2,
    },
    {
      id: 'proveedor',
      titulo: 'El proveedor no entrega',
      detalle: 'No llegan camiones durante 4 h: cada vez más referencias se quedan sin stock.',
      plan: 'Servir los pedidos sin stock desde la zona de reserva (stock de seguridad), aunque el recorrido sea más largo.',
      metrica: 'produccion',
      duracionH: 4,
    },
    {
      id: 'demanda',
      titulo: 'Pico de demanda',
      detalle: 'Entran el doble de pedidos durante 2,5 h.',
      plan: 'Sumar la carretilla manual de apoyo a la preparación de pedidos mientras dura el pico.',
      metrica: 'produccion',
      duracionH: 2.5,
    },
    {
      id: 'energia',
      titulo: 'Sube el precio de la energía',
      detalle: 'La electricidad cuesta el triple durante 6 h.',
      plan: 'Cargar baterías solo cuando es imprescindible y apagar por zonas la iluminación de pasillos sin actividad.',
      metrica: 'coste',
      duracionH: 6,
    },
  ],
  comparador: {
    titulo: '¿Cuántos AGV necesito?',
    pregunta: 'Con la demanda actual y sus picos, ¿ampliamos la flota o reorganizamos el almacén?',
    horizonte: 'Proyección de 1 día (2 turnos) · misma semilla en los tres escenarios',
    escenarios: [
      { id: 'base', titulo: 'Base · 5 AGV', detalle: 'Flota actual, ubicación aleatoria de referencias.' },
      { id: 'A', titulo: 'A · 7 AGV', detalle: 'Se compran 2 AGV más (más coste fijo).' },
      { id: 'B', titulo: 'B · 5 AGV + reorganización', detalle: 'Misma flota, pero las referencias de alta rotación se recolocan cerca de expedición (ABC).' },
    ],
  },
};

export default config;
