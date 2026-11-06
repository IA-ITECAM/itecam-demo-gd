/** Escena 3D y panel propio del gemelo de almacén. */
import { THREE, PALETA, box, cyl, mat, floorText, floorZone, FloorPath, SmoothPool, type SceneKit } from '../../web/src/kit/scene-kit';
import type { TwinClient, TwinApi } from '../../web/src/kit/types';
import { Chart, C } from '../../web/src/ui/charts';
import { fmt } from '../../web/src/ui/format';
import { NAVE, FILAS_Z, BLOQUES_X, PASILLOS_Z, TRANSVERSALES_X, MUELLES_RECEPCION, MUELLES_EXPEDICION, CARGADORES, RESERVA } from './config';
import type { AlmView } from './model';
import type { Equipo } from '../../core/types';

const COLOR_AGV = [0xc9cfd6, PALETA.teal, PALETA.teal, PALETA.azul, PALETA.rojo];

/** Estanterías instanciadas: montantes, largueros y palés. */
function estanterias(w: THREE.Group) {
  const niveles = [0.15, 1.45, 2.75];
  const bahia = 2;
  const montantes: THREE.Matrix4[] = [];
  const largueros: THREE.Matrix4[] = [];
  const pales: { m: THREE.Matrix4; c: number }[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const z of FILAS_Z) {
    for (const [x0, x1] of BLOQUES_X) {
      for (let x = x0; x <= x1 + 0.01; x += bahia) for (const dz of [-1.1, 1.1]) montantes.push(new THREE.Matrix4().makeTranslation(x, 1.8, z + dz));
      for (const y of niveles) for (const dz of [-1.1, 1.1]) largueros.push(new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, y, z + dz), new THREE.Quaternion(), new THREE.Vector3(x1 - x0, 1, 1)));
      for (let x = x0 + bahia / 2; x < x1; x += bahia)
        for (const y of niveles)
          for (const dz of [-0.55, 0.55])
            if (rnd() < 0.72) pales.push({ m: new THREE.Matrix4().makeTranslation(x, y + 0.55, z + dz), c: rnd() < 0.8 ? 0xd2b48c : rnd() < 0.5 ? 0xbfd3cf : 0xe3c9a5 });
    }
  }
  const mMont = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 3.6, 0.12), mat(PALETA.azul), montantes.length);
  montantes.forEach((m, i) => mMont.setMatrixAt(i, m));
  const mLarg = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 0.1), mat(PALETA.naranja), largueros.length);
  largueros.forEach((m, i) => mLarg.setMatrixAt(i, m));
  const mPale = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.9, 1.0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), pales.length);
  const col = new THREE.Color();
  pales.forEach((p, i) => {
    mPale.setMatrixAt(i, p.m);
    mPale.setColorAt(i, col.setHex(p.c));
  });
  for (const m of [mMont, mLarg, mPale]) {
    m.castShadow = true;
    m.receiveShadow = true;
    w.add(m);
  }
}

function crearAgv(manual: boolean) {
  const g = new THREE.Group();
  const cuerpo = box(1.3, 0.45, 1.0, manual ? PALETA.naranja : PALETA.teal, 0, 0.08, 0);
  cuerpo.name = 'cuerpo';
  g.add(cuerpo);
  for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) {
    const r = cyl(0.13, 0.12, PALETA.tinta, x, 0, z, 8);
    r.rotation.x = Math.PI / 2;
    r.position.y = 0.13;
    g.add(r);
  }
  if (manual) {
    g.add(box(0.1, 1.8, 0.8, PALETA.aceroOscuro, 0.6, 0.5, 0));
    g.add(box(0.6, 0.06, 0.8, PALETA.aceroOscuro, 0.95, 0.6, 0));
    g.add(box(0.5, 0.9, 0.6, PALETA.tinta, -0.3, 0.53, 0));
  } else {
    g.add(box(0.5, 0.12, 0.5, PALETA.tinta, -0.3, 0.53, 0));
  }
  const pale = box(1.1, 0.7, 0.9, 0xd2b48c, 0, 0.55, 0);
  pale.name = 'pale';
  pale.visible = false;
  g.add(pale);
  return g;
}

const subAgv = (e: Equipo) => {
  if (e.id.startsWith('agv')) {
    const bat = e.extra?.['Batería'];
    return `${e.extra?.Estado ?? ''}${bat && bat !== '—' ? ` · 🔋 ${bat}` : ''}`;
  }
  return e.cola !== undefined ? `en cola: ${e.cola}` : e.kw > 0.1 ? `${e.kw.toFixed(1)} kW` : '';
};

