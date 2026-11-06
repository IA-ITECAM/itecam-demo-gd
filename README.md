# Gemelos digitales de nueva generación · Demo Industria 5.0

Aplicación de demostración para el webinar **«Tendencias de la Industria 5.0: gemelos digitales de nueva generación»**, pensada para pymes. Incluye tres gemelos digitales de planta, cada uno con escena 3D, datos en tiempo real (simulados), crisis provocables, curva de resiliencia y comparador de escenarios «¿qué pasa si…?».

- Un solo contenedor y un solo puerto: **http://localhost:8080**
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

Variables opcionales (en `docker-compose.yml`):

| Variable | Por defecto | Qué hace |
|---|---|---|
| `DATOS_PUBLICOS` | `0` | Con `1`, al arrancar intenta descargar el precio eléctrico (REData) y la temperatura (Open-Meteo). Si falla, usa los datos simulados. |
| `SEMILLA` | `2026` | Semilla de la simulación. Con la misma semilla, la demo es idéntica. |
| `PORT` | `8080` | Puerto interno. |

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

**Menú principal (`/`)**: una tarjeta por gemelo. Cada gemelo tiene su propia ruta (`/mecanizado`, `/almacen`, `/alimentacion`) y desde cualquiera de ellos se vuelve con **← Menú**.

**Barra superior**: volver al menú, reloj simulado, velocidad (×1, ×5, ×20), pausa, reiniciar (misma semilla), qué escenario se está viendo en 3D, indicador **Datos simulados / Datos públicos** (al pulsarlo se activan o desactivan los datos públicos), botón **VR** (solo si el navegador admite WebXR) y **modo presentación**.

**Escena 3D**: arrastra para girar y usa la rueda para hacer zoom. Haz clic en un equipo (o en su etiqueta) para abrir su **ficha** (estado, utilización, potencia, cola, datos propios e histórico breve). Cada equipo lleva una baliza de color con su estado; cuando se avería se tiñe de **rojo intermitente**. Arriba a la izquierda aparecen las alertas.

**Panel lateral**: KPIs en vivo (producción, OEE, coste por unidad, nivel de servicio, energía, emisiones y plazo, cada uno con su flecha ↑/↓ de «más es mejor / menos es mejor»), la gráfica del ritmo de producción y tres pestañas:

- **Provocar crisis**: cuatro botones grandes.
- **¿Qué pasa si…?**: el comparador de escenarios Base / A / B.
- **Pestaña propia** de cada gemelo: *Planta y calibración*, *Flota de AGV* o *Energía*.

**Atajos de teclado**: `espacio` pausa · `1` / `5` / `2` velocidad ×1 / ×5 / ×20 · `P` modo presentación · `Esc` cierra ventanas.

**Escala de tiempo**: ×1 = 30 s simulados por segundo real (1 h simulada ≈ 2 min) · ×5 = 1 h ≈ 24 s · ×20 = 1 h ≈ 6 s.

> Un gemelo sin nadie mirándolo se queda congelado. Si quieres empezar la demo desde cero, pulsa **↺ Reiniciar**.

---

## 3. Los tres gemelos

### 3.1 Mecanizado (pyme metalmecánica)

Célula con **almacén de barra → sierra de corte → torno CNC → montaje → envío**, más un **torno alternativo** que normalmente está parado (se ve semitransparente). Las piezas (cilindros) esperan en colas visibles y se mueven en un carro naranja por el trazado verde del suelo. Hay tiempos de ciclo variables, averías aleatorias (MTBF/MTTR), transporte interno, un turno de 06:00 a 14:00 (de noche el reloj salta al día siguiente) y pedidos con plazo comprometido.

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

### 3.3 Alimentación y envasado (energía y sostenibilidad)

Línea continua (24 h) de **dosificación → horno túnel → túnel de enfriamiento → acumulación → envasadora → paletizado**. Las bandejas cambian de color al hornearse y los palés se apilan al final. El consumo de cada equipo se ve en 3D mediante un **halo naranja que crece con la potencia** y en la gráfica apilada de la pestaña **Energía**, junto con la potencia, el coste por hora, los kg de CO₂ por hora y el precio eléctrico del momento.

- **Escenario energético**: «Producir lo mismo con menos energía». A = horno de gas nuevo; B = horno eléctrico con bomba de calor y recuperación del calor del frío. En la pestaña *Energía* puedes ver A o B en 3D (el halo del horno encoge con B) y lanzar la comparación.

