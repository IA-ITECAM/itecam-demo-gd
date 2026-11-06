/** Escena 3D y panel propio del gemelo de mecanizado. */
import { THREE, PALETA, box, cyl, mat, floorText, FloorPath, SmoothPool, smoothTo, defaultSub, type SceneKit } from '../../web/src/kit/scene-kit';
import type { TwinClient, TwinApi } from '../../web/src/kit/types';
import { lineChart, setData, seguirTamano, C, type Chart } from '../../web/src/ui/charts';
import { fmt } from '../../web/src/ui/format';
import { LAYOUTS, type PuestoId } from './config';
import type { MecView } from './model';

const COLOR_PIEZA = [0x56606c, PALETA.teal, 0x2f3d4f, 0x8a96a3];

function almacen() {
  const g = new THREE.Group();
  g.add(box(4.4, 0.25, 3, PALETA.aceroOscuro));
  for (const x of [-2, 2]) for (const z of [-1.3, 1.3]) g.add(box(0.15, 2.6, 0.15, PALETA.azul, x, 0, z));
  g.add(box(4.4, 0.12, 3, PALETA.azul, 0, 1.3, 0));
  const stock = box(3.6, 1, 2.4, PALETA.madera, 0, 0.25, 0);
  stock.name = 'stock';
  g.add(stock);
  const seg = box(3.6, 1, 0.8, PALETA.naranja, 0, 1.45, 0);
  seg.name = 'seguridad';
  g.add(seg);
  return g;
}

function sierra() {
  const g = new THREE.Group();
  g.add(box(3.2, 0.9, 1.8, PALETA.acero));
  g.add(box(3.6, 0.15, 0.5, PALETA.aceroOscuro, 0, 0.9, 0));
  g.add(box(0.6, 1.4, 0.6, PALETA.tinta, 0.9, 0.9, -0.5));
  const brazo = box(1.6, 0.35, 0.4, PALETA.tinta, 0.3, 2.0, -0.5);
  g.add(brazo);
  const disco = cyl(0.55, 0.06, 0xc9cfd6, -0.4, 1.7, -0.25, 20);
  disco.rotation.x = Math.PI / 2;
  disco.name = 'gira';
  g.add(disco);
  return g;
}

function torno(color: number, escala = 1) {
  const g = new THREE.Group();
  g.add(box(4.6, 1.0, 2.0, PALETA.aceroOscuro));
  g.add(box(1.2, 1.4, 1.8, color, -1.6, 1.0, 0));
  g.add(box(0.9, 0.9, 1.4, color, 1.7, 1.0, 0));
  const plato = cyl(0.45, 0.35, 0xc9cfd6, -0.85, 1.6, 0, 16);
  plato.rotation.z = Math.PI / 2;
  plato.position.y = 1.65;
  plato.name = 'gira';
  g.add(plato);
  g.add(box(4.0, 1.3, 0.08, 0xbfe3e3, 0, 1.0, 0.95, { opacity: 0.35 }));
  g.add(box(0.8, 1.6, 0.5, PALETA.tinta, 2.4, 0, -0.9));
  g.scale.setScalar(escala);
  return g;
}

function montaje() {
  const g = new THREE.Group();
  g.add(box(3.2, 0.9, 2.0, PALETA.madera));
  for (const x of [-1.4, 1.4]) for (const z of [-0.8, 0.8]) g.add(box(0.12, 0.9, 0.12, PALETA.aceroOscuro, x, 0, z));
  g.add(cyl(0.3, 0.3, PALETA.tinta, 0.8, 0.9, -0.4));
  const brazo = new THREE.Group();
  brazo.position.set(0.8, 1.2, -0.4);
  brazo.add(box(0.25, 1.0, 0.25, PALETA.teal));
  const ant = box(1.0, 0.2, 0.2, PALETA.teal, -0.45, 0.95, 0);
  brazo.add(ant);
  brazo.name = 'gira';
  g.add(brazo);
  g.add(box(0.9, 0.5, 0.7, PALETA.grisClaro, -0.8, 0.9, 0.2));
  return g;
}

function envio() {
  const g = new THREE.Group();
  g.add(box(3.6, 0.2, 3.0, PALETA.madera));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g.add(box(1.0, 0.8, 1.2, 0xd2b48c, -1.1 + i * 1.1, 0.2, -0.65 + j * 1.3));
  g.add(box(4.2, 3.2, 0.2, PALETA.grisClaro, 0, 0, -1.9));
  g.add(box(3.4, 2.6, 0.1, 0x9aa3ad, 0, 0, -1.78));
  return g;
}

const BUILDERS: Record<PuestoId, () => THREE.Group> = {
  almacen,
  corte: sierra,
  torno: () => torno(PALETA.teal),
  torno2: () => torno(0x7d8995, 0.85),
  montaje,
  envio,
};
const ALTURA: Record<PuestoId, number> = { almacen: 2.7, corte: 2.4, torno: 2.5, torno2: 2.2, montaje: 2.2, envio: 3.2 };

