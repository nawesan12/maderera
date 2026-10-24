# Mudanza del backend de MJBJ a Go

## Context
Nahuel decidió el 24/10/2026 que **no se lanza hasta que todo el backend esté en Go**. Motivos: rendimiento con mucha concurrencia y consultas, no quedar casados con Next, y que sea más liviano y cómodo de mantener. Hoy el backend está todo en TypeScript, mezclado con Next:
- ~65k líneas en `lib/` y 210 server actions en 67 archivos.
- 29 rutas en `app/api` y otras 15 `route.ts` sueltas.
- 106 tablas, 79 migraciones de Drizzle y 923 tests de lógica pura, sin base y sin e2e.
- El ~95 % de las 114 páginas lee la base dentro del mismo proceso de Next (`lib/dal`).

Decisiones tomadas (no se revisan):
- **Next** queda solo como pantallas; todo dato pasa por Go.
- **Contrato**: REST + OpenAPI, con los tipos del cliente generados.
- **Base**: Postgres 18; las 79 migraciones se congelan y siguen con **goose**; las consultas van con **sqlc + pgx**, sin ORM.
- **El correo** (`correo.mjbj.com.ar`, Go + Svelte) va primero, como molde.

Resultado buscado: un binario de Go (api + worker) dueño de toda la lógica, la base y las integraciones, y Next sin acceso a la base.

## Reglas para toda la mudanza
- **Estrangulamiento por módulo.** TS y Go comparten la base. Un módulo se muda entero (lecturas, escrituras, rutas, trabajos y tareas), y su TS se borra en la misma tanda.
- **Mismos candados y numeración.** Go usa las mismas claves de `pg_advisory_xact_lock` y el mismo `MAX()+1` que `lib/fiscal/numeracion.ts` y `lib/dal/numeracion-ventas.ts`. Lo primero es juntar todas las claves (~20 lugares) en una tabla única.
- **Cada tipo de trabajo de `trabajos` lo consume un solo lado.** El worker de Go reclama `tipo = ANY($registrados)`, y `lib/cola` recibe el mismo filtro.
- **La plata en float64, no en decimal.** El TS calcula en IEEE float64, y Go en float64 da exactamente lo mismo; una librería decimal daría distinto (`1.005` redondea a 1.00 en JS y a 1.01 en decimal).
  - `internal/jsmath` copia cada helper tal cual: `Round = Floor(x+0.5)`, `redondear` con `EPSILON` (`lib/fiscal/impuestos.ts`) y `aCentavos` (`lib/mostrador/importes.ts`, `lib/cobros/partes.ts`).
  - En arm64, Go puede fusionar `x*y+z` en una sola instrucción y el resultado cambia. Se escribe `float64(x*y)+z`, un lint lo vigila y los tests golden también corren en amd64.
- **Las URLs del exterior no cambian:** webhooks de Mercado Pago y Meta, la API offline del mostrador (por el `sw.js` y las colas que ya hay en las PC), los endpoints del agente del taller, `/baja` y `/api/tareas`. Caddy los pasa a Go de a uno, así que volver atrás es una línea.
- **Seguimiento:** `docs/go/progreso.md` lleva la lista de cada tanda y las reglas para los agentes, y `CLAUDE.md` apunta ahí. Va una rama por tanda.

## Estructura
```
backend/
  cmd/mjbj/main.go          un binario: api | worker | migrar | tarea <n> | correo
  api/openapi.yaml          paths/<dominio>.yaml, schemas/<dominio>.yaml → bundle
  db/migraciones/           goose 00001–00079 = drizzle congelado; 00080+ nuevas
  db/consultas/<dominio>.sql   sqlc → internal/sqlc (un solo paquete)
  internal/plataforma/      config (caarlos0/env), slog, problem+json, servidor, pool, tx
  internal/{auth,roles,limites,cola,tareas,vivo,subidas,email,push,jsmath}/
  internal/<dominio>/       service.go, handlers.go (strict server), *_test.go
  internal/api/             generado por oapi-codegen (std-http + strict)
  testdata/golden/<modulo>/ fixtures exportadas desde el TS
correo/web/                 SPA de Svelte, embebida con go:embed
lib/api/servidor.ts         cliente openapi-fetch server-only (Next → http://api:8080)
lib/api/cliente.ts          cliente del navegador (mismo origen, /api/v1)
```
- **Librerías:** router `net/http` ServeMux; validación con el middleware de kin-openapi más `validar()` por dominio.
- **Errores:** RFC 9457 con `errores: {campo: mensaje}`, que entra directo en `useActionState`.
- **Generación:** `npm run api:gen` corre redocly, oapi-codegen y openapi-typescript juntos; CI falla si lo generado no coincide con lo commiteado.

