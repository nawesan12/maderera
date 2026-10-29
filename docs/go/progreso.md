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
| 3 | Productos, precios, stock, acopio | `go-productos` | hecha (el informe de reposición lee ventas: va con la tanda 5) |
| 4 | Clientes, cuenta corriente, cheques, cobros | `go-cuentas` | hecha (29/10): cartera 4×, historial 1,6×, cheques 2×, cobro 1,5× (bench/tanda4); recibo y resumen en PDF desde Go |
| 5 | Mostrador, caja, ventas, entregas | `go-mostrador` | hecha (29/10), integrada en `go-cuentas`: listado de pedidos 5,4×, ~3× menos memoria; nueve bugs de concurrencia y fechas arreglados; migración 00085 |
| 6 | Carrito, checkout, Mercado Pago | | |
| 7 | Facturación ARCA | `go-arca` | hecha (29/10), integrada en `go-cuentas`: CAE fuera de la transacción y recuperable tras un corte; falta homologar con el certificado real |
| 8 | Compras, proveedores, retenciones | `go-compras` | hecha (29/10), integrada en `go-cuentas`: pagos 6,5×, libro IVA 2,8×; tres bugs de concurrencia arreglados |
| 9 | WhatsApp | `go-whatsapp` | hecha (29/10), integrada en `go-cuentas`: webhook 1,4×, cola 1,7×; el worker de Go atiende los trabajos de WhatsApp |

| 10 | Campañas, avisos, profesionales, firma | `go-campanas` | hecha (29/10), integrada en `go-cuentas`: 3–6,5× pedidos/s, ¼ de la memoria; eventos guardados en UTC y permisos de aprobar arreglados |
| 11 | Cortes | `go-cortes` | hecha (29/10), integrada en `go-cuentas`; HTTP 6× con 20 a la vez |
| 12 | PDF y exportaciones | `go-pdf` | hecha (29/10), integrada en `go-cuentas`: 11 documentos idénticos a pdf-lib, con sus datos desde Go |
| 13 | Migración de ISIS | `go-migracion` | hecha (29/10), integrada en `go-cuentas`: repetible sin duplicar; cuatro bugs del TS arreglados |
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
- [x] El ajuste masivo en lote: dos consultas por lista en vez de tres por
      precio; 6400 precios en ~1 s (antes 21–33 s, y 32–45 s en TS)
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

## Tanda 12: PDF y exportaciones

Rama `go-pdf`. Los 11 documentos de `lib/pdf` están en `backend/internal/pdf`,
cada uno igual al de pdf-lib **píxel a píxel** (golden de 82 casos: 0,00000 %
de diferencia en todos, umbral 0,01 %, y el mismo texto con pdftotext).

- [x] La base (`hoja.go`, `escritor.go`): escritura propia de PDF en vez de
      fpdf, con los mismos operadores y números que pdf-lib y las métricas y
      el kerning de `@pdf-lib/standard-fonts` (`metricas.gen.go`, de
      `scripts/golden/metricas-pdf.ts`). fpdf mide sin kerning, ubica el
      texto desde arriba y redondea coordenadas: corría renglones y cortaba
      líneas en otro lugar. Medir sin kerning ya da 0,09–0,15 % de píxeles.
- [x] Golden: `scripts/golden/pdf.ts` (un archivo de casos por documento en
      `scripts/golden/pdf/`) → `backend/testdata/golden/pdf/<doc>/`;
      `TestGoldenPDF` rasteriza los dos con `pdftoppm` a 100 ppp y compara
      (necesita poppler: `brew install poppler`; sin él se saltea, en CI
      falla). También `formato.json` (moneda, fechas contra Intl), el QR
      (158 matrices contra qrcode 1.5.4), `desagregar` (3054 casos) e
      `importeEnLetras`.
- [x] Expuesto por Go (`api/documentos.yaml`, `internal/documentos`):
      `GET /api/v1/documentos/mi-lista-de-precios` (sesión, 10 por hora, la
      lista de la sesión) y `GET /api/v1/documentos/precios?formato=csv|pdf`
      (staff). Las rutas de Next `/mi-lista-de-precios` y
      `/admin/precios/exportar` ahora le piden el archivo a Go.
      `lib/pdf/lista-precios.ts` se borró (queda una copia en
      `scripts/golden/pdf/ts/` solo para regenerar los golden).
- [x] `internal/csvexcel`: `lib/csv-excel.ts` (el CSV para Excel de las
      exportaciones), golden de 12.618 casos.
- [x] Benchmark (`bench/tanda12`): Go 5–11× más rápido por documento y
      9–26× más pedidos por segundo con 8 a la vez; 30 MB contra 230–300 MB.
- No hay planillas XLSX que se escriban: `lib/xlsx.ts` solo lee (la
  importación de precios ya está en Go, tanda 3; la migración es la 13).
  Todas las exportaciones son CSV.
- Esperando a su tanda (el PDF ya está en `internal/pdf`; falta que los
  datos estén en Go y la ruta le pida el archivo):
  - Remito (`app/api/remitos/[id]/pdf`, WhatsApp), reposición
    (`app/admin/reportes/reposicion/exportar`, PDF y su CSV), presupuesto
    (`app/api/presupuestos/[id]/pdf`, WhatsApp) y reporte de ventas
    (`app/admin/reportes/exportar`, PDF y CSV): **tanda 5**.
  - Recibo (`app/api/recibos/[id]/pdf`, `lib/notificaciones/cobros.ts`,
    WhatsApp) y resumen de cuenta (`app/api/cuenta/[id]/pdf`, WhatsApp):
    **tanda 4**.
  - Comprobante (`app/api/comprobantes/[id]/pdf`,
    `lib/notificaciones/fiscal.ts`, WhatsApp) y el libro IVA en CSV:
    **tanda 7**.
  - Certificado de retención (`app/admin/compras/pagos/certificado/[numero]`)
    y los CSV de pagos y libro IVA compras (con `internal/csvexcel`):
    **tanda 8**. El de cierre de caja: **tanda 5**.
  - Plano y hoja de corte (`app/api/cortes/[id]/pdf|hoja`) y la lista de
    cortes en CSV: **tanda 11** (las piezas de `lib/cortes` que usan van
    como copias privadas en `corte_partes.go`: se juntan ahí).
  - Lo que manda documentos por WhatsApp (`lib/whatsapp/documentos.ts`):
    además, **tanda 9**.
- Arreglado en Go (con prueba):
  - Las fechas de «hoy» (vigencia de la lista, emisión de la reposición,
    firma del remito, `fechaCsv`) salen en hora argentina. El contenedor de
    Next no tiene TZ: en producción el TS fechaba en UTC, y después de las
    21 la lista decía mañana y la firma salía tres horas corrida.
  - Un emoji en un producto o un concepto tiraba la descarga entera del
    reporte de ventas y del resumen de cuenta (`recortar()` medía sin
    limpiar y pdf-lib tiraba un error). En Go el carácter no se cuenta al
    medir y el documento sale.
- Bugs del TS reproducidos a propósito (se arreglan con su tanda):
  - El comprobante no corta de página: con muchos renglones el detalle se
    dibuja encima del pie fiscal (tanda 7).
  - `importeEnLetras`: 999,995 sale «con 100/100», y desde mil millones se
    pierden los millones (1.234.567.890 → «treinta y cuatro millones…»)
    (tanda 4).
  - Una firma PNG con el CRC roto: UPNG la acepta y la dibuja, Go la
    rechaza y el remito sale sin firma (no está en el golden).
- Lo aprendido:
  - **pdf-lib mide con kerning pero dibuja sin él** (un `Tj` pelado): para
    que una alineación a la derecha dé igual hay que medir con kerning.
  - **ICU redondea la tira decimal más corta, no el valor binario**:
    `21021.995` con dos decimales es «21.022,00» en Intl y «21.021,99» con
    `toFixed`. Para los importes con decimales de los documentos (no la
    moneda sin decimales, donde da igual) va `Pesos` de `recibo_partes.go`.
  - **El Write de las herramientas escribe el BOM literal** si se le pasa
    `\ufeff` adentro de un string: Go no compila un BOM en medio del
    archivo. Se arregla con `perl -CSD -pi -e 's/\x{FEFF}/\\ufeff/g'`.
  - **pdftoppm + PGM alcanzan para un golden visual** sin dependencias de
    Go: el PGM se lee en veinte líneas.

### Benchmark de la tanda 12 (29/10/2026, misma Mac, sin base)

| Documento (caso más grande) | Go p50 | TS p50 | 8 a la vez, Go / TS |
|---|---:|---:|---:|
| Lista de precios (900 renglones) | 25 ms | 145 ms | 104 / 7 por s |
| Comprobante (60 renglones, QR) | 8 ms | 50 ms | 299 / 14 por s |
| Remito | 2,1 ms | 14 ms | 1185 / 69 por s |
| Hoja de corte | 18 ms | 82 ms | 78 / 6 por s |
| Memoria máx. | 26–37 MB | 214–308 MB | 50–85 / 225–375 MB |

El detalle de los 12 en `bench/tanda12/README.md`.

