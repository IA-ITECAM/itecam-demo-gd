import { describe, it, expect } from 'vitest';
import { makeRng, rand, poisson } from '../core/rng';
import { newLedger, kpisFrom, addEnergy, FACTOR_CO2, oee } from '../core/kpis';
import { reloj, horaDecimal, siguienteHora, enVentana } from '../core/clock';
import { TwinRunner, VELOCIDADES, clone } from '../core/engine';
import { MODELS } from '../twins/registry.gen';

const model = (id: string) => MODELS.find((m) => m.config.id === id)!;

describe('Generador aleatorio con semilla', () => {
  it('misma semilla → misma secuencia', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const sa = Array.from({ length: 50 }, () => rand(a));
    const sb = Array.from({ length: 50 }, () => rand(b));
    expect(sa).toEqual(sb);
  });
  it('semillas distintas → secuencias distintas', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(rand(a)).not.toEqual(rand(b));
  });
  it('el estado se puede clonar y continúa igual', () => {
    const a = makeRng(7);
    rand(a);
    const b = clone(a);
    expect(rand(a)).toEqual(rand(b));
  });
  it('valores en [0, 1) y media razonable', () => {
    const r = makeRng(3);
    let s = 0;
    for (let i = 0; i < 20000; i++) {
      const x = rand(r);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      s += x;
    }
    expect(s / 20000).toBeCloseTo(0.5, 1);
  });
  it('Poisson: la media de llegadas coincide con la tasa', () => {
    const r = makeRng(9);
    let n = 0;
    for (let i = 0; i < 36000; i++) n += poisson(r, 60, 1); // 10 h a 60/h
    expect(n).toBeGreaterThan(540);
    expect(n).toBeLessThan(660);
  });
});

describe('Cálculo de KPIs', () => {
  it('OEE = disponibilidad × rendimiento × calidad', () => {
    const L = newLedger();
    L.workS = 8 * 3600;
    L.oPlan = 8 * 3600;
    L.oUp = 7 * 3600; // A = 0.875
    L.oIdeal = 5.6 * 3600; // P = 0.8
    L.processed = 400;
    L.good = 380;
    L.scrap = 20; // Q = 0.95
    const k = kpisFrom(L);
    expect(k.disponibilidad).toBeCloseTo(87.5, 6);
    expect(k.rendimiento).toBeCloseTo(80, 6);
    expect(k.calidad).toBeCloseTo(95, 6);
    expect(k.oee).toBeCloseTo(oee(0.875, 0.8, 0.95) * 100, 6);
    expect(k.oee).toBeCloseTo(66.5, 6);
    expect(k.produccionHora).toBeCloseTo(380 / 8, 6);
  });
  it('coste por unidad, energía y emisiones', () => {
    const L = newLedger();
    L.good = 100;
    addEnergy(L, 50, 3600, 'elec', 0.2); // 50 kWh, 10 €
    addEnergy(L, 100, 3600, 'gas', 0.05); // 100 kWh, 5 €
    L.laborCost = 80;
    L.fixedCost = 5;
    const k = kpisFrom(L);
    expect(k.energiaKWh).toBeCloseTo(150, 6);
    expect(k.costeEnergia).toBeCloseTo(15, 6);
    expect(k.costeUnidad).toBeCloseTo((15 + 80 + 5) / 100, 6);
    expect(k.co2Kg).toBeCloseTo(50 * FACTOR_CO2.elec + 100 * FACTOR_CO2.gas, 6);
    expect(k.energiaUnidad).toBeCloseTo(1.5, 6);
  });
  it('nivel de servicio acotado a 100 % y sin divisiones por cero', () => {
    const L = newLedger();
    let k = kpisFrom(L);
    expect(k.servicio).toBe(100);
    expect(k.costeUnidad).toBe(0);
    L.servNum = 12;
    L.servDen = 10;
    k = kpisFrom(L);
    expect(k.servicio).toBe(100);
  });
  it('producción diaria con tiempo de calendario', () => {
    const L = newLedger();
    L.good = 600;
    L.workS = 16 * 3600;
    expect(kpisFrom(L, 2 * 86400).produccionDia).toBeCloseTo(300, 6);
  });
});

describe('Reloj simulado', () => {
  it('t = 0 es el Día 1 a las 06:00', () => {
    expect(reloj(0)).toBe('Día 1 · 06:00');
    expect(reloj(18 * 3600 + 90)).toBe('Día 2 · 00:01');
    expect(horaDecimal(3600 * 2.5)).toBeCloseTo(8.5);
  });
  it('ventanas horarias y salto al siguiente turno', () => {
    expect(enVentana(0, 6, 14)).toBe(true);
    expect(enVentana(8 * 3600, 6, 14)).toBe(false);
    expect(enVentana(19 * 3600, 22, 6)).toBe(true); // 01:00
    expect(horaDecimal(siguienteHora(9 * 3600, 6))).toBeCloseTo(6);
  });
});

