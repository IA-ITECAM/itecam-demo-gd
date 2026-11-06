/**
 * SceneKit: todo lo común a las escenas 3D de los gemelos.
 * Cámara orbital, luces, suelo, selección por clic, etiquetas flotantes,
 * balizas de estado (andon), tintado de averías, halos de consumo,
 * trazados sobre el suelo, pools instanciados y WebXR.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import type { Equipo, EstadoEquipo } from '../../../core/types';
import { esc } from '../ui/format';

export const PALETA = {
  fondo: 0xf5f3ee,
  suelo: 0xe7e2d7,
  tinta: 0x0e1a2b,
  teal: 0x0b7373,
  naranja: 0xe8731a,
  rojo: 0xd63b2f,
  gris: 0x8a96a3,
  grisClaro: 0xc9cfd6,
  acero: 0x9aa5b1,
  aceroOscuro: 0x5b6672,
  madera: 0xc8a26b,
  azul: 0x3b7dd8,
  blanco: 0xfbfaf7,
};

export const COLOR_ESTADO: Record<EstadoEquipo, number> = {
  trabajando: PALETA.teal,
  esperando: 0xb7c0c9,
  averia: PALETA.rojo,
  sin_material: PALETA.naranja,
  alerta: PALETA.naranja,
  inactivo: 0xdedede,
  fuera_turno: 0x9aa3ad,
  cargando: PALETA.azul,
};

export const TEXTO_ESTADO: Record<EstadoEquipo, string> = {
  trabajando: 'Trabajando',
  esperando: 'En espera',
  averia: 'Averiado',
  sin_material: 'Sin material',
  alerta: 'Atención',
  inactivo: 'Inactivo',
  fuera_turno: 'Fuera de turno',
  cargando: 'Cargando batería',
};

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

interface EquipoReg {
  id: string;
  obj: THREE.Object3D;
  bodies: THREE.Mesh[];
  beacon: THREE.Mesh;
  label: CSS2DObject;
  labelEl: HTMLDivElement;
  estado: EstadoEquipo;
  halo?: THREE.Mesh;
  haloTarget: number;
  haloScale: number;
}

export interface KitOptions {
  /** tamaño del suelo (m) */
  size: [number, number];
  camPos: [number, number, number];
  target?: [number, number, number];
}

export class SceneKit {
  scene = new THREE.Scene();
  world = new THREE.Group();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  controls: OrbitControls;
  equipos = new Map<string, EquipoReg>();
  private frameFns: ((dt: number, t: number) => void)[] = [];
  private pickFns: ((id: string | null) => void)[] = [];
  private lastT = performance.now();
  private elapsed = 0;
  private ro: ResizeObserver;
  private raycaster = new THREE.Raycaster();
  private down = { x: 0, y: 0 };
  private disposed = false;
  showLabels = true;
  /** texto de la segunda línea de las etiquetas (se puede personalizar por gemelo) */
  labelSub: (e: Equipo) => string = defaultSub;
  vrButton: HTMLElement | null = null;

  constructor(public container: HTMLElement, public opts: KitOptions) {
    const { clientWidth: w, clientHeight: h } = container;
    this.scene.background = new THREE.Color(PALETA.fondo);
    this.scene.fog = new THREE.Fog(PALETA.fondo, 70, 160);
    this.scene.add(this.world);

    this.camera = new THREE.PerspectiveCamera(42, w / Math.max(1, h), 0.1, 400);
    this.camera.position.set(...opts.camPos);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.xr.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.setSize(w, h);
    this.labels.domElement.className = 'labels-layer';
    container.appendChild(this.labels.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2.15;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 120;
    this.controls.target.set(...(opts.target ?? [0, 0, 0]));
    this.encuadrar();
    this.controls.update();

    this.lights();
    this.floor();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
      this.pick(e);
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);

    // WebXR (Meta Quest): solo si el navegador lo soporta
    const nav = navigator as any;
    if (nav.xr?.isSessionSupported) {
      nav.xr.isSessionSupported('immersive-vr').then((ok: boolean) => {
        if (!ok || this.disposed) return;
        this.vrButton = VRButton.createButton(this.renderer);
        this.vrButton.classList.add('vr-btn');
        this.vrButton.removeAttribute('style');
        document.dispatchEvent(new CustomEvent('vr-disponible', { detail: this.vrButton }));
      });
    }
    this.renderer.xr.addEventListener('sessionstart', () => {
      // En VR el usuario aparece en el borde de la planta mirando hacia ella
      this.world.position.set(0, 0, -this.opts.size[1] * 0.6);
    });
    this.renderer.xr.addEventListener('sessionend', () => this.world.position.set(0, 0, 0));
  }

