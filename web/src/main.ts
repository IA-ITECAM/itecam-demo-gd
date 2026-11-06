import './style.css';
import { renderMenu } from './menu';
import { getConfig } from './registry';
import { renderTwin } from './twin-page';

const root = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

function route() {
  cleanup?.();
  cleanup = null;
  root.innerHTML = '';
  const id = location.pathname.replace(/^\/+|\/+$/g, '');
  const cfg = id ? getConfig(id) : undefined;
  if (cfg) cleanup = renderTwin(root, cfg);
  else {
    if (id) history.replaceState(null, '', '/');
    cleanup = renderMenu(root);
  }
}

export function navigate(path: string) {
  if (path === location.pathname) return;
  history.pushState(null, '', path);
  route();
}

document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a[data-link]') as HTMLAnchorElement | null;
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href')!);
});
window.addEventListener('popstate', route);
route();