## Sesión y permisos
- **Go toma el login, el registro y la salida, compatible con lo que hay.** Usa las mismas tablas (`user`, `session`, `account`, `profiles`) y la misma cookie `better-auth.session_token` (`__Secure-` en https), con el formato `urlencode(token + "." + base64(HMAC-SHA256(BETTER_AUTH_SECRET, token)))`.
- **Las sesiones y claves existentes siguen sirviendo.** Las claves se verifican con scrypt N=16384, r=16, p=1, dkLen=64, sobre la clave normalizada NFKC; la sal es el texto hex usado como bytes y el formato guardado es `salt:hex`. Un semáforo limita a 2 hashes a la vez.
- **Vencimiento** rodante a 30 días: se extiende si la sesión tiene más de un día sin actualizarse. Los timestamps sin zona se confirman con una fixture antes de confiar en ellos.
- **Permisos:** `ACCESO` y `puedeEntrar` (`lib/roles.ts`) y `requireStaff`/`requireStaffRole` (`lib/dal/session.ts`) pasan a middleware de Go. `proxy.ts` queda solo con la redirección rápida si no hay cookie.
- **CSRF:** `http.CrossOriginProtection` más `SameSite=Lax`.
- **IP del cliente:** Go confía en `X-Forwarded-For` solo con `X-Interno: <API_SECRETO_INTERNO>`, que Caddy borra de los pedidos que vienen de afuera.

## Cómo cambia Next
- **Las páginas** (Server Components) llaman `await api.GET(...)` desde `lib/api/servidor.ts`, que pasa la cookie, la IP y `X-Interno` y está envuelto en `cache()`. Los DTO salen del OpenAPI.
- **Las server actions** quedan como envoltorios finos: FormData → `api.POST` → errores a `useActionState` → `revalidatePath`/`updateTag`. Zod se borra porque valida solo Go, y el login copia el `Set-Cookie` de Go.
- **El navegador llama a Go directo** solo donde no hay render del servidor: el mostrador offline, el `sw.js`, el carrito, el SSE, las subidas, `/estado` y la bandeja de WhatsApp.
- **Lo que Go cambia por su cuenta** (webhooks, cola, tareas) se avisa con un *outbox*: en la misma transacción encola `next.revalidar{tags,paths}`, y el worker lo manda a `http://app:3000/api/interno/revalidar` con el secreto. Las pantallas en vivo siguen con SSE y `router.refresh`.
- **Lo público:** `lib/cache-publico.ts` sigue con las 5 etiquetas, ahora sobre Go. `generateStaticParams` pasa a `[]`, así el build ya no necesita base. El SEO, el JSON-LD, las imágenes OG, el sitemap y el feed quedan en Next, con los datos de Go.

## Fases
Las cantidades son sesiones de agente.

| # | Tanda | Qué se muda | Listo cuando |
|---|---|---|---|
| 0 | **Correo** (5–6) | `mjbj correo`: go-imap v2, go-message, wneessen/go-mail, bluemonday con imágenes remotas bloqueadas. Sesión en la tabla `correo_sesiones` (cookie opaca, clave IMAP sellada con AES-GCM). Dockerfile distroless (~15 MB), perfil del compose, `correo.{$CORREO_DOMINIO}` en Caddy, paso en `desplegar.sh`. Reemplaza a Roundcube. | Se lee, se busca, se responde y se adjunta contra docker-mailserver, y se despliega con `desplegar.sh` |
| 1 | **Base común** (8–10) | goose y la adopción de drizzle, sqlc, `jsmath`, la generación de código, sesión y roles, `limites`, `cola` y worker, `tareas`, `vivo` (LISTEN → SSE), subidas, email y plantillas (`html/template`, golden de HTML), web-push. En Next: `lib/api`, el endpoint de revalidación, testcontainers, Playwright. Se borran better-auth, `/api/auth`, `/api/vivo`, `lib/vivo` y `lib/limites`. | Una cookie vieja de producción entra por Go y el SSE sale de Go |
| 2 | Catálogo público y contenido (5–6) | ajustes, sucursales, eventos, catálogo y búsqueda (`f_unaccent` + trigram), datos del feed y del sitemap, mi lista de precios, las 27 acciones de contenido | E2E y lecturas en sombra sin diferencias |
| 3 | Productos, precios, stock, acopio (6–7) | 23 acciones e importación de precios | golden de precios |
| 4 | Clientes, cuenta corriente, cheques, cobros internos (7–8) | 15 + 2 + cobros | golden de aging, partes y cheques |
| 5 | Mostrador, caja, ventas, entregas, numeración (9–11) | la API offline con las mismas rutas y formatos | descarga de ventas concurrente sin huecos; E2E offline en verde |
| 6 | Carrito, checkout, Mercado Pago (4–5) | preferencias, webhook HMAC en la misma URL, `acreditar` con su candado, `pago.aviso` | pago de prueba con MP de punta a punta |
| 7 | Facturación ARCA (7–8) | WSAA con smallstep/pkcs7, WSFEv1 con `encoding/xml`, el CAE fuera de la transacción como en `emitir.ts`, QR con skip2/go-qrcode | se emite en homologación en los dos circuitos; probado el corte entre el CAE y el commit |
| 8 | Compras, proveedores, retenciones (5–6) | 19 acciones, el certificado y los CSV | golden de retenciones |
| 9 | WhatsApp (7–8) | Graph v26, firma, medios privados, plantillas, ventana de 24 h, costos, simulador, 4 tipos de trabajo | ida y vuelta con el simulador |
| 10 | Campañas, avisos, profesionales, firma (5–6) | tandas por la cola, baja con HMAC (RFC 8058) | campaña de prueba contra Mailpit |
| 11 | Cortes (6–8) | plano, secuencia, ptx, formatos, tarifa y calculadoras; el agente del taller no se toca | golden con miles de casos; benchmark contra `scripts/benchmark-plano.ts` |
| 12 | PDF y exportaciones (6–7) | go-pdf/fpdf con las mismas métricas de Helvetica que pdf-lib (se vendoriza); primero `lib/pdf/hoja.ts`, después los 12 documentos; excelize en lugar del lector de xlsx | diferencia de píxeles con `pdftoppm` bajo el umbral |
| 13 | Migración de ISIS (3–4) | `lib/migracion` | golden con archivos reales de muestra |
| — | **Corte final** (4–5) | asistente/equipaje, diagnóstico, estado. Se borran `lib/dal`, `lib/db`, drizzle y `pg`; una regla de ESLint prohíbe importar la base; sale el contenedor cron | prueba de carga con k6 (200 clientes en mostrador, catálogo y SSE) y restauración de respaldo ensayada |

