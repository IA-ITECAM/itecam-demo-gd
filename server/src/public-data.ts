/** Datos públicos en el servidor: misma lógica que en el navegador (core/datos-publicos.ts). */
import { configurarCabeceras } from '../../core/datos-publicos';

configurarCabeceras({ 'User-Agent': 'itecam-demo-gd' });

export * from '../../core/datos-publicos';
