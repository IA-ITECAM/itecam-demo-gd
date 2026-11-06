import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';
import {
  leerConfig,
  claveCorrecta,
  crearToken,
  tokenValido,
  leerCookies,
  destinoSeguro,
  LimitadorIntentos,
  validarMensaje,
  CuboFichas,
  origenPermitido,
  ipCliente,
  paginaAcceso,
  cookieSesion,
} from '../server/src/seguridad';
import { TwinRunner } from '../core/engine';
import { MODELS } from '../twins/registry.gen';

const req = (headers: Record<string, string>, remota = '203.0.113.7') =>
  ({ headers, socket: { remoteAddress: remota } }) as unknown as IncomingMessage;

describe('Contraseña y sesiones', () => {
  const cfg = leerConfig({ CLAVE_ACCESO: 'una-clave-larga-123', SECRETO_SESION: 'secreto' });

  it('compara la contraseña correctamente', () => {
    expect(claveCorrecta('una-clave-larga-123', cfg.clave)).toBe(true);
    expect(claveCorrecta('una-clave-larga-124', cfg.clave)).toBe(false);
    expect(claveCorrecta('', cfg.clave)).toBe(false);
    expect(claveCorrecta(undefined, cfg.clave)).toBe(false);
    expect(claveCorrecta(['una-clave-larga-123'], cfg.clave)).toBe(false);
    expect(claveCorrecta('cualquiera', '')).toBe(false);
  });

  it('el token firmado es válido hasta que caduca', () => {
    const ahora = Date.now();
    const t = crearToken(cfg.claveFirma, ahora + 60_000);
    expect(tokenValido(t, cfg.claveFirma, ahora)).toBe(true);
    expect(tokenValido(t, cfg.claveFirma, ahora + 61_000)).toBe(false);
  });

  it('rechaza tokens manipulados o de otra contraseña', () => {
    const ahora = Date.now();
    const t = crearToken(cfg.claveFirma, ahora + 60_000);
    const [v, , firma] = t.split('.');
    expect(tokenValido(`${v}.${ahora + 9e9}.${firma}`, cfg.claveFirma, ahora)).toBe(false); // caducidad alargada
    expect(tokenValido(t.slice(0, -2) + 'xx', cfg.claveFirma, ahora)).toBe(false);
    expect(tokenValido('basura', cfg.claveFirma, ahora)).toBe(false);
    expect(tokenValido(undefined, cfg.claveFirma, ahora)).toBe(false);
    const otra = leerConfig({ CLAVE_ACCESO: 'otra-clave', SECRETO_SESION: 'secreto' });
    expect(tokenValido(t, otra.claveFirma, ahora)).toBe(false); // cambiar la contraseña invalida las sesiones
  });

  it('cookie HttpOnly y SameSite=Strict, Secure en HTTPS', () => {
    const c = cookieSesion('tok', 3600, true);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Secure');
    expect(cookieSesion('tok', 3600, false)).not.toContain('Secure');
  });

  it('lee cookies sin contaminar el prototipo', () => {
    const c = leerCookies('a=1; __proto__=x; gd_sesion=abc%2Edef');
    expect(c.a).toBe('1');
    expect(c.gd_sesion).toBe('abc.def');
    expect(({} as any).x).toBeUndefined();
  });

  it('sin SECRETO_SESION cada arranque genera una clave distinta', () => {
    const a = leerConfig({ CLAVE_ACCESO: 'x' });
    const b = leerConfig({ CLAVE_ACCESO: 'x' });
    expect(a.claveFirma.equals(b.claveFirma)).toBe(false);
  });
});