  /** Coloca la cámara (en la dirección de camPos) a la distancia justa para ver todo el ancho de la nave. */
  encuadrar() {
    const target = new THREE.Vector3(...(this.opts.target ?? [0, 0, 0]));
    const dir = new THREE.Vector3(...this.opts.camPos).sub(target);
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(0.6, this.camera.aspect));
    const d = (this.opts.size[0] * 0.5 * 0.98) / Math.tan(hfov / 2);
    this.camera.position.copy(target).add(dir.normalize().multiplyScalar(Math.max(d, 25)));
    this.camera.lookAt(target);
  }

  private lights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c3, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    const [sx, sz] = this.opts.size;
    sun.position.set(-sx * 0.4, 40, sz * 0.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const ext = Math.max(sx, sz) * 0.65;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 120 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
  }

  private floor() {
    const [w, d] = this.opts.size;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: PALETA.suelo, roughness: 0.95 }));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    this.world.add(g);
    const grid = new THREE.GridHelper(Math.max(w, d), Math.max(w, d) / 2, 0xd3ccbd, 0xdcd6c9);
    grid.position.y = 0.005;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    this.world.add(grid);
    // Borde de la nave
    const borde = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.6, 0.12, d + 0.6),
      new THREE.MeshStandardMaterial({ color: 0xd8d1c2, roughness: 1 }),
    );
    borde.position.y = -0.07;
    this.world.add(borde);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  start() {
    this.renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastT) / 1000);
      this.lastT = now;
      this.elapsed += dt;
      const t = this.elapsed;
      for (const f of this.frameFns) f(dt, t);
      this.animateEquipos(dt, t);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      if (!this.renderer.xr.isPresenting) this.labels.render(this.scene, this.camera);
    });
  }

  onFrame(fn: (dt: number, t: number) => void) {
    this.frameFns.push(fn);
  }

  onPick(fn: (id: string | null) => void) {
    this.pickFns.push(fn);
  }

  private pick(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const objs = [...this.equipos.values()].map((r) => r.obj);
    const hits = this.raycaster.intersectObjects(objs, true);
    let id: string | null = null;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.equipoId) o = o.parent;
      if (o) {
        id = o.userData.equipoId;
        break;
      }
    }
    for (const f of this.pickFns) f(id);
  }

  /** Registra un equipo: se podrá seleccionar, tendrá baliza, etiqueta y tintado de estado. */
  registerEquipo(id: string, obj: THREE.Object3D, height: number, opts: { halo?: number; labelOffset?: [number, number] } = {}) {
    obj.userData.equipoId = id;
    const bodies: THREE.Mesh[] = [];
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData.noTint) {
        m.material = (m.material as THREE.MeshStandardMaterial).clone();
        bodies.push(m);
      }
    });
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: PALETA.teal, emissive: PALETA.teal, emissiveIntensity: 0.6 }),
    );
    beacon.position.set(0, height + 0.25, 0);
    beacon.userData.noTint = true;
    obj.add(beacon);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), mat(PALETA.aceroOscuro));
    pole.position.set(0, height - 0.1, 0);
    obj.add(pole);

    const el = document.createElement('div');
    el.className = 'lbl';
    el.innerHTML = '<div class="lbl-t"></div><div class="lbl-s"></div>';
    el.addEventListener('click', () => this.pickFns.forEach((f) => f(id)));
    const label = new CSS2DObject(el);
    label.position.set(opts.labelOffset?.[0] ?? 0, height + 1.3, opts.labelOffset?.[1] ?? 0);
    obj.add(label);

    let halo: THREE.Mesh | undefined;
    if (opts.halo) {
      halo = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 16),
        new THREE.MeshBasicMaterial({ color: PALETA.naranja, transparent: true, opacity: 0.18, depthWrite: false, depthTest: false }),
      );
      halo.renderOrder = 5;
      halo.userData.noTint = true;
      halo.position.y = height * 0.45;
      halo.scale.setScalar(0.01);
      obj.add(halo);
    }
    this.equipos.set(id, { id, obj, bodies, beacon, label, labelEl: el, estado: 'trabajando', halo, haloTarget: 0, haloScale: 0 });
  }

  /** Actualiza balizas, etiquetas y tintes a partir de la vista del servidor. */
  updateEquipos(equipos: Equipo[], subtitulo: (e: Equipo) => string = this.labelSub) {
    for (const e of equipos) {
      const r = this.equipos.get(e.id);
      if (!r) continue;
      r.estado = e.estado;
      const c = COLOR_ESTADO[e.estado];
      const bm = r.beacon.material as THREE.MeshStandardMaterial;
      bm.color.setHex(c);
      bm.emissive.setHex(c);
      (r.labelEl.firstChild as HTMLElement).innerHTML = `<i style="background:${hex(c)}"></i>${esc(e.nombre)}`;
      (r.labelEl.lastChild as HTMLElement).textContent = subtitulo(e);
      r.labelEl.classList.toggle('lbl-crit', e.estado === 'averia' || e.estado === 'sin_material');
      r.label.visible = this.showLabels;
    }
  }

  /** Elimina un equipo registrado (p. ej. un AGV retirado de la flota). */
  unregisterEquipo(id: string) {
    const r = this.equipos.get(id);
    if (!r) return;
    r.label.removeFromParent();
    r.labelEl.remove();
    r.obj.removeFromParent();
    this.equipos.delete(id);
  }

  /** Fija el tamaño objetivo del halo de consumo (0..1). */
  setHalo(id: string, nivel: number, radioMax: number) {
    const r = this.equipos.get(id);
    if (r?.halo) r.haloTarget = Math.max(0, nivel) * radioMax;
  }

  private animateEquipos(dt: number, t: number) {
    const pulse = 0.55 + 0.45 * Math.sin(t * 6);
    for (const r of this.equipos.values()) {
      const crit = r.estado === 'averia';
      const warn = r.estado === 'sin_material' || r.estado === 'alerta';
      for (const b of r.bodies) {
        const m = b.material as THREE.MeshStandardMaterial;
        if (!m.emissive) continue;
        if (crit) {
          m.emissive.setHex(PALETA.rojo);
          m.emissiveIntensity = 0.35 + 0.45 * pulse;
        } else if (warn) {
          m.emissive.setHex(PALETA.naranja);
          m.emissiveIntensity = 0.12 + 0.15 * pulse;
        } else if (m.emissiveIntensity !== 0) {
          m.emissiveIntensity = 0;
        }
      }
      const bm = r.beacon.material as THREE.MeshStandardMaterial;
      bm.emissiveIntensity = crit ? 0.4 + 0.8 * pulse : 0.6;
      if (r.halo) {
        r.haloScale += (r.haloTarget - r.haloScale) * Math.min(1, dt * 3);
        const s = Math.max(0.01, r.haloScale * (1 + 0.03 * Math.sin(t * 3)));
        r.halo.scale.set(s, s * 0.6, s);
        (r.halo.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.min(0.28, r.haloScale * 0.04);
      }
    }
  }

  setLabelsVisible(v: boolean) {
    this.showLabels = v;
    for (const r of this.equipos.values()) r.label.visible = v;
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const x of mats) x.dispose();
    });
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}

