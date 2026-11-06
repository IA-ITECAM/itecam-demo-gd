import { describe, it, expect } from 'vitest';
import { SimHub } from '../core/hub';
import { TwinRunner, VELOCIDADES } from '../core/engine';
import { MODELS } from '../twins/registry.gen';

const nuevo = () => {
  const msgs: { c: string; m: any }[] = [];
  const hub = new SimHub(MODELS, 2026, (c, m) => msgs.push({ c, m }));
  const de = (c: string, tipo: string) => msgs.filter((x) => x.c === c && x.m.type === tipo).map((x) => x.m);
  return { hub, msgs, de };
};

describe('Simulación en el navegador (versión estática)', () => {
  it('al abrir un gemelo envía hola, series y el primer fotograma', () => {
    const { hub, msgs } = nuevo();
    expect(hub.abrir('a', 'mecanizado')).toBe(true);
    expect(msgs.map((x) => x.m.type)).toEqual(['hola', 'series', 'frame']);
    expect(msgs[0].m.config.id).toBe('mecanizado');
  });

  it('avanza con el reloj y respeta velocidad y pausa', async () => {
    const { hub, de } = nuevo();
    hub.abrir('a', 'almacen');
    hub.tick(1);
    expect(de('a', 'frame').at(-1).t).toBe(VELOCIDADES[1]);
    await hub.comando('a', JSON.stringify({ cmd: 'pausa', args: { v: true } }));
    const t = de('a', 'frame').at(-1).t;
    hub.tick(1);
    expect(de('a', 'frame').at(-1).t).toBe(t);
  });

  it('un gemelo sin nadie mirándolo se queda congelado', () => {
    const { hub } = nuevo();
    hub.tick(1);
    expect(hub.runners.get('mecanizado')!.state.t).toBe(0);
    hub.abrir('a', 'mecanizado');
    hub.cerrar('a');
    hub.tick(1);
    expect(hub.runners.get('mecanizado')!.state.t).toBe(0);
  });

  it('la curva de resiliencia y el comparador llegan a todos los que miran ese gemelo', async () => {
    const { hub, de } = nuevo();
    hub.abrir('a', 'mecanizado');
    hub.abrir('b', 'mecanizado');
    hub.abrir('c', 'almacen');
    await hub.comando('a', JSON.stringify({ cmd: 'crisis', args: { id: 'averia' } }));
    expect(de('a', 'resiliencia')).toHaveLength(1);
    expect(de('b', 'resiliencia')).toHaveLength(1);
    expect(de('c', 'resiliencia')).toHaveLength(0);
    await hub.comando('b', JSON.stringify({ cmd: 'comparar' }));
    expect(de('a', 'comparador')).toHaveLength(1);
  });

  it('aplica la misma lista blanca de comandos que el servidor', async () => {
    const { hub, de } = nuevo();
    hub.abrir('a', 'mecanizado');
    const antes = de('a', 'frame').length;
    for (const malo of ['basura', '{"cmd":"__proto__"}', '{"cmd":"velocidad","args":{"v":"__proto__"}}', '{"cmd":"crisis","args":{"id":"x"}}']) {
      await hub.comando('a', malo);
    }
    expect(de('a', 'frame').length).toBe(antes); // nada se ha ejecutado
    expect(hub.runners.get('mecanizado')!.speed).toBe(1);
  });

  it('gemelo desconocido: error, sin romper nada', () => {
    const { hub, de } = nuevo();
    expect(hub.abrir('a', '../etc')).toBe(false);
    expect(de('a', 'error')).toHaveLength(1);
  });

  it('da exactamente los mismos resultados que la versión con servidor', async () => {
    const { hub, de } = nuevo();
    hub.abrir('a', 'almacen');
    await hub.comando('a', JSON.stringify({ cmd: 'comparar' }));
    const local = de('a', 'comparador')[0].data.escenarios.map((e: any) => e.kpis);
    const servidor = new TwinRunner(MODELS.find((m) => m.config.id === 'almacen')!, 2026).comparar().escenarios.map((e) => e.kpis);
    expect(local).toEqual(servidor);
  });
});
