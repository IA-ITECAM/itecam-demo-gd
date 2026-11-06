# Gemelos digitales de nueva generación · Demo Industria 5.0

Aplicación de demostración para el webinar **«Tendencias de la Industria 5.0: gemelos digitales de nueva generación»**, pensada para pymes. Incluye dos gemelos digitales de planta (mecanizado y almacén), cada uno con escena 3D, datos en tiempo real (simulados), crisis provocables, curva de resiliencia y comparador de escenarios «¿qué pasa si…?».

- Dos formas de publicarla:
  - **Con servidor** (Docker, VPS, Dokploy o nginx): un solo contenedor y un solo puerto, **http://localhost:8080**. Admite contraseña de acceso.
  - **Sin servidor** (GitHub Pages): la simulación corre en el navegador. Es pública y gratuita (ver sección 9).
- Funciona **sin conexión a internet**: toda la geometría 3D se genera por código y no se descarga nada en tiempo de ejecución.
- Simulación con **semilla fija**: la demo sale siempre igual.
- Ningún dato procede de empresas reales.

---

## 1. Cómo arrancarlo

### Con Docker (recomendado)

```bash
docker compose up --build
```

Abre **http://localhost:8080**. Para pararlo, pulsa `Ctrl+C` o ejecuta `docker compose down`.

La configuración se lee de un fichero **`.env`** junto a `docker-compose.yml` (copia `.env.example`). Sin `.env` la demo arranca igual, con acceso libre.

| Variable | Por defecto | Qué hace |
|---|---|---|
| `CLAVE_ACCESO` | *(vacía)* | **Contraseña de acceso.** Si está definida, todo (páginas, API y tiempo real) exige iniciar sesión. Vacía = acceso libre (solo para un portátil). |
| `SECRETO_SESION` | *(aleatorio)* | Clave para firmar las sesiones. Si se deja vacía se genera al arrancar y las sesiones caducan al reiniciar el contenedor. |
| `SESION_HORAS` | `12` | Duración de la sesión. |
| `DATOS_PUBLICOS` | `0` | Con `1`, al arrancar intenta descargar el precio eléctrico (REData) y la temperatura (Open-Meteo). Si falla, usa los datos simulados. |
| `SEMILLA` | `2026` | Semilla de la simulación. Con la misma semilla, la demo es idéntica. |
| `PUERTO_LOCAL` | `8080` | Puerto del equipo en el que se publica la demo, **solo en 127.0.0.1**. |
| `BASE_PATH` | *(vacío)* | Prefijo si un proxy (nginx) publica la app en una ruta, p. ej. `/gemelos` → `https://tudominio.es/gemelos/`. Vacío = raíz de su propio dominio o subdominio. |
| `MAX_CONEXIONES` / `MAX_CONEXIONES_IP` | `60` / `15` | Conexiones de tiempo real simultáneas en total y por IP. |

### Sin Docker (desarrollo)

Requiere Node.js 20 o superior.

```bash
npm install
```

```bash
npm run build
```

```bash
npm start
```