const client: TwinClient = {
  kitOptions: { size: [50, 32], camPos: [2, 30, 33], target: [0, 0, 1] },
  build(kit: SceneKit) {
    const w = kit.world;
    // Etiquetas: en el almacén interesa el material, no la cola
    kit.labelSub = (e) => {
      if (e.id === 'almacen') return `material ${e.extra?.['Stock de material'] ?? ''} · pedidos ${e.cola ?? 0}`;
      return defaultSub(e);
    };
    w.add(floorText('CÉLULA DE MECANIZADO', -22, -13.5, 1.3));
    const ruta = new FloorPath(PALETA.teal, 0.42, 0.55);
    w.add(ruta.group);
    let rutaKey = '';

    const puestos = {} as Record<PuestoId, THREE.Group>;
    let layout: keyof typeof LAYOUTS = 'funcional';
    for (const id of Object.keys(BUILDERS) as PuestoId[]) {
      const g = BUILDERS[id]();
      const [x, z] = LAYOUTS.funcional[id];
      g.position.set(x, 0, z);
      w.add(g);
      kit.registerEquipo(id, g, ALTURA[id]);
      puestos[id] = g;
    }
    // El torno alternativo se ve semitransparente mientras no se usa
    puestos.torno2.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.noTint) (m.material as THREE.MeshStandardMaterial).transparent = true;
    });

    const piezas = new SmoothPool(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5 }), 400);
    const carros = new SmoothPool(new THREE.BoxGeometry(0.9, 0.35, 0.7), mat(0xffffff), 6);
    w.add(piezas.mesh, carros.mesh);
    let rutaLabelMesh: THREE.Mesh | null = null;

    let torno2Visible = false;
    const spin = { corte: false, torno: false, torno2: false, montaje: false } as Record<string, boolean>;

    return {
      update(v: MecView) {
        layout = v.layout;
        const key = v.layout;
        if (key !== rutaKey) {
          rutaKey = key;
          ruta.set(v.ruta.puntos);
          if (rutaLabelMesh) {
            w.remove(rutaLabelMesh);
            rutaLabelMesh.geometry.dispose();
          }
          rutaLabelMesh = floorText(`Recorrido de la pieza: ${fmt(v.ruta.longitud, 0)} m`, 0, 13.6, 1.1, '#0B7373');
          w.add(rutaLabelMesh);
        }
        torno2Visible = v.torno2Activo;
        for (const e of v.equipos) spin[e.id] = e.estado === 'trabajando' || e.estado === 'alerta';
        // Pila de material en el almacén
        const alm = puestos.almacen;
        const stock = alm.getObjectByName('stock')!;
        const nivel = Math.max(0.02, Math.min(1, v.stock / v.stockMax));
        stock.scale.y = nivel;
        stock.position.y = 0.25 + nivel / 2;
        const seg = alm.getObjectByName('seguridad')!;
        const segN = Math.max(0.02, v.seguridad / Math.max(1, v.seguridadMax));
        seg.scale.y = segN;
        seg.position.y = 1.45 + segN / 2;
        // Piezas y carros
        const lista: { id: number; x: number; y: number; z: number; color: number }[] = [];
        const listaC: { id: number; x: number; y: number; z: number; color: number }[] = [];
        const p = v.piezas;
        for (let i = 0; i < p.length; i += 4) {
          const [id, x, z, k] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
          const y = k === 1 ? 1.95 : k === 2 ? 0.75 : 0.21;
          lista.push({ id, x, y, z, color: COLOR_PIEZA[k] });
          if (k === 2) listaC.push({ id, x, y: 0.2, z, color: PALETA.naranja });
        }
        piezas.set(lista);
        carros.set(listaC);
      },
      frame(dt: number) {
        for (const id of Object.keys(puestos) as PuestoId[]) {
          const [x, z] = LAYOUTS[layout][id];
          smoothTo(puestos[id], x, z, dt, 3);
        }
        puestos.torno2.visible = true;
        const t2 = puestos.torno2;
        t2.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && !o.userData.noTint) ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = torno2Visible ? 1 : 0.55;
        });
        for (const id of ['corte', 'torno', 'torno2', 'montaje'] as const) {
          const g = puestos[id].getObjectByName('gira');
          if (g && spin[id]) {
            if (id === 'montaje') g.rotation.y += dt * 2.5;
            else if (id === 'corte') g.rotation.y += dt * 14;
            else g.rotation.x += dt * 16;
          }
        }
        piezas.frame(dt);
        carros.frame(dt);
      },
      panel: { titulo: 'Planta y calibración', render: renderPanel },
    };
  },
};

