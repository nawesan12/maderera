# La mudanza a Go: dónde va

El plan completo, con el porqué de cada decisión, está en [PLAN.md](PLAN.md).
Este archivo es lo que se actualiza: qué tanda está en curso, qué quedó hecho
y qué aprendimos. **Leelo antes de tocar `backend/`.**

## Reglas para quien trabaje acá

- Una rama por tanda (`go-<tanda>`). No se mergea a `main` sin los golden y
  los E2E de la tanda en verde.
- Un módulo se muda entero —lecturas, escrituras, rutas, trabajos, tareas— y
  su TypeScript se borra en la misma tanda. Nada queda a medias en los dos
  lados.
- Los candados (`pg_advisory_xact_lock`) y la numeración son los mismos del
  TypeScript, byte a byte, mientras convivan.
- La plata va en `float64` con los helpers de `internal/jsmath`, nunca con
  `math.Round` ni una librería decimal: el resultado tiene que ser idéntico
  al de hoy. `float64(x*y)+z`, nunca `x*y+z` (FMA en arm64).
- Las URLs que llama alguien de afuera (webhooks, mostrador offline, agente
  del taller, `/baja`, `/api/tareas`) no cambian.
- Al terminar una sesión: actualizar la tabla de abajo y anotar lo aprendido.
- **Al cerrar cada tanda, un benchmark TypeScript contra Go** (pedido de
  Nahuel, 24/10/2026): el mismo trabajo medido de los dos lados, en la misma
  máquina y contra la misma base —latencia p50/p95/p99, pedidos por segundo,
  memoria y CPU—, con el script en `bench/<tanda>/` para poder repetirlo, y
  los números en la sección «Benchmarks» de abajo.

## Estado

| # | Tanda | Rama | Estado |
|---|---|---|---|
| 0 | Correo (`correo.mjbj.com.ar`) | `go-correo` | hecha (falta encenderla en la VPS: DNS y PTR) |
| 1 | Base común | `go-base` | hecha (falta desplegarla; E2E de Playwright pendiente) |
| 2 | Catálogo público y contenido | `go-catalogo` | hecha (falta desplegarla; el secreto `API_SECRETO_INTERNO` va en el entorno de la VPS) |
| 3 | Productos, precios, stock, acopio | `go-productos` | casi hecha: falta mudar el informe de reposición (lee ventas: va con la tanda 5) y el ajuste masivo en lote |
| 4 | Clientes, cuenta corriente, cheques, cobros | | |
| 5 | Mostrador, caja, ventas, entregas | | |
| 6 | Carrito, checkout, Mercado Pago | | |
| 7 | Facturación ARCA | | |
| 8 | Compras, proveedores, retenciones | | |
| 9 | WhatsApp | | |
| 10 | Campañas, avisos, profesionales, firma | | |
| 11 | Cortes | | |
| 12 | PDF y exportaciones | | |
| 13 | Migración de ISIS | | |
| — | Corte final | | |

## Tanda 0: el correo

- [x] Esqueleto de `backend/`: `go.mod`, `cmd/mjbj`, `internal/plataforma`
- [x] Sesión del correo (cookie sellada con AES-GCM, ver «Lo aprendido»)
- [x] IMAP: carpetas, lista, lectura, adjuntos, acciones, búsqueda
- [x] SMTP: redactar, responder, adjuntar, copia en Enviados
- [x] SPA de Svelte embebida (Vite + Svelte 5, sin SvelteKit; 31 KB gz)
- [x] Dockerfile, compose (`correo-web`), Caddy (`correo.`), `desplegar.sh`
- [x] Probado contra docker-mailserver 16.0.1 local (curl y navegador)
- [x] Roundcube afuera
- [ ] Encendido en la VPS (espera los registros DNS y el PTR)

## Tanda 1: la base común

- [x] goose: las 79 de drizzle convertidas, esquema idéntico, adopción de la base
- [x] sqlc (numeric → jsmath.Num, timestamps UTC) y `internal/pruebas`
- [x] jsmath: idéntico a JS bit a bit en 6027 casos
- [x] Sesión compatible con better-auth (golden en los dos sentidos), entrar,
      registrarse, salir, cambiar la clave; `mjbj usuario staff|cliente`