Para desarrollar con recarga en caliente, usa dos terminales: `npm run dev:server` (backend en el puerto 8080) y `npm run dev:web` (frontend en http://localhost:5173 con proxy al backend).

Otros comandos (además, `npx tsx scripts/probe.ts <gemelo> [calibrar|barrido]` imprime KPIs, comparador y crisis para ajustar parámetros):

```bash
npm test
```

```bash
npm run typecheck
```

---

## 2. Qué hay en la pantalla

**Menú principal (`/`)**: una tarjeta por gemelo. Cada gemelo tiene su propia ruta (`/mecanizado`, `/almacen`) y desde cualquiera de ellos se vuelve con **← Menú**.

**Barra superior**: volver al menú, reloj simulado, velocidad (×1, ×5, ×20), pausa, reiniciar (misma semilla), qué escenario se está viendo en 3D, indicador **Datos simulados / Datos públicos** (al pulsarlo se activan o desactivan los datos públicos), botón **VR** (solo si el navegador admite WebXR) y **modo presentación**.

**Escena 3D**: arrastra para girar y usa la rueda para hacer zoom. Haz clic en un equipo (o en su etiqueta) para abrir su **ficha** (estado, utilización, potencia, cola, datos propios e histórico breve). Cada equipo lleva una baliza de color con su estado; cuando se avería se tiñe de **rojo intermitente**. Arriba a la izquierda aparecen las alertas.

**Panel lateral**: KPIs en vivo (producción, OEE, coste por unidad, nivel de servicio, energía, emisiones y plazo, cada uno con su flecha ↑/↓ de «más es mejor / menos es mejor»), la gráfica del ritmo de producción y tres pestañas:

- **Provocar crisis**: cuatro botones grandes.
- **¿Qué pasa si…?**: el comparador de escenarios Base / A / B.
- **Pestaña propia** de cada gemelo: *Planta y calibración* o *Flota de AGV*.

**Cómo seguir lo que pasa** (pensado para cuando ocurren muchas cosas a la vez):

- **«Qué está pasando»** (franja oscura abajo, en el centro de la escena): una o dos frases que explican en cada momento lo importante y dónde mirar. Por ejemplo: *«El proveedor no entrega. Quedan 12 piezas de material: cuando se acaben, la célula se parará»*. Durante una crisis se vuelve naranja.
- **Foco**: los equipos a los que hay que mirar se rodean de un **anillo naranja pulsante** y su etiqueta se destaca.
- **Gráfica de producción**: los tramos con crisis activa se dibujan en **naranja**, así se ve de un vistazo cuándo cae la producción y cuándo se recupera.
- **Alertas** (arriba a la izquierda): solo las 3 más graves, primero las críticas.

**Atajos de teclado**: `espacio` pausa · `1` / `5` / `2` velocidad ×1 / ×5 / ×20 · `P` modo presentación · `Esc` cierra ventanas.

**Escala de tiempo**: ×1 = 30 s simulados por segundo real (1 h simulada ≈ 2 min) · ×5 = 1 h ≈ 24 s · ×20 = 1 h ≈ 6 s.

> Un gemelo sin nadie mirándolo se queda congelado. Si quieres empezar la demo desde cero, pulsa **↺ Reiniciar**.

---

## 3. Los dos gemelos

### 3.1 Mecanizado (pyme metalmecánica)

Célula con **almacén de barra → sierra de corte → torno CNC → montaje → envío**, más un **torno alternativo** que normalmente está parado (se ve semitransparente). Las piezas (cilindros) esperan en colas visibles y se mueven en un carro naranja por el trazado verde del suelo. Hay tiempos de ciclo variables, averías aleatorias (MTBF/MTTR), transporte interno, un turno de 06:00 a 14:00 (de noche el reloj salta al día siguiente) y pedidos con plazo comprometido. El almacén de barra trabaja con poco colchón (40 piezas, ≈1 h de consumo) y guarda aparte un **stock de seguridad** de 50 piezas (la caja naranja de arriba), que solo se usa con el plan de la crisis del proveedor.

- **Layout** (pestaña *Planta y calibración*): **Funcional** ↔ **En línea**. Los equipos se desplazan en 3D y el trazado se redibuja. El recorrido de la pieza pasa de **117 m a 32 m (−73 %)**.
- **Calibración**: la gráfica compara la producción **real** (histórico de 24 h con paradas) con la del **gemelo**. Sin calibrar, el gemelo usa los tiempos de catálogo y va muy por encima (error ≈ 49 %). Al pulsar **Calibrar**, el gemelo carga las paradas registradas y ajusta los tiempos de ciclo paso a paso hasta seguir a la realidad (error ≈ 4 %). Al final aparece una tabla con los parámetros antes y después.
- **Comparador precargado**: *«Crece la demanda de una referencia»* (de 250 a 480 piezas/día). Base = sin cambios; **A = segundo turno**; **B = nueva célula** (más inversión y menor coste por pieza).

| (5 días) | Base | A · 2.º turno | B · Nueva célula |
|---|---|---|---|
| Producción | ≈ 282 piezas/día | ≈ 471 | ≈ 466 |
| Coste por pieza | ≈ 3,85 € | ≈ 5,07 € | **≈ 2,97 €** |
| Nivel de servicio | ≈ 65 % | ≈ 97 % | ≈ 100 % |

### 3.2 Almacén y logística

Nave con estanterías, **recepción** (izquierda), **expedición** (derecha), zona de **reserva**, **cargadores** y una flota de **AGV** que circula por los pasillos marcados en el suelo. Los pedidos llegan con picos (10–12 h y 17–19 h) y hay palés de entrada que ubicar. Cada AGV muestra en su etiqueta su estado (libre, cargado, cargando batería o averiado) y su batería; además, su color cambia: gris = libre, verde azulado = en tarea, azul = cargando, rojo = averiado. Cuando lleva un palé, se ve encima.

- **¿Cuántos AGV necesito?** (pestaña *Flota de AGV*): el deslizador cambia la flota en vivo y la gráfica muestra, para cada tamaño de flota, el **nivel de servicio** y el **coste por pedido** (un día completo simulado por punto). Se ve el «codo»: por debajo de 5 AGV el servicio se hunde, con 6 AGV se alcanza el 99 % al menor coste por pedido, y a partir de ahí cada AGV más encarece el pedido sin mejorar el servicio.
- **Comparador**: Base = 5 AGV · A = 7 AGV · B = 5 AGV + reorganización ABC (referencias rápidas cerca de expedición).

| (1 día) | Base · 5 AGV | A · 7 AGV | B · 5 AGV + ABC |
|---|---|---|---|
| Nivel de servicio | ≈ 88 % | ≈ 99 % | ≈ 96 % |
| Coste por pedido (incl. penalizaciones por retraso) | ≈ 2,64 € | ≈ 2,26 € | **≈ 2,21 €** |
| Plazo medio | ≈ 22 min | ≈ 3 min | ≈ 12 min |

  A da el mejor servicio y B el menor coste **sin comprar AGV**.

---

## 4. Cómo provocar cada crisis

En cualquier gemelo, abre la pestaña **Provocar crisis** y pulsa uno de los cuatro botones:

| Crisis | Mecanizado | Almacén |
|---|---|---|
| 🔧 Avería | El torno CNC se para 2,5 h. **Plan:** el torno alternativo produce mientras tanto (más despacio). | 3 de los 5 AGV averiados 2 h. **Plan:** dos carretillas manuales de apoyo (naranjas). |
| 🚚 Proveedor | No llega barra durante 4 h. El almacén se vacía en ≈1 h y **la célula se para**; al acabar la crisis llega el camión retrasado. **Plan:** stock de seguridad (+50 piezas), que **retrasa la parada pero no la evita del todo**. | No llegan camiones 4 h: cada vez más pedidos se quedan sin stock. **Plan:** servirlos desde la zona de reserva. |
| 📈 Pico de demanda | Doble de pedidos 3 h: la célula ya va al máximo y crecen los pedidos pendientes. **Plan:** torno alternativo y segundo carro. | Doble de pedidos 2,5 h. **Plan:** dos carretillas de apoyo. |
| ⚡ Energía | Electricidad ×3 durante 6 h: la producción no cambia, sube el coste. **Plan:** apagar equipos en espera y desplazar consumos auxiliares. | Electricidad ×3 durante 6 h. **Plan:** cargar solo lo imprescindible y apagar luz por zonas. |

Al lanzarla:

1. La escena 3D lo muestra al instante: el equipo se pone en rojo, aparecen alertas y las colas crecen. Arriba aparece una franja naranja con el tiempo restante de la crisis.
2. Se abre la **curva de resiliencia**. El gemelo bifurca el estado actual en tres ramas con la misma semilla (sin crisis, crisis **sin plan** y crisis **con plan ensayado**) y las simula hacia delante. La zona sombreada entre las dos curvas es la **producción que no se pierde** (o el coste que se evita, en las crisis de energía de mecanizado y almacén). Al lado se muestra el total salvado y el plan.
3. Con **Aplicar plan ensayado** (en la franja o en la ventana), el plan se aplica en vivo y se ve en 3D: se enciende el torno alternativo, aparecen las carretillas manuales de apoyo, se empieza a gastar el stock de seguridad, etc. La franja «Qué está pasando» cuenta en cada momento cómo evoluciona la crisis (por ejemplo, cuántas piezas de seguridad quedan).
4. La **✕** de la franja termina la crisis antes de tiempo.

Planes ensayados: redirigir a una máquina alternativa, usar el stock de seguridad o la zona de reserva, reforzar con un recurso de apoyo, subir la cadencia hasta el máximo validado o desplazar consumos a horas valle. Las crisis lucen más en los momentos de más actividad (por ejemplo, a media mañana).

---

## 5. Guion de demo (20 minutos)

> Consejo: antes de empezar, abre los dos gemelos una vez y pulsa **↺ Reiniciar** en cada uno. Activa el **modo presentación** (`P`) para que los KPIs y la franja «Qué está pasando» se vean más grandes al compartir pantalla. Durante la demo, si te pierdes, lee esa franja: siempre dice qué mirar.

**0:00–2:00 · Menú: qué es un gemelo digital**
- Enseña las dos tarjetas. *«Un gemelo digital no es una maqueta 3D: es un modelo que se comporta como la planta, con sus tiempos, averías, colas y costes. Hoy veremos dos pymes tipo.»*
- Señala el indicador **Datos simulados**. *«Todo es simulado y reproducible: misma semilla, mismo resultado.»*

**2:00–11:00 · Mecanizado**
1. Abre **Mecanizado** a ×5. Señala las colas delante del torno, el carro que lleva las piezas y los KPIs (OEE, coste por pieza). La franja de abajo dice que *el torno marca el ritmo*: haz clic en el **Torno CNC** para enseñar su ficha.
2. *Calibración* (pestaña **Planta y calibración**): *«Un gemelo recién hecho es optimista: usa los tiempos de catálogo.»* Pulsa **Calibrar** y comenta cómo la curva verde pasa de ir muy por encima a seguir a la negra.
3. *Layout*: pulsa **En línea**. Los equipos se mueven y el recorrido baja de 117 m a 32 m. Vuelve a **Funcional**.
4. *Crisis del proveedor* (la más visual): pulsa **El proveedor no entrega**. En la curva, enseña la caída a cero sin plan y la zona sombreada con plan. Cierra la ventana, pon ×20 y mira la franja: *«quedan 25… 12… 0 piezas»*; el almacén se pone naranja, la gráfica de producción cae a cero en naranja y los pedidos se acumulan. Pulsa **Aplicar plan ensayado**: la franja cuenta cómo se gasta el stock de seguridad. *«El plan no hace milagros: retrasa la parada y reduce la pérdida. Eso es lo que hay que saber antes de que pase.»*
5. *¿Qué pasa si…?*: **Comparar los tres escenarios**. *«Crece la demanda. Un segundo turno sirve, pero encarece la pieza. Una célula nueva cuesta más de entrada, pero baja el coste por pieza.»* Señala el mensaje inferior: **el gemelo no decide, muestra las consecuencias**.

**11:00–18:00 · Almacén**
1. Abre **Almacén** a ×5. Enseña los AGV, sus colores y sus baterías, y los palés que esperan en recepción y expedición.
2. Pestaña **Flota de AGV**: *«¿Cuántos AGV necesito?»* El servicio se dispara hasta 6 AGV y a partir de ahí el coste por pedido sube sin mejorar el servicio. Mueve el deslizador a 4 y mira crecer la cola de expedición; vuelve a 5.
3. Lanza **Avería de AGV**: tres AGV se ponen en rojo con su anillo naranja y la franja explica que el resto no da abasto. Aplica el plan: aparecen dos carretillas manuales (naranjas) y la cola deja de crecer.
4. Comparador: *«Comprar 2 AGV frente a reorganizar el almacén. Comprar da el mejor servicio; reorganizar se queda cerca y con el menor coste por pedido, sin inversión.»*

**18:00–20:00 · Cierre**
- (Opcional) Pulsa **Datos simulados** para activar los datos públicos (precio PVPC de hoy y temperatura real) si hay internet. *«El gemelo puede conectarse a datos reales; si la red falla, sigue funcionando.»*
- Mensajes clave: **calibrar** antes de confiar, **ensayar** las crisis antes de que ocurran y **comparar** opciones antes de invertir. El gemelo no decide: ilumina la decisión.

---

## 6. Datos

- **Por defecto, todo es simulado** con semilla fija (perfil de precios horarios con valle de madrugada y puntas de mañana y tarde, y temperatura de un día de otoño).
- **Datos públicos (opcional, desactivado por defecto)**, sin clave de API:
  - Precio horario de la electricidad (PVPC) de hoy: `https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real` (REData, Red Eléctrica).
  - Temperatura horaria en Tomelloso (Ciudad Real): `https://api.open-meteo.com/v1/forecast` (Open-Meteo).
  - Ambos endpoints se han comprobado. Si fallan, tardan más de 6 s o devuelven un formato inesperado, se usan los datos simulados y la interfaz sigue indicando **Datos simulados**.
- Factores de emisión de referencia: electricidad 0,12 kg CO₂/kWh y gas natural 0,202 kg CO₂/kWh. Precio del gas: 0,055 €/kWh.

---

## 7. Arquitectura

```
itecam-demo-gd/
├─ Dockerfile, docker-compose.yml   # multietapa → imagen final node:alpine sin node_modules
├─ core/                            # motor común (sin dependencias)
│  ├─ rng.ts        PRNG con semilla (mulberry32), estado clonable
│  ├─ kpis.ts       libro contable común → OEE, coste, energía, CO₂, servicio, plazo
│  ├─ clock.ts      reloj simulado (Día 1 · 06:00) y turnos
│  ├─ energy.ts     precios y temperaturas simulados
│  ├─ types.ts      contrato TwinModel, crisis, escenarios, vista
│  ├─ engine.ts     TwinRunner: velocidad, pausa, crisis, resiliencia (bifurcación), comparador
│  ├─ protocolo.ts  lista blanca de comandos (común a servidor y navegador)
│  ├─ hub.ts        simulación sin servidor (versión estática, en un Web Worker)
│  └─ datos-publicos.ts  REData y Open-Meteo (desde el servidor o desde el navegador)
├─ twins/<id>/                      # UN GEMELO = UNA CARPETA
│  ├─ config.ts     textos, crisis, escenarios, geometría (compartido servidor/cliente)
│  ├─ model.ts      simulación (servidor)
│  └─ scene.ts      escena 3D y panel propio (cliente)
├─ server/src/                      # Express + ws, un proceso, puerto 8080
├─ web/src/                         # Vite + TypeScript + Three.js + Chart.js
│  ├─ kit/scene-kit.ts  cámara, luces, selección, etiquetas, balizas, halos, instancing, WebXR
│  ├─ base.ts           prefijo de publicación (BASE_PATH, vía <base href>)
│  ├─ local/            Web Worker y conexión local de la versión estática
│  └─ ui/               comparador, curva de resiliencia, gráficas
└─ tests/                           # Vitest: semilla, KPIs, reproducibilidad, escenarios, datos
```

- **Números aleatorios comunes**: cada equipo tiene su propio generador de averías, así que en todas las ramas (con y sin plan, escenarios A y B) las averías caen en el mismo tiempo de funcionamiento y las diferencias se deben a la decisión, no al azar.
- **Simulación**: pasos de 1 s simulado; el servidor ejecuta cada gemelo y emite su estado por WebSocket 10 veces por segundo. El cliente interpola las posiciones para que el movimiento vaya fluido a 60 fps.
- **Escenarios en paralelo**: el comparador simula Base, A y B con la misma semilla. La curva de resiliencia clona el estado actual (incluido el del generador aleatorio) y lo simula en tres ramas.
- **Rendimiento**: estanterías, piezas, bandejas y palés se dibujan con `InstancedMesh`.

### Añadir un cuarto gemelo

1. Crea `twins/<nuevo>/config.ts`, `model.ts` (exporta por defecto un `TwinModel`) y `scene.ts` (exporta por defecto un `TwinClient`).
2. Ejecuta `npm run build` (o `npm run gen`). El servidor lo registra solo (`scripts/gen-registry.mjs`) y el menú lo descubre con `import.meta.glob`.

### ¿Por qué Three.js y Chart.js?

- **Three.js**: ligero, con `InstancedMesh`, `OrbitControls`, `CSS2DRenderer` (etiquetas) y `VRButton` (WebXR) de serie. Babylon.js aporta un inspector y una GUI propios que esta demo no necesita.
- **Chart.js**: incluye barras y relleno entre curvas (necesario para la curva de resiliencia), y con las animaciones desactivadas va sobrado para refrescar 10 veces por segundo.

---

## 8. Despliegue en Dokploy (VPS)

### Opción recomendada: servicio «Docker Compose»

1. Sube el proyecto a un repositorio Git **privado** (el `.env` no se sube: está en `.gitignore`).
2. En Dokploy: *Project → Create Service → Compose*. Elige el repositorio y la rama; *Compose Path*: `./docker-compose.yml`.
3. Pestaña **Environment**: pega las variables (Dokploy las guarda en un `.env` junto al compose):
   ```
   CLAVE_ACCESO=una-contraseña-larga-de-al-menos-12-caracteres
   SECRETO_SESION=pega-aquí-un-valor-aleatorio
   SESION_HORAS=12
   ```
   Genera el secreto con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` o con `openssl rand -hex 32`.
4. Pestaña **Domains**: añade tu dominio (o subdominio) con *Service* `gemelos`, *Container Port* `8080` y **HTTPS activado** (Let's Encrypt). El DNS del dominio debe apuntar a la IP del VPS.
5. **Deploy**. Al abrir el dominio debe aparecer la pantalla de contraseña.

Comprobaciones rápidas tras desplegar (cambia el dominio):

```bash
curl -sI https://demo.tudominio.es/ | head -3
```

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://demo.tudominio.es/api/datos
```

La primera debe devolver una redirección (`302`) a `/acceso` y la segunda `401`.

**Por qué es seguro así:**

- El compose **no publica el puerto 8080 hacia Internet**: solo lo abre en `127.0.0.1` del VPS, y el tráfico público entra únicamente por Traefik (el proxy de Dokploy) con HTTPS. Ojo: Docker se salta reglas de UFW cuando publica un puerto en `0.0.0.0`; por eso la publicación está limitada a `127.0.0.1`. Si en el VPS el 8080 ya está ocupado, cambia `PUERTO_LOCAL` en el Environment.
- **No abras el puerto 8080 en el cortafuegos** ni en el panel del proveedor del VPS.

### Alternativa: servicio «Application» con Dockerfile

*Create Service → Application*, *Build Type*: **Dockerfile**, las mismas variables en **Environment** y, en **Domains**, el puerto `8080` con HTTPS. Las opciones de endurecimiento del compose (`read_only`, `cap_drop`, límites de memoria y CPU) no se aplican en este modo; configura los límites de recursos en la pestaña *Advanced* de Dokploy.

### Con nginx propio delante

La configuración de referencia, probada con nginx 1.24 y 1.27, está en [`deploy/nginx-gemelos.conf`](deploy/nginx-gemelos.conf). Tiene dos opciones:

| Opción | URL pública | `BASE_PATH` en el `.env` | nginx |
|---|---|---|---|
| **A · Subdominio propio** (recomendada) | `https://gemelos.tudominio.es/` | *(vacío)* | `location / { proxy_pass http://127.0.0.1:8080; … }` |
| **B · Ruta en un dominio existente** | `https://tudominio.es/gemelos/` | `/gemelos` | `location /gemelos/ { proxy_pass http://127.0.0.1:8080; … }` |

En la opción B la app funciona tanto si nginx conserva el prefijo (`proxy_pass http://127.0.0.1:8080;`) como si lo quita (`proxy_pass http://127.0.0.1:8080/;`).

**Rutas que usa la app** (en la opción B, todas llevan delante `/gemelos`). Todas deben llegar a la app; con un único `location` que lo envíe todo basta:

| Ruta | Qué es | Sesión |
|---|---|---|
| `/` | Menú principal | Sí |
| `/mecanizado`, `/almacen` | Gemelos (la app las sirve aunque se entre directamente o se recargue la página) | Sí |
| `/acceso` (GET y POST) | Pantalla y formulario de contraseña | No |
| `/salir` | Cerrar sesión | No |
| `/assets/…`, `/favicon.svg` | Ficheros JS/CSS compilados e icono | Sí (el icono, no) |
| `/api/sesion`, `/api/datos`, `/api/gemelos` | API interna | Sí |
| `/api/health` | Comprobación de salud (`{"ok":true}`), también en la raíz | No |
| `/ws?gemelo=…` | **WebSocket** de tiempo real | Sí |

Imprescindible en nginx (ya está en el fichero de ejemplo):

- **WebSocket**: `proxy_http_version 1.1` y las cabeceras `Upgrade` y `Connection` (con el `map` del principio del fichero), y `proxy_read_timeout` largo. Sin esto, la escena 3D se queda congelada y el indicador de conexión se pone en rojo.
- **`Host $http_host`, `X-Forwarded-Host` y `X-Forwarded-Proto $scheme`**: la app los usa para validar el origen del WebSocket y del formulario, y para marcar la cookie como `Secure` bajo HTTPS.
- **`X-Forwarded-For $remote_addr`**: la IP real del visitante, para el bloqueo de intentos de contraseña. La app solo se fía de esta cabecera cuando la petición llega desde la propia máquina o una red privada (el nginx).
- **HTTPS** con certificado (por ejemplo `sudo certbot --nginx -d gemelos.tudominio.es`).

Comprobaciones tras configurar nginx (cambia la URL):

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}
" https://gemelos.tudominio.es/
```

```bash
curl -s https://gemelos.tudominio.es/api/health
```

La primera debe redirigir (`302`) a `/acceso` y la segunda devolver `{"ok":true}`. Después, entra con la contraseña y comprueba que el reloj de un gemelo avanza; eso confirma que el WebSocket atraviesa nginx.

> **Dokploy y nginx a la vez:** Dokploy ya trae su propio proxy (Traefik) en los puertos 80 y 443. Si usas Dokploy, lo más sencillo es su pestaña *Domains* (sección anterior) sin nginx. Si prefieres nginx, no configures dominio en Dokploy: nginx enviará el tráfico a `127.0.0.1:8080`, que es donde el compose publica la app. Y nginx y Traefik no pueden ocupar los dos los puertos 80 y 443.

### Recomendaciones para el VPS (fuera de esta app)

- Cortafuegos con solo los puertos **22, 80 y 443** abiertos; el panel de Dokploy (3000), restringido a tu IP o tras su propio dominio con HTTPS.
- SSH solo con clave (sin contraseña) y sin acceso directo de `root`.
- Contraseña fuerte y 2FA en el panel de Dokploy; actualizaciones automáticas de seguridad del sistema.
- Vuelve a desplegar de vez en cuando para recoger parches de la imagen base `node:24-alpine`.

---

## 9. Publicar en GitHub Pages (sin servidor)

La misma app se puede publicar como **sitio estático**. En lugar del servidor Node y el WebSocket, la simulación se ejecuta en un **Web Worker** del navegador de cada visitante, con el mismo motor y la misma semilla. Los resultados son idénticos a los de la versión con servidor (hay un test que lo comprueba).

**Cómo se publica:** el repositorio incluye el workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml). En cada push a `main` o `master` ejecuta los tests, compila la versión estática y la publica.

1. En GitHub: *Settings → Pages → Build and deployment → Source:* **GitHub Actions** (solo la primera vez).
2. Haz push. La web queda en `https://<usuario-u-organización>.github.io/<repositorio>/`.
3. Si usas un dominio propio en Pages, crea en *Settings → Secrets and variables → Actions → Variables* la variable `BASE_PATH` con el valor `/`.
4. Si el despliegue falla con un error de reglas del entorno, ve a *Settings → Environments → github-pages → Deployment branches* y añade tu rama (por ejemplo `master`). Pasa cuando Pages se activa antes del primer push: GitHub solo permite `main` por defecto.