export const defaultSub = (e: Equipo) => {
  const partes: string[] = [];
  if (e.cola !== undefined && e.cola > 0) partes.push(`cola ${e.cola}`);
  if (e.kw > 0.05) partes.push(`${e.kw.toFixed(0)} kW`);
  if (!partes.length) partes.push(TEXTO_ESTADO[e.estado]);
  return partes.join(' · ');
};

// ---------------- Ayudas de geometría low-poly ----------------

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(color: number, opts: { rough?: number; metal?: number; opacity?: number } = {}) {
  const key = `${color}-${opts.rough ?? 0.7}-${opts.metal ?? 0.1}-${opts.opacity ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.7,
      metalness: opts.metal ?? 0.1,
      flatShading: true,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

export function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, opts?: Parameters<typeof mat>[1]) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function cyl(r: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 12, opts?: Parameters<typeof mat>[1]) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat(color, opts));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Texto plano sobre el suelo (rótulo de zona). */
export function floorText(text: string, x: number, z: number, size = 1.2, color = '#0E1A2B', rotY = 0) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = `700 64px "Segoe UI", system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  c.width = w;
  c.height = 90;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, 45);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry((size * w) / 90, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = rotY;
  m.position.set(x, 0.02, z);
  return m;
}

/** Zona pintada en el suelo. */
export function floorZone(w: number, d: number, x: number, z: number, color: number, opacity = 0.35) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.012, z);
  return m;
}