## Tanda 11: cortes

Rama `go-cortes` (desde 9a17128 de `go-productos`).

- [x] El motor en Go (`internal/cortes`): el plano guillotina con la regla de
      la media placa, la búsqueda con semilla y tope de trabajo, las fijadas,
      la hoja de corte en el orden de la máquina, el PTX, la lista para el
      optimizador, la tarifa, el presupuesto, la placa, la sierra y las
      calculadoras. **Golden** (`scripts/golden/cortes.ts` →
      `testdata/golden/cortes`): 1761 planos (el banco del benchmark y 1500 al
      azar con fijadas, veta, discos, semillas y presupuestos), 600 listas y
      el PTX byte a byte, 600 presupuestos, 1500 cargos y 3000 cálculos. Go da
      lo mismo exacto.
- [x] La cola y la ficha, el alta (CRT- con el candado de siempre, en el
      paquete compartido `internal/numeracion`), avanzar, urgente, pasadas,
      acomodo a mano, cambio de disco, formatos (con la vista previa), tarifas,
      parámetros de las calculadoras, placas cortables por lista, sugerencias
      de la calculadora, la cotización del corte del sitio (con el freno
      «corte») y los cortes del carrito al confirmar (ruta interna con el
      secreto y la cookie de quien compra).
- [x] **Las rutas del agente del taller no cambian**: `/api/cortes/pendientes`,
      `/api/cortes/{id}/lista` y `/api/cortes/{id}/ptx` las atiende Go en la
      misma dirección (Caddy con `@cortesGo`, rewrite en `next.config.ts` para
      desarrollo). Mismo token (`CORTES_AGENTE_TOKEN`, que `api` ya recibe por
      el env_file), mismo 404 sin token, mismo CSV con BOM.
- [x] **El plano en vivo lo calcula Go**: el mostrador, el alta del panel, el
      acomodo y `/corte` le mandan el despiece a `/api/v1/cortes/plano`
      (`lib/cortes/en-vivo.ts`, espera de 120 ms y cancela el anterior). Las
      calculadoras del sitio y la vista previa del formato, igual.
- [x] Next: los DAL y las acciones son envoltorios; se borraron
      `lib/cortes/{plano,secuencia,ptx,formatos,presupuesto,agente}.ts`,
      `lib/calculations.ts`, las tres rutas del agente y sus tests. La copia
      textual del TS queda en `bench/tanda11/ts` (la usan el golden y el
      benchmark). Los tipos salen del contrato (`lib/cortes/tipos.ts`).
- [x] Pruebas de Go contra la base con el contrato en cada respuesta; la de
      numeración concurrente (20 altas a la vez) falla sin el candado.
- [x] E2E escrita (`e2e/cortes.spec.ts`), **sin correr**: los servidores de
      desarrollo son compartidos.
- [x] Benchmark (`bench/tanda11`).
- Queda en TS hasta su tanda: el PDF del reporte y de la hoja (tanda 12; los
  datos ya vienen de Go), la escritura de `cart_cortes` y la confirmación del
  pedido (tanda 6), y lo que usa el mostrador en el navegador
  (`lib/cortes/tarifa.ts`, `placa.ts`, `sierra.ts`, tanda 5: son las mismas
  cuentas que Go, cubiertas por el golden). Leen `cutting_orders` desde otros
  módulos, y se mudan con ellos: la venta y la anulación del mostrador, el
  resumen y los pendientes del panel, sucursales, el buscador del panel,
  existencia, los avisos y documentos de WhatsApp y `lib/reportes-cortes.ts`.
- El `.CPrg` queda fuera: es un formato cifrado (ver la memoria de cortes).
- **Bug arreglado: la fecha del PTX salía en UTC.** El contenedor de Next no
  tiene `TZ` y `getDate()` daba el día UTC: un trabajo cargado después de las
  21 h salía con la fecha de mañana. Go la escribe en hora argentina; el
  golden se genera con `TZ=America/Argentina/Buenos_Aires` y falla si Go usa
  UTC.
- **Arreglos menores**: un formato con nombre repetido daba 500 (ahora avisa);
  una fijada con placa < 1 rompía el plano (el contrato la rechaza); un tope
  de 5000 piezas para el plano en vivo.
- Lo aprendido:
  - **Un número del contrato sin `format: double` es `float32` en Go**
    (oapi-codegen): 4,4 mm de sierra llegaba como 4.400000095. En cortes
    todos los `number` llevan `format: double`. Las otras tandas lo tienen
    igual (stock: `cantidad`); conviene revisarlo.
  - Dos dominios con el mismo nombre de esquema (`Ficha` en productos y en
    cortes) se cruzan en `Esquemas` de `lib/api/tipos/index.ts`: el de
    cortes se llama `FichaCorte`.
  - Un motor que corría en el navegador también se muda: el golden asegura
    que es el mismo cálculo, y el navegador lo pide por HTTP con espera y
    cancelación. De a uno tarda lo mismo que antes (~12 ms).

- Benchmark (29/10/2026, misma Mac; detalle en `bench/tanda11/README.md`):

| Prueba | TypeScript | Go | Go / TS |
|---|---:|---:|---:|
| Banco de 200 despieces con búsqueda: ms por despiece | 16,2 | 11,4 | **1,4×** |
| ídem, el peor despiece | 150 ms | 56 ms | **2,7× menos** |
| Placas del banco (heurística / búsqueda) | 559 / 534 | 559 / 534 | idénticas |
| Plano por HTTP, 20 a la vez: pedidos/s | 28,3 | 174,5 | **6,2×** |
| ídem, p50 / p99 | 454 / 2944 ms | 110 / 266 ms | **4× / 11× menos** |
| ídem, memoria máx. | 154 MB | 53 MB | 2,9× menos |
| Plano por HTTP, de a uno: p50 | 12,8 ms | 12,1 ms | empate |

## Tanda 9: WhatsApp

- [x] Lógica pura (internal/whatsapp) con golden contra el TS
      (`scripts/golden/whatsapp.ts`): números, ventana de 24 h, BAJA/ALTA,
      firma del webhook, costos y tope, errores de Meta, plantillas (leer,
      completar, componentes), el payload del webhook (1240 casos, los de
      vitest y mutados al azar), el cuerpo de cada envío, limpiar/resumen, el
      aviso manual por wa.me y los datos de la sucursal
- [x] Webhook de Meta en Go con la misma URL (`/api/whatsapp/webhook`):
      verificación GET, firma sobre los bytes crudos, a la cola y 200
- [x] Los tres trabajos (`whatsapp.payload`, `whatsapp.estado`,
      `whatsapp.medio`) en el worker de Go; fuera de `MANEJADORES` (y por eso
      de `TIPOS_PROPIOS`) de lib/cola
- [x] Envíos por la Graph API y proveedor de demostración; EnviarYRegistrar
      como única puerta de salida; adjuntos privados (`/api/whatsapp/medios/<id>`
      y `/api/whatsapp/enviar-archivo`, mismas direcciones)
- [x] Plantillas: sincronización (botón, webhook y la tarea diaria
      `plantillas-whatsapp` del worker; salió de la `diaria` de lib/tareas)
- [x] Bandeja, configuración, gasto y tope, avisos automáticos (ruta interna
      con el secreto; el PDF se pide en dos pasos, solo si el aviso sale) y el
      botón «Avisar por WhatsApp» con su historia
- [x] Pruebas de Go contra la base y contra un simulador de la Graph API: la
      ida y vuelta entera, demostración, permisos, coexistencia, estados
      tardíos, avisos y archivos; el contrato en cada respuesta
- [x] E2E escrita (`e2e/whatsapp.spec.ts`, en modo demostración); sin correr
- [x] Benchmark (`bench/tanda9`)
- [ ] La consulta del gasto del mes recorre los salientes en cada apertura de
      la bandeja (~28 ms con 40.000 mensajes): un índice parcial o el gasto
      guardado. Es lo que hoy limita la bandeja, en TS y en Go
- [ ] El worker toma 100 trabajos cada 2 s: un mensaje entrante tarda hasta
      2 s en aparecer (el TS lo procesaba en el `after()` de la ruta)
- Queda en TS: lo que corre en el navegador (plantillas, ventana, costos,
  números, aviso-manual, plantillas-base; Go tiene su gemelo con golden), los
  PDF de `documentos.ts` (tanda 12: Next los arma y viajan a Go en el
  pedido), el alta de ficha desde una conversación (clientes, tanda 4: Next
  crea la ficha y Go la vincula), `enlace.ts` (el wa.me público del sitio) y
  los scripts de desarrollo (`simulador-meta.ts`, `whatsapp-webhook.ts`,
  `seed-whatsapp.ts`), que hablan HTTP o SQL y siguen andando.
- Los adjuntos de Vercel Blob (de antes de la VPS) ya no se leen: Go lee
  `privado:` y `/subidas/`.
