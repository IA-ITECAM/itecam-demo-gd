/** Escena 3D y panel propio del gemelo de alimentación (energía y sostenibilidad). */
import { THREE, PALETA, box, cyl, mat, floorText, SmoothPool, type SceneKit } from '../../web/src/kit/scene-kit';
import type { TwinClient, TwinApi } from '../../web/src/kit/types';
import { Chart, C, SERIE_COLORES } from '../../web/src/ui/charts';
import { fmt, esc } from '../../web/src/ui/format';
import { FACTOR_CO2 } from '../../core/kpis';
import { LINEA, NOMBRES, type EquipoId } from './config';
import type { AliView } from './model';

const Y_CINTA = 1.0;
const KW_MAX: Record<EquipoId, number> = { dosificado: 10, horno: 360, enfriamiento: 90, envasado: 22, paletizado: 10 };
const RADIO_HALO: Record<EquipoId, number> = { dosificado: 2.4, horno: 7, enfriamiento: 4.8, envasado: 2.8, paletizado: 2.4 };
const EQUIPOS: EquipoId[] = ['dosificado', 'horno', 'enfriamiento', 'envasado', 'paletizado'];

function cinta(x0: number, x1: number) {
  const g = new THREE.Group();
  const len = x1 - x0;
  g.add(box(len, 0.12, 1.2, 0x2f3d4f, (x0 + x1) / 2, Y_CINTA - 0.12, 0));
  for (let x = x0 + 0.5; x < x1; x += 2.5) for (const z of [-0.5, 0.5]) g.add(box(0.12, Y_CINTA - 0.12, 0.12, PALETA.aceroOscuro, x, 0, z));
  return g;
}

function tunel(x0: number, x1: number, color: number, alto: number, techo: number) {
  const g = new THREE.Group();
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  g.add(box(len, 0.25, 2.6, color, cx, alto, 0));
  g.add(box(len + 0.3, 0.12, 2.8, techo, cx, alto + 0.25, 0));
  for (const z of [-1.25, 1.25]) {
    const vidrio = box(len, alto - Y_CINTA, 0.06, 0xbfe3e3, cx, Y_CINTA, z, { opacity: 0.28 });
    vidrio.userData.noTint = true;
    g.add(vidrio);
    g.add(box(len, 0.25, 0.1, color, cx, Y_CINTA - 0.1, z));
  }
  for (const x of [x0, x1]) g.add(box(0.3, alto, 2.7, color, x, 0, 0));
  return g;
}