const client: TwinClient = {
  kitOptions: { size: [NAVE.ancho, NAVE.fondo], camPos: [0, 42, 37], target: [0, 0, 3] },
  build(kit: SceneKit) {
    const w = kit.world;
    kit.labelSub = subAgv;
    // Rutas de los AGV (pasillos y transversales)
    const segs: [number, number][][] = [];
    for (const z of PASILLOS_Z) segs.push([[-29, z], [29, z]]);
    for (const x of TRANSVERSALES_X) segs.push([[x, PASILLOS_Z[0]], [x, PASILLOS_Z[PASILLOS_Z.length - 1]]]);
    const grupoRutas = new THREE.Group();
    for (const sgm of segs) {
      const fp = new FloorPath(0x0b7373, 0.16, 0.25);
      fp.set(sgm);
      grupoRutas.add(fp.group);
    }
    w.add(grupoRutas);
    estanterias(w);
    // Zonas
    w.add(floorZone(5, 34, -29.5, -2, PALETA.teal, 0.12), floorText('RECEPCIÓN', -29.5, -2, 1.4, '#0B7373', Math.PI / 2));
    w.add(floorZone(5, 34, 29.5, -2, PALETA.naranja, 0.12), floorText('EXPEDICIÓN', 29.5, -2, 1.4, '#B85A12', -Math.PI / 2));
    w.add(floorZone(6, 3, RESERVA[0], RESERVA[1], PALETA.naranja, 0.2), floorText('RESERVA', RESERVA[0], RESERVA[1] + 1.8, 0.9, '#B85A12'));
    for (let i = 0; i < 4; i++) w.add(box(1.6, 0.9, 1.0, 0xe3c9a5, RESERVA[0] - 2.2 + i * 1.5, 0, RESERVA[1]));
    // Muelles (puertas)
    for (const [x, z] of MUELLES_RECEPCION) w.add(box(0.3, 3.4, 3.2, 0x9aa3ad, x - 2.7, 0, z));
    for (const [x, z] of MUELLES_EXPEDICION) w.add(box(0.3, 3.4, 3.2, 0x9aa3ad, x + 2.7, 0, z));
    // Recepción / expedición como equipos seleccionables
    const rec = new THREE.Group();
    rec.position.set(-29, 0, -21);
    rec.add(box(3, 1.2, 1.4, PALETA.teal));
    w.add(rec);
    kit.registerEquipo('recepcion', rec, 1.3);
    const exp = new THREE.Group();
    exp.position.set(29, 0, -21);
    exp.add(box(3, 1.2, 1.4, PALETA.naranja));
    w.add(exp);
    kit.registerEquipo('expedicion', exp, 1.3);
    // Cargadores
    const carg = new THREE.Group();
    carg.position.set(0, 0, CARGADORES[0][1] + 1.6);
    for (const [x] of CARGADORES) {
      carg.add(box(1.2, 1.4, 0.5, PALETA.aceroOscuro, x, 0, 0));
      carg.add(box(0.6, 0.3, 0.06, PALETA.azul, x, 0.9, -0.28));
    }
    w.add(carg);
    kit.registerEquipo('cargadores', carg, 1.5);
    w.add(floorText('CARGA', 0, 17.4, 0.9, '#3B7DD8'));

    // Palés en cola de recepción y expedición (instanciados)
    const colaRec = new SmoothPool(new THREE.BoxGeometry(1.2, 0.8, 1.0), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), 40);
    const colaExp = new SmoothPool(new THREE.BoxGeometry(1.2, 0.8, 1.0), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), 40);
    w.add(colaRec.mesh, colaExp.mesh);

    const agvs = new Map<number, { g: THREE.Group; tx: number; tz: number; rot: number; manual: boolean }>();

    return {
      update(v: AlmView) {
        const vistos = new Set<number>();
        const a = v.agvs;
        for (let i = 0; i < a.length; i += 8) {
          const [id, x, z, rot, code, , cargado, tipo] = a.slice(i, i + 8);
          vistos.add(id);
          let it = agvs.get(id);
          if (!it) {
            const g = crearAgv(tipo === 1);
            g.scale.setScalar(1.6);
            g.position.set(x, 0, z);
            w.add(g);
            kit.registerEquipo(`agv${id}`, g, 1.3);
            it = { g, tx: x, tz: z, rot, manual: tipo === 1 };
            agvs.set(id, it);
          }
          it.tx = x;
          it.tz = z;
          it.rot = rot;
          (it.g.getObjectByName('pale') as THREE.Mesh).visible = cargado === 1;
          if (!it.manual) {
            const cuerpo = it.g.getObjectByName('cuerpo') as THREE.Mesh;
            (cuerpo.material as THREE.MeshStandardMaterial).color.setHex(COLOR_AGV[code]);
          }
        }
        for (const [id, it] of agvs)
          if (!vistos.has(id)) {
            kit.unregisterEquipo(`agv${id}`);
            it.g.removeFromParent();
            agvs.delete(id);
          }
        // Palés esperando en recepción (ubicaciones) y pedidos pendientes en expedición
        const rec = [];
        for (let i = 0; i < Math.min(40, v.ubicacionesPendientes); i++) rec.push({ id: i, x: -30.5 + (i % 2) * 1.4, y: 0.4, z: -15 + Math.floor(i / 2) * 1.2, color: 0xd2b48c });
        colaRec.set(rec);
        const ex = [];
        for (let i = 0; i < Math.min(40, v.pedidosPendientes); i++) ex.push({ id: i, x: 30.5 - (i % 2) * 1.4, y: 0.4, z: -15 + Math.floor(i / 2) * 1.2, color: i < 8 ? 0xe3c9a5 : PALETA.naranja });
        colaExp.set(ex);
      },
      frame(dt: number) {
        const k = Math.min(1, dt * 8);
        for (const it of agvs.values()) {
          const g = it.g;
          if (Math.hypot(it.tx - g.position.x, it.tz - g.position.z) > 20) g.position.set(it.tx, 0, it.tz);
          g.position.x += (it.tx - g.position.x) * k;
          g.position.z += (it.tz - g.position.z) * k;
          let d = it.rot - Math.PI / 2 - g.rotation.y;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          g.rotation.y += d * k;
        }
        colaRec.frame(dt);
        colaExp.frame(dt);
      },
      panel: { titulo: 'Flota de AGV', render: renderPanel },
    };
  },
};