- Bug del TS arreglado: `fechaCorta`/`fechaHora` usaban la zona del servidor,
  y el contenedor de la aplicación corre en UTC (el compose pone `TZ` solo a
  la base y al cron): la historia del aviso manual decía las 03:05 por las
  00:05 y la fecha de las plantillas era la de mañana desde las 21. Go dice
  todo en hora de Argentina (`TestFechasEnHoraArgentina`).
- Benchmark (29/10/2026, misma Mac, 1500 conversaciones y 30.000 mensajes):

  | Prueba | TypeScript | Go | Go / TS |
  |---|---:|---:|---:|
  | Abrir la bandeja, 20 a la vez: pedidos/s | 71,9 | 83,3 | 1,2× (manda Postgres) |
  | ídem, p99 / memoria máx. | 508 ms / 174 MB | 421 ms / 52 MB | 1,2× / 3,3× menos |
  | Webhook, 5000 firmados, 50 a la vez: aceptados/s | 2229 | 3198 | **1,4×** |
  | ídem, p99 / memoria máx. | 52 ms / 162 MB | 34 ms / 42 MB | 1,5× / 3,9× menos |
  | Procesar 5200 payloads encolados | 115,5 s | 68,6 s | **1,7×** |

- Aprendido: el hook de Mercado Pago también bloquea un `WebhookSecret:
  "…"` de 20 caracteres o más en un archivo (lo toma por un secreto real):
  en las pruebas va en una constante. Y en el `Esquemas` de todos los
  dominios juntos los nombres chocan (`Mensaje` existe en otro): el DAL de
  WhatsApp usa los esquemas de su propio archivo de tipos.

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
| Ajuste masivo de 6400 precios | 32–45 s | ~1 s (en lote) | **~35×** |

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

## Tanda 4: clientes, cuenta corriente, cheques y cobros (29/10, rama go-cuentas)

- En Go: `internal/cobros` (EmitirRecibo, anular, cheques, crédito, historial,
  resumen, recibo completo), `internal/clientes` (ficha, cartera, vendedores,
  seguimiento) y `internal/cuentas` (api/cuentas.yaml, 27 rutas).
- Next: el DAL de clientes, cheques, cobranza, vendedores, seguimiento,
  historial, recibos, resumen y la cuenta corriente del portal, y las cinco
  acciones, son envoltorios. Recibo y resumen se leen con `apiInterna`: las
  rutas de PDF ya revisan de quién es (el worker de la cola necesita
  `API_URL` y `API_SECRETO_INTERNO`).
- Quedan en TS hasta su tanda: `emitirRecibo` (mostrador, facturación,
  acreditar, retenciones sufridas) y `estadoDeCredito` (mostrador,
  facturación). Los avisos `recibo.aviso` y `cheque.rechazado` los encola Go
  y los atiende el TS.
- Bug arreglado: el límite de crédito con formato argentino («1.500.000»
  daba 0). `internal/formato` imita Intl de es-AR (golden de 3017 números).
- E2E `e2e/cuentas.spec.ts`; toda la batería: 26 en verde.

## Tanda 8: compras, proveedores y retenciones (rama `go-compras`)

Hecha el 29/10/2026 en `backend/internal/compras` (contrato
`backend/api/compras.yaml`). Falta correr la e2e (`e2e/compras.spec.ts`) al
integrar.

### Inventario (lo que había en TS y adónde fue)

| TS | Qué hacía | Ahora |
|---|---|---|
| `lib/dal/admin/proveedores.ts` | listado con saldo, ficha con el libro, condiciones, para elegir, perfil de la lista, resolver códigos | Go; el DAL es un envoltorio |
| `app/admin/proveedores/actions.ts`, `[id]/condiciones-actions.ts` | ficha (alta/edición), movimientos de cuenta, baja, condiciones, convenios | Go; las acciones son envoltorios |
| `app/admin/proveedores/lista-precios/actions.ts`, `lib/precios/lista-proveedor.ts` | vista previa (planilla + perfil + apareo) y aplicar | Go (con `internal/planilla`); el TS se borró |
| `lib/dal/admin/ordenes-compra.ts`, `app/admin/compras/ordenes/actions.ts` | órdenes: listar, ver, crear (serie `OC-n`), enviar, anular, recibir; lo que está por llegar | Go (`internal/numeracion`, compartido con la tanda 4) |
| `lib/dal/admin/recepciones.ts`, `app/admin/recepciones/actions.ts`, `lib/compras/recepcion.ts` | recepciones: listar, ver, buscar mercadería, crear, confirmar (stock + costo + deuda), anular | Go; `recepcion.ts` se borró |
| `lib/compras/costo.ts` | `mezclarCosto`, `prorratearGastos`, `margenDeLinea` | las dos primeras a Go (se borraron); el margen queda (lo usan las ventas) |
| `lib/compras/congelar.ts` | el costo que se congela en una venta | queda: corre dentro de las ventas (tandas 5 y 6) |
| `lib/dal/admin/pagos-proveedor.ts`, `app/admin/compras/pagos/actions.ts`, `lib/retenciones/pago.ts`, `lib/retenciones/calculo.ts` | pagos con retenciones, imputaciones, partes y cheques; regímenes; acumulado del mes; certificado | Go; `pago.ts` y `calcularRetencion` se borraron (quedan el tipo y `REGIMENES_INICIALES` para la semilla) |
| `app/admin/compras/pagos/exportar/route.ts`, `app/admin/arca/libro-iva-compras/exportar/route.ts` | los CSV | Go arma el archivo; la ruta de Next le pone las cabeceras |
| `app/admin/compras/pagos/certificado/[numero]/route.ts` | el PDF del certificado | los datos de Go; el PDF queda en TS (tanda 12) |
| `lib/dal/admin/compras-fiscal.ts`, `app/admin/compras/facturas/actions.ts` | libro IVA compras, facturas de compra (carga con la deuda) | Go |
| `lib/dal/admin/retenciones-sufridas.ts`, `app/admin/arca/retenciones/*` | listar, crédito por impuesto, regímenes (alícuotas), **cargar** | Go, **menos la carga**: emite un recibo, espera `internal/cobros` de la tanda 4 |
| `lib/dal/admin/gastos.ts`, `app/admin/compras/gastos/actions.ts` | gastos (con su salida de caja si es efectivo), por categoría, por circuito | Go; el turno se busca con la misma consulta de `turnoQueContiene` (se junta con la caja en la tanda 5) |
| `lib/dal/numeracion-ventas.ts` | `siguienteNumeroDeOrdenDeCompra` | se borró (está en `internal/numeracion`) |

Quedan en TS porque son de otra tanda y solo leen estas tablas:
`lib/dal/admin/cierre-mensual.ts`, `lib/contable/asientos.ts`,
`lib/dal/admin/busqueda-panel.ts`, `lib/dal/admin/pendientes.ts`, las
semillas y la migración de ISIS.

### Golden

`scripts/golden/compras.ts` (con `TZ=UTC`, como Next en producción) corre el
TS real —las copias de lo que se borró están en `scripts/golden/originales`,
con sus pruebas de vitest— sobre 3000 costos, 3000 prorrateos, 300 cadenas de
recepciones (con el estado guardado como numeric), 5000 retenciones, 400
meses de pagos (el acumulado sumado como Postgres), 3000 controles de pago
(imputaciones y partes), 1500 listas de proveedor, 200 libros IVA con su CSV
byte a byte, 150 CSV de retenciones, 500 saldos corrientes, 2000 facturas con
saldo, períodos, vencimientos, `formatearMonto` y 2184 formularios por los
esquemas de zod (primer error con su campo, o los datos leídos). Go da lo
mismo en todos.

### Bugs del TS arreglados (cada uno con su prueba que falla sin el arreglo)

- **Recepciones simultáneas perdían una mezcla del costo.** El candado era
  el del stock (variante y sucursal) y el costo es por variante: dos
  recepciones de lo mismo en sucursales distintas leían el mismo costo previo
  y la segunda pisaba a la primera (sin fila previa, la segunda abortaba con
  el índice único). Ahora además se bloquea la fila de `variant_costs`.
  `TestRecepcionesSimultaneasNoPierdenLaMezcla`.
- **Anular una recepción sin remito no devolvía la deuda.** La nota de crédito
  sumaba las facturas con la referencia del remito; sin remito no encontraba
  ninguna. Ahora sale de las líneas de la recepción (lo mismo que se cargó).
  `TestAnularSinRemitoDevuelveLaDeuda`.
- **Los pagos a proveedores no tomaban candado.** Dos a la vez repetían el
  número de certificado (el segundo abortaba con un error crudo), retenían de
  menos sobre el mismo acumulado del mes e imputaban dos veces el saldo de
  una factura. Ahora toman `pg_advisory_xact_lock(1_000_000_000_801)`
  (`compras.SeriePagosAProveedores`; por encima de las series de
  `numeracion`) y bloquean la factura y el cheque endosado.
  `TestPagosSimultaneosNumeranSinRepetir`.
- **Permisos:** aplicar la lista de un proveedor pedía solo ser personal
  (cualquier vendedor reescribía la lista general); ahora es del admin. Y lo
  que está por llegar, que lo muestra la grilla de `/admin/stock`, pedía el
  admin: al depósito y al vendedor la página de stock los mandaba a su
  inicio. Ahora lo lee quien entra a `/admin/stock`.