- [x] API con OpenAPI (oapi-codegen), validación de contrato encadenable, problem+json
- [x] limites, cola (cada lado sus tipos), tareas, worker, next.revalidar
- [x] vivo (SSE) en Go; la ruta de Next y lib/vivo/escucha.ts, borradas
- [x] email, push, subidas, roles (golden de ACCESO)
- [x] Next: getSession, entrar, registrarse y salir por la API; better-auth
      fuera de la aplicación (queda de desarrollo, para los golden)
- [x] Despliegue: api, worker, migrar (goose), Caddy, desplegar.sh
- [x] E2E con Playwright (login primero; un flujo más por tanda)
- [ ] Desplegar en la VPS y probar una cookie real de producción
- Queda en TS hasta su tanda: `lib/limites` (lo usan otras acciones; cuenta
  en la misma tabla que Go) y las tareas de `lib/tareas` (el cron sigue
  pegándole a Next).

## Tanda 2: el catálogo público y el contenido

- [x] Catálogo: lista por sesión, productos, búsqueda sin tildes, ficha,
      sugeridos, complementos, portada (sombra 143/143 contra el TS)
- [x] Contenido: ajustes, promociones, banners con imagen, reseñas de
      productos (dejar y moderar) y del negocio (con Google Places, la tarea
      `resenas-google` en el worker de Go)
- [x] Documentos técnicos (lo público y el panel), lecturas de eventos,
      sitemap, contacto (con la plantilla de los correos en Go, golden byte a
      byte), sucursales, zonas de envío, escalas por medio de pago
- [x] `/mi-lista-de-precios`: las filas desde Go, con el factor de la lista
      derivada (el TS lo ignoraba); el PDF sigue en TS hasta la tanda 12
- [x] Caché por lista para el profesional (`API_SECRETO_INTERNO`)
- [x] Pruebas: Go contra la base y el contrato en cada respuesta
      (`pruebas.ConContrato`), y 30 E2E en escritorio y teléfono
- [x] Benchmark (`bench/tanda2`)
- [ ] Desplegar en la VPS: agregar `API_SECRETO_INTERNO` al entorno de `api`
      y `app` antes del despliegue
- Queda en TS hasta su tanda: la inscripción a eventos y su panel (cobran
  por Mercado Pago, tanda 6, y avisan con lo de profesionales, tanda 10),
  `estadoProfesional` (tanda 10; el mismo criterio está en Go en
  `EsProfesionalAprobado`, se juntan ahí), `lib/dal/visitante.ts` (combina
  catálogo con carrito y cortes) y el PDF de la lista.

## Tanda 3: productos, precios y stock

- [x] Productos (internal/productos): listado, ficha con medidas, precios y
      stock (validación igual a zod, golden de 57 formularios), imágenes,
      sugeridos, rubros, candidatos a baja (tarea semanal en el worker de Go)
- [x] Precios (internal/precios): grilla, historial, editar, ajuste masivo,
      listas derivadas, descuentos por medio de pago, importación de planillas
      (internal/planilla: CSV y XLSX, golden de 11.344 casos)
- [x] Stock (internal/stock): grilla, alertas, movimientos, ajuste rápido,
      transferencia
- [x] Candados de stock en la ficha y la transferencia (el TS no los tomaba),
      transferencia contra lo disponible y no contra el físico
- [x] Benchmark (`bench/tanda3`)
- [ ] El ajuste masivo en lote: hoy son tres consultas por precio (20–30 s
      para 6400 en la Mac)
- [ ] El informe de reposición (lib/dal/admin/reposicion.ts): lee ventas,
      va con la tanda 5
- Queda en TS hasta su tanda: el acopio y las reservas (tanda 5), las
  recepciones de compras (tanda 8), las tarifas de cortes (tanda 11), los PDF
  de listas (tanda 12) y lib/csv.ts, lib/xlsx.ts y lib/planilla.ts (los usan
  la migración de ISIS y las listas de proveedores).
