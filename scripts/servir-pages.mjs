// Sirve dist/pages imitando a GitHub Pages: bajo un prefijo y con 404.html para rutas desconocidas.
// Uso: node scripts/servir-pages.mjs [prefijo] [puerto]     (por defecto /itecam-demo-gd/ y 4173)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';

const raiz = resolve('dist/pages');
const prefijo = ('/' + (process.argv[2] ?? 'itecam-demo-gd') + '/').replace(/\/+/g, '/');
const puerto = Number(process.argv[3] ?? 4173);
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

createServer(async (req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (ruta === prefijo.slice(0, -1)) {
    res.writeHead(301, { Location: prefijo });
    return res.end();
  }
  if (!ruta.startsWith(prefijo)) {
    res.writeHead(404);
    return res.end('Fuera del sitio');
  }
  let fichero = normalize(join(raiz, ruta.slice(prefijo.length)));
  if (!fichero.startsWith(raiz)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    if ((await stat(fichero)).isDirectory()) fichero = join(fichero, 'index.html');
    const datos = await readFile(fichero);
    res.writeHead(200, { 'Content-Type': tipos[extname(fichero)] ?? 'application/octet-stream' });
    res.end(datos);
  } catch {
    res.writeHead(404, { 'Content-Type': tipos['.html'] });
    res.end(await readFile(join(raiz, '404.html')));
  }
}).listen(puerto, () => console.log(`Versión estática en http://localhost:${puerto}${prefijo}`));