- Menores, sin prueba aparte: editar una condición de pago exige que sea del
  proveedor de la ficha; las fechas inválidas y los proveedores que no
  existen dan un 422 con mensaje en vez de un 500.

### Pendiente

- [ ] La carga de una retención sufrida (`cargarRetencionSufrida`): emite un
      recibo; espera `internal/cobros` de la tanda 4.
- [ ] El PDF del certificado de retención (tanda 12).
- [ ] `turnoQueContiene` duplicado en `internal/compras/gastos.go`: se junta
      con la caja de la tanda 5.
- [ ] La e2e `e2e/compras.spec.ts` (no se corrió: los servidores son
      compartidos).
- Sin cambiar (a propósito, anotado): aplicar la lista del proveedor no deja
  historial de precios (el TS tampoco); `TotalDeGastos` sale como `clave` y
  el DAL lo renombra a `categoria`/`circuito`.

### Benchmark (29/10/2026, misma Mac, 20 a la vez; detalle en `bench/tanda8`)

| Prueba | TypeScript | Go | Go / TS |
|---|---:|---:|---:|
| Listado de proveedores: pedidos/s | 108,7 | 164,6 | 1,5× |
| Ficha de un proveedor: pedidos/s | 212,5 | 265,0 | 1,2× |
| Pagos (60): pedidos/s | 76,7 | 495,2 | **6,5×** (consulta acotada con `LATERAL`) |
| Libro IVA de un mes en CSV: pedidos/s | 93,2 | 258,2 | **2,8×** |
| Pagar con retención, 5 a la vez: fallos | **79,8 %** | 0 % | el TS repite el certificado |
| Memoria máx. | 164–245 MB | 89–91 MB | ~2× menos |

### Lo aprendido

- **Los formularios de las acciones van a Go como objeto libre** y se validan
  con `internal/compras/zod.go`: faltar, venir en null o con otro tipo dan el
  error que daba zod (el NaN de JS llega como null). Un contrato con tipos
  estrictos rechazaba antes que zod y con otro mensaje.
- **kin-openapi decodifica `text/csv` como CSV con coma** para validar la
  respuesta, y un archivo con `;` y BOM no pasa. Los CSV salen de Go como
  `application/octet-stream` y Next les pone sus cabeceras.
- **El lado TS de un benchmark corre en la zona de la máquina** salvo que se
  le diga: con la de Argentina, «el mes» empieza tres horas después que en
  producción (UTC) y los listados por período no coinciden. `TZ=UTC`.
- **Un `pkill` de otro agente puede tirar tu servidor**: el binario del
  benchmark lleva nombre propio (`mjbj-t8`).

## Corte final: lo que ya se ensayó (29/10/2026)

**Restaurar y migrar.** Un volcado de la base de desarrollo (Postgres 17, con
las 79 migraciones de drizzle) restaurado con `pg_restore --no-owner
--no-acl` en un Postgres 18 limpio; `mjbj migrar` la adoptó («base adoptada
de drizzle», 79) y aplicó la 80 en 0,05 s. La API levantó sobre esa base, el
admin entró con su clave de better-auth (scrypt) y todas las rutas mudadas
contestaron 200 en 3–35 ms. Para el día del corte, lo mismo contra el
respaldo de producción:

```sh
pg_dump -F c … > antes.dump            # o el último de respaldos/
createdb ensayo && pg_restore -d ensayo --no-owner --no-acl antes.dump
DATABASE_URL=…/ensayo mjbj migrar
DATABASE_URL=…/ensayo … mjbj api       # y recorrer el panel
```

**Carga** (`bench/corte/carga.k6.js`): 200 a la vez durante 60 s contra esa
API —140 en el catálogo (listado y búsqueda), 40 en el panel, 20 con el
tiempo real abierto—: 9229 pedidos, **0 fallos, p50 5 ms, p95 9,5 ms, p99
134 ms**, 101 MB de memoria. Falta sumarle el mostrador cuando la tanda 5
esté, y correrla en la VPS (la de desarrollo es una Mac de 6 núcleos).

## Lo que no era de ninguna tanda (29/10/2026, rama `go-cuentas`)

Mudado a Go mientras corrían las tandas 5, 7, 10 y 13:
- **Bitácora** (`internal/bitacora`, `api/bitacora.yaml`): la pantalla, sus
  filtros y la campanita. La escritura queda en TS mientras haya acciones de
  TS que anotan. «Hace N días» contaba desde la medianoche UTC.
- **Mi cuenta** (`internal/portal`, `api/portal.yaml`): la ficha, el
  resumen, pedidos, presupuestos (y responderlos), datos y direcciones.
  Quedan en TS el detalle de un pedido (lee el acopio, tanda 5), volver a
  pedir (carrito, tanda 6), los comprobantes (tanda 7) y la baja de novedades
  (campañas, tanda 10).
- **Seguimiento público de un pedido** (`internal/portal/seguimiento.go`):
  token en tiempo constante, el mismo 404 para «no existe» y «no es tuyo», y
  los renglones sin costo ni alícuota.
- **Métricas de las sucursales** (`internal/stock/sucursales.go`), con el día
  argentino.
- **«¿Existe esto?»** (`internal/existencia`), solo con el secreto interno.
- **Cola**: un trigger avisa cada trabajo nuevo y el worker se despierta en
  el acto (migración 00081); si una pasada llena el tope, sigue de largo.
- **Contratos**: todo `number` es `double` (había 111 en float32) y
  `api/contratos_test.go` lo vigila.
- **WhatsApp**: índice parcial para el gasto del mes (migración 00082).

Queda en TS sin tanda asignada, para el corte final: el buscador del panel
(`lib/dal/admin/busqueda-panel.ts`, lee de todos los dominios: va después de
la 5), `lib/dal/admin/reportes.ts` (si la 5 no lo mudó), `/api/diagnostico`,
`lib/tareas` y `lib/cola` (los trabajos que todavía atiende el TS), y la
escritura de la bitácora.

## Tanda 10: campañas, avisos, profesionales y eventos (rama `go-campanas`)

Hecha el 29/10/2026 desde `go-cuentas` (56ef2a1). Paquetes nuevos:
`internal/campanas` (campañas, bajas, novedades de Mi cuenta),
`internal/avisos` (despacho de correos, `email.reintento`, el panel de
avisos y las suscripciones de push), `internal/profesionales` (solicitudes,
aprobación, estado profesional, eventos e inscripción) e `internal/zod`
(validación de formularios de texto como zod 4, compartible). Contratos
`api/campanas.yaml` y `api/profesionales.yaml`. Falta correr la e2e
(`e2e/campanas.spec.ts`) al integrar.

## Tanda 7: facturación electrónica con ARCA (rama `go-arca`)

Hecha el 29/10/2026 desde `go-cuentas` (56ef2a1). Contrato
`backend/api/facturacion.yaml`; la lógica pura en `backend/internal/fiscal`
(con el simulador de ARCA en `internal/fiscal/simulador` y
`cmd/simulador-arca`) y la base en `backend/internal/facturacion`. Sin
migraciones nuevas: el pedido de CAE se anota en `arca_log` antes de mandarlo.

### Inventario

| TS | Ahora |
|---|---|
| `lib/campanas/{baja,bajas,correo,cuerpo,disponible,envio}.ts`, `lib/dal/admin/campanas.ts`, `app/admin/campanas/actions.ts` | Go; borrados (copias en `scripts/golden/originales/tanda10/`); el DAL y las acciones son envoltorios |
| `lib/campanas/segmento.ts` | queda solo `SEGMENTO_TODOS` y `duracionDelEnvio` (los usa el editor en el navegador; el gemelo de Go está en el golden) |
| `campana.tanda` (cola) y `iniciarProgramadas` (tarea `cada-minuto`) | worker de Go: el manejador y una vuelta por minuto |
| `/api/baja` (RFC 8058, POST da de baja, GET lleva a /baja) | Go, **misma dirección** (Caddy `@baja`, rewrite en `next.config.ts`); `app/api/baja/route.ts` borrado. La página `/baja` y Mi cuenta le preguntan a Go |
| `lib/dal/admin/avisos.ts`, `app/admin/avisos/{acciones,push-actions}.ts`, `lib/notificaciones/sembrar.ts` | Go (siembra al listar); `sembrar.ts` borrado; `avisosDe` no lo usaba nadie |
| `email.reintento` (`reintentarEmail`) | worker de Go. Lo sigue encolando `despacharEmail` del TS: `CargasParaGo` en `lib/cola/manejadores.ts` |
| `lib/notificaciones/{profesionales,eventos}.ts` | Go (`internal/profesionales`, plantillas con golden); borrados |
| `lib/dal/admin/profesionales.ts`, `app/admin/profesionales/actions.ts`, `app/(public)/profesionales/actions.ts`, `lib/profesionales/fichas.ts`, `estadoProfesional` | Go; envoltorios; `fichas.ts` borrado. `estadoProfesional` pide `/api/v1/profesionales/estado` (se junta con `EsProfesionalAprobado`: mismo criterio) |
| `lib/dal/admin/eventos.ts`, `app/admin/eventos/actions.ts`, `lib/eventos/index.ts` (`inscribir`), la inscripción pública | Go, con el **mismo candado** `pg_advisory_xact_lock(hashtext(eventId))`; `lib/eventos` borrado (`confirmarInscripcionPorPago` y `cancelarInscripcion` no los usaba nadie) |
| `enviarRecordatorios` (tarea `diaria`) | worker de Go, tarea `recordatorios-eventos` a las 7; el botón del panel sigue |

