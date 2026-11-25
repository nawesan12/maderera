# Benchmark de la tanda 12: los PDF, pdf-lib (TS) contra internal/pdf (Go)

Medido el 29/10/2026 en la Mac de desarrollo (i7-9750H, 6 núcleos), con
otros agentes trabajando en la misma máquina (hay ruido: una segunda corrida
movió algunos números del TS hasta un 40 %). Sin base: cada servidor arma el
PDF de un caso del golden (`backend/testdata/golden/pdf`) en cada pedido.

- **Go** (`:8292`): `TestServidorBench` de `internal/pdf`, con la
  decodificación del JSON del caso incluida en cada pedido.
- **TS** (`:8392`): `ts-servidor.ts`, los generadores de `lib/pdf` con los
  datos ya armados en memoria (solo se mide pdf-lib).

Los dos dan el mismo documento (golden de píxeles en 0 %).

## Un pedido a la vez (1 VU, 5 s): lo que tarda un documento

| Documento (caso más grande) | Go p50 | TS p50 | Go / TS | memoria Go | memoria TS |
|---|---:|---:|---:|---:|---:|
| Lista de precios (900 renglones, 18 páginas) | 25,0 ms | 145,4 ms | **5,8×** | 30 MB | 292 MB |
| Reposición (400 renglones) | 10,4 ms | 59,3 ms | **5,7×** | 30 MB | 245 MB |
| Remito (muchas líneas) | 2,1 ms | 14,0 ms | **6,6×** | 31 MB | 240 MB |
| Recibo (60 partes) | 4,5 ms | 22,4 ms | **4,9×** | 31 MB | 230 MB |
| Resumen de cuenta (220 movimientos) | 11,4 ms | 67,9 ms | **5,9×** | 32 MB | 257 MB |
| Certificado de retención | 0,7 ms | 8,0 ms | **10,8×** | 32 MB | 217 MB |
| Comprobante (60 renglones, QR) | 8,0 ms | 49,5 ms | **6,2×** | 32 MB | 227 MB |
| Presupuesto (90 renglones) | 5,8 ms | 27,8 ms | **4,8×** | 33 MB | 286 MB |
| Plano de corte (muchas placas) | 4,2 ms | 27,7 ms | **6,5×** | 33 MB | 275 MB |
| Hoja de corte (muchas placas) | 17,9 ms | 81,9 ms | **4,6×** | 37 MB | 308 MB |
| Reporte de ventas (300 filas) | 17,2 ms | 92,9 ms | **5,4×** | 33 MB | 235 MB |
| Remito mínimo | 0,7 ms | 7,3 ms | **10,4×** | 26 MB | 214 MB |

## 8 a la vez (8 VU, 10 s): cuántos por segundo

| Documento | Go pedidos/s | TS pedidos/s | Go / TS |
|---|---:|---:|---:|
| Lista de precios | 104 | 7,0 | **15×** |
| Reposición | 234 | 15,8 | **15×** |
| Remito | 1185 | 68,7 | **17×** |
| Recibo | 787 | 36,2 | **22×** |
| Resumen de cuenta | 192 | 7,3 | **26×** |
| Certificado de retención | 1770 | 86,3 | **21×** |
| Comprobante | 299 | 13,8 | **22×** |
| Presupuesto | 281 | 30,0 | **9×** |
| Plano de corte | 466 | 9,9 | **47×** (TS con poca CPU en esa corrida: en la primera dio 38,5, 15×) |
| Hoja de corte | 78 | 6,3 | **12×** |
| Reporte de ventas | 221 | 9,7 | **23×** |
| Remito mínimo | 1763 | 109 | **16×** |

Memoria máxima con 8 a la vez: Go 50–85 MB, TS 225–375 MB.

**Por qué tanto.** Un documento es CPU pura. pdf-lib arma un objeto por cada
operador, lo serializa a texto y lo comprime con pako; Go escribe los
operadores directo a un buffer y comprime con zlib nativo. El logo se
decodifica y se comprime una vez por proceso (en el TS, en cada documento).
Y con varios pedidos a la vez Go usa todos los núcleos y Node uno.

## Cómo repetirlo

```sh
bench/tanda12/correr.sh 8 10s   # resultados/vus-8
bench/tanda12/correr.sh 1 5s    # resultados/vus-1
```

Levanta los dos servidores, mide cada documento con k6 (con 2 s de
calentamiento) y muestrea memoria y CPU con `ps`.