const client: TwinClient = {
  kitOptions: { size: [66, 28], camPos: [-4, 24, 44], target: [0, 0, -1] },
  build(kit: SceneKit) {
    const w = kit.world;
    w.add(floorText('LÍNEA DE HORNEADO Y ENVASADO', -32, -12, 1.2));
    w.add(cinta(LINEA.dosificado + 1, LINEA.buffer.x1 + 1), cinta(LINEA.envasado + 1, LINEA.paletizado - 1));

    const g: Record<EquipoId, THREE.Group> = {} as any;
    // Dosificación: tolva y silo de materia prima
    g.dosificado = new THREE.Group();
    g.dosificado.position.x = LINEA.dosificado;
    g.dosificado.add(box(2.2, 1.0, 2.0, PALETA.acero));
    const tolva = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.35, 1.2, 10), mat(PALETA.grisClaro));
    tolva.position.y = 1.9;
    tolva.castShadow = true;
    g.dosificado.add(tolva);
    const silo = cyl(1.1, 3.6, 0xe3dccb, -2.4, 0, -2.2, 14);
    g.dosificado.add(silo);
    const nivel = cyl(1.12, 1, PALETA.madera, -2.4, 0, -2.2, 14);
    nivel.name = 'nivel';
    nivel.userData.noTint = true;
    g.dosificado.add(nivel);
    // Horno túnel
    g.horno = new THREE.Group();
    g.horno.add(tunel(LINEA.horno.x0, LINEA.horno.x1, PALETA.tinta, 2.4, 0x5b6672));
    const chimenea = cyl(0.35, 2.2, PALETA.aceroOscuro, LINEA.horno.x0 + 2, 2.6, -0.6, 10);
    chimenea.name = 'chimenea';
    g.horno.add(chimenea);
    g.horno.add(box(1.2, 2.0, 1.0, PALETA.aceroOscuro, LINEA.horno.x1 - 1.5, 0, -1.9));
    // Llamas / resistencias dentro del horno (brillo según potencia)
    const fuego = box(LINEA.horno.x1 - LINEA.horno.x0 - 0.6, 0.08, 2.0, PALETA.naranja, (LINEA.horno.x0 + LINEA.horno.x1) / 2, Y_CINTA - 0.35, 0);
    fuego.material = new THREE.MeshStandardMaterial({ color: PALETA.naranja, emissive: PALETA.naranja, emissiveIntensity: 1.2 });
    fuego.userData.noTint = true;
    fuego.name = 'fuego';
    g.horno.add(fuego);
    // Túnel de enfriamiento con ventiladores
    g.enfriamiento = new THREE.Group();
    g.enfriamiento.add(tunel(LINEA.enfriamiento.x0, LINEA.enfriamiento.x1, 0xdfe8ee, 2.2, 0x9fb7c6));
    for (let i = 0; i < 4; i++) {
      const v = cyl(0.55, 0.15, 0x3b7dd8, LINEA.enfriamiento.x0 + 2 + i * 3.4, 2.5, 0, 12);
      v.name = 'ventilador';
      g.enfriamiento.add(v);
    }
    // Envasadora
    g.envasado = new THREE.Group();
    g.envasado.position.x = LINEA.envasado;
    g.envasado.add(box(2.6, 1.8, 2.4, PALETA.teal));
    g.envasado.add(box(2.2, 0.6, 2.0, 0xbfe3e3, 0, 1.8, 0, { opacity: 0.5 }));
    g.envasado.add(box(0.6, 1.2, 0.5, PALETA.tinta, 1.0, 0, -1.6));
    // Paletizado: robot y palé
    g.paletizado = new THREE.Group();
    g.paletizado.position.x = LINEA.paletizado;
    g.paletizado.add(box(1.6, 0.15, 1.3, PALETA.madera, 1.2, 0, 1.6));
    g.paletizado.add(cyl(0.45, 0.5, PALETA.aceroOscuro, -0.6, 0, 0));
    const brazo = new THREE.Group();
    brazo.position.set(-0.6, 0.5, 0);
    brazo.add(box(0.35, 1.6, 0.35, PALETA.naranja));
    brazo.add(box(1.8, 0.3, 0.3, PALETA.naranja, 0.8, 1.5, 0));
    brazo.name = 'brazo';
    g.paletizado.add(brazo);
    const pila = box(1.5, 1, 1.2, 0xd2b48c, 1.2, 0.15, 1.6);
    pila.name = 'pila';
    pila.userData.noTint = true;
    g.paletizado.add(pila);
    for (const e of EQUIPOS) {
      w.add(g[e]);
      // La etiqueta y la baliza se colocan en el centro del equipo
      if (e === 'horno' || e === 'enfriamiento') {
        const ref = new THREE.Group();
        const L = e === 'horno' ? LINEA.horno : LINEA.enfriamiento;
        ref.position.x = (L.x0 + L.x1) / 2;
        ref.add(g[e]);
        g[e].position.x = -ref.position.x;
        w.add(ref);
        kit.registerEquipo(e, ref, e === 'horno' ? 2.7 : 2.5, { halo: 1 });
      } else kit.registerEquipo(e, g[e], 2.4, { halo: 1 });
    }
    // Palés terminados
    const pales = new SmoothPool(new THREE.BoxGeometry(1.5, 1.1, 1.2), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), 12);
    w.add(pales.mesh);
    // Bandejas
    const bandejas = new SmoothPool(new THREE.BoxGeometry(0.55, 0.16, 0.85), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }), 400);
    w.add(bandejas.mesh);

    let spinFans = true;
    let fuegoNivel = 1;
    let brazoActivo = false;
    return {
      update(v: AliView) {
        const lista = [];
        const b = v.bandejas;
        for (let i = 0; i < b.length; i += 3) {
          const sec = b[i + 2];
          const color = sec === 0 ? 0xf0dcb4 : sec === 1 ? 0xd9a55a : sec >= 5 ? PALETA.teal : 0xc07a35;
          lista.push({ id: b[i], x: b[i + 1], y: Y_CINTA + 0.08, z: sec === 4 ? 0 : 0, color });
        }
        bandejas.set(lista);
        for (const e of v.equipos) kit.setHalo(e.id, e.kw / KW_MAX[e.id as EquipoId], RADIO_HALO[e.id as EquipoId]);
        const horno = v.equipos.find((e) => e.id === 'horno')!;
        fuegoNivel = horno.estado === 'averia' ? 0.05 : Math.min(1.4, horno.kw / 250);
        spinFans = true;
        brazoActivo = v.equipos.find((e) => e.id === 'paletizado')!.estado === 'trabajando';
        const pila = g.paletizado.getObjectByName('pila')!;
        const h = Math.max(0.05, (v.cajasPale / 40) * 1.4);
        pila.scale.y = h;
        pila.position.y = 0.15 + h / 2;
        const nivel = g.dosificado.getObjectByName('nivel')!;
        const n = Math.max(0.03, (v.stock / v.stockMax) * 3.5);
        nivel.scale.y = n;
        nivel.position.y = n / 2;
        const lp = [];
        for (let i = 0; i < Math.min(12, v.pales); i++) lp.push({ id: i, x: LINEA.paletizado + 3.5 + (i % 3) * 1.8, y: 0.55, z: -2 + Math.floor(i / 3) * 1.5, color: 0xd2b48c });
        pales.set(lp);
      },
      frame(dt: number) {
        bandejas.frame(dt);
        pales.frame(dt);
        if (spinFans) g.enfriamiento.traverse((o) => o.name === 'ventilador' && (o.rotation.y += dt * 8));
        const f = g.horno.getObjectByName('fuego') as THREE.Mesh;
        const m = f.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity += (fuegoNivel * (0.9 + 0.2 * Math.random()) - m.emissiveIntensity) * Math.min(1, dt * 4);
        if (brazoActivo) {
          const br = g.paletizado.getObjectByName('brazo')!;
          br.rotation.y = Math.sin(performance.now() / 600) * 1.2;
        }
      },
      panel: { titulo: 'Energía', render: renderPanel },
    };
  },
};