Quedan en TS a propósito: `despacharEmail` y los avisos de pedidos, pagos,
facturas, presupuestos y recibos (tandas 4–7: leen la misma configuración de
`email_avisos`); `avisarAlPanel` (lo usan módulos en TS; suscribir y borrar
dispositivos ya es de Go); el cobro de un evento con precio
(`iniciarPagoDeInscripcion`, Mercado Pago, tanda 6: Go reserva el lugar y
Next arma la preferencia) y el aviso al acreditarse (`notificarResultadoDePago`
le pide a Go `/api/v1/eventos/aviso-por-pago` con el secreto interno);
`lib/dal/admin/pendientes.ts` (lee solicitudes y eventos para el resumen del
panel, tanda 5); `titulos.ts` (textos de la pantalla). **Firma**: no hay firma
de correo ni de campañas; la del remito (`app/firmar`) es de la tanda 5 y
`lib/pagos/firma.ts` es la de Mercado Pago (tanda 6). Los descuentos por
volumen no existen (se borraron antes; `descuentoPorVolumen` del carrito es
de la tanda 6).

### Golden

`TZ=America/Argentina/Buenos_Aires npx tsx scripts/golden/campanas.ts` →
`testdata/golden/campanas/`: 1508 cuerpos (texto a HTML), 410 enlaces de baja
(firma, verificación con firma ajena, otro secreto, firma corta), 660
decodificaciones al azar (el `Buffer.from(…, "base64url")` de Node: se saltea
lo que no es del alfabeto y corta en `=`; el UTF-8 inválido como WHATWG),
2000 segmentos, 602 duraciones, 400 correos de campaña completos con sus
cabeceras, `primerNombre`, 18 formularios de zod (12.000 casos, primer error y
campo), `aSlug`, `decidirFicha` y las 85 plantillas de avisos. Go da lo mismo
en todos.

### Bugs del TS arreglados (con prueba)

- **Las fechas de los eventos se leían en la zona del servidor**, que en
  producción es UTC: `new Date("2026-11-05T18:00")` guardaba un evento de las
  18 como de las 15. Los correos de inscripción y recordatorio decían la hora
  en UTC («21:00» para uno de las 18), «mañana» de los recordatorios era el de
  UTC y el sufijo del slug repetido el mes de UTC. Go lee y escribe en hora de
  Buenos Aires (`TestEventos`, golden con la zona de Argentina).
- **Permisos**: aprobar una solicitud (que asigna lista de precios y límite de
  cuenta corriente) y todo el panel de eventos pedían solo ser personal: el
  depósito y el aserradero, que no entran a esas pantallas, podían hacerlo
  llamando a la acción. La configuración de avisos, igual (la pantalla es del
  admin). Ahora cada ruta exige el ACCESO de su pantalla
  (`TestSolicitudYAprobacion`, `TestAvisos`).
- «Aprobados este mes» empezaba el mes en UTC: el 1.º antes de las 21 contaba
  el mes anterior. Ahora el mes de Buenos Aires.
- Menores: una fecha de fin inválida en un evento daba un error de base (ahora
  avisa); `motivoParaNoEnviar` ya no mira `PLATAFORMA` (las tandas las manda el
  worker de Go, siempre está).

### Concurrencia (vistas fallar sin el arreglo)

- `TestInscripcionesSimultaneasRespetanElCupo`: diez al último lugar; sin el
  candado entran 6–7 (hay que abrir las conexiones antes y largar a la vez: si
  no, abrirlas espacia los pedidos y la prueba pasa sin candado).
- `TestTandasSimultaneasNoRepiten`: cuatro tandas a la vez de la misma
  campaña; sin `FOR UPDATE … SKIP LOCKED` a alguien le llega dos veces.

### Despliegue

- El worker ahora manda correo: necesita `EMAIL_*`/`SMTP_*`, `APP_URL` y
  `BETTER_AUTH_SECRET` (firma los enlaces de baja; tiene que ser el mismo que
  el de la app, o los enlaces de los correos que ya salieron dejan de
  verificar). Los toma de `.env.produccion`; `SMTP_HOST`, `SMTP_PUERTO` y
  `SMTP_NOMBRE_TLS` solo estaban en `app`: se sumaron a `api` y `worker` en
  `docker-compose.prod.yml`.
- `CAMPANAS_POR_MINUTO` sigue igual (3 con SMTP propio, 60 con Resend).

### Benchmark (29/10/2026, misma Mac, 20 a la vez; detalle en `bench/tanda10`)

| Prueba | TypeScript | Go | Go / TS |
|---|---:|---:|---:|
| Campañas (60, conteos de 120.000 envíos): pedidos/s | 9,6 | 30,6 | **3,2×** |
| Alcance de un segmento (20.000 fichas): pedidos/s | 107,2 | 96,7 | 0,9× (manda Postgres) |
| Solicitudes de profesionales: pedidos/s | 89 | 584 | **6,5×** |
| Eventos del panel: pedidos/s | 178 | 551 | **3,1×** |
| Estado profesional (cada página del sitio): pedidos/s | 430 | 1585 | **3,7×** |
| Memoria máx. | 176–224 MB | 42–58 MB | ~4× menos |
| Armar el correo de un destinatario (CPU) | 50 µs | 90 µs | **0,55×** (irrelevante con 3 por minuto) |

### Pendiente

- [ ] Correr `e2e/campanas.spec.ts` (no se corrió: los servidores son
      compartidos).
- [ ] `internal/email.Escapar`/`Envolver` asignan mucho (98 KB por correo de
      campaña): si alguna vez se manda sin tope, un `strings.Replacer`.
- [ ] La tanda 6 se lleva `iniciarPagoDeInscripcion` y el aviso por pago (hoy
      Next → `/api/v1/eventos/aviso-por-pago`); la 5, `pendientes.ts`.
- [ ] `despacharEmail` del TS y `avisos.Despachar` de Go conviven (misma
      tabla, mismo `email.reintento`): se junta cuando se muden los avisos de
      pedidos y pagos.

### Lo aprendido

- **pgx guarda las sentencias y Postgres pasa al plan genérico después de
  cinco ejecuciones.** Para una consulta armada con un segmento (tipo,
  rubros), el genérico no ve los valores y el conteo salía más lento que en TS
  (node-postgres no reusa sentencias). `pgx.QueryExecModeExec` como primer
  argumento: un plan por pedido.
- **Una prueba de concurrencia contra un pool recién creado no es
  concurrente**: abrir cada conexión tarda más que la transacción, y los
  pedidos llegan de a uno. Abrir las conexiones antes y largar con un canal.
- **La validación de zod de los formularios de texto entra en un paquete
  chico** (`internal/zod`): `String(campo, opcional).Trim().Min().Max()`,
  `Enum`, `EnteroCoercido` (el `z.coerce.number().int()` con sus cinco
  mensajes), y el `|| undefined` de las acciones como «"" en un opcional es no
  venir».
- **`pkill -f <patrón>` mata también el shell que lo ejecuta** si el patrón
  aparece en su propia línea de comandos.

| `lib/fiscal/impuestos.ts`, `comprobantes.ts` | quedan (los usan el navegador —el formulario de la factura—, los precios, el presupuesto y el mostrador); Go tiene su gemelo con golden |
| `lib/fiscal/notas.ts`, `numeracion.ts`, `qr.ts`, `proveedores/*` (WSAA con node-forge, WSFEv1) | Go; borrados (copias en `scripts/golden/originales/fiscal-*.ts` y `scripts/golden/pdf/ts/qr.ts`) |
| `lib/fiscal/emitir.ts` | Go; queda como envoltorio con las mismas firmas (`emitirComprobante`, `autorizarComprobante`, `obtenerConfiguracionFiscal`) para el mostrador y las hojas, por las rutas internas |
| `lib/dal/admin/facturacion.ts`, `app/admin/facturacion/actions.ts` | envoltorios de Go |
| `app/admin/arca/libro-iva/exportar`, el libro IVA | Go arma el CSV (con `internal/csvexcel`) y corta el mes en hora argentina |
| `app/api/comprobantes/[id]/pdf`, `lib/pdf/comprobante.ts` | el PDF de `internal/pdf` con los datos de Go; `lib/pdf/comprobante.ts` borrado (copia en `scripts/golden/pdf/ts`) |
| `misComprobantes` (`lib/dal/cuenta.ts`) | envoltorio de `GET /api/v1/cuenta/comprobantes` |
| `lib/notificaciones/fiscal.ts` (el PDF por correo) | el trabajo `factura.aviso` lo encola Go al emitir y al autorizar; lo atiende el TS pidiéndole el PDF a Go |
| `lib/fiscal/comprobantes-compra.ts` | queda (compras, tanda 8) |
| `app/admin/arca/retenciones/*` | ya estaba en Go (tandas 4 y 8) |