| (24 h) | A · Gas nuevo | B · Eléctrico + bomba de calor |
|---|---|---|
| Producción | ≈ 6.821 cajas/día | ≈ 6.814 cajas/día |
| Coste por caja | ≈ 0,75 € | ≈ 0,77 € (parecido) |
| Plazo | ≈ 21 min | ≈ 22 min (parecido) |
| Energía por caja | ≈ 1,36 kWh | **≈ 0,76 kWh (−44 %)** |
| Emisiones por caja | ≈ 0,24 kg CO₂ | **≈ 0,09 kg CO₂ (−63 %)** |

---

## 4. Cómo provocar cada crisis

En cualquier gemelo, abre la pestaña **Provocar crisis** y pulsa uno de los cuatro botones:

| Crisis | Mecanizado | Almacén | Alimentación |
|---|---|---|---|
| 🔧 Avería | El torno CNC se para 2,5 h | 2 AGV averiados 2 h | El horno se para 2 h (se pierde el producto que había dentro) |
| 🚚 Proveedor | Sin barra de acero 5 h | Sin camiones 4 h: referencias sin stock | Sin materia prima 5 h |
| 📈 Pico de demanda | Doble de pedidos 3 h | Doble de pedidos 2,5 h | +60 % de pedidos 4 h |
| ⚡ Energía | Electricidad ×3 durante 6 h | Electricidad ×3 durante 6 h | Electricidad ×3 durante 8 h (sin plan se recorta producción) |

Al lanzarla:

1. La escena 3D lo muestra al instante: el equipo se pone en rojo, aparecen alertas y las colas crecen. Arriba aparece una franja naranja con el tiempo restante de la crisis.
2. Se abre la **curva de resiliencia**. El gemelo bifurca el estado actual en tres ramas con la misma semilla (sin crisis, crisis **sin plan** y crisis **con plan ensayado**) y las simula hacia delante. La zona sombreada entre las dos curvas es la **producción que no se pierde** (o el coste que se evita, en las crisis de energía de mecanizado y almacén). Al lado se muestra el total salvado y el plan.
3. Con **Aplicar plan ensayado** (en la franja o en la ventana), el plan se aplica en vivo y se ve en 3D: se enciende el torno alternativo, aparece la carretilla manual de apoyo, se usa el stock de seguridad, etc.
4. La **✕** de la franja termina la crisis antes de tiempo.

Planes ensayados: redirigir a una máquina alternativa, usar el stock de seguridad o la zona de reserva, reforzar con un recurso de apoyo, subir la cadencia hasta el máximo validado o desplazar consumos a horas valle. Las crisis lucen más en los momentos de más actividad (por ejemplo, a media mañana).

---

## 5. Guion de demo (20 minutos)

> Consejo: antes de empezar, abre los tres gemelos una vez y pulsa **↺ Reiniciar** en cada uno. Activa el **modo presentación** (`P`) para que los KPIs se vean más grandes al compartir pantalla.

**0:00–2:00 · Menú: qué es un gemelo digital**
- Enseña las tres tarjetas. *«Un gemelo digital no es una maqueta 3D: es un modelo que se comporta como la planta, con sus tiempos, averías, colas, costes y energía. Hoy veremos tres pymes tipo.»*
- Señala el indicador **Datos simulados**. *«Todo es simulado y reproducible: misma semilla, mismo resultado.»*

**2:00–8:00 · Mecanizado**
1. Abre **Mecanizado** a ×5. Señala las colas delante del torno, el carro que lleva las piezas y los KPIs (OEE, coste por pieza). Haz clic en el **Torno CNC** para enseñar su ficha.
2. *Calibración* (pestaña **Planta y calibración**): *«Un gemelo recién hecho es optimista: usa los tiempos de catálogo.»* Pulsa **Calibrar** y comenta cómo la curva verde pasa de ir muy por encima a seguir a la negra. *«Sin calibrar, el gemelo engaña. Calibrado con datos reales, es una herramienta para decidir.»*
3. *Layout*: pulsa **En línea**. Los equipos se mueven y el recorrido baja de 117 m a 32 m. *«Antes de mover una sola máquina, ya sabemos cuánto recorrido nos ahorramos.»*
4. *Crisis*: **Avería del torno**. Enseña el torno en rojo y la curva de resiliencia. *«El gemelo nos dice cuánto perdemos si no hacemos nada y cuánto salvamos con el plan ensayado.»* Pulsa **Aplicar plan ensayado** y enseña cómo se enciende el torno alternativo.
5. *¿Qué pasa si…?*: **Comparar los tres escenarios**. *«Crece la demanda. Un segundo turno sirve, pero encarece la pieza. Una célula nueva cuesta más de entrada, pero baja el coste por pieza.»* Señala el mensaje inferior: **el gemelo no decide, muestra las consecuencias**.