const ETQ: Record<string, string> = { ...NOMBRES, servicios: 'Servicios (aire, luz)' };

function renderPanel(body: HTMLElement, api: TwinApi) {
  body.innerHTML = `
    <div class="card">
      <h3>Consumo ahora <small>potencia instantánea</small></h3>
      <div class="fila" style="justify-content:space-between">
        <div><div class="big-num kw">—</div><span class="nota">kW totales</span></div>
        <div><div class="big-num eur" style="font-size:26px">—</div><span class="nota">€/h de energía</span></div>
        <div><div class="big-num co2" style="font-size:26px">—</div><span class="nota">kg CO₂/h</span></div>
      </div>
      <table class="tabla tbl" style="margin-top:8px"></table>
    </div>
    <div class="card">
      <h3>Potencia por equipo <small>kW · últimas horas</small></h3>
      <div class="chart-box alto"><canvas></canvas></div>
    </div>
    <div class="card">
      <h3>Escenario energético <small>verlo en 3D</small></h3>
      <p>Cambia la tecnología del horno y observa cómo encogen los halos de consumo.</p>
      <div class="fila" style="margin-top:8px"><div class="seg tec"><button data-id="base">Actual</button><button data-id="A">A · Gas nuevo</button><button data-id="B">B · Eléctrico</button></div></div>
      <button class="btn primario cmp" style="margin-top:10px">▶ Comparar A y B (24 h)</button>
    </div>`;
  const ds = ['horno', 'enfriamiento', 'envasado', 'paletizado', 'dosificado', 'servicios'];
  const chart: Chart<'line', number[], string> = new Chart(body.querySelector('canvas')!, {
    type: 'line',
    data: {
      labels: [],
      datasets: ds.map((k, i) => ({ label: ETQ[k], data: [], borderColor: SERIE_COLORES[i], backgroundColor: SERIE_COLORES[i] + '99', fill: i === 0 ? 'origin' : '-1', pointRadius: 0, borderWidth: 1.5, tension: 0.2 })),
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } } },
      scales: { x: { ticks: { maxTicksLimit: 5, maxRotation: 0 } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'kW' } } },
    },
  });
  const pintarSeries = (series: any[]) => {
    chart.data.labels = series.map((p) => p.reloj.split('· ')[1] ?? p.reloj);
    ds.forEach((k, i) => (chart.data.datasets[i].data = series.map((p) => p.kw[k] ?? 0)));
    chart.update('none');
  };
  pintarSeries(api.series());
  body.querySelectorAll<HTMLButtonElement>('.tec [data-id]').forEach((b) => b.addEventListener('click', () => api.send('escenario', { id: b.dataset.id })));
  body.querySelector('.cmp')!.addEventListener('click', () => api.send('comparar'));
  api.on((msg) => {
    if (!body.isConnected) return;
    if (msg.type === 'series') pintarSeries(msg.data);
    if (msg.type === 'frame') {
      const v: AliView = msg.view;
      body.querySelectorAll<HTMLButtonElement>('.tec [data-id]').forEach((b) => b.classList.toggle('on', b.dataset.id === msg.escenario));
      (body.querySelector('.kw') as HTMLElement).textContent = fmt(v.kwTotal, 0);
      let eur = 0;
      let co2 = 0;
      const filas = v.equipos.map((e) => {
        const gas = e.id === 'horno' && v.fuenteHorno === 'gas';
        eur += e.kw * (gas ? 0.055 : v.precio);
        co2 += e.kw * (gas ? FACTOR_CO2.gas : FACTOR_CO2.elec);
        return `<tr><td>${esc(e.nombre)}</td><td>${gas ? '🔥 gas' : '⚡ elec.'}</td><td><b>${fmt(e.kw, 0)} kW</b></td></tr>`;
      });
      (body.querySelector('.eur') as HTMLElement).textContent = fmt(eur + 12 * v.precio, 1);
      (body.querySelector('.co2') as HTMLElement).textContent = fmt(co2 + 12 * FACTOR_CO2.elec, 1);
      (body.querySelector('.tbl') as HTMLElement).innerHTML = `<tr><th>Equipo</th><th>Fuente</th><th>Potencia</th></tr>${filas.join('')}<tr><td colspan="2">Precio electricidad ahora</td><td><b>${fmt(v.precio * 1000, 0)} €/MWh</b></td></tr>`;
    }
  });
}

export default client;
