# Benchmark de la tanda 13: la migración de ISIS, TypeScript contra Go

Medido el 29/10/2026 en la Mac de desarrollo, contra el Postgres 18 de
`mjbj-go-pg`. **Con la máquina muy cargada**: otros agentes corrían pruebas y
benchmarks a la vez (load average entre 95 y 124, el contenedor de Postgres
al 1400 % de CPU). Los números absolutos tienen mucho ruido; lo que se
sostiene son las proporciones grandes y la memoria.

Cada lado importa los mismos siete archivos (`generar.ts`, semilla fija:
72.000 filas) sobre la misma base recién copiada de `tanda2` (`bench_t13`),
con su servidor solo: Go (`mjbj-t13`) en :8213, el TS de antes (commit
56ef2a1, en `ts/`, servido por node:http sin Next) en :8313. El cliente
(`medir.ts`) hace lo mismo que la pantalla: analizar, vista previa, abrir la
corrida, los lotes de 200 uno detrás del otro y cerrar. Dos pasadas: la
primera crea todo, la segunda repite el mismo archivo (actualiza u omite:
los contadores de los dos lados dieron iguales en las dos pasadas).

## Resultados (segundos por archivo; filas/s entre paréntesis)

| Archivo | Filas | Go, 1.ª | TS, 1.ª | Go, 2.ª | TS, 2.ª |
|---|---:|---:|---:|---:|---:|
| Clientes | 10.000 | **61,3** (163) | 146,5 (68) | **69,2** (145) | 149,8 (67) |
| Productos y medidas | 5.000 | **87,2** (57) | 123,8 (40) | 128,3 (39) | **77,8** (64) |
| Stock | 5.000 | **41,5** (121) | 76,0 (66) | **58,6** (85) | 79,2 (63) |
| Saldos | 10.000 | 68,4 (146) | **54,2** (185) | **48,5** (206) | 77,9 (128) |
| Proveedores | 2.000 | 18,6 (107) | **17,2** (116) | **7,1** (281) | 12,8 (156) |
| Histórico de ventas | 20.000 | **90,1** (222) | 133,1 (150) | 82,0 (244) | **77,1** (260) |
| Comprobantes | 20.000 | **110,2** (181) | 114,3 (175) | 155,8 (128) | **131,8** (152) |
| **Total** | 72.000 | **477 s** | 665 s | **550 s** | 606 s |
| Memoria máx. / CPU media | | **95 MB** / 9 % | 245 MB / 13 % | | |

Los p50/p95/p99 de cada lote están en `resultados/go.txt` y `resultados/ts.txt`.

- **Manda Postgres.** Los dos lados escriben fila por fila (es lo que
  conserva el orden y la repetibilidad dentro del lote), y el servidor pasa
  el 90 % del tiempo esperando a la base: CPU media del 9 % en Go y del 13 %
  en TS. Con la base saturada por otros, las diferencias de ±30 % entre
  archivos son ruido (productos fue más rápido en Go en la 1.ª pasada y más
  lento en la 2.ª).
- **Clientes, 2,4× en las dos pasadas.** Lo que no es ruido: el TS buscaba
  la ficha sin código ni CUIT con `lower(nombre) = …`, que recorre la tabla
  por cada fila; Go lee los nombres una vez por lote. (La primera versión
  de Go comparaba sin tildes en SQL y era más lenta todavía: ~2,7 s por
  lote; por eso el índice por lote.)
- **Memoria: 2,6× menos** (95 MB contra 245 MB).
- La vista previa y el análisis de 20.000 filas tardan lo mismo del orden
  de magnitud en los dos (100–1.000 ms con la base cargada); lo que se lleva
  el tiempo son los lotes.

## Cómo repetirlo

```sh
(cd backend && go build -o /ruta/a/mjbj-t13 ./cmd/mjbj)
BIN=/ruta/a/mjbj-t13 bench/tanda13/correr.sh
```

`correr.sh` genera los archivos si faltan (`archivos/`, no se suben), recrea
`bench_t13` desde `tanda2` antes de cada lado, crea el admin, levanta el
servidor, mide y lo baja. Conviene correrlo con la máquina quieta.
