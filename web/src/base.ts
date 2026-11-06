/**
 * Prefijo en el que está publicada la app: "/" (dominio propio) o, por ejemplo, "/gemelos/"
 * (detrás de un nginx con una ruta). El servidor lo inyecta en <base href> de index.html
 * a partir de la variable BASE_PATH, así que el mismo build sirve para cualquier prefijo.
 */
export const BASE: string = (() => {
  const p = new URL(document.baseURI).pathname;
  return p.endsWith('/') ? p : p.replace(/[^/]*$/, '');
})();

/** Ruta absoluta dentro de la app: url('api/datos') → "/gemelos/api/datos". */
export const url = (p: string) => BASE + p.replace(/^\/+/, '');

/** Ruta interna de la página actual, sin el prefijo: "/mecanizado". */
export function rutaActual(): string {
  const path = location.pathname;
  const rel = path.startsWith(BASE) ? path.slice(BASE.length) : path.replace(/^\/+/, '');
  return '/' + rel.replace(/\/+$/, '');
}
