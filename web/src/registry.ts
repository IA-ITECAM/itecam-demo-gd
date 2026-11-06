/**
 * Registro de gemelos en el cliente. Se descubren solos: cada carpeta twins/<id>/
 * con config.ts y scene.ts aparece en el menú y en su ruta /<id>.
 */
import type { TwinConfig } from '../../core/types';
import type { TwinClient } from './kit/types';

const configs = import.meta.glob<{ config: TwinConfig }>('../../twins/*/config.ts', { eager: true });
const scenes = import.meta.glob<{ default: TwinClient }>('../../twins/*/scene.ts');

export const TWINS: TwinConfig[] = Object.values(configs)
  .map((m) => m.config)
  .sort((a, b) => a.orden - b.orden);

export function getConfig(id: string): TwinConfig | undefined {
  return TWINS.find((t) => t.id === id);
}

export async function loadScene(id: string): Promise<TwinClient> {
  const key = Object.keys(scenes).find((k) => k.includes(`/twins/${id}/`));
  if (!key) throw new Error(`Escena no encontrada para ${id}`);
  return (await scenes[key]()).default;
}