function renderPanel(body: HTMLElement, api: TwinApi) {
  const v: AlmView | null = api.lastView();
  const flota = v?.flota ?? 5;
  body.innerHTML = `
    <div class="card">
      <h3>¿Cuántos AGV necesito? <small>tamaño de la flota en vivo</small></h3>
      <div class="campo">
        <label><span>AGV en la flota</span><span class="big-num nf" style="font-size:28px">${flota}</span></label>
        <input type="range" min="2" max="14" step="1" value="${flota}" />
      </div>
      <div class="fila estados" style="margin-top:6px"></div>
    </div>
    <div class="card">
      <h3>Nivel de servicio y coste según la flota <small>1 día simulado por punto</small></h3>
      <div class="chart-box alto"><canvas></canvas></div>
      <p class="nota" style="margin-top:6px">Cada punto es un día completo (2 turnos, con picos) simulado con la misma semilla. El punto naranja es la flota actual.</p>
    </div>
    <div class="info">Pista: pasa de 4 a 5 y a 7 AGV. A partir de cierto tamaño, el servicio ya no mejora y el coste por pedido sube.</div>`;
  const range = body.querySelector('input')!;
  const nf = body.querySelector('.nf') as HTMLElement;
  range.addEventListener('input', () => (nf.textContent = range.value));
  range.addEventListener('change', () => api.send('flota', { n: Number(range.value) }));

  let datos: any = null;
  const chart = new Chart(body.querySelector('canvas')!, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Nivel de servicio (%)', data: [], borderColor: C.teal, backgroundColor: C.teal, yAxisID: 'y', pointRadius: 3, borderWidth: 3 },
        { label: 'Coste por pedido (€)', data: [], borderColor: C.tinta, backgroundColor: C.tinta, yAxisID: 'y1', pointRadius: 3, borderWidth: 2.5, borderDash: [5, 4] },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 14 } } },
      scales: {
        x: { title: { display: true, text: 'AGV en la flota' }, grid: { color: C.tinta + '14' } },
        y: { min: 0, max: 100, position: 'left', title: { display: true, text: 'Servicio %' }, grid: { color: C.tinta + '14' } },
        y1: { min: 0, position: 'right', title: { display: true, text: '€/pedido' }, grid: { display: false } },
      },
    },
  });
  const pintar = () => {
    if (!datos) return;
    const actual = Number(range.value);
    chart.data.labels = datos.flotas;
    chart.data.datasets[0].data = datos.servicio;
    chart.data.datasets[1].data = datos.coste;
    (chart.data.datasets[0] as any).pointBackgroundColor = datos.flotas.map((n: number) => (n === actual ? C.naranja : C.teal));
    (chart.data.datasets[0] as any).pointRadius = datos.flotas.map((n: number) => (n === actual ? 8 : 3));
    chart.update('none');
  };
  api.on((msg) => {
    if (!body.isConnected) return;
    if (msg.type === 'respuesta' && msg.cmd === 'barrido') {
      datos = msg.data;
      pintar();
    }
    if (msg.type === 'frame') {
      const vv: AlmView = msg.view;
      if (document.activeElement !== range && Number(range.value) !== vv.flota) {
        range.value = String(vv.flota);
        nf.textContent = String(vv.flota);
        pintar();
      }
      const cnt = [0, 0, 0, 0, 0];
      for (let i = 0; i < vv.agvs.length; i += 8) cnt[vv.agvs[i + 4]]++;
      const est = body.querySelector('.estados') as HTMLElement;
      est.innerHTML = [
        ['Libres', cnt[0], '#b7c0c9'],
        ['En tarea', cnt[1] + cnt[2], '#0B7373'],
        ['Cargando', cnt[3], '#3B7DD8'],
        ['Averiados', cnt[4], '#D63B2F'],
      ]
        .map(([l, n, c]) => `<span class="pill"><i class="dot" style="background:${c}"></i>${l}: <b>${fmt(n as number)}</b></span>`)
        .join('');
    }
  });
  api.send('barrido');
}

export default client;
