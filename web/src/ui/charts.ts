/** Ayudas para Chart.js (solo se registran los componentes que se usan). */
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Legend,
  Tooltip,
  BarController,
  BarElement,
  type ChartDataset,
} from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Legend, Tooltip, BarController, BarElement);
Chart.defaults.font.family = '"Segoe UI", "Inter", system-ui, -apple-system, sans-serif';
Chart.defaults.font.size = 14;
Chart.defaults.color = '#3b4757';
Chart.defaults.animation = false;
Chart.defaults.maintainAspectRatio = false;

export const C = {
  tinta: '#0E1A2B',
  teal: '#0B7373',
  tealSuave: 'rgba(11,115,115,0.20)',
  naranja: '#E8731A',
  naranjaSuave: 'rgba(232,115,26,0.18)',
  gris: '#8A96A3',
  rejilla: 'rgba(14,26,43,0.08)',
  azul: '#3B7DD8',
  morado: '#7B5EA7',
  oliva: '#8A9A3B',
  rojo: '#D63B2F',
};

export const SERIE_COLORES = [C.naranja, C.teal, C.azul, C.morado, C.oliva, C.gris, C.rojo];

export interface LineOpts {
  yTitulo?: string;
  xTitulo?: string;
  stacked?: boolean;
  leyenda?: boolean;
  yMin?: number;
  maxTicksX?: number;
}

export function lineChart(canvas: HTMLCanvasElement, datasets: ChartDataset<'line'>[], o: LineOpts = {}) {
  return new Chart(canvas, {
    type: 'line',
    data: { labels: [], datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      elements: { point: { radius: 0, hitRadius: 6 }, line: { tension: 0.25, borderWidth: 2.5 } },
      plugins: {
        legend: { display: o.leyenda ?? datasets.length > 1, position: 'bottom', labels: { boxWidth: 14, padding: 12 } },
        tooltip: { enabled: true },
      },
      scales: {
        x: {
          grid: { color: C.rejilla },
          ticks: { maxTicksLimit: o.maxTicksX ?? 6, maxRotation: 0 },
          title: { display: !!o.xTitulo, text: o.xTitulo ?? '' },
        },
        y: {
          stacked: o.stacked,
          grid: { color: C.rejilla },
          min: o.yMin,
          beginAtZero: true,
          title: { display: !!o.yTitulo, text: o.yTitulo ?? '' },
        },
      },
    },
  });
}

export function setData(chart: Chart, labels: (string | number)[], series: number[][]) {
  chart.data.labels = labels;
  series.forEach((d, i) => {
    if (chart.data.datasets[i]) chart.data.datasets[i].data = d;
  });
  chart.update('none');
}

/** Reajusta la gráfica cada vez que cambia el tamaño de su caja (paneles elásticos sin scroll). */
export function seguirTamano(chart: Chart) {
  const caja = chart.canvas.parentElement;
  if (!caja) return;
  const ro = new ResizeObserver(() => {
    if (!caja.isConnected) return ro.disconnect();
    chart.resize();
  });
  ro.observe(caja);
}

export { Chart };