### El CAE fuera de la transacción

El orden es el del TS: **numerar y guardar** (transacción con el candado de
`claveDeLock`, la misma clave del TS) → **pedir el CAE** (sin transacción
abierta) → **guardar el CAE**. Lo que el TS no cubría:

- **El corte entre el CAE y el guardado** (el proceso muere, o la respuesta de
  ARCA no llega): el comprobante quedaba «emitido» sin CAE; al reintentar, el
  TS volvía a pedir el mismo número, ARCA lo rechazaba por repetido (10016) y
  quedaba «rechazado» con el CAE perdido. Go, si el anterior no tiene CAE o
  ARCA contesta 10016, pregunta el último autorizado; si el número ya está del
  lado de ARCA lo consulta (`FECompConsultar`) y adopta el CAE si el documento
  y el total coinciden. `TestCorteEntreElCaeYElGuardado` y
  `TestRespuestaPerdida` (corta la conexión del simulador).
- **Los pedidos van de a uno** (un mutex en el proceso y
  `pg_advisory_lock(1_000_000_003_001)` de sesión, sin transacción): ARCA
  solo acepta el número siguiente, y con ventas simultáneas el TS los mandaba
  desordenados; el primer 10016 dejaba rechazados todos los siguientes. Si hay
  anteriores sin CAE, se autorizan primero y en orden. Si el anterior ya tiene
  CAE, una sola llamada. `TestAutorizarVeinteALaVez`, `TestAutorizarEnOrden`.
- El pedido queda en `arca_log` **antes** de mandarlo y con el `invoice_id`
  (el TS lo anotaba después y sin el comprobante).

### Golden (`TZ=America/Argentina/Buenos_Aires npx tsx scripts/golden/fiscal.ts`)

4000 desagregados, 1000 totales, 1000 emisiones (con la percepción de IIBB o
los tributos dados), 1200 notas de crédito (renglones, prorrateo, tope),
1500 sueltas, 500 débitos, la letra, el documento, el número, 1500 fechas de
ARCA, 1000 claves de candado, **800 sobres de FECAESolicitar byte a byte**,
2005 respuestas leídas como fast-xml-parser, 300 tickets del WSAA y 300 TRA,
80 libros IVA con su CSV y 6500 formularios por los esquemas de zod (primer
error y su campo). Go da lo mismo en todos. Con la zona argentina a
propósito: ver «Arreglado».

### Pruebas

Contra la base y el simulador, con el contrato en cada respuesta: la ida y
vuelta (emitir a mano, CAE, QR, PDF, ticket reusado), el corte, la respuesta
perdida, 20 a la vez (**sin el candado fallan 17 de 20**:
`MJBJ_PRUEBA_SIN_CANDADO=1 go test -run TestNumeracionConcurrente`), el orden,
el proveedor interno, notas y anulación con la cuenta corriente, el cobro
(recibo por `cobros.EmitirRecibo`, cuenta corriente por `cobros.Credito`),
facturar un pedido una sola vez, el portal y las rutas internas, el libro en
hora argentina y el emisor con los puntos de venta. `go test -race` en verde.
E2E escrita (`e2e/facturacion.spec.ts`), sin correr: no emite nada.

### Arreglado (cada uno con su prueba)

- **La fecha que va a ARCA** (`CbteFch`, la del comprobante asociado y la del
  QR), la de la hoja impresa y la del PDF, **en hora argentina**: el TS usaba
  la zona del proceso (UTC en el contenedor) y desde las 21 h mandaba la fecha
  de mañana. El vencimiento del CAE se guarda a la medianoche argentina (el TS
  lo guardaba a la de UTC y se mostraba un día antes).
- **El libro IVA ventas por mes argentino**: una factura de las 22 del último
  día caía en el libro del mes siguiente. `TestLibroIvaEnHoraArgentina`.
- **Facturar un pedido dos veces** con dos clics: el TS miraba si ya tenía
  comprobante fuera de la transacción. Ahora se bloquea el pedido.
  `TestFacturarPedidoUnaSolaVez` (5 a la vez, uno solo).
- **El listado de facturación se caía** en cuanto un comprobante tenía un
  cobro: `array_agg(distinct medio)` de un enum vuelve de node-postgres como
  el texto `{efectivo}` y `.filter` no existe. Lo encontró el benchmark.
- **Dos tickets del WSAA a la vez**: ARCA no da otro mientras haya uno vigente
  y el segundo pedido fallaba. Candado `1_000_000_003_002`.
- La fila de `configuracion_fiscal` se podía crear dos veces (candado
  `1_000_000_003_003`); la deuda de una factura manual se anotaba fuera de su
  transacción; una fecha de inicio de actividades inválida daba 500.

### Reproducido a propósito (anotado, sin arreglar)

- Sin certificado, autorizar marca el comprobante **«rechazado»** con «Emitido
  sin autorización de ARCA…» (el proveedor interno; así lo hacía el TS).
- En la factura C, `ImpNeto` va con el total: si llevara tributos o exento,
  ARCA la rechazaría (no cierra). La maderera es responsable inscripta.
- Una alícuota fuera de 0/10,5/21/27 (la carga manual la acepta) va a ARCA
  como el Id 5 (21 %).
- El CSV del libro IVA ventas **cambió de formato** (es el de compras, con
  `internal/csvexcel`): CRLF, encabezados entre comillas, fecha dd/mm/aaaa.

### Para el mostrador (tanda 5)

- En Go: `facturacion.Nuevo(pool, log).EmitirParaLaVenta(ctx,
  facturacion.PedidoDeComprobante{…})` **después** de confirmar la venta,
  nunca adentro (no tira: devuelve el aviso y si quedó autorizado), y
  `LetraQueSaldria(ctx, customerID, cuit)` para decir la letra antes de
  cobrar. El alta rápida de clientes está en `internal/clientes/alta.go`
  (`PorDocumento`, `CrearRapido`).
- Mientras siga en TS: `lib/mostrador/comprobante.ts` funciona igual
  (`emitirComprobante`, `autorizarComprobante` y `obtenerConfiguracionFiscal`
  de `lib/fiscal/emitir.ts` llaman a Go), o directo
  `POST /api/v1/interno/facturacion/venta` y
  `GET /api/v1/interno/facturacion/letra` con `API_SECRETO_INTERNO`.

### Benchmark (29/10/2026, misma Mac; detalle en `bench/tanda7/README.md`)

| Prueba, 20 a la vez | TypeScript | Go | |
|---|---:|---:|---|
| Emitir y pedir el CAE (ARCA simulado, 60–180 ms) | 9,7/s, **0 de 217 con CAE** | 6,4/s, **145 de 145 con CAE** | el TS se desordena y ARCA rechaza en cascada |
| Libro IVA de un mes en CSV | 8,5/s, p50 2,2 s | **40/s, p50 440 ms** | **4,7×** |
| Listado (200 con cobros) | 150,6/s* | 120,6/s | empate (manda Postgres; Go además lee la sesión) |
| Memoria máx. | 149–264 MB | 37–118 MB | ~2–4× menos |

\* El TS de antes fallaba el 100 % (el bug del `array_agg`); se midió con el
arreglo puesto en la copia del banco.

### Homologación con el certificado real

Hoy no hay certificado (es de la clienta). Lo que ya está probado contra ARCA
de verdad: el TLS de Go con los cuatro servidores, `FEDummy` en homologación
con el sobre y la lectura de Go (`MJBJ_ARCA_REAL=1 go test -run
TestHomologacionReal ./internal/fiscal/`), y el WSAA de homologación leyendo
el CMS que firma Go (con un certificado autofirmado contesta «Certificado no
emitido por AC de confianza»: el formato lo acepta). Para homologar:

1. Subir el CSR de homologación (`~/Trabajo/Codigo/Misc/mjbj-arca/homologacion`)
   en WSASS, bajar el `.crt` y **delegar el servicio `wsfe`** a ese
   certificado. Dar de alta un punto de venta para web services en
   homologación.
2. Con el certificado y la clave en una carpeta propia (en producción,
   `secretos/arca/`, legible por el usuario 65532 de la imagen de Go: el
   compose ya los monta en `api`):
   `ARCA_CUIT=30589445259 ARCA_AMBIENTE=homologacion ARCA_CERTIFICADO_ARCHIVO=… ARCA_CLAVE_PRIVADA_ARCHIVO=… MJBJ_ARCA_REAL=1 MJBJ_ARCA_PV=<punto> go test -run TestHomologacionReal -v ./internal/fiscal/`
   (pide el ticket y el último autorizado del punto).
3. Con la API local y esas variables, cargar el emisor y el punto de venta en
   `/admin/arca` (el número inicial = el último de ARCA), emitir una factura B
   a consumidor final, una A a un CUIT de prueba, una nota de crédito parcial
   y una de débito, y autorizarlas desde el panel. Mirar `arca_log`.