Total aproximado: **95–110 sesiones**.

## Despliegue
- **Contenedores:** una imagen `mjbj-go` que corre como `api` (puerto 8080), `worker`, `migrador` (`mjbj migrar`) y `correo-web`. Al final, `app` (Next) pierde `DATABASE_URL` y recibe `API_URL` y `API_SECRETO_INTERNO`.
- **Migraciones:** `mjbj migrar` ve las 79 de drizzle aplicadas; si `goose_db_version` no existe, marca 1–79 como hechas y sigue con `goose up`.
- **Caddy:** `/api/v1/*` y las rutas viejas ya mudadas van a `api:8080` con `flush_interval -1` (por el SSE); el resto va a `app:3000`. Al ser el mismo origen, las cookies andan sin más.
- **Orden de `desplegar.sh`:** imágenes → respaldo → migrador → `api` y `worker` con su healthcheck → `app`.

## Verificación
1. **Golden:** `scripts/golden/<modulo>.ts` (tsx) corre el TS real y escribe `backend/testdata/golden/…`. Entran todos los casos de vitest más miles de casos al azar con semilla para plata, precios, impuestos, retenciones, cuenta corriente, cobros, arqueo, cortes e importes. Go las compara con igualdad exacta, también en amd64. Se commitean y quedan como especificación.
2. **Integración:** testcontainers-go con `postgres:18-alpine` y una base plantilla por test. Cubre transacciones, candados (20 goroutines numerando sin huecos ni repetidos), `SKIP LOCKED`, la descarga idempotente y escrituras cruzadas entre TS y Go en la misma base.
3. **Contrato:** un validador de kin-openapi envuelve el router en los tests, y CI corre `api:gen` más `git diff --exit-code`.
4. **Lecturas en sombra** (catálogo, cuenta corriente, reportes): `COMPARAR=1` en una copia de producción registra las diferencias entre el DAL y Go.
5. **E2E con Playwright** contra el compose, después de cada tanda: login; venta en el mostrador (en línea y offline); pago de prueba con MP; factura en homologación; pago de cuenta corriente; ida y vuelta de WhatsApp.
6. **El correo:** `scripts/correo.sh alta` de una casilla de prueba en el docker-mailserver local, y después leer, buscar, responder con adjunto y ver el envío en otra casilla.

## Riesgos
| Riesgo | Mitigación |
|---|---|
| Diferencias de redondeo | `jsmath`, la regla de la multiplicación-suma, corridas en amd64, golden exactas |
| TS y Go numerando a la vez | tabla única de candados y test cruzado |
| Sesiones o claves incompatibles | fixtures de better-auth y una cookie real de producción probada en la copia |
| Mostradores offline con colas viejas | rutas y formatos congelados, con tests de contrato sacados del TS |
| Webhooks externos | mismas URLs, golden de firmas, homologación y pruebas, cambio en Caddy de a una ruta |
| Contexto que se pierde entre ~100 sesiones | `docs/go/progreso.md`, una rama por tanda, golden y E2E como requisito para mergear |
| Memoria de la VPS | Go ~60 MB, semáforo de scrypt, pool de 20, y el pool de Next sale al final |
