# Benchmark de la tanda 9: WhatsApp, TypeScript contra Go

Medido el 29/10/2026 en la Mac de desarrollo (i7-9750H, 6 núcleos), contra el
mismo Postgres 18 en Docker, en la base `bench_t9` (copia de `tanda2` con
`sembrar.sql`: 1500 conversaciones y 30.000 mensajes; la ráfaga del webhook
suma después unas 10.000 conversaciones más, una por mensaje). El lado TS es
el DAL de la bandeja y el webhook **de antes de la mudanza** (git 9a17128,
sacados de la historia con `copiar-ts.mjs`) servidos por `node:http`, con la
sesión stubeada; los dos en modo demostración (sin la Graph API). Antes de
medir se comprobó que la bandeja dé lo mismo de los dos lados (150
conversaciones, la primera con sus 20 mensajes, los mismos contadores y las
12 plantillas).

## Abrir la bandeja: 20 a la vez, 20 segundos (k6), cero fallos

| | pedidos/s | p50 | p95 | p99 | memoria máx. | CPU |
|---|---:|---:|---:|---:|---:|---:|
| **Go** (`GET /api/v1/admin/whatsapp/bandeja`) | **83,3** | **234 ms** | **353 ms** | **421 ms** | **52 MB** | 35 % |
| TS (las seis lecturas de `vista.tsx` y la conversación) | 71,9 | 267 ms | 447 ms | 508 ms | 174 MB | 51 % |

**Casi empate: manda Postgres.** De los dos lados lo caro es la misma
consulta del gasto del mes (los salientes sin cobro informado, ~28 ms con
40.000 mensajes): se hace en cada apertura. Lo que sigue es un índice parcial
(`created_at` de los salientes sin `cobro_categoria`) o guardar el gasto del
mes y actualizarlo con cada estado; está anotado en docs/go/progreso.md. Go
gana en la cola (p99 −17 %) y en memoria (3,3× menos).

## El webhook en ráfaga: 5000 mensajes firmados, 50 a la vez

| | aceptados/s | p50 | p95 | p99 | memoria máx. |
|---|---:|---:|---:|---:|---:|
| **Go** (`POST /api/whatsapp/webhook`: firma y a la cola) | **3198** | **14,6 ms** | **20,8 ms** | **33,9 ms** | **42 MB** |
| TS (la ruta de antes, sin el `after()`) | 2229 | 19,1 ms | 39,2 ms | 52,2 ms | 162 MB |

## Procesar lo encolado (5200 payloads: mensaje nuevo, conversación nueva, aviso al panel)

| | tiempo | por payload |
|---|---:|---:|
| **Go** (los manejadores del worker, `drenar_bench_test.go`) | **68,6 s** | **13 ms** |
| TS (`procesarPayload` de antes, de a uno) | 115,5 s | 22 ms |

Go 1,7× más rápido: son las mismas idas a la base (buscar la ficha por
teléfono, crear la conversación, el mensaje, la señal, el aviso), con menos
costo por ida.

**Ojo con el worker:** toma de a 100 trabajos cada 2 segundos, así que en
producción una ráfaga se procesa a 50 por segundo como máximo, y un mensaje
suelto tarda hasta 2 s en aparecer en la bandeja (el TS lo procesaba en el
`after()` de la misma ruta). Para la maderera alcanza de sobra; si molestara,
el worker puede volver a pasar enseguida cuando la pasada llenó el límite.

## Cómo repetirlo

```sh
docker exec mjbj-go-pg createdb -U postgres -T tanda2 bench_t9
docker exec -i mjbj-go-pg psql -U postgres -d bench_t9 < bench/tanda9/sembrar.sql
node bench/tanda9/copiar-ts.mjs
DATABASE_URL=…/bench_t9 DATABASE_SSL=off BENCH_USUARIO=<id del admin> WHATSAPP_APP_SECRET=secreto-de-prueba WHATSAPP_PROVIDER=demo \
  npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda9/ts-servidor.ts   # :8389
DATABASE_URL=…/bench_t9 DATABASE_SSL=off BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:8289 API_ESCUCHAR=:8289 \
  WHATSAPP_APP_SECRET=secreto-de-prueba CARPETA_PRIVADA=… ./mjbj-bench api
bench/tanda9/correr.sh <archivo con la cookie de sesión de Go> 20 20s   # SOLO=bandeja para la primera parte
```