function renderPanel(body: HTMLElement, api: TwinApi) {
  const v0: MecView | null = api.lastView();
  body.innerHTML = `
    <div class="card">
      <h3>Distribución en planta <small>recorrido de la pieza (trazado verde)</small></h3>
      <div class="fila" style="justify-content:space-between">
        <div class="seg"><button data-l="funcional">Funcional (actual)</button><button data-l="linea">En línea</button></div>
        <span class="big-num rec">—</span>
      </div>
      <div class="nota rec-s una-linea" style="margin-top:4px"></div>
    </div>
    <div class="card flex">
      <h3>Modo calibración <small>piezas por hora · 24 h</small></h3>
      <p class="una-linea"><b style="color:var(--tinta)">━ Real</b> (histórico con paradas) frente al <b style="color:var(--teal)">━ gemelo</b></p>
      <div class="chart-box"><canvas></canvas></div>
      <div class="fila" style="margin-top:6px;justify-content:space-between">
        <button class="btn primario b-cal" disabled>⚙ Calibrar</button>
        <span>Error medio: <b class="err">—</b></span>
      </div>
      <div class="nota paso una-linea" style="margin-top:4px">Cargando histórico…</div>
      <div class="nota res-cal una-linea hidden"></div>
    </div>`;
  const recorrido: Record<string, number> = {};
  const pintarLayout = (layout: string) => {
    body.querySelectorAll<HTMLButtonElement>('[data-l]').forEach((b) => b.classList.toggle('on', b.dataset.l === layout));
    const lv: MecView | null = api.lastView();
    if (lv) recorrido[lv.layout] = lv.ruta.longitud;
    const r = recorrido[layout];
    (body.querySelector('.rec') as HTMLElement).textContent = r ? `${fmt(r, 0)} m` : '—';
    const f = recorrido.funcional;
    const l = recorrido.linea;
    (body.querySelector('.rec-s') as HTMLElement).textContent =
      f && l ? `Funcional ${fmt(f, 0)} m → en línea ${fmt(l, 0)} m (−${fmt((1 - l / f) * 100, 0)} %)` : 'Cambia la distribución y mira el recorrido';
  };
  body.querySelectorAll<HTMLButtonElement>('[data-l]').forEach((b) =>
    b.addEventListener('click', () => {
      api.send('layout', { v: b.dataset.l });
    }),
  );
  if (v0) pintarLayout(v0.layout);

  const canvas = body.querySelector('canvas')!;
  const chart: Chart = lineChart(
    canvas,
    [
      { label: 'Real (histórico)', data: [], borderColor: C.tinta, borderWidth: 2.5, tension: 0.1 },
      { label: 'Gemelo', data: [], borderColor: C.teal, borderWidth: 3, borderDash: [], backgroundColor: C.tealSuave, fill: false, tension: 0.1 },
    ],
    { leyenda: false, maxTicksX: 8 },
  );
  seguirTamano(chart);
  let calib: any = null;
  let anim: number | null = null;
  const btn = body.querySelector('.b-cal') as HTMLButtonElement;
  const mostrar = (i: number) => {
    const it = calib.iteraciones[i];
    setData(chart, calib.horas, [calib.real, it.serie]);
    (body.querySelector('.err') as HTMLElement).textContent = `${fmt(it.error, 1)} %`;
    (body.querySelector('.err') as HTMLElement).style.color = it.error > 10 ? 'var(--naranja)' : 'var(--teal)';
    (body.querySelector('.paso') as HTMLElement).textContent = `Paso ${i + 1}/${calib.iteraciones.length}: ${it.nombre} — ${it.detalle}`;
  };
  btn.addEventListener('click', () => {
    if (!calib) return;
    if (anim) clearInterval(anim);
    const tabla = body.querySelector('.res-cal') as HTMLElement;
    tabla.classList.add('hidden');
    let i = 0;
    btn.disabled = true;
    anim = window.setInterval(() => {
      i++;
      mostrar(i);
      if (i >= calib.iteraciones.length - 1) {
        clearInterval(anim!);
        anim = null;
        btn.disabled = false;
        btn.textContent = '↺ Repetir calibración';
        const r = calib.resumen;
        tabla.innerHTML = `<b>Calibrado:</b> ciclo del torno ${fmt(r.cicloTorno[0], 0)} → ${fmt(r.cicloTorno[1], 0)} s · ${r.paradas} paradas reales · MTBF ${r.mtbfTorno} h / MTTR ${r.mttrTorno} min`;
        tabla.title = tabla.textContent ?? '';
        tabla.classList.remove('hidden');
      }
    }, 700);
  });
  api.on((msg) => {
    if (msg.type === 'respuesta' && msg.cmd === 'calibrar' && msg.data) {
      calib = msg.data;
      if (!body.isConnected) return;
      mostrar(0);
      btn.disabled = false;
      (body.querySelector('.paso') as HTMLElement).textContent = 'El gemelo sin calibrar va muy por encima de la realidad. Pulsa «Calibrar».';
    }
    if (msg.type === 'frame' && body.isConnected) pintarLayout(msg.view.layout);
  });
  api.send('calibrar');
}

export default client;
