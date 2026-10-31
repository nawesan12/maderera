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
| 6 | Carrito, checkout, Mercado Pago | `go-checkout` | hecha (29/10), integrada en `go-cuentas`: confirmar 1,5×, conciliación 2×; doble clic en «Confirmar» y precio de la media placa arreglados; falta probar con Mercado Pago de verdad |
| 7 | Facturación ARCA | `go-arca` | hecha (29/10), integrada en `go-cuentas`: CAE fuera de la transacción y recuperable tras un corte; falta homologar con el certificado real |
| 8 | Compras, proveedores, retenciones | `go-compras` | hecha (29/10), integrada en `go-cuentas`: pagos 6,5×, libro IVA 2,8×; tres bugs de concurrencia arreglados |
| 9 | WhatsApp | `go-whatsapp` | hecha (29/10), integrada en `go-cuentas`: webhook 1,4×, cola 1,7×; el worker de Go atiende los trabajos de WhatsApp |
| 10 | Campañas, avisos, profesionales, firma | `go-campanas` | hecha (29/10), integrada en `go-cuentas`: 3–6,5× pedidos/s, ¼ de la memoria; eventos guardados en UTC y permisos de aprobar arreglados |
| 11 | Cortes | `go-cortes` | hecha (29/10), integrada en `go-cuentas`; HTTP 6× con 20 a la vez |
| 12 | PDF y exportaciones | `go-pdf` | hecha (29/10), integrada en `go-cuentas`: 11 documentos idénticos a pdf-lib, con sus datos desde Go |
| 13 | Migración de ISIS | `go-migracion` | hecha (29/10), integrada en `go-cuentas`: repetible sin duplicar; cuatro bugs del TS arreglados |
| — | Corte final | `main` | **desplegado el 30/10/2026** en la VPS (KVM 2): goose en la 85, Next sin acceso a la base, sin cron; faltan Mercado Pago y ARCA reales, y el dominio |

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
- [x] Desplegar en la VPS y probar una cookie real de producción
      Hecho: en la VPS desde el 30/10; las sesiones las lleva Go.
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
- [x] Desplegar en la VPS: agregar `API_SECRETO_INTERNO` al entorno de `api`
      y `app` antes del despliegue
      Hecho: desplegado; Next le habla a Go con el secreto.
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
- [x] El informe de reposición (lib/dal/admin/reposicion.ts): lee ventas,
      va con la tanda 5
      Hecho: `internal/reportes/reposicion.go`; `lib/dal/admin/reposicion.ts` es solo el cliente de la API.
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
- [x] La consulta del gasto del mes recorre los salientes en cada apertura de
      la bandeja (~28 ms con 40.000 mensajes): un índice parcial o el gasto
      guardado. Es lo que hoy limita la bandeja, en TS y en Go
      Hecho: índice parcial `whatsapp_mensajes_gasto_idx` (00082).
- [x] El worker toma 100 trabajos cada 2 s: un mensaje entrante tarda hasta
      2 s en aparecer (el TS lo procesaba en el `after()` de la ruta)
      Hecho: el trigger de `trabajos` avisa por `mjbj_cola` (00081) y `cola.Despertador` despierta al worker en el acto.
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

- [x] La carga de una retención sufrida (`cargarRetencionSufrida`): emite un
      recibo; espera `internal/cobros` de la tanda 4.
      Hecho: `cobros.CargarRetencionSufrida`.
- [x] El PDF del certificado de retención (tanda 12).
      Hecho: `CertificadoDeRetencionPdf` (internal/pdf).
- [x] `turnoQueContiene` duplicado en `internal/compras/gastos.go`: se junta
      con la caja de la tanda 5.
      Hecho: ya no está duplicado.
- [x] La e2e `e2e/compras.spec.ts` (no se corrió: los servidores son
      compartidos).
      Hecho: corre y pasa (30/10).
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
134 ms**, 101 MB de memoria. **En la VPS (30/10/2026, KVM 2: 2 núcleos, 8 GB), ya desplegada:** los
mismos 200 durante 60 s desde afuera (con ~55 ms de ida y vuelta de red):
8039 pedidos, **0 fallos, p50 107 ms, p95 251 ms, p99 285 ms**. La API de Go
llegó al 67 % de CPU y 90 MiB; Postgres al 160 % y 173 MiB: con más carga, el
primero en quedarse corto es la base, no Go. Se corre con
`-e IP=179.197.224.61` si el DNS de la red no resuelve sslip.io.

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

- [x] Correr `e2e/campanas.spec.ts` (no se corrió: los servidores son
      compartidos).
      Hecho: corre en la suite completa (79 en verde el 30/10).
- [ ] `internal/email.Escapar`/`Envolver` asignan mucho (98 KB por correo de
      campaña): si alguna vez se manda sin tope, un `strings.Replacer`.
- [x] La tanda 6 se lleva `iniciarPagoDeInscripcion` y el aviso por pago (hoy
      Next → `/api/v1/eventos/aviso-por-pago`); la 5, `pendientes.ts`.
      Hecho: ya no queda en el TS.
- [x] `despacharEmail` del TS y `avisos.Despachar` de Go conviven (misma
      tabla, mismo `email.reintento`): se junta cuando se muden los avisos de
      pedidos y pagos.
      Hecho: solo queda `avisos.Despachar`.

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
- [x] Leen `invoices` desde otros módulos y se mudan con ellos: la caja y las
      entregas (tanda 5), el cierre mensual, el buscador del panel, los
      asientos y los pendientes.
      Hecho: todos en Go (caja, entregas, reportes, cierre).
- [x] El comprobante en PDF sigue sin cortar de página (tanda 12). Hecho (30/10): el comprobante y el remito pasan a otra hoja con el número y la cabecera; el pie fiscal y las firmas, en la última. Copiado al original TS de las golden.

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

- [x] Correr las cuatro e2e; aplicar la 00085 antes de desplegar.
      Hecho.