**8:00–13:00 · Almacén**
1. Abre **Almacén** a ×5. Enseña los AGV, sus colores y sus baterías, y los palés que esperan en recepción y expedición.
2. Pestaña **Flota de AGV**: *«¿Cuántos AGV necesito?»* Explica la gráfica: el servicio se dispara hasta 6 AGV y a partir de ahí el coste por pedido sube sin mejorar el servicio. Mueve el deslizador a 4 y verás cómo crecen las colas de pedidos en expedición.
3. Vuelve a 5 y lanza **Avería de AGV** o **Pico de demanda** (mejor a media mañana, cuando hay más pedidos). Aplica el plan: aparecen las carretillas manuales de apoyo (naranjas).
4. Comparador: *«Comprar 2 AGV frente a reorganizar el almacén. Comprar da el mejor servicio; reorganizar se queda cerca y con el menor coste por pedido, sin inversión.»*

**13:00–18:00 · Alimentación: energía y sostenibilidad**
1. Abre **Alimentación** a ×5. Señala los **halos naranjas**: *«el tamaño del halo es lo que consume cada equipo»*. El horno es el gran consumidor.
2. Pestaña **Energía**: la gráfica apilada por equipo, los €/h y los kg de CO₂/h.
3. Pulsa **B · Eléctrico**: el halo del horno encoge. Luego **Comparar A y B**: *«En coste y en plazo son parecidas (barras en verde suave), pero B consume un 44 % menos de energía y emite un 63 % menos. Con el gemelo, esa decisión se toma con datos.»*
4. Crisis **Sube el precio de la energía**: *«Sin plan, la empresa recorta producción en las horas caras. Con un plan ensayado, mantiene la producción y desplaza el frío a horas valle.»*

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
│  └─ engine.ts     TwinRunner: velocidad, pausa, crisis, resiliencia (bifurcación), comparador
├─ twins/<id>/                      # UN GEMELO = UNA CARPETA
│  ├─ config.ts     textos, crisis, escenarios, geometría (compartido servidor/cliente)
│  ├─ model.ts      simulación (servidor)
│  └─ scene.ts      escena 3D y panel propio (cliente)
├─ server/src/                      # Express + ws, un proceso, puerto 8080
├─ web/src/                         # Vite + TypeScript + Three.js + Chart.js
│  ├─ kit/scene-kit.ts  cámara, luces, selección, etiquetas, balizas, halos, instancing, WebXR
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

## 8. VR (Meta Quest 3, opcional)

El botón **VR** aparece solo si el navegador admite WebXR. Las gafas exigen un **contexto seguro** (HTTPS o `localhost`), así que `http://IP-del-portátil:8080` no basta. Opciones:

- Conectar las gafas por USB y usar `adb reverse tcp:8080 tcp:8080`; después, abrir `http://localhost:8080` en el navegador de las Quest.
- Publicar el puerto con un túnel HTTPS.

En VR apareces en el borde de la planta. Las etiquetas flotantes no se muestran en VR.

---

## 9. Limitaciones conocidas

- Son **modelos de demostración**: los parámetros son genéricos y verosímiles, pero no proceden de ninguna empresa. No deben usarse para decisiones reales sin calibrarlos.
- Los AGV no gestionan colisiones ni bloqueos entre sí (pueden cruzarse en un pasillo).
- La curva de resiliencia se calcula sobre un horizonte fijo (6 h, o 10 h en alimentación) y se suaviza para dibujarla; los totales usan los datos sin suavizar.
- Durante el cálculo del comparador (unas décimas de segundo) o de la gráfica de flota del almacén (≈ 0,7 s la primera vez) la simulación en vivo se detiene un instante.
- Todos los espectadores conectados a un mismo gemelo ven y controlan la misma instancia.
- VR: probado solo el arranque del botón; la experiencia en las Quest depende del contexto seguro descrito arriba.