/**
 * Trazado sobre el suelo formado por cintas planas (las líneas de WebGL no tienen grosor).
 * Se puede redibujar con set(puntos).
 */
export class FloorPath {
  group = new THREE.Group();
  private material: THREE.MeshBasicMaterial;
  constructor(color: number, private width = 0.35, opacity = 0.85) {
    this.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  }
  set(points: [number, number][]) {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1];
      const [bx, bz] = points[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(len + this.width, this.width), this.material);
      seg.rotation.x = -Math.PI / 2;
      seg.rotation.z = -Math.atan2(bz - az, bx - ax);
      seg.position.set((ax + bx) / 2, 0.03, (az + bz) / 2);
      this.group.add(seg);
      // flecha de sentido en medio del tramo
      if (len > 3) {
        const arrow = new THREE.Mesh(new THREE.CircleGeometry(this.width * 1.6, 3), this.material);
        arrow.rotation.x = -Math.PI / 2;
        arrow.rotation.z = -Math.atan2(bz - az, bx - ax);
        arrow.position.set((ax + bx) / 2, 0.035, (az + bz) / 2);
        this.group.add(arrow);
      }
    }
  }
}

/**
 * Pool instanciado de objetos identificados por id, con movimiento suavizado
 * entre las actualizaciones del servidor (10 Hz) para verse fluido a 60 fps.
 */
export class SmoothPool {
  mesh: THREE.InstancedMesh;
  private items = new Map<number, { x: number; y: number; z: number; tx: number; ty: number; tz: number; c: number; seen: number }>();
  private gen = 0;
  private color = new THREE.Color();
  private m4 = new THREE.Matrix4();

  constructor(geom: THREE.BufferGeometry, material: THREE.Material, public capacity: number) {
    this.mesh = new THREE.InstancedMesh(geom, material, capacity);
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /** Define los objetos presentes. */
  set(list: { id: number; x: number; y: number; z: number; color?: number }[]) {
    this.gen++;
    for (const it of list) {
      const cur = this.items.get(it.id);
      if (cur) {
        const jump = Math.hypot(cur.tx - it.x, cur.tz - it.z) > 25;
        Object.assign(cur, { tx: it.x, ty: it.y, tz: it.z, c: it.color ?? cur.c, seen: this.gen });
        if (jump) Object.assign(cur, { x: it.x, y: it.y, z: it.z });
      } else {
        this.items.set(it.id, { x: it.x, y: it.y, z: it.z, tx: it.x, ty: it.y, tz: it.z, c: it.color ?? 0xffffff, seen: this.gen });
      }
    }
    for (const [id, it] of this.items) if (it.seen !== this.gen) this.items.delete(id);
  }

  frame(dt: number) {
    const k = Math.min(1, dt * 10);
    let i = 0;
    for (const it of this.items.values()) {
      if (i >= this.capacity) break;
      it.x += (it.tx - it.x) * k;
      it.y += (it.ty - it.y) * k;
      it.z += (it.tz - it.z) * k;
      this.m4.makeTranslation(it.x, it.y, it.z);
      this.mesh.setMatrixAt(i, this.m4);
      this.mesh.setColorAt(i, this.color.setHex(it.c));
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Mueve suavemente un objeto hacia una posición objetivo. */
export function smoothTo(o: THREE.Object3D, x: number, z: number, dt: number, speed = 6) {
  const k = Math.min(1, dt * speed);
  o.position.x += (x - o.position.x) * k;
  o.position.z += (z - o.position.z) * k;
}

export { THREE };