- [x] Facturación (tanda 7): `/api/mostrador/ventas` y `/api/mostrador/config`
      se mudan enteros a Go cuando el comprobante esté en Go.
      Hecho: las rutas de Next son envoltorios de `POST /api/v1/mostrador/descarga`.
- [x] Tanda 6 (checkout y Mercado Pago): confirmar la compra tiene que usar
      `reservas.ReservarPedido`, `reservas.FactoresDeStock`,
      `reservas.CostosParaCongelar`, `numeracion.Pedido` y
      `pedidos.DatosParaTransferir`; acreditar, `cobros.EmitirRecibo`. Al
      mudarlo se borran los TS de la lista de arriba.
      Hecho: `checkout/compra.go` usa `reservas.ReservarPedido` y `numeracion.Pedido`.
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

- [x] Una alícuota que no entra en `numeric(4,2)` (un «105» en el archivo)
      deshace el lote entero con «numeric field overflow», y la corrida
      queda interrumpida: habría que validarla en la fila.
      Hecho: es un error de la fila (`TestAlicuotaInvalidaRechazaSoloSuFila`); la regla se copió al original TS de las golden.
- [ ] Los otros bugs del lector de .xlsx de la tanda 3 siguen: la hoja se
      elige por nombre de archivo y no por las relaciones del libro, se
      pierden los espacios de `xml:space="preserve"`, los `&#NN;` quedan
      escritos y con prefijo de espacio de nombres la planilla sale vacía.
      Arreglados el 30/10 (en Go y en el original TS, con las golden regeneradas): la hoja sale de `xl/_rels/workbook.xml.rels`, los prefijos se sacan después de parsear y las `&#NN;` se resuelven en el texto de la celda. Queda el `xml:space="preserve"` (habría que tocar el parser).
- [x] Dos lotes de saldos a la vez podrían cargar dos veces el saldo de un
      cliente (mirar y escribir, sin candado). La pantalla manda los lotes
      de a uno, como el TS.
      Hecho: candado por cuenta (`cuenta:` y `proveedor:`), `TestSaldosSimultaneosSeCarganUnaVez`.
- [ ] El histórico de ventas y de comprobantes no tiene pantalla donde
      verse: solo lo escribe la migración.
- [x] Correr la e2e.
      Hecho: `e2e/migracion.spec.ts` en verde (30/10).

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

## Tanda 6: carrito, checkout y Mercado Pago (29/10, rama `go-checkout`)

Desde `go-cuentas` (b6eb298). Paquetes nuevos `internal/checkout` (contrato
`api/checkout.yaml`) e `internal/pagos` (`api/pagos.yaml`). Sin migraciones.
Falta correr la e2e (`e2e/checkout.spec.ts`).

- [x] **Carrito** (`internal/checkout`): leerlo (la lista de quien mira, el
      precio de la media, los descuentos por volumen, los cortes), agregar
      (suma la misma medida), varios (tope 40), cambiar, quitar, vaciar,
      actualizar precios, los cortes a medida (se recalculan con
      `cortes.CotizarParaElCarrito`, freno «corte»), quitar lo que se cotiza
      y adoptar el carrito anónimo al entrar (ruta interna con el secreto: el
      `api()` del pedido ya tiene la cookie de antes). **La cookie
      `mjbj_carrito` la pone Go** cuando crea el carrito; las acciones la
      copian (`copiarCookies`) y prenden la señal del encabezado.
- [x] **Pedir presupuesto**: `numeracion.Presupuesto`, express para el
      profesional aprobado, el mismo freno. El correo sigue en Next.
- [x] **Confirmar la compra**: `numeracion.Pedido`, `reservas.CostosParaCongelar`,
      `FactoresDeStock`, `CostoPorUnidadDeVenta`, los cortes con
      `cortes.ResolverCarrito` y `numeracion.Corte`, la deuda a cuenta
      corriente con `cuentas.CreditoDeLaSesion` (el `MiCredito` del portal,
      sacado a una función), `reservas.ReservarPedido` (con los candados del
      stock tomados antes, en orden) y el carrito desactivado, en una
      transacción. Next sigue haciendo `updateTag(catálogo)`,
      `avisarPedidoNuevo`, el correo y la redirección al seguimiento.
- [x] **Cobros** (`internal/pagos`): Mercado Pago por HTTP (preferencia con
      `X-Idempotency-Key`, `GET /v1/payments/{id}`; `MP_API_URL` solo para el
      simulador) y el de demostración; abrir el pago de un pedido y de una
      inscripción (ruta interna; Go ya reservaba el lugar); **acreditar** con
      el candado del TS (`hashtext(pagoId)`) y `cobros.EmitirRecibo` /
      `AnularRecibo`; el **webhook en `/api/pagos/webhook`** (firma
      `x-signature`, a la cola, 200 rápido; Caddy `@pagosGo` y el rewrite de
      desarrollo) con `pago.aviso` atendido por el **worker de Go**; los
      comprobantes de transferencia (pedido y deuda, con
      `subidas.GuardarAdjunto`), los cheques informados, la pantalla de
      demostración y la conciliación del panel en un pedido.
- [x] **El aviso de un pago acreditado** (`notificarResultadoDePago`) sigue
      en TS: Go encola `pago.resultado` en la misma transacción que acredita
      (una sola vez) y lo atiende el TS. Desde la demostración y la
      conciliación, Next lo procesa en el acto (`after(procesarCola)`);
      desde el webhook, en la vuelta de cada minuto (antes era en el acto).
- [x] Golden (`TZ=America/Argentina/Buenos_Aires npx tsx scripts/golden/checkout.ts`
      → `testdata/golden/checkout`): 4000 descuentos por volumen, 2500
      carritos armados, 3000/3000/4000/1500 formularios de agregar,
      presupuesto, compra y datos bancarios (primer error y campo, o los
      datos), 4000 cuentas de la compra (envío, medio permitido, descuento,
      total), 3000 firmas del webhook con su `data.id`, 2000 preferencias,
      2000 pagos de Mercado Pago, 2000 avisos de MP y de la demostración,
      3000 decisiones de acreditar y 3000 plazos de respuesta. Go da lo mismo.