describe('Redirecciones, origen e IP', () => {
  it('solo redirige a rutas internas', () => {
    expect(destinoSeguro('/mecanizado')).toBe('/mecanizado');
    expect(destinoSeguro('/')).toBe('/');
    for (const malo of ['//evil.com', 'https://evil.com', '/\\evil.com', '/a/../b', 'javascript:alert(1)', 42, undefined]) {
      expect(destinoSeguro(malo)).toBe('/');
    }
  });

  it('acepta el WebSocket solo desde el mismo sitio', () => {
    expect(origenPermitido(req({ host: 'demo.ejemplo.es', origin: 'https://demo.ejemplo.es' }))).toBe(true);
    expect(origenPermitido(req({ host: 'demo.ejemplo.es', origin: 'https://atacante.com' }))).toBe(false);
    expect(origenPermitido(req({ host: 'demo.ejemplo.es', origin: 'null' }))).toBe(false);
    expect(origenPermitido(req({ host: 'demo.ejemplo.es', origin: 'null', 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(origenPermitido(req({ host: 'demo.ejemplo.es', origin: 'null', 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(origenPermitido(req({ host: 'interno:8080', 'x-forwarded-host': 'demo.ejemplo.es', origin: 'https://demo.ejemplo.es' }))).toBe(true);
  });

  it('solo se fía de X-Forwarded-For si viene del proxy (red privada)', () => {
    expect(ipCliente(req({ 'x-forwarded-for': '1.2.3.4' }, '203.0.113.7'))).toBe('203.0.113.7');
    expect(ipCliente(req({ 'x-forwarded-for': '9.9.9.9, 1.2.3.4' }, '10.0.1.5'))).toBe('1.2.3.4');
  });

  it('la página de acceso escapa los textos', () => {
    const html = paginaAcceso({ error: '<script>x</script>', volver: '"><img>' });
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('name="volver" value="/"');
  });
});

describe('Límite de intentos', () => {
  it('bloquea una IP tras 5 fallos y no afecta a otras', () => {
    const l = new LimitadorIntentos(5, 60_000, 60_000);
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) l.fallo('1.1.1.1', t);
    expect(l.bloqueado('1.1.1.1', t)).toBe(0);
    l.fallo('1.1.1.1', t);
    expect(l.bloqueado('1.1.1.1', t)).toBeGreaterThan(0);
    expect(l.bloqueado('2.2.2.2', t)).toBe(0);
    expect(l.bloqueado('1.1.1.1', t + 61_000)).toBe(0);
  });
  it('un acceso correcto reinicia el contador', () => {
    const l = new LimitadorIntentos(3, 60_000, 60_000);
    l.fallo('ip', 0);
    l.fallo('ip', 0);
    l.exito('ip');
    l.fallo('ip', 0);
    expect(l.bloqueado('ip', 0)).toBe(0);
  });
});

describe('Mensajes del WebSocket', () => {
  it('acepta solo comandos conocidos con argumentos válidos', () => {
    expect(validarMensaje('{"cmd":"velocidad","args":{"v":20}}')).toEqual({ cmd: 'velocidad', args: { v: 20 } });
    expect(validarMensaje('{"cmd":"flota","args":{"n":7}}')).toEqual({ cmd: 'flota', args: { n: 7 } });
    expect(validarMensaje('{"cmd":"crisis","args":{"id":"averia","extra":"x"}}')).toEqual({ cmd: 'crisis', args: { id: 'averia' } });
  });
  it('descarta comandos y argumentos peligrosos o inválidos', () => {
    for (const malo of [
      'no es json',
      'null',
      '[]',
      '{"cmd":"__proto__"}',
      '{"cmd":"constructor"}',
      '{"cmd":"toString"}',
      '{"cmd":"velocidad","args":{"v":"__proto__"}}',
      '{"cmd":"velocidad","args":{"v":7}}',
      '{"cmd":"crisis","args":{"id":"rm -rf"}}',
      '{"cmd":"flota","args":{"n":1e9}}',
      '{"cmd":"flota","args":{"n":2.5}}',
      '{"cmd":"escenario","args":{"id":"C"}}',
      '{"cmd":"layout","args":{"v":"x"}}',
      'x'.repeat(5000),
    ]) {
      expect(validarMensaje(malo), malo.slice(0, 40)).toBeNull();
    }
  });
  it('el cubo de fichas limita la frecuencia de mensajes', () => {
    const c = new CuboFichas(10, 5, 1000);
    let ok = 0;
    for (let i = 0; i < 50; i++) if (c.tomar(1000)) ok++;
    expect(ok).toBe(5);
    expect(c.tomar(1200)).toBe(true); // se recargan 2 fichas en 200 ms
  });
  it('el motor ignora velocidades no válidas aunque lleguen', () => {
    const r = new TwinRunner(MODELS.find((m) => m.config.id === 'mecanizado')!, 1);
    r.command('velocidad', { v: '__proto__' });
    r.command('velocidad', { v: 'constructor' });
    expect(r.speed).toBe(1);
    r.tick(1);
    expect(r.state.workT).toBeGreaterThan(0);
    expect(() => r.command('crisis', { id: 'inexistente' })).toThrow();
  });
});
