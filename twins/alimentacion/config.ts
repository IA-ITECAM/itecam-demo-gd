import type { TwinConfig } from '../../core/types';

export type EquipoId = 'dosificado' | 'horno' | 'enfriamiento' | 'envasado' | 'paletizado';

/** Disposición de la línea (x en metros; la línea va a lo largo del eje x). */
export const LINEA = {
  dosificado: -27,
  horno: { x0: -21, x1: -7 },
  enfriamiento: { x0: -3, x1: 11 },
  buffer: { x0: 11.5, x1: 16 },
  envasado: 18,
  paletizado: 25,
};

export const NOMBRES: Record<EquipoId, string> = {
  dosificado: 'Dosificación',
  horno: 'Horno túnel',
  enfriamiento: 'Túnel de enfriamiento',
  envasado: 'Envasadora',
  paletizado: 'Paletizado',
};

export const config: TwinConfig = {
  id: 'alimentacion',
  orden: 3,
  titulo: 'Alimentación y envasado',
  subtitulo: 'Energía y sostenibilidad',
  sector: 'Agroalimentario',
  descripcion:
    'Línea de horno, enfriamiento, envasado y paletizado. Consumo energético por equipo visible en 3D y en gráfica. Dos formas de producir lo mismo: misma producción y coste, mucha menos energía.',
  unidad: 'caja',
  unidadPlural: 'cajas',
  equipoCritico: 'horno',
  crisis: [
    {
      id: 'averia',
      titulo: 'Avería del horno',
      detalle: 'El horno túnel se para 2 h y se pierde el producto que había dentro.',
      plan: 'Reparación exprés con el kit de repuestos críticos definido con el gemelo y rearranque en modo degradado al 70 %.',
      metrica: 'produccion',
      duracionH: 2,
    },
    {
      id: 'proveedor',
      titulo: 'El proveedor no entrega',
      detalle: 'No llega materia prima durante 5 h.',
      plan: 'Usar el stock de seguridad y la receta alternativa ya validada en el gemelo.',
      metrica: 'produccion',
      duracionH: 5,
    },
    {
      id: 'demanda',
      titulo: 'Pico de demanda',
      detalle: 'Los pedidos suben un 60 % durante 4 h.',
      plan: 'Subir la cadencia de la línea al máximo validado (+13 %) sin superar la capacidad del horno.',
      metrica: 'produccion',
      duracionH: 4,
    },
    {
      id: 'energia',
      titulo: 'Sube el precio de la energía',
      detalle: 'La electricidad cuesta el triple durante 8 h. Sin plan, se recorta producción en las horas caras.',
      plan: 'Mantener la producción y desplazar el consumo del frío a horas valle con acumulación térmica.',
      metrica: 'produccion',
      duracionH: 8,
    },
  ],
  comparador: {
    titulo: 'Producir lo mismo con menos energía',
    pregunta: 'Hay que renovar el horno. ¿Horno de gas nuevo (A) o horno eléctrico con bomba de calor y recuperación de calor del frío (B)?',
    horizonte: 'Proyección de 24 h · misma semilla y misma producción objetivo',
    escenarios: [
      { id: 'base', titulo: 'Base · Horno actual', detalle: 'Horno de gas antiguo, sin recuperación de calor.' },
      { id: 'A', titulo: 'A · Horno de gas nuevo', detalle: 'Quemadores modernos. Inversión moderada.' },
      { id: 'B', titulo: 'B · Eléctrico + bomba de calor', detalle: 'Horno eléctrico y recuperación del calor del túnel de frío. Algo más de inversión.' },
    ],
  },
};

export default config;
