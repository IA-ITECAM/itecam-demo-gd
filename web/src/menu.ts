import { TWINS } from './registry';
import { el, esc } from './ui/format';
import { url } from './base';

/** Ilustraciones sencillas (SVG en línea, sin descargas). */
const ILUSTRACION: Record<string, string> = {
  mecanizado: `<svg viewBox="0 0 320 170"><rect width="320" height="170" fill="#ebe6db"/>
    <path d="M30 120 L290 120" stroke="#0B7373" stroke-width="5" stroke-dasharray="2 10" stroke-linecap="round"/>
    <rect x="22" y="78" width="40" height="40" rx="4" fill="#c8a26b"/><rect x="92" y="84" width="46" height="34" rx="4" fill="#9aa5b1"/>
    <rect x="160" y="70" width="58" height="48" rx="5" fill="#0E1A2B"/><circle cx="189" cy="94" r="10" fill="#0B7373"/>
    <rect x="236" y="86" width="40" height="32" rx="4" fill="#5b6672"/><circle cx="189" cy="58" r="6" fill="#E8731A"/>
    <rect x="106" y="106" width="9" height="9" fill="#E8731A"/><rect x="118" y="106" width="9" height="9" fill="#E8731A"/></svg>`,
  almacen: `<svg viewBox="0 0 320 170"><rect width="320" height="170" fill="#ebe6db"/>
    ${[0, 1, 2, 3].map((i) => `<rect x="${40 + i * 62}" y="40" width="40" height="80" fill="none" stroke="#0E1A2B" stroke-width="4"/>
    <rect x="${44 + i * 62}" y="48" width="14" height="14" fill="#c8a26b"/><rect x="${62 + i * 62}" y="68" width="14" height="14" fill="#c8a26b"/><rect x="${44 + i * 62}" y="90" width="14" height="14" fill="#E8731A"/>`).join('')}
    <rect x="70" y="130" width="34" height="18" rx="4" fill="#0B7373"/><rect x="190" y="130" width="34" height="18" rx="4" fill="#0B7373"/>
    <path d="M20 156 H300" stroke="#0B7373" stroke-width="3" stroke-dasharray="6 6"/></svg>`,
  alimentacion: `<svg viewBox="0 0 320 170"><rect width="320" height="170" fill="#ebe6db"/>
    <rect x="20" y="104" width="280" height="10" fill="#5b6672"/>
    <circle cx="96" cy="86" r="44" fill="#E8731A" opacity="0.25"/><rect x="60" y="66" width="72" height="38" rx="6" fill="#0E1A2B"/>
    <rect x="148" y="72" width="60" height="32" rx="6" fill="#9aa5b1"/><rect x="222" y="78" width="30" height="26" rx="4" fill="#0B7373"/>
    <rect x="262" y="74" width="30" height="30" fill="#c8a26b"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${30 + i * 44}" y="96" width="12" height="8" fill="#f5f3ee"/>`).join('')}</svg>`,
};

export function renderMenu(root: HTMLElement) {
  document.title = 'Gemelos digitales · Industria 5.0';
  const page = el('div', 'menu');
  page.innerHTML = `
    <div class="menu-head">
      <div>
        <div class="menu-kicker">Tendencias de la Industria 5.0</div>
        <h1>Gemelos digitales de nueva generación</h1>
        <p class="menu-lead">Tres plantas tipo de pyme simuladas en tiempo real. Provoca crisis, compara escenarios y observa las consecuencias antes de decidir.</p>
      </div>
      <div class="fila"><span class="pill" id="menu-datos"><i class="dot sim"></i> Datos simulados</span><a class="btn hidden" id="menu-salir" href="${url('salir')}">Cerrar sesión</a></div>
    </div>
    <div class="menu-cards"></div>
    <div class="menu-foot">
      <span>Simulación con semilla fija: la demo es reproducible. Ningún dato procede de empresas reales.</span>
      <span>Atajos: <b>espacio</b> pausa · <b>1 / 5 / 2</b> velocidad ×1 ×5 ×20 · <b>P</b> modo presentación · <b>Esc</b> cerrar</span>
    </div>`;
  const cards = page.querySelector('.menu-cards')!;
  for (const t of TWINS) {
    const a = el('a', 'tarjeta');
    a.href = url(t.id);
    a.dataset.link = '';
    a.innerHTML = `
      <div class="tarjeta-img">${ILUSTRACION[t.id] ?? ''}</div>
      <div class="tarjeta-body">
        <div class="tarjeta-sector">${esc(t.subtitulo)}</div>
        <h2>${esc(t.titulo)}</h2>
        <p>${esc(t.descripcion)}</p>
        <div class="tarjeta-cta">Abrir gemelo →</div>
      </div>`;
    cards.appendChild(a);
  }
  root.appendChild(page);
  fetch(url('api/sesion'), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
      if (s?.autenticacion) page.querySelector('#menu-salir')?.classList.remove('hidden');
    })
    .catch(() => {});
  fetch(url('api/datos'))
    .then((r) => r.json())
    .then((d) => {
      const p = page.querySelector('#menu-datos');
      if (p) p.innerHTML = `<i class="dot ${d.fuente === 'públicos' ? 'pub' : 'sim'}"></i> Datos ${d.fuente}`;
    })
    .catch(() => {});
  return () => {};
}