**Publicación actual:** https://ia-itecam.github.io/itecam-demo-gd/ (repositorio [IA-ITECAM/itecam-demo-gd](https://github.com/IA-ITECAM/itecam-demo-gd)).

**Probarla en local antes de subirla** (imita a GitHub Pages: prefijo y `404.html`):

```bash
BASE_PATH=/itecam-demo-gd/ npm run build:pages
```

```bash
npm run preview:pages
```

Después, abre http://localhost:4173/itecam-demo-gd/. En Git Bash para Windows, escribe el prefijo sin la barra inicial (`BASE_PATH=itecam-demo-gd`), porque Git Bash convierte `/itecam-demo-gd/` en una ruta de Windows.

**Diferencias con la versión con servidor:**

| | Con servidor (Docker/VPS) | GitHub Pages |
|---|---|---|
| Contraseña de acceso | Sí (`CLAVE_ACCESO`) | **No**: el sitio es público para cualquiera con el enlace |
| Estado de la simulación | Compartido: todos ven la misma planta | Cada visitante tiene la suya; al recargar la página empieza de cero |
| Dónde se calcula | En el servidor | En el ordenador de quien la abre (los cálculos pesados van en un Web Worker y no congelan el 3D) |
| Datos públicos (REData, Open-Meteo) | Los consulta el servidor | Los consulta el navegador (ambas APIs lo permiten) |
| VR en Meta Quest | Requiere HTTPS en tu dominio | Funciona directamente (Pages ya usa HTTPS) |
| Coste y mantenimiento | VPS, proxy y certificados | Gratis y sin servidor que mantener |