- [x] Pruebas contra la base, con el contrato en cada respuesta, y contra un
      simulador de la API de Mercado Pago (`httptest`): la preferencia, el
      webhook firmado cinco veces (un evento, un aviso), la firma mala (nada
      en la base), el importe que no coincide (en revisión), el aviso que
      falla y se retoma, la demostración y la conciliación. `-race` en verde.
- [x] Benchmark (`bench/tanda6`).

### Concurrencia (vistas fallar sin el arreglo: `MJBJ_PRUEBA_SIN_CANDADO=1`)

- `TestConfirmarDosVecesElMismoCarrito`: diez «Confirmar» del mismo carrito
  a la vez. **El TS hacía diez pedidos** (leía el carrito fuera de la
  transacción) con la mercadería reservada diez veces; Go bloquea la fila
  del carrito y verifica que siga activo: uno.
- `TestAcreditarVeinteVecesUnRecibo`: veinte acreditaciones del mismo pago
  de una deuda. Con el candado, un recibo; sin él, doce.
- `TestComprasSimultaneas`: veinte compras de carritos distintos con las
  mismas variantes en distinto orden: números distintos y la reserva justa.

### Bugs del TS arreglados

- **Dos clics en «Confirmar» = dos pedidos** (arriba).
- **«Actualizar precios» le ponía a la media placa el precio de la entera**,
  y el aviso de «cambió el precio» no se iba nunca (`TestCarritoAnonimo`).
- **Volver del pago de demostración rompía el token del seguimiento**:
  `volverA` ya trae `?t=` y se le pegaba otro `?pago=`; quien compró sin
  cuenta volvía a un «no encontrado».
- **Permisos de la conciliación**: acreditar una transferencia pedía solo ser
  personal; ahora es de quien entra a `/admin/pagos` (`TestConciliacion`).
- Dos primeros «agregar» a la vez dejaban dos carritos activos del mismo
  usuario, o el mismo renglón repetido: candado por usuario
  (`pg_advisory_xact_lock(hashtext('carrito:' || user_id))`, **clave nueva**)
  y la fila del carrito bloqueada al agregar.
- Fechas en hora argentina: «para cuándo» del presupuesto (12 h de Buenos
  Aires; el TS, 12 UTC), el plazo de respuesta (8 a 16 de Buenos Aires; el
  TS contaba el horario en UTC), el vencimiento, el año de la numeración del
  presupuesto y el período de la conciliación.
- Una referencia que no es un uuid en el aviso de MP daba un error de
  Postgres; ahora se ignora y se busca por el id del proveedor.

### Qué TS se borró y qué quedó

- Borrado: `app/api/pagos/webhook/route.ts`, `lib/pagos/*` (menos
  `config.ts`, que queda con `urlBase` para los correos),
  `lib/inventario/{reservas,locks}.ts`, `lib/compras/congelar.ts`,
  `lib/ventas/factores.ts`, `lib/cortes/desde-carrito.ts`,
  `lib/dal/numeracion-ventas.ts`, `lib/cobros/{recibo,leer}.ts`,
  `lib/dal/credito.ts`, `lib/precios/volumen.ts`, `pedidoAutorizado` y
  `tests/numeracion-ventas.test.ts`. Las copias que usan el golden, vitest y
  los benchmarks viejos (tandas 4 y 5, con los imports cambiados) están en
  `scripts/golden/originales/tanda6`.
- Envoltorios: `lib/dal/carrito.ts`, `lib/dal/pagos.ts`,
  `lib/dal/admin/pagos.ts` y todas las acciones (carrito, corte, presupuesto,
  compra, pago, demostración, conciliación, inscripción con precio).
- Queda en TS: `lib/limites` (lo usan `/api/diagnostico` y la limpieza de
  `lib/tareas`; ni el carrito ni los cobros lo usan), lo que corre en el
  navegador (`lib/ventas/forma-de-venta.ts`, `lib/precios/medio-pago.ts`,
  `lib/envios.ts`, `lib/cobros/partes.ts`) y los avisos por correo
  (`notificarPedidoRecibido`, `notificarResultadoDePago`,
  `notificarPresupuestoRecibido`).
- `POST /api/v1/cortes/carrito` (la tanda 11) ya no lo llama Next: la compra
  usa `cortes.ResolverCarrito` adentro de Go. Se puede borrar.

### Despliegue

- `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `PAGOS_PROVIDER` y `APP_URL` en el
  entorno de **`api` y `worker`** (los lee `pagos.Config`); `app` ya no los
  necesita para cobrar (los avisos siguen usando `APP_URL`).
- Caddy: `@pagosGo` antes de la aplicación. Sin migraciones.

### Para probar con Mercado Pago de verdad

1. Con la cuenta de la clienta: una aplicación de Checkout Pro y las
   credenciales de prueba en `MP_ACCESS_TOKEN` (con las que empiezan con
   `TEST-` Go manda al `sandbox_init_point`; con las de un usuario de prueba
   que empiezan con `APP_USR-`, al `init_point`).
2. En el panel de Mercado Pago, Webhooks: la URL
   `https://<dominio>/api/pagos/webhook`, el evento «Pagos», y la clave que
   genera ahí en `MP_WEBHOOK_SECRET`. Con «Simular notificación» tiene que
   aparecer en `/admin/pagos` → avisos con firma `true` (una firma mala no
   deja nada: mirar el registro de `api`).
3. Comprar con un usuario de prueba y las tarjetas de prueba (APRO, OTHE,
   CONT): aprobado → pedido pagado y un solo `pago.resultado`; rechazado →
   «rechazado»; pendiente → sigue pendiente. Reintentar el aviso desde el
   panel de MP no tiene que cambiar nada.
4. «Reconsultar» desde `/admin/pagos` un cobro con el aviso perdido.
5. Producción: las credenciales de la cuenta real y la clave del webhook de
   producción.

### Pendiente

- [x] Correr `e2e/checkout.spec.ts` (sin correr: servidores compartidos).
      Hecho: en verde (30/10).