4. Probar el corte: apagar la API justo después de autorizar (o cortar la red)
   y reintentar: tiene que recuperar el CAE con `FECompConsultar` y no pedir
   otro.
5. Para producción: el certificado de producción, `ARCA_AMBIENTE=produccion`,
   los puntos 15, 17 y 20 en modalidad web services y el número inicial de
   cada uno.

### Pendiente

- [ ] Correr la E2E (`e2e/facturacion.spec.ts`) y homologar (arriba).
- [ ] El candado del CAE es uno solo para todos los puntos de venta: alcanza
      para una maderera; si hiciera falta, uno por punto y tipo, y pedir
      varios comprobantes en un solo `FECAESolicitar` (`CantReg`).
- [ ] Leen `invoices` desde otros módulos y se mudan con ellos: la caja y las
      entregas (tanda 5), el cierre mensual, el buscador del panel, los
      asientos y los pendientes.
- [ ] El comprobante en PDF sigue sin cortar de página (tanda 12).

### Lo aprendido

- **Una transacción que pide otra conexión del pool se puede quedar
  esperando para siempre**: con 20 emisiones a la vez, cada una con su
  transacción abierta, la lectura del emisor por el pool no conseguía
  conexión. Adentro de una transacción, todo por la transacción. Y un
  candado de sesión que se espera con una conexión tomada hace lo mismo: el
  pedido de CAE espera primero un mutex del proceso, sin conexión.
- **node-forge firma el CMS con los atributos sin ordenar** y smallstep/pkcs7
  los reordena para verificar: el simulador verifica como OpenSSL (y ARCA),
  sobre los bytes que llegaron.
- **Un simulador con demora pareja esconde el desorden**: con 60 ms fijos el
  TS no perdía un CAE; con 60–180 ms, todos. El simulador tiene `-variacion`.

## Tanda 5: mostrador, caja, ventas y entregas (29/10, rama go-mostrador)

Sobre `go-cuentas`. Hecha en cuatro partes (el mostrador, y tres ramas
integradas: `go-mostrador-pedidos`, `go-mostrador-entregas`,
`go-mostrador-caja`). Falta correr las e2e (`e2e/mostrador.spec.ts`,
`ventas.spec.ts`, `entregas.spec.ts`, `caja.spec.ts`) y aplicar la 00085.

- [x] La base compartida: `internal/ventas` (importes del mostrador, forma de
      venta, descuento por medio de pago, fecha acotada, orden de clientes),
      `internal/reservas` (reservar, liberar, salida por remito, devolver,
      factores y costos congelados: **lo usa también el checkout de la tanda
      6**), `internal/caja` (turno que contiene un momento —compras lo usa en
      vez de su copia—, turno abierto, cierre Z, latido) e `internal/zodjs`
      (el lector de zod de compras, exportado y completo).
- [x] **Mostrador** (`internal/mostrador`, `api/mostrador.yaml`): la venta (la
      única que la registra, repetible por su clave), anular, abrir, mover y
      cerrar la caja con el arqueo, el buscador, el alta rápida, el
      presupuesto, el cobro de la cuenta con `cobros.EmitirRecibo`, la
      pantalla y la descarga de la cola. **Las rutas de la copia local no
      cambian**: `/api/mostrador/latido`, `catalogo`, `clientes`,
      `caja/movimientos` y `caja/vincular` las atiende Go en la misma
      dirección, con el mismo 401/403 de la guardia (Caddy `@mostradorGo`,
      rewrite en `next.config.ts`). Quedan en Next `/api/mostrador/config`
      (lee lo fiscal y las fichas de `lib/sucursales.ts`) y
      `/api/mostrador/ventas`, que le pide la descarga a Go y emite el
      comprobante (facturación, tanda 7). Tests de contrato sacados del TS
      para cada ruta.
- [x] **Pedidos y presupuestos** (`internal/pedidos`, `api/ventas.yaml`):
      tablero y ficha (el margen, solo para el admin), avanzar, cancelar,
      cobrado, presupuestos (plazo, decidir, convertir, alta) y su PDF.
- [x] **Entregas** (`internal/entregas`, `api/entregas.yaml`): saldo de
      acopio, remitos (preparar, anular, el de constancia del mostrador), la
      firma pública por token (`/firmar/<token>` no cambia), el remito en PDF,
      los retiros del portal y las zonas de envío. Serie de remitos con la
      misma clave del TS (918273645, `numeracion.Remito`).
- [x] **Caja del panel, cierre y reportes** (`internal/caja/panel.go`,
      `internal/reportes`, `api/caja.yaml`, `api/reportes.yaml`): cajas
      físicas, ventas sueltas, turnos cerrados con el cierre Z, lo emitido,
      el reporte de ventas y la reposición (PDF y CSV desde Go), el cierre del
      mes con su CSV y el inicio del panel (métricas y pendientes por rol).
- [x] Golden: `scripts/golden/mostrador.ts` (4000 ventas, 2000 escalas, 3000
      formas de venta, fechas, clientes y 10.500 formularios de las cinco
      puertas del mostrador), `pedidos.ts` (15.000), `entregas.ts` (14.515),
      `reportes.ts` (~13.000). Go da lo mismo exacto.
- [x] Migración 00085: índice sobre la expresión de la numeración (ver abajo).
- [x] Benchmark (`bench/tanda5`).

### Qué TS se borró y qué quedó

- Borrado: `lib/mostrador/{venta,anular,buscar,turno,caja}.ts`,
  `lib/dal/admin/{mostrador-offline,latido-caja}.ts`, la lógica de los DAL de
  ventas, entregas, cajas físicas, cierre, reportes, reposición, resumen y
  pendientes (quedan envoltorios con los mismos nombres),
  `lib/reposicion.ts`, `lib/contable/asientos.ts`, `lib/compras/costo.ts` y
  los PDF de presupuesto, remito, reposición y reporte de ventas (copias en
  `scripts/golden/originales` y `scripts/golden/pdf/ts` para los golden).
- Queda en TS: lo que corre en el navegador (`lib/mostrador/importes.ts`,
  `ticket.ts`, `arqueo.ts`, `ranking-clientes.ts`, `offline/*`; Go tiene su
  gemelo con golden), el comprobante (`lib/mostrador/comprobante.ts`, tanda
  7), y lo que usa el checkout de la tanda 6: `lib/dal/numeracion-ventas.ts`,
  `lib/inventario/reservas.ts`, `lib/compras/congelar.ts`, `lib/ventas/*`
  (con su gemelo en `internal/reservas` y `internal/ventas`). También
  `lib/cobros/recibo.ts` y `lib/dal/credito.ts` (facturación y acreditar).

### Bugs del TS arreglados (cada uno con su prueba, vista fallar sin el arreglo)

- **La venta no tomaba el candado del stock**: una corrección de la ficha
  (que lee y escribe el físico con el candado) le pisaba el descuento.
  `TestVentaContraFichaNoPierdeStock`. Las ventas toman los candados de
  todas sus variantes juntos y en orden (sin abrazo mortal entre dos ventas).
- **Una venta de la cola de un usuario que ya no existe** quedaba en
  «reintentar» para siempre (la clave foránea de la caja); ahora entra a
  nombre de quien la sube. `TestDescargaDeLaCola`.
- **El comprobante de una venta de la cola** se emitía con las líneas sin el
  descuento repartido (la acción en línea sí lo hacía bien). Go devuelve las
  líneas rebajadas.
- Pedidos: la misma conversión de un presupuesto dos veces daba varios
  pedidos; avanzar y cancelar a la vez dejaba un pedido vivo con las
  reservas liberadas; el historial repetía estados (FOR UPDATE de la fila).
  La anulación del mostrador también bloquea la fila.
- Entregas: veinte retiros a la vez del mismo acopio sacaban de más (el
  saldo se leía fuera de la transacción); la anulación y la firma dobles;
  anular un remito de constancia devolvía al stock lo que nunca sacó.
- Caja: asignar una venta suelta a un turno duplicaba el efectivo con diez
  clics.
- Fechas en hora argentina: «hoy» de las ventas del mostrador, el año del
  presupuesto (el 31/12 desde las 21 salía P-2027), la firma y la fecha del
  remito, los períodos y meses de los reportes, lo emitido por caja y la
  etiqueta del turno. **El cierre del mes sigue en UTC a propósito**: los
  días de gastos, facturas de compra y recepciones se guardan a las 0 UTC.
- Permisos: las acciones de la caja del panel piden el acceso de
  `/admin/caja`; el remito de constancia, el de `/mostrador`.

### Pendiente

- [ ] Correr las cuatro e2e; aplicar la 00085 antes de desplegar.
- [ ] Facturación (tanda 7): `/api/mostrador/ventas` y `/api/mostrador/config`
      se mudan enteros a Go cuando el comprobante esté en Go.