Seguridad en Pages: no hay servidor que atacar. La página lleva una política CSP en una etiqueta `<meta>`: solo carga scripts propios y solo se conecta a REData y a Open-Meteo. Ten en cuenta que **todo el contenido es público**, así que no publiques datos reales.

---

## 10. Seguridad (versión con servidor)

Se revisó la aplicación pensando en su publicación en Internet. Medidas aplicadas:

| Riesgo | Medida |
|---|---|
| Acceso de cualquiera a la demo | Contraseña (`CLAVE_ACCESO`) en una pantalla propia. Se protegen todas las páginas, la API, los ficheros y el WebSocket. |
| Robo o falsificación de la sesión | Cookie firmada con HMAC-SHA256, `HttpOnly`, `SameSite=Strict` y `Secure` bajo HTTPS. No contiene la contraseña, caduca y deja de valer si se cambia la contraseña. Las conexiones de tiempo real se cierran al caducar la sesión. |
| Fuerza bruta | 5 fallos por IP en 15 min bloquean esa IP 15 min, con una espera de 0,6 s por fallo. La contraseña se compara en tiempo constante. Solo se confía en `X-Forwarded-For` si la petición llega desde la red privada del proxy. |
| Caída del servidor con un mensaje malformado | Antes, un único frame WebSocket inválido tumbaba el proceso (comprobado). Ahora se manejan los errores de cada conexión y los mensajes están limitados a 4 KB. |
| Comandos manipulados | Lista blanca de comandos con validación de cada argumento. Por ejemplo, antes una velocidad `"__proto__"` congelaba la simulación. Los errores internos no se envían al navegador. |
| Saturación (DoS) | Máximo 10 mensajes/s por conexión (se corta a quien abusa), los cálculos pesados se espacian, los datos públicos se consultan como mucho cada 15 s, hay límite de conexiones total y por IP, se omiten los envíos a clientes lentos y las colas y cachés de la simulación están acotadas. |
| WebSocket desde otra web (CSWSH) y CSRF | Se comprueba el `Origin` en el WebSocket y en el formulario de acceso. |
| XSS y clickjacking | CSP estricta (`script-src 'self'`, sin scripts en línea), `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff` y `Referrer-Policy`; se escapan los textos que se pintan como HTML. |
| Redirección abierta | Tras el acceso solo se vuelve a rutas internas (`/mecanizado`…). |
| Lectura de ficheros del servidor | Solo se sirven los ficheros compilados; probados intentos de *path traversal* (devuelven 404). |
| Escalada dentro del contenedor | Imagen final sin `node_modules`, usuario `node` (no root), sistema de ficheros de solo lectura, sin capacidades (`cap_drop: ALL`), `no-new-privileges` y límites de memoria, CPU y procesos. |
| Cadena de suministro | `npm ci --ignore-scripts` en la construcción; `npm audit` sin vulnerabilidades conocidas a fecha de esta revisión. |
| Secretos | El `.env` no se sube a Git ni se copia en la imagen (`.gitignore` y `.dockerignore`). |

