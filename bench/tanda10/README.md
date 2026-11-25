# Benchmark de la tanda 10: campañas, profesionales y eventos, TypeScript contra Go

Medido el 29/10/2026 en la Mac de desarrollo, contra el mismo Postgres 18 en
Docker (`mjbj-go-pg`), con la base `bench_t10` (copia de tanda2 +
`sembrar.sql`: 20.000 clientes, 2000 bajas, 60 campañas con 2000 envíos cada
una —120.000—, 2000 solicitudes de acceso profesional con la mitad de los
CUIT ya en la cartera, 200 eventos con 50 inscriptos cada uno). El lado TS es
el DAL de antes de la mudanza (go-cuentas 56ef2a1, copiado en `ts/`) servido
por `node:http`, con la sesión stubeada (`ts/sesion.ts`); el de Go, la API con
la sesión de verdad (cada pedido además lee la sesión). Antes de medir,
`comparar.py` comprobó que los dos lados den **lo mismo** (conteos de cada
campaña, bajas, alcance, solicitudes con su ficha existente, resumen, eventos
con sus conteos y lo recaudado, y el estado profesional).

20 a la vez, 20 segundos (k6), cero fallos:

| | | pedidos/s | p50 | p99 | memoria máx. |
|---|---|---:|---:|---:|---:|
| Campañas (60, con los conteos de 120.000 envíos) | **Go** | **30,6** | **595 ms** | **1,3 s** | **42 MB** |
| | TS | 9,6 | 1,9 s | 3,5 s | 206 MB |
| Alcance de un segmento (20.000 clientes) | Go | 96,7 | 188 ms | 510 ms | 42 MB |
| | TS | 107,2 | 170 ms | 428 ms | 178 MB |
| Solicitudes de profesionales (200 + ficha por CUIT + resumen) | **Go** | **584** | **31 ms** | **81 ms** | 58 MB |
| | TS | 89 | 207 ms | 496 ms | 224 MB |
| Eventos del panel (200, con sus conteos) | **Go** | **551** | **32 ms** | **96 ms** | 58 MB |
| | TS | 178 | 78 ms | 432 ms | 176 MB |
| Estado profesional (lo pide cada página del sitio) | **Go** | **1585** | **11 ms** | **42 ms** | 58 MB |
| | TS | 430 | 41 ms | 140 ms | 222 MB |

- **Campañas, 3,2×**: el TS contaba los envíos con cinco subconsultas por
  campaña; Go, con una sola pasada (`count(*) filter`) en un `LATERAL`.
- **Solicitudes, 6,5×** y **estado profesional, 3,7×**: menos consultas por
  pedido (el estado era sesión + ficha + solicitud + lista; ahora dos) y JSON
  sin el costo de un hilo solo.
- **El alcance empata (0,9×)**: es un `count(distinct …)` sobre 20.000 fichas
  y manda Postgres. La primera medición daba Go 0,65×: pgx guarda la sentencia
  y después de cinco ejecuciones Postgres pasa al plan genérico, que no ve qué
  tipo y qué rubros se piden. Ahora esa consulta va sin caché de sentencias
  (`pgx.QueryExecModeExec`), como hacía node-postgres. Lo que queda de
  diferencia es la lectura de la sesión, que el TS stubeado no hace.
- Las mediciones se movían entre corridas (otros agentes usaban la máquina):
  la primera corrida dio 16,1 / 3,6 campañas y 323 / 47 solicitudes; las
  proporciones se mantienen.

## Armar el correo de cada destinatario (CPU)

`armar.ts` contra `BenchmarkArmarCorreo` (el enlace de baja firmado, el
cuerpo a HTML y la plantilla), 50.000 correos:

| | por correo | memoria |
|---|---:|---:|
| TS | 50 µs | 105 MB |
| Go | 90 µs (98 KB y 255 asignaciones por correo) | — |

**Acá Go es 1,8× más lento.** Las expresiones regulares de Go (RE2, sin
retroceso compilado como V8) y `email.Escapar`/`Envolver`, que arman el HTML
con muchos reemplazos encadenados, asignan mucho. No importa en la práctica:
una tanda manda 3 correos por minuto (el tope de Hostinger) y armar 3 correos
son 0,3 ms. Si algún día se manda por un relay sin tope, `internal/email` es
lo primero a mirar (un `strings.Replacer` en `Escapar`).

## Cómo repetirlo

```sh
docker exec mjbj-go-pg psql -U postgres -c "create database bench_t10 template tanda2"
docker exec -i mjbj-go-pg psql -U postgres -d bench_t10 < bench/tanda10/sembrar.sql
(cd backend && go build -o /ruta/a/mjbj-t10 ./cmd/mjbj)
DATABASE_URL=…/bench_t10 BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:3100 mjbj-t10 usuario staff --email admin@bench.test --password Secreto123 --name Admin --role admin
DATABASE_URL=…/bench_t10 BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:3100 mjbj-t10 usuario cliente --email pro@bench.test --password Secreto123 --name Pro
# (la ficha de pro@bench.test, como profesional con lista; ver el README de la tanda)
DATABASE_URL=…/bench_t10 DATABASE_POOL_MAX=20 BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:3100 API_ESCUCHAR=:8210 EMAIL_PROVIDER=demo mjbj-t10 api
TZ=UTC DATABASE_URL=…/bench_t10 DATABASE_POOL_MAX=20 BENCH_USUARIO=<id del admin> BENCH_CLIENTE=<id de pro> \
  npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda10/ts-servidor.ts   # :8310
python3 bench/tanda10/comparar.py "<cookie admin de Go>" "<cookie de pro>"
bash bench/tanda10/correr.sh "<cookie admin de Go>" "<cookie de pro>" 20 20s
npx tsx --tsconfig tsconfig.json bench/tanda10/armar.ts
(cd backend && go test -run x -bench ArmarCorreo -benchtime 50000x ./internal/campanas/)
```

Las cookies salen de `POST /api/v1/sesion` con `{"correo","clave"}`. El
binario lleva nombre propio (`mjbj-t10`): otros agentes hacen `pkill` por
nombre.