- [ ] Tanda 6 (checkout y Mercado Pago): confirmar la compra tiene que usar
      `reservas.ReservarPedido`, `reservas.FactoresDeStock`,
      `reservas.CostosParaCongelar`, `numeracion.Pedido` y
      `pedidos.DatosParaTransferir`; acreditar, `cobros.EmitirRecibo`. Al
      mudarlo se borran los TS de la lista de arriba.
- Diferencias sabidas: un NaN que la acción recibía de la pantalla llega a
  Go como null («expected number, received null» en vez de «received NaN»);
  `limiteCredito` del buscador de clientes sale como número (el TS lo daba
  como texto; la pantalla no lo usa).
- Mientras el carrito numere en TS, la noche del 31/12 los presupuestos de
  Go y del carrito usan años distintos (prefijos distintos: no chocan).

### Benchmark (29/10/2026, misma Mac, 20 a la vez; detalle en `bench/tanda5`)

| Prueba | TypeScript | Go | Go / TS |
|---|---:|---:|---:|
| Venta del mostrador (mismo candado): ventas/s | 27,0 | 30,5 | 1,1× (manda el candado) |
| Búsqueda del mostrador: pedidos/s | 29,6 | 26,3 | empate (manda Postgres) |
| Listado de pedidos (~9000): pedidos/s | 4,9 | 26,5 | **5,4×** |
| Descarga de la cola, lotes de 25, 5 a la vez: lotes/s | 1,5 | 1,6 | empate |
| Memoria máx. | 170–423 MB | 39–195 MB | ~3× menos |

### Lo aprendido

- **La numeración por máximo barre la tabla entera con el candado tomado**:
  sin índice era el techo de ventas por segundo de todo el negocio, y bajaba
  con cada pedido (con 6000, 23 por segundo y lotes de la cola de 27 s). La
  00085 indexa la misma expresión: el máximo sale del índice.
- **pgx y el plan genérico**: con la sentencia preparada en caché, después de
  cinco ejecuciones Postgres puede usar un plan genérico, que para un ILIKE
  con el patrón como parámetro no sabe nada. La búsqueda va con
  `QueryExecModeExec`.
- **Un hueco de una lista en JS viaja como null**: el golden de los esquemas
  se arma sobre `JSON.parse(JSON.stringify(entrada))`, que es lo que llega
  por la red. Y `Number([])` es 0: el coerce de zod convierte listas.
- **El candado de una serie se toma antes de leer lo que valida** (entregas):
  si no, numera bien y entrega de más. Con candado, `now()` es la hora del
  BEGIN: va `clock_timestamp()` donde importa el orden.
- **Tres agentes en paralelo en ramas propias** desde la misma base, con los
  nombres de paquete, contrato, migración y claves repartidos de antemano: los
  únicos choques fueron las líneas agregadas de `api.go`, `generar.go` y
  `lib/api/tipos/index.ts` (las uniones del final: cuidado con el `;`).

## Tanda 13: la migración de ISIS (29/10, rama `go-migracion`)

Rama `go-migracion`, desde 56ef2a1 (`go-cuentas`). En
`backend/internal/migracion`, contrato `backend/api/migracion.yaml`.

- [x] La lectura (`leer.go`, `analizar.go`, `informe.go`): las siete
      entidades, el mapeo automático, la normalización de cada fila
      (importes argentinos, fechas día primero, CUIT, correos, opciones), la
      vista previa, el análisis del archivo (con `internal/planilla`) y los
      controles del informe. **Golden** (`scripts/golden/migracion.ts` →
      `testdata/golden/migracion`): 4038 fechas, 3000 mapeos, 2000 archivos
      al azar (24.078 filas), 800 informes y 16 exportaciones de muestra de
      ISIS en `archivos/` (sintéticas: no hay reales en el repo; CSV en
      Windows-1252 y UTF-8 con BOM, con `;`, coma y tabulador, saltos de
      línea entre comillas, .xlsx con textos compartidos y fechas). Go da lo
      mismo exacto.
- [x] La escritura (`escribir.go`): por lotes de 200, cada uno en su
      transacción, fila por fila y con las mismas claves naturales del TS.
      La corrida (`migration_runs`) suma los contadores en la base y guarda
      los rechazos; al cerrar, el informe y la bitácora (`importar`,
      `migracion`). Escribe directo en tablas de otras tandas con la misma
      forma que el TS: `account_movements` (saldos, tanda 4/5),
      `inventory` y su libro (stock), precios con `price_history`,
      `historical_sales`/`historical_invoices` (no tocan la numeración ni
      ARCA, tanda 7).
- [x] **Repetible**: `TestMigracionCompletaYRepetible` corre las diez
      muestras de punta a punta por HTTP (con el contrato) y otra vez: la
      segunda no crea nada y la base queda idéntica.
- [x] Next: el DAL y las cinco acciones del asistente son envoltorios; la
      pantalla recibe las entidades y el lote de la API
      (`GET /api/v1/admin/migracion/entidades`). Se borraron
      `lib/migracion/{entidades,ejecutar}.ts`; `lib/csv.ts`, `lib/xlsx.ts`,
      `lib/planilla.ts` y `lib/precios-csv.ts` ya no los usaba nadie de la
      aplicación y pasaron a `scripts/golden/originales` (golden, vitest y
      el benchmark de la tanda 3). Tipos en `lib/migracion/tipos.ts`.
- [x] E2E escrita (`e2e/migracion.spec.ts`), **sin correr**: llega hasta la
      vista previa y no escribe nada.
- [x] Benchmark (`bench/tanda13`).

Bugs arreglados (cada uno con su prueba que falla sin el arreglo):

- **Un nombre con tildes se duplicaba en cada corrida.** Cliente, producto
  o proveedor sin código ni CUIT: el TS buscaba `lower(nombre)` contra el
  texto ya sin tildes, y «José Pérez» no se encontraba nunca. Ahora los dos
  lados pasan por `comparable`, con un índice de nombres leído una vez por
  lote (sin índice, compararlo en SQL recorría la tabla por fila).
  `TestNombresConTildesNoSeDuplican`.
- **La existencia no tomaba el candado del stock** (el de
  `lib/inventario/reservas.ts`): dos a la vez, o una venta en el medio,
  dejaban el libro de movimientos sin cerrar con el stock.
  `TestStockSimultaneoCierraConElLibro`.
- **Las fechas de un .xlsx salían un día antes** (`fechaDeSerie` restaba un
  día de más): todo el histórico de ventas y comprobantes migrado desde
  Excel, y las fechas de la importación de precios. La prueba de vitest
  usaba 46269 (el 4/9) y así lo tapaba.
- **«0,125» y «0.125» se leían como 125.** Con un cero o nada adelante, son
  decimales.
- Los dos últimos estaban reproducidos a propósito desde la tanda 3: ahora
  que el TS no lee archivos en ningún lado, se arreglaron en Go y en la
  copia de `scripts/golden/originales` (los golden de planilla y migración
  se regeneraron: Go y TS siguen dando lo mismo).

Reproducido a propósito, y pendiente:

- [ ] Una alícuota que no entra en `numeric(4,2)` (un «105» en el archivo)
      deshace el lote entero con «numeric field overflow», y la corrida
      queda interrumpida: habría que validarla en la fila.
- [ ] Los otros bugs del lector de .xlsx de la tanda 3 siguen: la hoja se
      elige por nombre de archivo y no por las relaciones del libro, se
      pierden los espacios de `xml:space="preserve"`, los `&#NN;` quedan
      escritos y con prefijo de espacio de nombres la planilla sale vacía.
- [ ] Dos lotes de saldos a la vez podrían cargar dos veces el saldo de un
      cliente (mirar y escribir, sin candado). La pantalla manda los lotes
      de a uno, como el TS.
- [ ] El histórico de ventas y de comprobantes no tiene pantalla donde
      verse: solo lo escribe la migración.
- [ ] Correr la e2e.

Benchmark (29/10/2026, con la máquina muy cargada por otros agentes: load
average ~100; detalle en `bench/tanda13/README.md`). 72.000 filas en siete
archivos, mismas bases:

| Prueba | TypeScript | Go | Go / TS |
|---|---:|---:|---:|
| Importar todo, 1.ª vez | 665 s | 477 s | 1,4× |
| Repetirlo (actualiza u omite) | 606 s | 550 s | 1,1× (ruido) |
| Clientes, 10.000 filas (las dos pasadas) | 147–150 s | 61–69 s | **2,2–2,4×** |
| Memoria máx. / CPU media | 245 MB / 13 % | 95 MB / 9 % | **2,6× menos** |

Manda Postgres: los dos escriben fila por fila y esperan a la base el 90 %
del tiempo.

Lo aprendido:

- **La plantilla de las pruebas (`mjbj_plantilla`) es compartida entre
  agentes**: una migración nueva que se le aplique (aunque sea `00095`)
  hace fallar con «missing migrations» a las ramas que tengan una más vieja
  sin aplicar. Para el índice por nombre se evitó la migración (se resolvió
  en Go, por lote).
- **Un benchmark de escritura fila por fila mide la base, no el lenguaje**:
  la diferencia está donde el algoritmo cambia (la búsqueda por nombre), no
  en el resto.