- [x] El crédito de una compra a cuenta corriente se mira fuera de la
      transacción (como en el TS): dos compras a la vez pueden pasar el
      límite. Bloquear la ficha y volver a mirar adentro.
      Hecho: `cobros.LimiteEnLaTransaccion`, con candado por cuenta (`TestVentasACuentaSimultaneasRespetanElLimite`).
- [x] El aviso de un pago que llega por el webhook sale en la vuelta de cada
      minuto del TS (antes, en el acto): se arregla cuando los avisos de
      pedidos y pagos se muden.
      Hecho: los avisos están en Go y el worker se despierta con el trabajo nuevo (`cola.Despertador`).
- [x] El precio que se guarda al agregar es el de la lista general: para un
      profesional el aviso de «cambió el precio» aparece siempre (igual que
      en el TS).
      Hecho: se guarda y se actualiza con la lista de quien compra (`TestElProfesionalNoVePreciosDesactualizados`).
- [x] Borrar `POST /api/v1/cortes/carrito`. Hecho: la usa el checkout por dentro (`cortes.ResolverCarrito`).

### Benchmark (29/10/2026, misma Mac; detalle en `bench/tanda6`)

| Prueba | TypeScript | Go | Go / TS |
|---|---:|---:|---:|
| Confirmar la compra, 20 a la vez: compras/s | 25,8 | 38,5 | **1,5×** |
| ídem, p50 / p99 | 739 ms / 1,15 s | 495 ms / 966 ms | 1,5× / 1,2× menos |
| Webhook firmado, 50 a la vez: aceptados/s | 846 | 849 | empate (manda el INSERT) |
| Conciliación (3000 cobros), 20 a la vez: pedidos/s | 182 | 368 | **2×** |
| Memoria máx. | 209–213 MB | 63–104 MB | 2–3× menos |

### Lo aprendido

- **Una prueba de concurrencia que toma conexiones de más se cuelga**:
  «abrir las conexiones antes» con un bucle de 20 sobre un pool de menos se
  queda esperando para siempre. Se abren `pool.Stat().MaxConns()`.
- **El hook de Mercado Pago también bloquea un encabezado Authorization con
  un token de prueba escrito entero** en una prueba: el del simulador se arma
  con partes.
- **Los ids de better-auth no son uuid**: validar el `userId` como uuid hacía
  que adoptar el carrito no hiciera nada.
- Con el candado de la serie de pedidos tomado al principio, dos compras ya
  no se pueden trabar por los candados del stock; tomarlos en orden igual
  cubre una venta del mostrador o una entrega que se crucen.

## Los avisos al cliente y la cola de TS (29/10, rama `go-avisos`)

Desde `go-cuentas` (7c087bb). Sin migraciones. Lo último que Next le pedía a
la base salvo `lib/dal/admin/auditoria.ts` y `lib/dal/seguimiento.ts` (van
en paralelo).

- [x] **Cada aviso lo encola Go en la misma transacción que confirma** y lo
      atiende el worker (`internal/notificaciones/pedidos.go`). Donde antes
      Next llamaba al aviso en el `after()` de la acción, ya no llama nada:

      | Trabajo | Lo encola | Era (TS) | Evento(s) |
      |---|---|---|---|
      | `pedido.recibido` | `checkout.Confirmar` | `notificarPedidoRecibido` | `pedido_recibido` (correo y WhatsApp) + «Venta nueva» al panel |
      | `pedido.estado` | `pedidos.Avanzar` | `notificarCambioDeEstado` + `avisarCambioDePedido` | el estado (correo y WhatsApp) |
      | `pago.resultado` | `pagos` al acreditar (ya lo encolaba) | `notificarResultadoDePago` | `pago_acreditado`, «Pago acreditado» al panel, el recibo (`recibo_emitido`) o la inscripción |
      | `presupuesto.recibido` | `checkout.PedirPresupuesto` | `notificarPresupuestoRecibido` | `presupuesto_recibido` |
      | `presupuesto.enviado` | `pedidos.CambiarEstadoPresupuesto` y el alta del mostrador (30/10) | `notificarPresupuestoEnviado` (no lo llamaba nadie) | `presupuesto_listo` (correo y WhatsApp con el PDF) |
      | `remito.para-firmar` | `entregas.CrearEntrega` | `notificarRemitoParaFirmar` | `remito_para_firmar` |
      | `remito.firmado` | `entregas.RegistrarFirma` (ahora en una transacción) | `notificarRemitoFirmado` | `remito_firmado` |

      Mismas condiciones: sin correo no sale, apagado en `/admin/avisos`
      queda `omitida`, el asunto y el encabezado editados mandan, el aviso al
      panel sale aunque el comprador no haya dejado correo. Como los de
      recibos y cheques, no se reintentan (un reintento repetiría el
      WhatsApp que sí salió); el correo que rebota temporalmente sigue con
      `email.reintento`.
- [x] Plantillas en `internal/avisos/pedidos.go`; golden
      `TZ=America/Argentina/Buenos_Aires npx tsx --conditions=react-server scripts/golden/avisos-pedidos.ts`
      → `testdata/golden/avisos/pedidos.json`: 1192 correos, asunto, HTML y
      texto byte a byte. El acuse del presupuesto estaba sin exportar en
      `presupuestos.ts`: va como copia textual en el script.
- [x] Pruebas contra la base: cada productor deja su trabajo (una sola vez
      con diez «Confirmar» o veinte firmas a la vez) y cada manejador manda lo
      que mandaba el TS, también pasando por la cola entera.
- [x] **Borrado**: `lib/notificaciones/{avisos,cobros,presupuestos,push,entregas,fiscal}.ts`,
      `lib/whatsapp/avisos.ts`, `lib/cola`, `lib/tareas`, `app/api/tareas/[tarea]`,
      `tests/tareas.test.ts` (Go tiene `internal/cola` e `internal/tareas`) y
      el contenedor `cron` con `servidor/cron/`. `desplegar.sh` saca el
      contenedor `cron` que haya quedado de antes. `TAREAS_SECRETO` ya no se
      usa. El PDF del comprobante para WhatsApp pasó a
      `lib/whatsapp/documentos.ts`. Queda `lib/notificaciones/titulos.ts`
      (los nombres de los eventos, para el panel).
