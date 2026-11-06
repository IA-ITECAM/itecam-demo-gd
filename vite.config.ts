import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, writeFileSync } from 'node:fs';
import { normalizarBase } from './core/protocolo';

/**
 * Dos builds del mismo frontend:
 *  - normal (`vite build`): lo sirve el servidor Node (Docker/VPS), que inyecta <base href>.
 *  - estático (`vite build --mode pages`): para GitHub Pages; la simulación corre en un Web Worker.
 *    El prefijo (p. ej. /nombre-del-repo/) se toma de BASE_PATH al compilar.
 */
function paginasEstaticas(base: string): Plugin {
  // Sin servidor no hay cabeceras HTTP: la política de seguridad va en una etiqueta <meta>.
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://apidatos.ree.es https://api.open-meteo.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  let outDir = '';
  return {
    name: 'paginas-estaticas',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    transformIndexHtml(html) {
      return html
        .replace(/<base\s[^>]*>/i, `<base href="${base}" />`)
        .replace(/<meta charset="UTF-8" \/>/i, `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
    closeBundle() {
      // GitHub Pages sirve 404.html en cualquier ruta desconocida (/repo/mecanizado):
      // al ser una copia de index.html, la app arranca y su router muestra el gemelo.
      copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
      // Evita que Jekyll procese el sitio
      writeFileSync(resolve(outDir, '.nojekyll'), '');
    },
  };
}

export default defineConfig(({ mode }) => {
  const estatico = mode === 'pages';
  const base = normalizarBase(process.env.BASE_PATH);
  if (estatico && !base) throw new Error(`BASE_PATH no válido: "${process.env.BASE_PATH}"`);
  return {
    root: resolve(__dirname, 'web'),
    publicDir: resolve(__dirname, 'web/public'),
    // Rutas relativas: el mismo build funciona en la raíz del dominio o bajo un prefijo
    base: './',
    define: estatico ? { 'import.meta.env.VITE_MODO': JSON.stringify('estatico') } : {},
    plugins: estatico ? [paginasEstaticas(base!)] : [],
    worker: { format: 'es' as const },
    build: {
      outDir: resolve(__dirname, estatico ? 'dist/pages' : 'dist/public'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 1200,
    },
    server: {
      port: 5173,
      fs: { allow: [resolve(__dirname)] },
      proxy: {
        '/api': 'http://localhost:8080',
        '/ws': { target: 'ws://localhost:8080', ws: true },
      },
    },
  };
});
