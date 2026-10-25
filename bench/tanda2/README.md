# Benchmark de la tanda 2: el catálogo público, TypeScript contra Go

Medido el 24/10/2026 en la Mac de desarrollo (Intel i7-9750H, 6 núcleos /
12 hilos, 16 GB), contra el mismo Postgres 18 en Docker, con **2000
productos** (3200 variantes, 6400 precios y 6400 filas de stock: el catálogo
de desarrollo multiplicado por 80). Un proceso por lado, pool de 20
conexiones en los dos.

## Qué se midió

| Prueba | TypeScript (lo de antes) | Go (lo nuevo) |
|---|---|---|
| Catálogo, página 1, sin filtros | `paginaDeProductosPublica` | `GET /productos/pagina?publico=true` |
| Búsqueda («placa», ~1/3 del catálogo) | ídem con `busqueda` | ídem |
| Ficha de producto (una distinta por pedido) | `obtenerProductoPublico` | `GET /productos/{slug}?publico=true` |

**El lado TS es el DAL de antes de la mudanza** (`ts/catalogo.ts`, sacado de
git `c575c73^`), servido por `node:http` **sin Next y sin su caché**, igual que
Go, que tampoco cachea: se mide lo que cuesta un pedido cuando la caché de
Next no tiene la página (la primera visita después de un cambio de precios,
o un bot recorriendo fichas). Antes de medir se verificó que los dos
devolvieran **exactamente lo mismo** en las tres pruebas.

## Resultados: 50 a la vez, 20 segundos (k6), cero fallos en los dos

| Prueba | | pedidos/s | p50 | p95 | p99 | memoria máx. |
|---|---|---:|---:|---:|---:|---:|
| Catálogo (2000 productos) | **Go** | **23** | **2,2 s** | **2,6 s** | **2,8 s** | **178 MB** |
| | TS | 5 | 10,0 s | 11,2 s | 11,8 s | 383 MB |
| | Go / TS | **4,6×** | **4,6× menos** | | | **2,2× menos** |
| Búsqueda | **Go** | **46** | **1,0 s** | 1,6 s | 1,7 s | **178 MB** |
| | TS | 33 | 1,3 s | 2,1 s | 2,3 s | 346 MB |
| | Go / TS | 1,4× | 1,3× menos | | | 1,9× menos |
| Ficha | **Go** | **1126** | **40 ms** | **71 ms** | **115 ms** | **135 MB** |
| | TS | 442 | 96 ms | 257 ms | 372 ms | 237 MB |
| | Go / TS | **2,5×** | **2,4× menos** | **3,6× menos** | **3,2× menos** | 1,8× menos |

Un pedido solo, sin carga: el catálogo entero tarda 92 ms en Go (82 ms con
las dos consultas en paralelo) y 257 ms en TS.

## Cómo leerlo

- **TS se queda sin CPU; Go espera a la base.** El proceso de Node está
  clavado en un núcleo (~100 %) armando los 2000 productos; Go usa ~2 núcleos
  de 12 y el perfil muestra que el 56 % del tiempo está en llamadas al
  sistema, esperando filas. Por eso en la ficha, que es poca base y mucho
  armado, Go saca 2,5×, y en la búsqueda, donde manda el `ILIKE` con
  `f_unaccent` de Postgres, solo 1,4×.
- **El catálogo entero sin caché es caro en los dos.** Es el diseño heredado:
  trae el conjunto filtrado completo y recorta en memoria, porque el precio y
  la oferta se resuelven después (está explicado en `PaginaDeCatalogo`). Con
  la caché de Next adelante, el público casi nunca lo paga. Si el catálogo
  crece a varios miles, lo que sigue es mover el precio y la oferta a la
  consulta y paginar en SQL, y un índice trigram sobre `f_unaccent(name)`
  para la búsqueda.
- **Docker Desktop en la Mac encarece el ida y vuelta con la base** (el
  reenvío de puertos de la VM): las 6400 filas del listado pesan más acá que
  en la VPS, con Linux nativo. Los dos lados lo pagan igual; la proporción
  vale, los milisegundos absolutos van a ser otros.

## Lo que encontró el benchmark

1. **Un pánico bajo carga en Go.** El `collate.Collator` del orden por nombre
   era uno solo y compartido, y no se puede usar desde dos goroutines a la
   vez: con 50 pedidos simultáneos, un 25 % fallaba con `index out of range`.
   En las pruebas no se veía porque nunca ordenaban dos a la vez. Ahora sale
   de un `sync.Pool`, y `TestOrdenarEnParalelo` lo cubre con `-race`.
2. **La caché por lista se había perdido en la mudanza.** El TS guardaba el
   listado del profesional en la caché de Next con la lista como clave, así
   que todos los de la misma lista lo compartían. Al pasar a Go, el camino con
   sesión quedó sin caché: cada carga del catálogo de un profesional armaba
   todo de nuevo (el «catálogo» de arriba, por persona). Volvió: Next pide los
   precios de una lista con `API_SECRETO_INTERNO` (sin él, Go contesta 403) y
   los cachea por lista y factor. Verificado: tres cargas seguidas de un
   profesional, cero pedidos a Go.

## Cómo repetirlo

```sh
# La base: copia de la de desarrollo, ×80 (ver el SQL en el historial de la tanda)
DATABASE_URL=postgres://postgres:prueba@127.0.0.1:55480/tanda2 DATABASE_POOL_MAX=20 \
  npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda2/ts-servidor.ts   # :8092
DATABASE_URL=… BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:3100 API_ESCUCHAR=:8082 \
  CARPETA_SUBIDAS=/tmp/subidas ./mjbj api                                                    # :8082
bench/tanda2/correr.sh 50 20s
```

Los resultados crudos (k6 y memoria/CPU cada medio segundo) quedan en
`resultados/`.