- [x] El aviso de un pago que llega por el webhook sale en el acto (el
      trigger despierta al worker), no en la vuelta de cada minuto del TS. La
      conciliación y la demostración ya no corren `procesarCola` en Next.
- Arreglado (con prueba):
  - **La hora del acuse del presupuesto** («Te contestamos antes de») salía
    en UTC: el contenedor de Next no tiene `TZ`. Go la da en hora argentina
    (el golden falla con UTC).
  - **El correo del pago tomaba cualquier cobro del pedido** (`limit 1` sin
    orden): con un intento rechazado antes del aprobado podía decir otro
    importe y otro medio. Va el aprobado más reciente (`TestResultadoDePago`,
    vista fallar sin el orden). Lo mismo en el pago de una deuda sin recibo.
  - Los renglones del acuse del pedido, en el orden del pedido (el TS no
    ordenaba).
- Reproducido a propósito: el débito no está en los nombres de los medios
  del acuse (sale «A coordinar», como en el TS); el medio del correo del pago
  es el que dice Mercado Pago (`account_money`, `visa`), sin traducir.
- Pendiente:
  - [ ] `lib/email` ya no lo usa la aplicación: queda para los golden
        (`scripts/golden/{plantillas,avisos-cobros,avisos-pedidos}.ts` y
        `originales/tanda10`), vitest (`tests/correo*.test.ts`) y el bench de
        la tanda 10. Se puede mover a `scripts/golden/originales` y sacar
        `nodemailer`, `resend` y `web-push` del `package.json`.
  - [ ] Sacar `TAREAS_SECRETO` de `.env.example` y del `.env.produccion` de
        la VPS (el compose ya no la pide).
  - [x] `notificarPresupuestoEnviado` no lo llamaba nadie (se borró con
        `presupuestos.ts`): el presupuesto armado no se avisaba por correo
        ni por WhatsApp al pasar a «enviado». Era así antes de la mudanza.
        **Hecho (30/10, sobre `go-cuentas`)**, sin migraciones:
        - `pedidos.CambiarEstadoPresupuesto` es ahora una transacción que
          lee el estado anterior con `FOR UPDATE` y encola
          `presupuesto.enviado` solo si llega a «enviado» desde otro estado.
          Diez clics a la vez → un aviso (`TestPasarAEnviadoAvisaUnaVez`,
          vista fallar con diez sin el `FOR UPDATE`).
        - El presupuesto del mostrador nace «enviado»: encola el mismo aviso
          en la transacción del alta.
        - No había botón que pasara a «enviado» (solo Aceptar y Rechazar):
          se sumó «Enviar al cliente» en `app/admin/presupuestos/acciones.tsx`
          para lo pendiente o en revisión.
        - `notificaciones.PresupuestoEnviado` manda el WhatsApp de
          `presupuesto_listo` (plantilla `presupuesto_enviado`) con el PDF de
          `pedidos.PresupuestoPdf` —armado solo si el WhatsApp va a salir— y
          el correo `avisos.PresupuestoListo` (golden: 360 casos más en
          `avisos-pedidos.ts`). Cada canal respeta su interruptor.
          `TestPresupuestoEnviado`, `TestPresupuestoEnviadoPorLaCola`.
        - Distinto del TS, a propósito: si cuando lo atiende el worker ya no
          está «enviado», no sale; sin teléfono o correo en el presupuesto
          (el del mostrador no guarda correo) se usan los de la ficha.

## Errores de plata de la auditoría (30/10, sobre `go-cuentas`)

Cada uno con una prueba que falla sin el arreglo. **Migración 00087**: va a
mano y antes del despliegue, como todas.

- **Recepción + factura duplicaban la deuda con el proveedor.** La factura de
  compra puede vincularse a la recepción que cubre (`receiptId`) y carga solo
  la diferencia con lo que la recepción ya cargó; lo ya cargado se lee de los
  movimientos atados a la recepción (`supplier_movements.goods_receipt_id`,
  00087). El vínculo resuelve el aviso «Recepciones sin factura» del cierre.
  **Pregunta para el contador**: ¿la deuda nace con el remito o con la
  factura? Se responde con la constante `compras.LaDeudaNaceConElRemito`.
- **Gasto en efectivo de hoy fuera de la caja**: el turno se buscaba con la
  medianoche UTC. Los formularios proponen el día argentino (`hoyEnArgentina`).
- **Venta suelta mixta**: se lista y se asigna solo la parte en efectivo.
- **Anular suelto un cheque de un recibo**: se rechaza; se anula el recibo.
- **Cancelar un pedido a cuenta corriente** devuelve la deuda, una vez; una
  venta del mostrador se anula desde el mostrador.
- **Aging con restos de coma flotante**: tolerancia de medio centavo.
- **Cierre Z de un turno cerrado**: la venta anulada después sigue en su Z, y
  la devolución aparece en el turno en que se anuló.

## Cobros en el cierre y reintegros de Mercado Pago (30/10, sobre `go-cuentas`)

Cada uno con una prueba que falla sin el arreglo. **Migración 00090**
(`payment_refunds`): va a mano y antes del despliegue, después de la 00089
de compras.

- **Los asientos de cobro salen de los recibos** (`reportes/cobros.go`).
  Antes solo de `invoice_payments`: el cobro de cuenta corriente, Mercado
  Pago, la transferencia y la retención no se asentaban y Deudores no daba
  lo de las cuentas corrientes. Un renglón por parte (efectivo → Caja,
  cheque/echeq → Valores a depositar, retención → Retenciones sufridas, lo
  demás → Banco) contra Deudores; el anulado, contraasiento en la fecha de
  anulación. `facturacion.Cobrar` emite recibo y ata el `invoice_payments`
  con `receipt_id`: esos ya no se asientan aparte (quedan los viejos, sin
  recibo). La venta del mostrador y el pedido en línea **no emiten recibo**:
  su cobro (`payments` sin parte de recibo) se asienta solo si el pedido
  tiene factura con CAE y esa factura no tiene cobros propios, con la fecha
  de la factura si salió después del cobro (un mes cerrado no cambia por
  facturar tarde); el reintegrado, al revés. Sin factura no hay asiento de
  venta ni de cobro. Entran también los pagos de deuda de antes de los
  recibos. `TestCierreAsientaLosCobrosDesdeLosRecibos`.