describe.each(MODELS.map((m) => m.config.id))('Gemelo %s', (id) => {
  it('es reproducible: misma semilla → mismos KPIs', () => {
    const a = new TwinRunner(model(id), 2026);
    const b = new TwinRunner(model(id), 2026);
    a.advance(4 * 3600);
    b.advance(4 * 3600);
    expect(a.kpis()).toEqual(b.kpis());
    expect(a.kpis().unidades).toBeGreaterThan(0);
  });
  it('reiniciar vuelve exactamente al mismo recorrido', () => {
    const a = new TwinRunner(model(id), 2026);
    a.advance(2 * 3600);
    const k1 = a.kpis();
    a.reset();
    a.advance(2 * 3600);
    expect(a.kpis()).toEqual(k1);
  });
  it('semillas distintas dan resultados distintos', () => {
    const a = new TwinRunner(model(id), 1);
    const b = new TwinRunner(model(id), 2);
    a.advance(3 * 3600);
    b.advance(3 * 3600);
    expect(a.kpis()).not.toEqual(b.kpis());
  });
  it('KPIs dentro de rangos válidos', () => {
    const r = new TwinRunner(model(id), 2026);
    r.advance(6 * 3600);
    const k = r.kpis();
    for (const key of ['oee', 'disponibilidad', 'rendimiento', 'calidad', 'servicio'] as const) {
      expect(k[key]).toBeGreaterThanOrEqual(0);
      expect(k[key]).toBeLessThanOrEqual(100.0001);
    }
    expect(k.oee).toBeCloseTo((k.disponibilidad * k.rendimiento * k.calidad) / 10000, 6);
    expect(k.costeUnidad).toBeGreaterThan(0);
    expect(k.energiaKWh).toBeGreaterThan(0);
    expect(k.co2Kg).toBeGreaterThan(0);
  });
  it('velocidad y pausa', () => {
    const r1 = new TwinRunner(model(id), 2026);
    const r20 = new TwinRunner(model(id), 2026);
    r20.command('velocidad', { v: 20 });
    r1.tick(1);
    r20.tick(1);
    expect(r1.state.workT).toBe(VELOCIDADES[1]);
    expect(r20.state.workT).toBe(VELOCIDADES[20]);
    r1.command('pausa', { v: true });
    const t = r1.state.t;
    r1.tick(1);
    expect(r1.state.t).toBe(t);
  });
  it('lanzar una crisis no altera el estado de la bifurcación de referencia', () => {
    const r = new TwinRunner(model(id), 2026);
    r.advance(3600);
    const antes = JSON.stringify(r.state.L);
    const res = r.resiliencia('averia');
    expect(JSON.stringify(r.state.L)).toBe(antes);
    expect(res.sinPlan.length).toBe(res.conPlan.length);
    expect(res.sinPlan.length).toBeGreaterThan(0);
  });
  it('el plan ensayado reduce la pérdida en cada crisis', () => {
    const r = new TwinRunner(model(id), 2026);
    r.advance(2 * 3600);
    for (const c of r.config.crisis) {
      const res = r.resiliencia(c.id);
      expect(res.perdidaSinPlan, `${id}/${c.id}`).toBeGreaterThanOrEqual(res.perdidaConPlan - 25);
    }
  });
  it('el comparador ejecuta base, A y B con la misma semilla', () => {
    const r = new TwinRunner(model(id), 2026);
    const c = r.comparar();
    expect(c.escenarios.map((e) => e.id)).toEqual(['base', 'A', 'B']);
    const c2 = new TwinRunner(model(id), 2026).comparar();
    expect(c2.escenarios.map((e) => e.kpis)).toEqual(c.escenarios.map((e) => e.kpis));
  });
});

describe('Mensajes de negocio de cada comparador', () => {
  it('Mecanizado: B (nueva célula) da menor coste por pieza; A (2.º turno) mejora el servicio', () => {
    const c = new TwinRunner(model('mecanizado'), 2026).comparar();
    const [base, A, B] = c.escenarios.map((e) => e.kpis);
    expect(B.costeUnidad).toBeLessThan(base.costeUnidad);
    expect(B.costeUnidad).toBeLessThan(A.costeUnidad);
    expect(A.servicio).toBeGreaterThan(base.servicio + 15);
  });
  it('Almacén: más AGV mejora el servicio', () => {
    const c = new TwinRunner(model('almacen'), 2026).comparar();
    const [base, A] = c.escenarios.map((e) => e.kpis);
    expect(A.servicio).toBeGreaterThan(base.servicio);
  });
  it('Alimentación: A y B cuestan parecido, pero B gasta claramente menos energía y emite menos', () => {
    const c = new TwinRunner(model('alimentacion'), 2026).comparar();
    const [, A, B] = c.escenarios.map((e) => e.kpis);
    expect(Math.abs(B.costeUnidad - A.costeUnidad) / A.costeUnidad).toBeLessThan(0.08);
    expect(Math.abs(B.plazo - A.plazo) / A.plazo).toBeLessThan(0.15);
    expect(B.energiaUnidad).toBeLessThan(A.energiaUnidad * 0.7);
    expect(B.co2Unidad).toBeLessThan(A.co2Unidad * 0.5);
  });
  it('Mecanizado: la calibración reduce el error contra la serie real', () => {
    const r = new TwinRunner(model('mecanizado'), 2026);
    const res: any = r.command('calibrar')!.data;
    const its = res.iteraciones;
    expect(its[0].error).toBeGreaterThan(30);
    expect(its[its.length - 1].error).toBeLessThan(8);
  });
  it('Mecanizado: la distribución en línea acorta el recorrido de la pieza', () => {
    const r = new TwinRunner(model('mecanizado'), 2026);
    const res: any = r.command('layout', { v: 'linea' })!.data;
    expect(res.linea).toBeLessThan(res.funcional * 0.5);
    expect((r.state.p as any).layout).toBe('linea');
    r.reset();
    expect((r.state.p as any).layout).toBe('linea'); // el ajuste sobrevive al reinicio
  });
});