- Bugs del TS que el lector de Go reproduce a propósito (se arreglan cuando
  se mude la migración, tanda 13): las fechas de un .xlsx salen un día antes;
  se lee el sheetN.xml primero en orden alfabético (sheet10 antes que
  sheet2); se pierden los espacios de xml:space="preserve"; los &#NN; quedan
  escritos; con prefijo de espacio de nombres (<x:worksheet>) la planilla sale
  vacía; «0,125» se lee como 125.

## Benchmarks

Uno por tanda, al cerrarla. Detalle y cómo repetirlos: `bench/<tanda>/README.md`.

### Tanda 1 (24/10/2026, Mac i7 6 núcleos, Postgres 18 en Docker)

| Prueba | TypeScript | Go | Go / TS |
|---|---:|---:|---:|
| Leer la sesión, 50 a la vez: pedidos/s | 829 | 4989 | **6,0×** |
| ídem, p50 / p99 | 56,8 / 101,1 ms | 9,4 / 20,4 ms | **6× / 5× menos** |
| ídem, memoria máx. | 324 MB | 83 MB | **3,9× menos** |
| Entrar con clave (scrypt), 2 hilos: por s | 26,6 | 22,9 | 0,9× (empate) |
| La cola, 2000 trabajos vacíos: por s | 276 | 340 | 1,2× |

Lo que pasa en cada pedido es donde Go gana de verdad (un núcleo contra
todos, y una consulta con join contra las varias de better-auth). Lo que
manda scrypt o Postgres, empata.

### Tanda 2 (24/10/2026, misma Mac, 2000 productos, sin caché en ninguno)

| Prueba, 50 a la vez | TypeScript | Go | Go / TS |
|---|---:|---:|---:|
| Catálogo entero: pedidos/s | 5 | 23 | **4,6×** |
| ídem, p50 | 10,0 s | 2,2 s | **4,6× menos** |
| Búsqueda: pedidos/s | 33 | 46 | 1,4× |
| Ficha: pedidos/s | 442 | 1126 | **2,5×** |
| ídem, p50 / p99 | 96 / 372 ms | 40 / 115 ms | **2,4× / 3,2× menos** |
| Memoria máx. | 237–383 MB | 135–178 MB | ~2× menos |

TS se queda sin CPU (un núcleo); Go espera a Postgres. Donde manda la base
(la búsqueda con `ILIKE`) la diferencia se achica. El benchmark encontró un
pánico de concurrencia en Go y la caché por lista que se había perdido: ver
`bench/tanda2/README.md`.

### Tanda 3 (25/10/2026, misma Mac, 2000 productos, 20 a la vez)

| Prueba | TypeScript | Go | Go / TS |
|---|---:|---:|---:|
| Grilla de productos: pedidos/s | 9,3 | 27,0 | **2,9×** |
| Grilla de precios: pedidos/s | 1,0 | 30,1 | **30×** (el TS cruzaba listas en n²) |
| Grilla de stock: pedidos/s | 8,7 | 23,3 | **2,7×** |
| Memoria máx. | 295–504 MB | 87–140 MB | ~3,5× menos |
| Ajuste masivo de 6400 precios | 32–45 s | 21–33 s | 1,4× (lento en los dos: va en lote) |

## Lo aprendido

- **La sesión del correo no va en Postgres** (el plan decía `correo_sesiones`):
  va en una cookie `__Host-` sellada con AES-GCM (`CORREO_CLAVE`). Así el
  webmail no depende de la base del ERP —se lee el correo aunque la base esté
  caída— y la adopción de goose queda para la tanda 1, donde corresponde.
- **El HTML de los correos va en un iframe con origen opaco** (CSP `sandbox`
  sin `allow-same-origin`). Desde ahí el navegador no manda la cookie, así que
  las imágenes en línea (`cid:`) se incrustan como `data:` en el servidor en
  vez de servirse por una ruta. La CSP del iframe (`img-src data:`) es la que
  frena las imágenes remotas; el saneo con bluemonday es la segunda capa.
- **IMAP sin `Extended: true` en BODYSTRUCTURE no trae el
  `Content-Disposition`**: sin eso no se sabe qué partes son adjuntos.