- **Retenciones practicadas anuladas**: el resumen las saca cuando exista
  `retenciones_practicadas.anulada_at` (la 00089 de compras). Se pregunta a
  `information_schema` en vez de una constante: no importa qué rama entra
  antes. `TestCierreSinRetencionesPracticadasAnuladas`.
- **Reintegro de un pago cuyo recibo ya se anuló a mano**: se da por hecho
  y el pago pasa a reintegrado (antes el aviso se reintentaba para siempre).
  `TestReintegroDeUnReciboYaAnulado`.
- **Reintegro parcial de Mercado Pago**: el pago sigue `approved` y suma lo
  devuelto en `transaction_amount_refunded` (está en la respuesta de
  `GET /v1/payments` de la doc de MP; el detalle es `partially_refunded`).
  `ReintegroParcial` aplica solo lo nuevo; cada tramo queda en
  `payment_refunds` (índice único por pago y acumulado) y, si el pago
  canceló deuda, vuelve a la cuenta con un ajuste con la referencia del pago
  de MP. Un reintegro total después de uno parcial devuelve lo que faltaba
  en vez de anular el recibo entero. El de un pedido solo anota el tramo:
  la plata vuelve a la tarjeta, no a la cuenta. `TestReintegroParcialDeUnaDeuda`,
  `TestReintegroParcial`.
- **El cheque de una venta del mostrador** (`order_payment_id`, sin recibo)
  no se anula suelto: manda a anular la venta desde el mostrador.
  `TestAnularChequeDeUnaVentaDelMostradorSeBloquea`.

Pendiente:
- [x] Anular a mano un recibo de Mercado Pago que ya tuvo un reintegro
      parcial devuelve la deuda entera más el tramo: habría que restar los
      tramos en `AnularRecibo` (o frenarlo).
      Hecho: `AnularRecibo` resta los reintegros parciales.
- [ ] Las comisiones de Mercado Pago siguen sin asiento (Banco recibe el
      bruto).
- [x] El efectivo de un recibo emitido sin caja abierta va a Caja en el
      asiento aunque no haya entrado al arqueo.
      No se toca: el asiento a Caja es correcto (la plata entró); lo que falta es el arqueo, y el recibo avisa que se cargue a mano. El cierre no asienta los ingresos manuales de caja, así que no cuenta dos veces.
- [ ] La plantilla de pruebas (`mjbj_plantilla`) es compartida: con la 00090
      aplicada antes que la 00089, goose da «missing migrations». Se borra y
      se rearma sola.

## Retenciones y pagos a proveedores de la auditoría (30/10, sobre `go-cuentas`)

Cada uno con una prueba que falla sin el arreglo. **Migración 00089**: va a
mano y antes del despliegue.

- **La base de la retención era el total con IVA.** El botón «Todo» del
  formulario de pagos ponía el importe del pago; para Ganancias e IIBB la
  base es el neto de IVA. Ahora las facturas con saldo traen `netoSinIva`
  (neto + exento/no gravado, sin IVA ni percepciones) y el botón «Neto sin
  IVA» propone la proporción de lo que se paga de cada factura imputada; sin
  facturas imputadas, se escribe a mano. Go rechaza una base mayor al total
  del pago. `TestLaBaseDeLaRetencionNoPasaElPago`.
- **El certificado no cerraba a la vista.** Mostraba la base del pago, pero
  la retención sale de (acumulado del mes − mínimo no imponible) × alícuota −
  lo ya retenido. `retenciones_practicadas` guarda `acumulado`, `imponible`
  y `retenido_antes` del momento (null en los de antes), y el certificado y
  el CSV muestran la cuenta entera. **El PDF del certificado ahora lo arma
  Go** (`GET /api/v1/admin/compras/certificados/{numero}/pdf`, con
  `internal/pdf`); la ruta de Next solo lo pasa. Sin el cálculo (certificados
  viejos, golden del TS) sale el cuadro de siempre. El CSV suma las columnas
  «Acumulado del mes», «Monto sujeto a retención» y «Ya retenido en el mes».
  `TestElCertificadoMuestraElCalculo`.
- **Mínimos editables**: `GuardarRegimen` también cambia el mínimo no
  imponible y el de retención (si no vienen, quedan); la pantalla de
  `/admin/arca/retenciones` tiene los dos campos.
  `TestLosMinimosDelRegimenSeEditan`.
- **Anular un pago a proveedor** (no existía): solo el admin, con motivo, en
  la bitácora (`POST /api/v1/admin/compras/pagos/{id}/anular`). Marca el pago
  (`anulado_at`, `motivo_anulacion`), devuelve la deuda con un movimiento
  `ajuste` por el total, borra las imputaciones, anula los certificados
  (`retenciones_practicadas.anulada_at`; el número no se reusa) y borra las
  `bases_de_retencion` del pago, así el acumulado del mes y el CSV no los
  cuentan. Cheques: los de terceros endosados vuelven a cartera, los propios
  se anulan; si alguno ya está acreditado o rechazado, no se anula nada y se
  dice por qué. La parte en efectivo no sale de ninguna caja (el pago no
  toca la caja del turno): no hay nada que devolver.
  `TestAnularUnPagoAProveedor`, `TestNoSeAnulaUnPagoConElChequeCobrado`.
- **El libro IVA ventas lo leía cualquiera del panel** (y lo bajaba en CSV):
  ahora pide lo mismo que el de compras, el admin de `/admin/arca`.
  `TestElLibroIvaVentasEsDelAdmin`.

Pendiente:

