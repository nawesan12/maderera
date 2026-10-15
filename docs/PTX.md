# PTX: el formato de programas para la seccionadora

Qué es, qué dice la especificación, cómo lo genera la plataforma y qué falta
confirmar. Lo genera `lib/cortes/ptx.ts`; el botón está en la ficha del corte
(«Programa para la máquina (.PTX) — prueba»). La guía para la visita al taller
está en [`RELEVAMIENTO-TALLER.md`](RELEVAMIENTO-TALLER.md).

## Para qué

En el taller hay una seccionadora SCM con una PC con Windows XP que corre
**WinCut**. El optimizador que le armaba los programas, **Cutty**, no anda, y el
operario carga las medidas a mano en el modo semiautomático. La plataforma ya
arma su propio plano guillotina para vender el corte. Si la máquina lee un
archivo de patrones, ese plano se le puede llevar por pendrive y reemplazar lo
que hacía Cutty. Mientras tanto, la **hoja de corte** (`/hoja-de-corte/[id]`)
le da al operario la misma secuencia en papel, sin depender de nada de esto.

## La especificación

PTX (*Pattern Exchange*) es el formato abierto con que los optimizadores le
pasan patrones de corte a las seccionadoras. La definición pública es la
**Interface Guide de Magi-Cut**, capítulo «Pattern Exchange File –
Specification». Se leyeron tres versiones:

| Documento | Versión de la spec | Páginas |
|---|---|---|
| [V10 Interface Guide](https://www.magi-cut.co.uk/files/V10%20Interface%20Guide.pdf) | 1.14 (la que piden las SCM con MaestroActive) | — |
| [V11 Interface Guide](https://www.magi-cut.co.uk/files/V11%20Interface%20Guide.pdf) | 1.17 | 114–179 |
| [V12 Interface Guide](https://www.magi-cut.co.uk/files/V12%20Interface%20Guide.pdf) | 1.21 (14/3/2025) | 115–183 |

Los campos de 1.14 y 1.17 son idénticos; 1.21 solo agrega campos al final de
algunos registros. Hay además un archivo oficial completo exportado por
Magi-Cut V12 en [Saw Examples.zip](https://www.magi-cut.co.uk/files/Saw%20Examples.zip)
(enlazado desde <https://www.magi-cut.co.uk/saw-interface>), y la ayuda en línea:
[mct1404](https://www.magi-cut.co.uk/files/html/V12webhelp/mct1404.htm),
[mct1502](https://www.magi-cut.co.uk/files/html/V12webhelp/mct1502.htm),
[mct1272](https://www.magi-cut.co.uk/files/html/V12webhelp/mct1272.htm).

### Reglas generales

- Texto CSV con coma; extensión **`.PTX`**. Comillas optativas (obligatorias si
  un texto lleva coma; una comilla adentro se duplica). Los espacios iniciales
  se ignoran y las comas finales sobran.
- Una línea por registro; el primer campo es el nombre del registro.
- Los índices son enteros desde 1, consecutivos. Todo registro lleva el índice
  de su trabajo (`JOB_INDEX`).
- Medidas (`DIM`) en milímetros con decimales cuando `HEADER.UNITS` = 0
  (0,0 a 9999,9). Cantidades enteras, hasta 99999.
- Los códigos de material no llevan espacios (se cambian por `_`).
- **Codificación y fin de línea no están fijados.** El ejemplo oficial de V12 es
  ASCII con CRLF; Magi-Cut ofrece ASCII o Unicode, con ASCII por omisión.
- Lo mínimo para importar piezas es `PARTS_REQ` y `MATERIALS`.

### Registros (orden de campos)

Entre paréntesis, lo que escribe la plataforma.

**HEADER** — `VERSION, TITLE (25 caracteres), UNITS (0 mm, 1 pulgadas), ORIGIN
(solo para VECTORS), TRIM_TYPE (0 refila primero el desperdicio, 1 primero el
fijo)`. (`1.14`, `MJBJ CRT-460`, `0`, `0`, `1`.)

**JOBS** — `JOB_INDEX, NAME (50), DESC (50), ORD_DATE, CUT_DATE (DD/MM/YYYY),
CUSTOMER (100), STATUS (0 sin optimizar, 1 optimizado, 2 falló), OPT_PARAM,
SAW_PARAM, CUT_TIME (s), WASTE_PCNT`. (El nombre es el número del trabajo sin
letras: algunos controladores aceptan solo cinco dígitos.)

**PARTS_REQ** — `JOB_INDEX, PART_INDEX, CODE (50), MAT_INDEX, LENGTH, WIDTH,
QTY_REQ, QTY_OVER, QTY_UNDER, GRAIN (0 se puede girar, 1 veta a lo largo,
2 veta a lo ancho), QTY_PROD, UNDER_PROD_ERROR, UNDER_PROD_ALLOWED,
UNDER_PROD_PLUSPART`. (Un renglón por renglón del despiece; `QTY_PROD` es lo
que sale de los patrones, así que una pieza que no entra queda con 0.)

**PARTS_INF** (32 campos de etiqueta: descripción, medida terminada, cantos…),
**PARTS_UDI**, **PARTS_DST** (desapilado), **NOTES**, **PTN_UDI**: optativos,
no se escriben.

**BOARDS** — `JOB_INDEX, BRD_INDEX, CODE, MAT_INDEX, LENGTH, WIDTH, QTY_STOCK,
QTY_USED, COST, STK_FLAG, INFORMATION, MAT_PARAM, GRAIN, TYPE (0 stock,
1 retal), BIN, SUPPLIER` (+ `EXTRA_INFORMATION, COST_METHOD` en 1.21, no se
escriben).

**MATERIALS** — `JOB_INDEX, MAT_INDEX, CODE, DESC, THICK, BOOK (placas por
libro), KERF_RIP, KERF_XCT, TRIM_FRIP, TRIM_VRIP, TRIM_FXCT, TRIM_VXCT,
TRIM_HEAD, TRIM_FRCT, TRIM_VRCT, RULE1 (niveles de anidado), RULE2 (cortes de
cabeza), RULE3 (girar la placa), RULE4, MAT_PARAM, GRAIN, PICTURE, DENSITY`.
- **El ancho de sierra va acá y solo acá** (`KERF_RIP` y `KERF_XCT`).
- Los refilados incluyen la sierra.
- **Un campo vacío quiere decir «usá lo configurado en la máquina»; un 0 quiere
  decir cero.** La plataforma escribe 0 porque su plano no lleva refilado.
- `BOOK` 1: una placa por vez. El espesor sale de la descripción («18mm»), o 18
  si no lo dice.

**OFFCUTS** — retales con su índice, para nombrarlos como `X1`, `X2` en `CUTS`.
No se escriben: lo que sobra va como desperdicio de su fase.

**PATTERNS** — `JOB_INDEX, PTN_INDEX, BRD_INDEX, TYPE, QTY_RUN (placas con este
patrón), QTY_CYCLES, MAX_BOOK, PICTURE, CYCLE_TIME, TOTAL_TIME`. `TYPE`:
- 0 = primero a lo largo, sin corte de cabeza;
- 1 = girar la placa antes;
- 2 / 3 = corte de cabeza;
- 4 = solo transversales.

La plataforma usa 0, o 1 cuando el patrón arranca con cortes de través.

**CUTS** — `JOB_INDEX, PTN_INDEX, CUT_INDEX, SEQUENCE, FUNCTION, DIMENSION,
QTY_RPT, PART_INDEX, QTY_PARTS, COMMENT`.
- `FUNCTION`: 0 corte de cabeza, 1 longitudinal (*rip*), 2 transversal, 3 tercer
  nivel, 4 cuarto…; **90 + n** es el refilado o desperdicio de la fase n (91,
  92, 93…).
- `DIMENSION` es **la medida neta de la tira o la pieza, sin la sierra**, y es
  relativa (no una posición). La sierra la suma la máquina entre tira y tira.
- `QTY_RPT` es cuántas veces seguidas se corta esa medida. Con **0**, el
  registro no lleva pasada propia: es el último trozo que llega justo al
  borde («encaje exacto», la medida no cambia) o el desperdicio final.
- `PART_INDEX`: el renglón de `PARTS_REQ` que sale, 0 si no sale pieza, o
  `X` + índice de retal.
- `QTY_PARTS`: piezas que salen de ese registro **sumando todas las placas del
  patrón**.
- `SEQUENCE` (optativo): orden en que corta la máquina; avanza de a `QTY_RPT`,
  y vale 0 para los registros sin pasada. Si no viene, lo decide la máquina.
- Los registros van **anidados en preorden**: cada tira de función 1 y, debajo,
  los cortes de función 2 de esa tira, y debajo de cada uno los de función 3.

**VECTORS** (optativo) — las mismas líneas en coordenadas absolutas. No se
escriben.

### La cuenta que cierra

Verificado sobre el ejemplo oficial (patrón 4, placa de 2440 × 1220, sierra 4,8,
refilado 10). Los registros de función 1 son `91 5,2`, `1 572`, `1 572` y
`91 56,4`:

5,2 + 4,8 + 572 + 4,8 + 572 + 4,8 + 56,4 = **1220**

Cada registro con `QTY_RPT` *n* consume *n* × (medida + sierra). El último, con
`QTY_RPT` 0, es lo que queda. Los tests de `tests/ptx.test.ts` rearman el
árbol leyendo solo el archivo y comprueban esta cuenta en cada trozo, además
de que salgan exactamente las piezas del despiece. Corre sobre doscientos
despieces al azar.

## Cómo lo escribe la plataforma

Un ejemplo, el archivo de prueba [`ptx/PRUEBA1.PTX`](ptx/PRUEBA1.PTX). El
despiece son 2 puertas de 800 × 400 con veta y un estante de 600 × 350, sobre
una placa de 2750 × 1830 con sierra de 4,4:

```
HEADER,1.14,MJBJ PRB-1,0,0,1
JOBS,1,1,PRB-1 Melamina 18mm blanca,15/10/2026,,Prueba de la plataforma,1,,,0,83.11
PARTS_REQ,1,1,P1_PUERTA,1,800.0,400.0,2,0,0,1,2,0,0,0
PARTS_REQ,1,2,P2_ESTANTE,1,600.0,350.0,1,0,0,0,1,0,0,0
BOARDS,1,1,MELAMINA_18MM_BLANCA/01,1,2750.0,1830.0,1,1,0.000,0,,,1,0,,
MATERIALS,1,1,MELAMINA_18MM_BLANCA,Melamina 18mm blanca,18.0,1,4.4,4.4,0.0,0.0,0.0,0.0,0.0,0.0,0.0,3,0,0,0,,1,,
PATTERNS,1,1,1,0,1,1,1,,0,0
CUTS,1,1,1,1,1,400.0,1,0,0
CUTS,1,1,2,2,2,800.0,2,1,2
CUTS,1,1,3,4,2,600.0,1,0,0
CUTS,1,1,4,5,3,350.0,1,2,1
CUTS,1,1,5,0,93,45.6,0,0,0
CUTS,1,1,6,0,92,536.8,0,0,0
CUTS,1,1,7,0,91,1425.6,0,0,0
```

Se lee así:
- Una tira de 400 a lo largo.
- De la tira, dos piezas P1 de 800 de través, y un trozo de 600.
- Del trozo de 600, a lo largo, la pieza P2 de 350; caen 45,6 de desperdicio.
- Al final de la tira quedan 536,8, y de la placa quedan 1425,6.

Es la misma secuencia que la hoja de corte, y sale del mismo árbol
(`lib/cortes/secuencia.ts`).

Decisiones para una PC con Windows XP:

- **ASCII puro.** Los acentos se transliteran (é → e, ñ → n) y el resto se
  descarta. Así no importa si quien lo lee espera Windows-1252 o ASCII, y no
  hay BOM.
- **CRLF**, como el ejemplo oficial.
- **Sin comillas.** Una coma en un texto se cambia por un punto, que es lo que
  hace Magi-Cut al importar.
- **Nombre 8.3 en mayúsculas**: `CRT460.PTX`. La spec no lo exige, pero
  CADmatic 3 pide ocho caracteres sin espacios y algún controlador, cinco
  dígitos de trabajo; lo corto no le hace mal a ninguno y en un pendrive FAT32
  con XP se ve igual en todos lados.

## Lo que no está confirmado

1. **Que WinCut lea PTX.** Es lo más importante y no se pudo confirmar.
   - Wood Tec Pedia dice que WinCut importa en formato **«Perfect Cut»**, cuya
     especificación no se encontró.
   - En SCM, el PTX lo lee **Maestro Converter Cut** (lo convierte a datos SCM),
     y MaestroActive lo lee en versión 1.14.
   - OptiCut tiene posprocesadores separados para «PTX 1.14 (SCM)» y para «SCM
     WinCut» / «SCM WinCutPlus». Eso sugiere que **WinCut tiene su propio
     formato**.
   - Los ejemplos de Magi-Cut traen otros formatos SCM: `.900` (Master-S, medidas
     en décimas de mm), `.xprg` / `.cprg` (Maestro Cut) y Seziona (`.lst` /
     `.prg`). **Si en la carpeta de programas de WinCut aparece alguno de estos,
     el camino es generar ese y no PTX.**
2. **La versión.** La guía dice «1.06» en una tabla y «1.08» en el texto;
   Magi-Cut V12 escribe 1.13 y SCM pide 1.14. No se encontró qué distingue una
   de otra en el archivo (los campos son iguales). Se declara 1.14.
3. **`QTY_RPT` del refilado.** El ejemplo de la guía y el export de V12 usan
   convenciones opuestas. No afecta: la plataforma no escribe refilado.
4. **Desperdicio negativo.** Cuando lo que queda es más fino que la sierra,
   Magi-Cut escribe la medida negativa (`93,-0.8`) y la plataforma hace lo
   mismo. No se sabe cómo lo toma una máquina SCM.
5. **El orden de corte (`SEQUENCE`).** La plataforma numera nivel por nivel y en
   el orden de la lista. Magi-Cut, dentro de un nivel, numera desde el otro
   extremo (corta primero la última tira). Si la máquina usa este campo, hay
   que mirar en qué orden lo muestra.
6. **Nombre de archivo y carpeta** que espera la máquina, y si toma un archivo
   suelto o hay que «importarlo» desde un menú.

**Con un programa real copiado de la máquina se ajusta todo esto**: el
generador es puro y tiene tests, así que cambiar una convención es tocar una
función y ver que los tests sigan cerrando la cuenta.

## Otras fuentes

- HOMAG intelliDivide, exportación PTX:
  <https://docs.homag.cloud/docs/en/intellidivide-in-a-nutshell-saw-export-format>
- Wood Tec Pedia:
  - WinCut: <https://wtp.hoechsmann.com/en/lexikon/11332/scm_wincut>
  - Maestro Converter Cut: <https://wtp.hoechsmann.com/en/lexikon/58873/scm_maestro_converter_cut>
- Microvellum, sobre MaestroActive y PTX 1.14:
  <https://community.microvellum.com/portal/en/kb/articles/maestroactive-encryption-plugin>
- OptiCut, posprocesadores: <https://wooddesigner.org/help-centre/opticut-integration-cnc-saw/>
- Promob Cut Pro para SCM Maestro Cut:
  <https://suporte.promob.com/hc/en-us/articles/31120896133009-Cut-Pro-SCM-Cutting-Manager-Maestro-Cut>
- Optimalon (genera PTX 1.08):
  <https://www.einpresswire.com/article/535949530/optimalon-software-introduces-support-for-cnc-saw-machines-in-online-panel-cutting-tool-by-generation-ptx-files>
- Dos PTX reales de una Holzma con CADLink:
  <https://github.com/tiagofur/muebleria/tree/main/docs/machines/ptx-cadmatic4>.
  Ojo: ese proyecto tuvo archivos rechazados por el CADLink sin saber por qué,
  y uno de los defectos era un `TITLE` de más de 25 caracteres.
