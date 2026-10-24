# Benchmark de la tanda 1: TypeScript contra Go

Medido el 24/10/2026, en la Mac de desarrollo (Intel i7-9750H, 6 núcleos /
12 hilos, 16 GB), contra el mismo Postgres 18 en Docker. Un proceso por
lado. Los números absolutos de la VPS (2 núcleos) van a ser otros; lo que
importa es la proporción.

## Qué se midió

| Prueba | TypeScript (lo de antes) | Go (lo nuevo) |
|---|---|---|
| Leer la sesión por HTTP (cada página con usuario) | better-auth `getSession` + la consulta del perfil (la lógica de `lib/dal/session.ts`), en `node:http` sin Next | `GET /api/v1/sesion` |
| Entrar con clave | better-auth `signInEmail` | `auth.Servicio.Entrar` |
| La cola | el SQL de `lib/cola` por drizzle | `internal/cola` |

**El lado TypeScript no tiene Next adelante**, a propósito: se compara el
lenguaje con sus librerías, no el framework. Con Next en el medio, el lado TS
sería más lento, no más rápido.

## Resultados

### Leer la sesión: 50 usuarios a la vez, 20 segundos (k6)

| | pedidos/s | p50 | p95 | p99 | memoria máx. | CPU |
|---|---:|---:|---:|---:|---:|---:|
| **Go** | **4989** | **9,4 ms** | **14,6 ms** | **20,4 ms** | **83 MB** | 149 % |
| TS | 829 | 56,8 ms | 85,4 ms | 101,1 ms | 324 MB | 105 % |
| Go / TS | **6,0×** | **6,0× menos** | 5,8× menos | 5,0× menos | **3,9× menos** | |

Cero fallos en los dos.

### Entrar con clave (scrypt), 12 a la vez

| | 4 hilos | 2 hilos (lo que tiene la VPS) |
|---|---:|---:|
| Go | 45,0 por s | 22,9 por s |
| TS | 43,6 por s | 26,6 por s |

### La cola: 2000 trabajos vacíos, un proceso

| | trabajos/s |
|---|---:|
| Go | 340 |
| TS | 276 |

## Qué quiere decir

- **Lo que pasa en cada pedido es donde Go gana de verdad: 6 veces más
  pedidos por segundo, 6 veces menos espera y 4 veces menos memoria.** Hay
  dos razones, y conviene separarlas:
  - *El lenguaje.* Node corre en un solo núcleo (por eso el 105 % de CPU: un
    núcleo lleno y la cola esperando); Go reparte entre todos (149 %) y su
    memoria es una fracción. En la VPS, con 2 núcleos, esto pesa todavía más:
    Node deja uno quieto.
  - *El diseño.* better-auth hace varias consultas por sesión (la sesión, el
    usuario) y después venía la del perfil; Go hace una sola con join. Eso se
    podría hacer en TS también, pero no con better-auth tal cual.
- **Entrar con clave es un empate.** Casi todo el tiempo es scrypt, que está
  hecho a propósito para ser lento. El de Node es OpenSSL en C y anda apenas
  mejor que el de Go con 2 hilos. El lenguaje no cambia nada acá.
- **La cola casi no cambia (1,2×).** Cada trabajo son dos idas y vueltas a
  Postgres: manda la base, no el lenguaje. Lo que gana Go es que corre en
  paralelo sin trabas si se agregan procesos (probado: 4 procesos, 200
  trabajos, ninguno repetido).

## Cómo repetirlo

```bash
# Postgres 18 descartable con una base migrada y un usuario:
docker run -d --name mjbj-go-pg -e POSTGRES_PASSWORD=prueba -p 127.0.0.1:55480:5432 postgres:18-alpine
#   (crear la base «bench» migrada con `mjbj migrar` y el usuario con
#    `mjbj usuario staff --email bench@mjbj.com.ar --password "clave de benchmark" --role vendedor`)

# Los dos servidores, con el mismo secreto:
API_ESCUCHAR=127.0.0.1:8081 DATABASE_URL=…/bench BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:3100 mjbj api
BENCH_BASE=…/bench BETTER_AUTH_SECRET=… npx tsx bench/tanda1/ts-servidor.ts

# Una cookie de sesión (entrando por la API) y la carga:
bench/tanda1/correr.sh "better-auth.session_token=…" 50 20s

# Entrar y la cola:
MJBJ_PRUEBA_BASE=…/postgres go test -run '^$' -bench 'Entrar|Cola2000' ./internal/auth/ ./internal/cola/
BENCH_BASE=…/bench npx tsx bench/tanda1/entrar-ts.ts
BENCH_BASE=…/bench npx tsx bench/tanda1/cola-ts.ts
```