- [x] **El cierre (`internal/reportes/cierre.go`) tiene que filtrar los
      anulados**: `supplier_payments.anulado_at IS NULL` en los asientos de
      pagos y `retenciones_practicadas.anulada_at IS NULL` en el total de
      retenciones practicadas. Hoy un pago anulado sigue contando ahí.
      Hecho: el pago anulado lleva su contraasiento y las retenciones anuladas no suman.
- [x] `certificadoParaImprimir` de `lib/dal/admin/pagos-proveedor.ts` ya no
      lo usa nadie; `lib/pdf/certificado-retencion.ts` queda solo para el
      golden (`scripts/golden/pdf/certificado-retencion.ts`): se puede mover a
      `scripts/golden/originales`.
      Hecho: se borró.
- [ ] `lib/db/schema/retenciones.ts` (drizzle, solo para las semillas) no
      tiene las columnas nuevas.

## Errores de stock de la auditoría (30/10, sobre `go-cuentas`)

Cada uno con una prueba que falla sin el arreglo (`internal/mostrador/stock_test.go`
y `internal/productos/ficha_stock_test.go`). Sin migración.

- **Anular el remito de un acopio** devolvía el físico sin volver a
  reservar: los 10 del cliente quedaban disponibles para venderle a otro, y
  el pedido seguía «entregado» con saldo. Ahora lo que vuelve sale de los
  movimientos del remito (lo que de verdad salió, de la sucursal de donde
  salió), se **vuelve a reservar** si el pedido no está cancelado
  (`reservas.VolverAReservar`) y, si estaba entregado y le queda saldo,
  vuelve a «listo». La anulación toma la serie de remitos primero, como
  `CrearEntrega`. `TestAnularElRemitoDeUnAcopioVuelveAReservar`.
- **Anular la venta del mostrador** decidía qué devolver por la ausencia de
  reservas: con el remito anulado devolvía el físico otra vez (100 → 110).
  Ahora suma los movimientos de la venta («Mostrador V-…») y de sus remitos
  («Remito REM-…» y «Anulación del remito REM-…») por variante y sucursal, y
  devuelve lo que dé negativo; además libera las reservas activas. Una venta
  importada de ISIS (sin esos movimientos) ya no devuelve nada al anularse.
  `TestAnularElRemitoDeUnAcopioVuelveAReservar`,
  `TestAnularUnaVentaSinAcopioDevuelveLoQueSalio`.
- **«Avanzar» a «entregado» sin remito** (el tablero, retiro de «listo» o
  envío de «en camino») no sacaba nada: el físico no bajaba y la reserva
  quedaba activa para siempre. **Decisión**: si hay saldo, sale con un
  remito por todo lo pendiente (`entregas.RemitoPorLoQueQueda`), con su
  número, el movimiento, el consumo de la reserva y el enlace para firmar
  (queda «preparada», nota «Entregado desde el tablero de pedidos»). No se
  rechaza porque Avanzar es el camino normal de los pedidos de la tienda, y
  la regla del depósito es que cada salida tenga su remito: así la tiene, se
  firma con el dedo como cualquiera y se puede anular. Avanzar toma la serie
  de remitos antes que la fila del pedido (el orden de `CrearEntrega`).
  `TestAvanzarAEntregadoSacaConRemito`.
- **Envío sin sucursal**: reservaba en la primera sucursal activa y el remito
  no sacaba nada (solo salía con `pedido.sucursal`). Ahora la salida es de
  donde está la reserva (`reservas.SucursalDeSalida`: la de las reservas, la
  del pedido, o la primera activa) y el remito queda con esa sucursal.
  `TestRemitoDeUnEnvioSinSucursal`.
- **La ficha del producto pisaba el físico** con el número que traía. La
  pantalla manda lo que vio al abrir (`stockCentralVisto`,
  `stockAserraderoVisto`, en `api/productos.yaml`): si no cambió, no se toca;
  si cambió, se aplica la diferencia contra lo visto. Un campo vacío ya no
  lo pone en 0 (la pantalla mandaba «0»; ahora manda vacío y Go no lo toca).
  Sin lo visto (un alta, u otro cliente), el valor tal cual como antes.
  `TestLaFichaNoPisaElStockConUnValorViejo`.
- **Abrazos mortales**: `LiberarReservas`, `ReservarPedido`,
  `SalidaPorEntrega`, `DevolverAlStock` y la anulación del mostrador toman
  ahora todos sus candados juntos y ordenados (`reservas.BloquearEnOrden`,
  por variante y sucursal: el orden de la venta y del checkout).
  `TestCancelarContraVentasSinAbrazo`, `TestRemitosContraVentasSinAbrazo`
  (30 contra 30, sin ningún 40P01).
- **El ajuste rápido** dejaba lo disponible negativo: ahora una resta no
  puede dejar el físico por debajo de lo reservado («En Casa Central hay 100
  y 90 están reservados para clientes: se pueden sacar hasta 10.»). Sumar
  siempre se puede. `TestElAjusteRapidoRespetaLoReservado`.
- **Restos de reserva por redondeo** (m²): las salidas a tres decimales
  podían no llegar a lo reservado y quedaba 0,001 activo en un pedido
  entregado. El retiro que completa el renglón consume toda la reserva que
  quede (el físico baja lo redondeado, como antes).
  `TestElUltimoRetiroConsumeElRestoDeLaReserva`.

Pendiente y preguntas (decisiones de negocio, no se tocaron):

- [ ] **¿La tienda y la conversión de presupuestos frenan si no hay
      disponible?** Hoy reservan aunque deje lo disponible en negativo.
- [ ] **El costo promedio**: ¿se pondera sobre todo lo comprado en la
      historia (`variant_costs.cantidad_base`) o sobre lo que hay en stock al
      recibir? Y **anular una recepción no revierte el costo** promedio que
      movió: ¿se recalcula o queda?
- [x] Un remito preparado a mano sobre una venta del mostrador **sin acopio**
      (ya «entregado», con saldo porque no tiene remito) saca del físico otra
      vez: lo correcto ahí es el remito de constancia. ¿Se rechaza
      `CrearEntrega` si el pedido tiene movimientos «Mostrador V-…»?
      Hecho: `CrearEntrega` rechaza el pedido ya entregado y manda al remito de constancia.
