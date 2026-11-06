import { describe, it, expect, vi, afterEach } from 'vitest';
import { cargarDatos } from '../server/src/public-data';
import { PRECIOS_SIMULADOS, TEMPERATURAS_SIMULADAS } from '../core/energy';

afterEach(() => vi.unstubAllGlobals());

describe('Datos públicos opcionales', () => {
  it('desactivados por defecto: datos simulados', async () => {
    const d = await cargarDatos(false);
    expect(d.fuente).toBe('simulados');
    expect(d.ctx.precios).toEqual(PRECIOS_SIMULADOS);
  });

  it('sin red: vuelve a los simulados sin romper nada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')));
    const d = await cargarDatos(true);
    expect(d.fuente).toBe('simulados');
    expect(d.ctx.precios).toEqual(PRECIOS_SIMULADOS);
    expect(d.ctx.temperaturas).toEqual(TEMPERATURAS_SIMULADAS);
    expect(d.detalle).toContain('simulado');
  });

  it('con respuestas válidas: interpreta REData (€/MWh → €/kWh) y Open-Meteo', async () => {
    const values = Array.from({ length: 24 }, (_, h) => ({ value: 100 + h, datetime: `2026-11-05T${String(h).padStart(2, '0')}:00:00.000+01:00` }));
    const temps = Array.from({ length: 24 }, (_, h) => 10 + h * 0.1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (url.includes('ree.es') ? { included: [{ type: 'PVPC', attributes: { title: 'PVPC', values } }] } : { hourly: { temperature_2m: temps } }),
      })),
    );
    const d = await cargarDatos(true);
    expect(d.fuente).toBe('públicos');
    expect(d.ctx.precios[0]).toBeCloseTo(0.1, 6);
    expect(d.ctx.precios[23]).toBeCloseTo(0.123, 6);
    expect(d.ctx.temperaturas).toEqual(temps);
  });

  it('respuesta con formato inesperado: se ignora', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ algo: 'raro' }) })));
    const d = await cargarDatos(true);
    expect(d.fuente).toBe('simulados');
  });
});
