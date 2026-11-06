// Descubre los gemelos (una carpeta por gemelo en /twins) y genera el registro del servidor.
// Para añadir un gemelo nuevo basta con crear twins/<id>/{config,model,scene}.ts
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = join(process.cwd(), 'twins');
const ids = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'model.ts')))
  .map((d) => d.name)
  .sort();
const out = `// ARCHIVO GENERADO por scripts/gen-registry.mjs — no editar a mano.
import type { TwinModel } from '../core/types';
${ids.map((id, i) => `import m${i} from './${id}/model';`).join('\n')}

export const MODELS: TwinModel<any, any, any>[] = [${ids.map((_, i) => `m${i}`).join(', ')}];
`;
writeFileSync(join(dir, 'registry.gen.ts'), out);
console.log(`Gemelos registrados: ${ids.join(', ')}`);
