/**
 * Página de un gemelo: barra superior, escena 3D, panel lateral con KPIs y gráficas,
 * crisis, comparador de escenarios, ficha de equipo y modo presentación.
 */
import type { TwinConfig, Equipo, ScenarioId } from '../../core/types';
import type { Kpis } from '../../core/kpis';
import { crearConexion } from './net';
import { BASE } from './base';
import { loadScene } from './registry';
import { SceneKit, COLOR_ESTADO, TEXTO_ESTADO } from './kit/scene-kit';
import type { TwinApi, TwinSceneHandle } from './kit/types';
import { lineChart, setData, C, type Chart } from './ui/charts';
import { fmt, fmtMin, el, esc } from './ui/format';
import { ResilienceModal } from './ui/resilience';
import { ComparatorModal } from './ui/comparator';

const ICONO_CRISIS: Record<string, string> = { averia: '🔧', proveedor: '🚚', demanda: '📈', energia: '⚡' };
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function renderTwin(root: HTMLElement, cfg: TwinConfig): () => void {
  document.title = `${cfg.titulo} · Gemelo digital`;
  const page = el('div', 'twin-page');
  page.innerHTML = `
    <header class="topbar">
      <a class="btn" href="${BASE}" data-link title="Volver al menú">← Menú</a>
      <div class="tb-title"><b>${esc(cfg.titulo)}</b><span>${esc(cfg.subtitulo)}</span></div>
      <div class="tb-clock">—</div>
      <div class="seg sec" role="group" aria-label="Velocidad">
        <button data-v="1" title="×1 (tecla 1)">×1</button><button data-v="5" title="×5 (tecla 5)">×5</button><button data-v="20" title="×20 (tecla 2)">×20</button>
      </div>
      <button class="btn btn-pausa" title="Pausa (espacio)">⏸ Pausa</button>
      <button class="btn sec btn-reset" title="Reiniciar con la misma semilla">↺ Reiniciar</button>
      <div class="tb-esc">En 3D: <b>Base</b> <button class="btn btn-base hidden" title="Volver a la situación actual">↺ Actual</button></div>
      <div class="tb-spacer"></div>
      <button class="btn sec tb-datos" title="Activar o desactivar datos públicos (REData y Open-Meteo)"><i class="dot sim"></i> Datos simulados</button>
      <span class="vr-slot sec"></span>
      <button class="btn btn-pres" title="Modo presentación (P)">⛶ Presentación</button>
      <i class="conn" title="Conexión con el servidor"></i>
    </header>
    <div class="twin-body">
      <section class="viewport">
        <div class="canvas-host"></div>
        <div class="alerts"></div>
        <div class="crisis-banner hidden"></div>
        <div class="ficha hidden"></div>
        <div class="narrativa" aria-live="polite"><b>Qué está pasando</b><span></span></div>
        <div class="legend sec"></div>
        <div class="hint sec">Arrastra para girar · rueda para zoom · clic en un equipo para ver su ficha</div>
      </section>
      <aside class="side">
        <div class="kpis"></div>
        <div class="card"><h3>Ritmo de producción <small>${esc(cfg.unidadPlural)}/h · <span style="color:var(--naranja);font-weight:700">naranja = en crisis</span></small></h3><div class="chart-box"><canvas class="ch-prod"></canvas></div></div>
        <nav class="tabs"></nav>
        <div class="tab-body"></div>
      </aside>
    </div>`;
  root.appendChild(page);

  const $ = <T extends HTMLElement = HTMLElement>(s: string) => page.querySelector(s) as T;
  const socket = crearConexion(cfg.id);
  const resModal = new ResilienceModal(page);
  const cmpModal = new ComparatorModal(page, cfg);
  let lastFrame: any = null;
  let lastView: any = null;
  let series: any[] = [];
  let handle: TwinSceneHandle | null = null;
  let kit: SceneKit | null = null;
  let fichaId: string | null = null;
  let disposed = false;
  const msgHandlers: ((m: any) => void)[] = [];
  const historial = new Map<string, { util: number[]; kw: number[] }>();
  let frameCount = 0;

  // ---------- Leyenda de estados ----------
  $('.legend').innerHTML = (['trabajando', 'esperando', 'averia', 'sin_material', 'inactivo'] as const)
    .map((k) => `<span><i style="background:${hex(COLOR_ESTADO[k])}"></i>${TEXTO_ESTADO[k]}</span>`)
    .join('');

  // ---------- KPIs ----------
  const KPI_CARDS: { key: string; label: string; dir: '↑' | '↓'; ancho?: boolean }[] = [
    { key: 'ritmo', label: 'Producción', dir: '↑' },
    { key: 'oee', label: 'OEE', dir: '↑' },
    { key: 'coste', label: `Coste por ${cfg.unidad}`, dir: '↓' },
    { key: 'servicio', label: 'Nivel de servicio', dir: '↑' },
    { key: 'energia', label: 'Energía consumida', dir: '↓' },
    { key: 'co2', label: 'Emisiones estimadas', dir: '↓' },
    { key: 'plazo', label: 'Plazo medio', dir: '↓', ancho: true },
  ];
  const kpiBox = $('.kpis');
  const kpiEls: Record<string, { v: HTMLElement; s: HTMLElement; card: HTMLElement }> = {};
  for (const k of KPI_CARDS) {
    const card = el('div', `kpi${k.ancho ? ' ancho' : ''}`);
    card.innerHTML = `<div class="kpi-l"><span>${esc(k.label)}</span><span class="dir" title="${k.dir === '↑' ? 'Más es mejor' : 'Menos es mejor'}">${k.dir}</span></div><div class="kpi-v">—</div><div class="kpi-s"></div>`;
    kpiBox.appendChild(card);
    kpiEls[k.key] = { v: card.querySelector('.kpi-v')!, s: card.querySelector('.kpi-s')!, card };
  }
  function renderKpis(f: any) {
    const k: Kpis = f.kpis;
    const set = (key: string, v: string, s: string, mal = false) => {
      kpiEls[key].v.innerHTML = v;
      kpiEls[key].s.textContent = s;
      kpiEls[key].card.classList.toggle('mal', mal);
    };
    set('ritmo', `${fmt(f.ritmo, 0)}<small>${cfg.unidadPlural}/h</small>`, `${fmt(k.unidades)} ${cfg.unidadPlural} en total · media ${fmt(k.produccionHora, 1)}/h`);
    set('oee', `${fmt(k.oee, 1)}<small>%</small>`, `Disp. ${fmt(k.disponibilidad, 0)} % · Rend. ${fmt(k.rendimiento, 0)} % · Cal. ${fmt(k.calidad, 1)} %`, k.oee < 45);
    set('coste', `${fmt(k.costeUnidad, 2)}<small>€</small>`, 'energía, personal y amortización');
    set('servicio', `${fmt(k.servicio, 1)}<small>%</small>`, 'demanda atendida a tiempo', k.servicio < 90);
    set('energia', `${fmt(k.energiaKWh, 0)}<small>kWh</small>`, `${fmt(k.energiaUnidad, 2)} kWh/${cfg.unidad} · ${fmt(k.costeEnergia, 0)} €`);
    set('co2', `${fmt(k.co2Kg, 0)}<small>kg CO₂</small>`, `${fmt(k.co2Unidad * 1000, 0)} g CO₂/${cfg.unidad}`);
    set('plazo', `${fmtMin(k.plazo)}`, 'desde el pedido hasta la expedición');
  }

  // ---------- Gráfica de producción ----------
  const enCrisis = (i: number) => !!series[i]?.crisis;
  const chProd: Chart = lineChart($('.ch-prod') as HTMLCanvasElement, [
    {
      label: 'Ritmo',
      data: [],
      borderColor: C.teal,
      backgroundColor: C.tealSuave,
      fill: true,
      segment: {
        borderColor: (c: any) => (enCrisis(c.p1DataIndex) ? C.naranja : C.teal),
        backgroundColor: (c: any) => (enCrisis(c.p1DataIndex) ? C.naranjaSuave : C.tealSuave),
      },
    } as any,
  ]);
  function renderSeries() {
    setData(chProd, series.map((p) => p.reloj.split('· ')[1] ?? p.reloj), [series.map((p) => p.prod)]);
  }

  // ---------- Barra superior ----------
  page.querySelectorAll<HTMLButtonElement>('.seg [data-v]').forEach((b) => b.addEventListener('click', () => socket.send('velocidad', { v: Number(b.dataset.v) })));
  $('.btn-pausa').addEventListener('click', () => socket.send('pausa'));
  $('.btn-reset').addEventListener('click', () => {
    socket.send('reiniciar');
    historial.clear();
  });
  $('.btn-base').addEventListener('click', () => socket.send('escenario', { id: 'base' }));
  $('.btn-pres').addEventListener('click', () => togglePresentacion());
  let datosActivos = false;
  $('.tb-datos').addEventListener('click', () => {
    $('.tb-datos').innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Consultando…';
    socket.send('datosPublicos', { v: !datosActivos });
  });
  function renderDatos(d: any) {
    datosActivos = d.activado;
    const pub = d.fuente === 'públicos';
    $('.tb-datos').innerHTML = `<i class="dot ${pub ? 'pub' : 'sim'}"></i> Datos ${pub ? 'públicos' : 'simulados'}`;
    $('.tb-datos').title = `${d.detalle}\n(clic para ${d.activado ? 'desactivar' : 'activar'} datos públicos)`;
  }
  function togglePresentacion(v?: boolean) {
    const on = document.body.classList.toggle('presentacion', v);
    $('.btn-pres').classList.toggle('on', on);
    setTimeout(() => kit?.resize(), 50);
  }
  socket.onStatus = (ok) => $('.conn').classList.toggle('off', !ok);
  const onVr = (e: Event) => {
    const slot = $('.vr-slot');
    slot.innerHTML = '';
    slot.appendChild((e as CustomEvent).detail);
  };
  document.addEventListener('vr-disponible', onVr);

  // ---------- Pestañas ----------
  const tabs: { id: string; titulo: string; render: (el: HTMLElement) => void }[] = [
    { id: 'crisis', titulo: 'Provocar crisis', render: renderCrisisTab },
    { id: 'escenarios', titulo: '¿Qué pasa si…?', render: renderEscenariosTab },
  ];
  let tabActiva = 'crisis';
  function renderTabs() {
    const nav = $('.tabs');
    nav.innerHTML = '';
    for (const t of tabs) {
      const b = el('button', t.id === tabActiva ? 'on' : '', esc(t.titulo));
      b.addEventListener('click', () => {
        tabActiva = t.id;
        renderTabs();
      });
      nav.appendChild(b);
    }
    const outer = $('.tab-body');
    outer.innerHTML = '';
    // Cada pestaña se pinta en un contenedor nuevo: así los paneles anteriores quedan
    // desconectados (isConnected = false) y se descartan sus escuchadores.
    msgHandlers.length = 0;
    const body = el('div', 'tab-inner');
    outer.appendChild(body);
    tabs.find((t) => t.id === tabActiva)?.render(body);
  }

  function renderCrisisTab(body: HTMLElement) {
    body.appendChild(el('p', '', 'Provoca una crisis: el gemelo la muestra al instante y calcula qué pasaría <b>sin plan</b> y <b>con un plan ensayado</b>.'));
    const grid = el('div', 'crisis-grid');
    for (const c of cfg.crisis) {
      const b = el('button', 'crisis-btn');
      b.dataset.crisis = c.id;
      b.innerHTML = `<b><span class="ico">${ICONO_CRISIS[c.id] ?? '⚠'}</span>${esc(c.titulo)}</b><span>${esc(c.detalle)}</span>`;
      b.addEventListener('click', () => socket.send('crisis', { id: c.id }));
      grid.appendChild(b);
    }
    body.appendChild(grid);
    const ver = el('button', 'btn btn-vercurva', '📉 Ver la última curva de resiliencia');
    ver.addEventListener('click', () => resModal.open(undefined, !!lastFrame?.crisis?.plan));
    ver.disabled = !resModal.hasData;
    body.appendChild(ver);
  }

  function renderEscenariosTab(body: HTMLElement) {
    const c = cfg.comparador;
    body.innerHTML = `<div class="card"><h3>${esc(c.titulo)}</h3><p>${esc(c.pregunta)}</p></div>`;
    for (const sc of c.escenarios) {
      const d = el('div', 'card');
      d.innerHTML = `<h3>${esc(sc.titulo)}</h3><p>${esc(sc.detalle)}</p>`;
      body.appendChild(d);
    }
    const run = el('button', 'btn primario', '▶ Comparar los tres escenarios');
    run.style.alignSelf = 'flex-start';
    run.addEventListener('click', () => {
      cmpModal.loading();
      socket.send('comparar');
    });
    body.appendChild(run);
    body.appendChild(el('p', 'nota', `${esc(c.horizonte)}. El gemelo no decide: muestra las consecuencias de cada opción.`));
  }

  // ---------- Banner de crisis ----------
  function renderBanner(f: any) {
    const b = $('.crisis-banner');
    const c = f.crisis;
    page.querySelectorAll<HTMLButtonElement>('.crisis-btn').forEach((x) => x.classList.toggle('activa', !!c && x.dataset.crisis === c.id));
    if (!c) {
      b.classList.add('hidden');
      b.dataset.key = '';
      return;
    }
    b.classList.remove('hidden');
    const key = `${c.id}-${c.plan}`;
    if (b.dataset.key !== key) {
      b.dataset.key = key;
      b.innerHTML = `<span>⚠</span><div><b>${esc(c.titulo)}</b><br/><span class="rest"></span></div>
        ${c.plan ? '<span class="ok">Plan aplicado ✓</span>' : '<button class="btn primario b-plan">Aplicar plan ensayado</button>'}
        <button class="btn b-curva">Ver curva</button><button class="btn b-fin" title="Terminar la crisis">✕</button>`;
      b.querySelector('.b-plan')?.addEventListener('click', () => socket.send('plan'));
      b.querySelector('.b-curva')!.addEventListener('click', () => resModal.open(undefined, c.plan));
      b.querySelector('.b-fin')!.addEventListener('click', () => socket.send('finCrisis'));
    }
    b.querySelector('.rest')!.textContent = `Quedan ${fmtMin(c.restanteMin)} de crisis`;
  }
  resModal.onAplicarPlan = () => socket.send('plan');
  cmpModal.onVer3D = (id: ScenarioId) => socket.send('escenario', { id });

  // ---------- Narración: qué está pasando y dónde mirar ----------
  let narrativaPrevia = '';
  function renderNarrativa(f: any) {
    const caja = $('.narrativa');
    const texto: string = f.view.narrativa ?? '';
    caja.classList.toggle('hidden', !texto);
    caja.classList.toggle('crisis', !!f.crisis);
    if (texto !== narrativaPrevia) {
      narrativaPrevia = texto;
      caja.querySelector('span')!.textContent = texto;
    }
  }

  // ---------- Avisos breves del servidor ----------
  let avisoTimer: number | undefined;
  function aviso(texto: string) {
    let t = page.querySelector('.toast') as HTMLElement | null;
    if (!t) {
      t = el('div', 'toast');
      t.setAttribute('role', 'status');
      page.appendChild(t);
    }
    t.textContent = texto;
    t.classList.remove('hidden');
    clearTimeout(avisoTimer);
    avisoTimer = window.setTimeout(() => t!.classList.add('hidden'), 3500);
  }

  // ---------- Alertas ----------
  const ORDEN_ALERTA: Record<string, number> = { critico: 0, aviso: 1, info: 2 };
  let alertKey = '';
  function renderAlertas(v: any) {
    const k = JSON.stringify(v.alertas);
    if (k === alertKey) return;
    alertKey = k;
    $('.alerts').innerHTML = (v.alertas as any[])
      .slice()
      .sort((a: any, b: any) => ORDEN_ALERTA[a.nivel] - ORDEN_ALERTA[b.nivel])
      .slice(0, 3)
      .map((a) => `<div class="alerta ${a.nivel}">${a.nivel === 'critico' ? '⛔ ' : a.nivel === 'aviso' ? '⚠ ' : ''}${esc(a.texto)}</div>`)
      .join('');
  }

  // ---------- Ficha de equipo ----------
  let fichaChart: Chart | null = null;
  function abrirFicha(id: string | null) {
    fichaId = id;
    const f = $('.ficha');
    fichaChart?.destroy();
    fichaChart = null;
    if (!id) {
      f.classList.add('hidden');
      return;
    }
    f.classList.remove('hidden');
    f.innerHTML = `<div class="ficha-head"><div><h3></h3><span class="estado-chip"></span></div><button class="cerrar" title="Cerrar">×</button></div>
      <table><tbody></tbody></table><div><b style="font-size:14px">Histórico breve</b><div class="mini"><canvas></canvas></div></div>`;
    f.querySelector('.cerrar')!.addEventListener('click', () => abrirFicha(null));
    fichaChart = lineChart(
      f.querySelector('canvas')!,
      [
        { label: 'Utilización %', data: [], borderColor: C.teal, borderWidth: 2 },
        { label: 'Potencia kW', data: [], borderColor: C.naranja, borderWidth: 2 },
      ],
      { leyenda: true, maxTicksX: 3 },
    );
    fichaChart.options.plugins!.legend!.labels!.font = { size: 12 };
    renderFicha();
  }
  function renderFicha() {
    if (!fichaId || !lastView) return;
    const e: Equipo | undefined = lastView.equipos.find((x: Equipo) => x.id === fichaId);
    if (!e) return;
    const f = $('.ficha');
    f.querySelector('h3')!.textContent = e.nombre;
    const chip = f.querySelector('.estado-chip') as HTMLElement;
    chip.textContent = TEXTO_ESTADO[e.estado];
    chip.style.background = hex(COLOR_ESTADO[e.estado]);
    if (e.estado === 'esperando' || e.estado === 'inactivo') chip.style.color = '#0E1A2B';
    else chip.style.color = '#fff';
    const filas: [string, string][] = [
      ['Utilización', `${fmt(e.util * 100, 0)} %`],
      ['Potencia', `${fmt(e.kw, 1)} kW`],
    ];
    if (e.cola !== undefined) filas.push(['Cola', `${e.cola}`]);
    for (const [k, v] of Object.entries(e.extra ?? {})) filas.push([k, String(v)]);
    f.querySelector('tbody')!.innerHTML = filas.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
    const h = historial.get(e.id);
    if (h && fichaChart) setData(fichaChart, h.util.map((_, i) => i), [h.util, h.kw]);
  }
  function registrarHistorial(v: any) {
    for (const e of v.equipos as Equipo[]) {
      let h = historial.get(e.id);
      if (!h) historial.set(e.id, (h = { util: [], kw: [] }));
      h.util.push(+(e.util * 100).toFixed(1));
      h.kw.push(+e.kw.toFixed(1));
      if (h.util.length > 90) {
        h.util.shift();
        h.kw.shift();
      }
    }
  }

  // ---------- Mensajes del servidor ----------
  socket.on((msg) => {
    switch (msg.type) {
      case 'hola':
        renderDatos(msg.datos);
        break;
      case 'datos':
        renderDatos(msg.data);
        break;
      case 'series':
        series = msg.data;
        renderSeries();
        break;
      case 'frame': {
        lastFrame = msg;
        lastView = msg.view;
        $('.tb-clock').textContent = msg.reloj;
        page.querySelectorAll<HTMLButtonElement>('.seg [data-v]').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === msg.velocidad && !msg.pausa));
        $('.btn-pausa').innerHTML = msg.pausa ? '▶ Reanudar' : '⏸ Pausa';
        $('.btn-pausa').classList.toggle('on', msg.pausa);
        const sc = cfg.comparador.escenarios.find((s) => s.id === msg.escenario);
        const esc3d = $('.tb-esc');
        esc3d.querySelector('b')!.textContent = msg.escenario === 'base' ? 'Situación actual' : sc?.titulo ?? msg.escenario;
        esc3d.classList.toggle('alt', msg.escenario !== 'base');
        $('.btn-base').classList.toggle('hidden', msg.escenario === 'base');
        renderKpis(msg);
        renderBanner(msg);
        renderAlertas(msg.view);
        renderNarrativa(msg);
        kit?.setFoco(msg.view.foco ?? []);
        resModal.crisisActiva = !!msg.crisis;
        if (frameCount++ % 5 === 0) registrarHistorial(msg.view);
        kit?.updateEquipos(msg.view.equipos);
        handle?.update(msg.view, msg);
        renderFicha();
        break;
      }
      case 'resiliencia':
        // la curva llega justo al lanzar la crisis, antes del primer fotograma que la incluye
        resModal.crisisActiva = true;
        resModal.open(msg.data, false);
        page.querySelectorAll<HTMLButtonElement>('.btn-vercurva').forEach((b) => (b.disabled = false));
        break;
      case 'comparador':
        cmpModal.open(msg.data, lastFrame?.escenario ?? 'base');
        break;
      case 'error':
      case 'aviso':
        aviso(String(msg.mensaje ?? ''));
        if (cmpModal.isOpen && cmpModal.root.querySelector('.cargando')) cmpModal.close();
        break;
    }
    for (const h of msgHandlers) h(msg);
  });

  // ---------- Escena 3D ----------
  const api: TwinApi = {
    socket,
    send: (c, a) => socket.send(c, a),
    on: (h) => msgHandlers.push(h),
    lastView: () => lastView,
    lastFrame: () => lastFrame,
    series: () => series,
  };
  loadScene(cfg.id)
    .then((client) => {
      if (disposed) return;
      const host = $('.canvas-host');
      kit = new SceneKit(host, client.kitOptions);
      handle = client.build(kit);
      kit.onPick((id) => abrirFicha(id));
      if (handle.frame) kit.onFrame((dt) => handle!.frame!(dt));
      kit.start();
      if (handle.panel) {
        const p = handle.panel;
        tabs.push({ id: 'propio', titulo: p.titulo, render: (body) => p.render(body, api) });
        tabActiva = 'propio';
      }
      renderTabs();
      if (lastView) {
        kit.updateEquipos(lastView.equipos);
        handle.update(lastView, lastFrame);
      }
    })
    .catch((e) => {
      console.error(e);
      $('.canvas-host').innerHTML = `<div style="padding:24px">No se pudo cargar la escena 3D: ${esc(String(e))}</div>`;
    });
  renderTabs();

  // ---------- Atajos de teclado ----------
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as Element | null)?.closest?.('input, textarea')) return;
    if (e.key === ' ') {
      e.preventDefault();
      socket.send('pausa');
    } else if (e.key === '1') socket.send('velocidad', { v: 1 });
    else if (e.key === '5') socket.send('velocidad', { v: 5 });
    else if (e.key === '2') socket.send('velocidad', { v: 20 });
    else if (e.key === 'p' || e.key === 'P') togglePresentacion();
    else if (e.key === 'Escape') {
      if (cmpModal.isOpen) cmpModal.close();
      else if (resModal.isOpen) resModal.close();
      else abrirFicha(null);
    }
  };
  window.addEventListener('keydown', onKey);

  return () => {
    disposed = true;
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('vr-disponible', onVr);
    socket.close();
    chProd.destroy();
    fichaChart?.destroy();
    kit?.dispose();
    document.body.classList.remove('presentacion');
  };
}