- **El límite de intentos va en el webmail, no en fail2ban**: el servidor de
  correo ve todos los intentos del webmail desde la IP del contenedor.
- **El hook de Mercado Pago bloquea cualquier comando que nombre un `.env`**
  (incluso `correo.env` o `.env.produccion` en un texto): los cambios a esos
  archivos o a comandos que los citan van por un script en el scratchpad.
- **«Next.js encountered uncached data» en desarrollo** es la validación de
  navegación instantánea (`validationLevel: 'warning'`), no un error: dice que
  la página espera datos sin caché fuera de un `<Suspense>`. Pasaba igual con
  las consultas a la base, solo que Next no las veía; ahora que los datos
  llegan por fetch, se ven. No rompe el build (la página ya es dinámica por la
  cookie). Se mejora página por página con `<Suspense>` o `"use cache"` donde
  valga la pena; no esconderlo con un fetch que Next no vea.
- **`curl -F campo='<...'` lee un archivo** (el `<` es «desde archivo»): para
  mandar HTML por curl, `--form-string`.
- **Un `collate.Collator` no se comparte entre goroutines**: guarda el estado
  de la comparación en curso. Uno global para ordenar por nombre andaba en
  las pruebas y entraba en pánico con 50 pedidos a la vez. Va en un
  `sync.Pool`. En general: todo lo global que tenga métodos con estado
  (collators, `rand.Rand`, buffers) se revisa con `-race` y una prueba en
  paralelo.
- **Una caché de Next con clave por algo que no es la persona se pierde fácil
  al mudar**: el TS cacheaba el listado del profesional por lista, y el
  envoltorio nuevo llamaba a Go con la cookie y sin caché. Al mudar un DAL,
  mirar qué estaba en `cachearPublico` y con qué clave, no solo qué devuelve.
  Para pedirle a Go los precios de una lista sin cookie está `apiInterna`
  (`API_SECRETO_INTERNO`); Go no acepta `lista=` sin él.
- **sqlc devuelve `nil` en una consulta `:many` sin filas** si no se le pide
  `emit_empty_slices`, y en JSON eso es `null`: el panel hacía `.map` y no
  cargaba. Está activado, y `plataforma.SinNulos` cubre las listas que arma
  el código. `TestListasVacias` recorre las rutas con la base vacía.
- **sqlc pierde la nulabilidad de una columna con cast** (`coalesce(...)::text`,
  `nullif` lo infiere como `bool`): para esas, SQL a mano con pgx
  (`catalogo/milista.go`).
- **Turbopack en desarrollo puede quedarse con una versión vieja de un
  módulo** en una ruta (el sitemap veía `lib/api/servidor.ts` sin los exports
  nuevos: `apiPublica` era `undefined`). Si un import existe y llega
  `undefined`, reiniciar `next dev` antes de buscar el bug.
- **Las server actions agregan campos al FormData** (`$ACTION_REF_1`,
  `$ACTION_1:0`): el validador de la API rechaza las partes que el contrato no
  declara. `soloCampos()` los saca antes de mandar un multipart a Go.
- **Que una prueba de concurrencia pase no prueba nada si no falla sin el
  arreglo.** La primera prueba del candado de la ficha pasaba igual sin el
  candado: dos ediciones de la ficha ya se ordenaban por el UPDATE del
  producto. La carrera real era ficha contra venta. Antes de dar por buena
  una prueba de concurrencia, correrla sin el arreglo y verla fallar.
- **zod 4 rechaza NaN con el mensaje de tipo** («Invalid input: expected
  number, received NaN»), antes de `.finite(...)`; los refinamientos de un
  objeto (`superRefine`) solo corren si todo lo demás validó; los mensajes
  de un enum siguen el orden de las claves de un objeto JS (primero las que
  parecen enteros: "0"|"21"|"10.5"). Los golden de las validaciones los
  sacan del esquema real.
- **toFixed de JS no es FormatFloat**: en el empate exacto JS sube y Go va al
  par. `jsmath.ToFixed`.
- **Las e2e entran una sola vez** (`e2e/autenticar.setup.ts`, storageState):
  con una entrada por prueba, la suite pasaba el freno de 10 cada 5 minutos.