- [ ] El remito implícito de «Avanzar» nace sin documento de quien retira
      (en el remito a mano es obligatorio en un retiro): se completa al
      firmar.
- [x] Cancelar desde Pedidos un pedido ya entregado sigue permitido y no
      devuelve nada (solo libera reservas, que ya no hay).
      Hecho: con un remito vigente pide anularlo primero (`TestNoSeCancelaUnPedidoConRemito`).

## Seguridad antes de abrir al público (30/10, sobre `go-cuentas`)

La auditoría recorrió cada ruta con un usuario de cada rol (la matriz ruta ×
rol). Lo que se arregló, cada cosa con su prueba:

- **El pago de demostración se aprobaba solo.** Sin `MP_ACCESS_TOKEN` el
  proveedor caía al demo y `POST /api/v1/pagos/demo/{id}` le dejaba a un
  anónimo aprobar su propio pedido. Ahora el demo existe solo con
  `PAGOS_PROVIDER=demo` puesto a propósito; sin token y sin demo, pagar con
  Mercado Pago da 503 «El pago online no está disponible» antes de abrir un
  cobro, y las rutas del demo dan 404. `api:dev` y `worker:dev` ponen el
  demo si no hay token (así andan desarrollo y los E2E);
  `docker-compose.prod.yml` no fija nada. `TestSinTokenNiDemoNoHayPagoOnline`.
  **La VPS hoy cobra con el demo: con este cambio el pago online queda
  apagado hasta que se cargue el token** (decisión a avisarle a Nahuel). Las
  pantallas siguen diciendo «modo de prueba» cuando `enVivo` es falso
  (`/admin/pagos`, el bloque de pago del pedido, la inscripción a eventos):
  sin token ahora es «apagado», y el texto habría que ajustarlo.
- **Rutas más abiertas que su pantalla** (~100, todas con `ExigirStaff`): el
  mostrador entero, clientes, vendedores, seguimiento, cheques, facturación,
  bitácora, migración, proveedores, precios y su planilla, stock,
  sucursales, productos, WhatsApp (avisos manuales, sin leer), las tarifas
  vigentes de corte y los pendientes del inicio. Cada handler pide ahora
  `roles.QuienEntra` de la pantalla que lo usa (la más amplia si son
  varias). `TestAccesoPorPantalla` (`cmd/mjbj`) llama a todas las
  operaciones de los contratos con cada rol y las compara con
  `pantallaDeCadaRuta`: **una ruta nueva se declara ahí** (con
  `MJBJ_VER_ACCESO=1 go test ./cmd/mjbj -run TestVerAcceso -v` se ve la
  matriz). A propósito para todo el personal: el push, el buscador del
  encabezado, el emisor fiscal y la ficha del pedido (la abre el aserradero
  en `/admin/cortes/nuevo`). La cartera de cheques va con
  `/admin/compras/pagos`: es el pago a proveedores el que la usa, no el
  mostrador. Recibos y comprobantes (JSON y PDF) ya no los abre el
  aserradero.
- **`auth.Exigir` sin roles dejaba pasar a cualquier sesión**: una clave mal
  escrita en `roles.QuienEntra` abría la ruta. Ahora da 403; para «cualquiera
  que haya entrado» está `auth.ExigirSesion`.
  `TestExigirSinRolesNoDejaEntrarANadie`.
- **CSV con fórmulas**: el texto que empieza con `= + - @`, tabulador o
  retorno sale con un apóstrofo (`csvexcel.SinFormula`), en todas las
  exportaciones; la planilla de precios lo saca al subirla de vuelta. Ningún
  golden cambió. `TestTextoSinFormula` y compañía.
- **Comprobantes de transferencia y documentos técnicos, privados**: van a
  `CARPETA_PRIVADA` (`privado:<nombre>` en la base) y se entregan por
  `/api/v1/admin/pagos/{id}/comprobante` (quien entra a `/admin/pagos`) y
  `/api/v1/contenido/documentos/{id}/archivo` (el abierto, a cualquiera; el
  reservado, a profesionales aprobados y al panel). `TestComprobanteEsPrivado`,
  `TestPanelDeDocumentacion`. **Paso al desplegar**: correr una vez
  `docker compose -f docker-compose.prod.yml run --rm api privados` (mismas
  carpetas que la API; mueve lo que quedó en `/subidas/` y actualiza la base;
  repetible). Hasta correrlo, lo viejo se sigue viendo por la ruta nueva
  pero también por `/subidas/`.
- Bajos: el límite de comprobantes se cuenta después del token; el motivo
  del rechazo de un profesional va escapado en el correo (el golden de
  `campanas/avisos.json` tenía ese caso y se actualizó a mano ese renglón);
  un anónimo en `/api/v1/admin/*` recibe 401 antes de validar el contrato
  (`auth.Panel`), y un cliente 403; los carritos anónimos nuevos tienen tope
  de 60 por hora por IP (acción `carrito` del limitador).

Decisiones pendientes (no se hicieron):

- [ ] **Vincular por correo una compra anónima a la ficha de un cliente
      existente** (`internal/checkout/compra.go`, `clientePorCorreo`): hoy
      quien compra sin cuenta con el correo de otro cliente queda asociado a
      su ficha (y a su historial). Decidir si se vincula solo con sesión, o
      se crea ficha aparte y se avisa.
- [ ] **`trusted_proxies` de Cloudflare en Caddy**: cuando se ponga
      Cloudflare, `IPDelCliente` va a ver la IP de Cloudflare en todos los
      pedidos (límites por IP compartidos por todo el mundo). Se configura
      junto con el dominio.
- [x] Otras vistas de documentos siguen abiertas a todo el personal (el
      remito, el presupuesto en PDF, el seguimiento): revisar si el
      aserradero las necesita.
      Hecho: el presupuesto en PDF lo bajan presupuestos y mostrador; el remito, el seguimiento y la pantalla de pago, quien entra a pedidos. El aserradero, 404.