Riesgos que quedan (asumidos para una demo):

- Es **una única contraseña compartida**: quien la tenga puede usar y controlar la demo. Cámbiala tras el webinar si la has repartido.
- Sin HTTPS la contraseña viajaría en claro: publícala **siempre** con el dominio HTTPS de Dokploy.
- El bloqueo por intentos fallidos vive en memoria y se reinicia si se reinicia el contenedor.
- Los estilos permiten `'unsafe-inline'` (las etiquetas 3D y las gráficas lo necesitan); los scripts no.
- Con `DATOS_PUBLICOS` el servidor sale a Internet, solo a `apidatos.ree.es` y `api.open-meteo.com` (URLs fijas, sin datos del usuario).

---

## 11. VR (Meta Quest 3, opcional)

El botón **VR** aparece solo si el navegador admite WebXR. Las gafas exigen un **contexto seguro** (HTTPS o `localhost`). Desplegada en Dokploy con dominio HTTPS, o en GitHub Pages, basta con abrir la URL en el navegador de las Quest. En local, `http://IP-del-portátil:8080` no basta. Opciones:

- Conectar las gafas por USB y usar `adb reverse tcp:8080 tcp:8080`; después, abrir `http://localhost:8080` en el navegador de las Quest.
- Publicar el puerto con un túnel HTTPS.

En VR apareces en el borde de la planta. Las etiquetas flotantes no se muestran en VR.

---

## 12. Limitaciones conocidas

- Son **modelos de demostración**: los parámetros son genéricos y verosímiles, pero no proceden de ninguna empresa. No deben usarse para decisiones reales sin calibrarlos.
- Los AGV no gestionan colisiones ni bloqueos entre sí (pueden cruzarse en un pasillo).
- La curva de resiliencia se calcula sobre un horizonte fijo de 6 h y se suaviza para dibujarla; los totales usan los datos sin suavizar.
- Durante el cálculo del comparador (unas décimas de segundo) o de la gráfica de flota del almacén (≈ 0,7 s la primera vez) la simulación en vivo se detiene un instante.
- Versión con servidor: todos los espectadores conectados a un mismo gemelo ven y controlan la misma instancia. En GitHub Pages cada visitante tiene la suya y no hay contraseña.
- VR: probado solo el arranque del botón; la experiencia en las Quest depende del contexto seguro descrito arriba.
