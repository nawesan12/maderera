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
| 2 | Catálogo público y contenido | | |
| 3 | Productos, precios, stock, acopio | | |
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
- [ ] E2E con Playwright (login primero; un flujo más por tanda)
- [ ] Desplegar en la VPS y probar una cookie real de producción
- Queda en TS hasta su tanda: `lib/limites` (lo usan otras acciones; cuenta
  en la misma tabla que Go) y las tareas de `lib/tareas` (el cron sigue
  pegándole a Next).

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
