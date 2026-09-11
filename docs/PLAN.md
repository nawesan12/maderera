# Plan de proyecto — Plataforma Digital Integral MJBJ

> Documento de trabajo interno del PRESTADOR. Traduce el contrato firmado
> (`Contrato — Maderera Juan B. Justo.pdf`, 15 pp.) a un plan ejecutable.
> Última actualización: 05/09/2026 (el brief del cliente, aplicado de punta a
> punta).

---

## 1. Marco contractual que gobierna el plan

| Ítem | Valor | Cláusula |
|---|---|---|
| Precio | $6.400.000 ARS fijo, sin ajuste | 3.1 |
| Cobro | 5 × $1.280.000 — sep/26 a ene/27 | 3.2 |
| Plazo | 2 a 3 meses desde la firma | 5.1 |
| Etapas | 4 etapas de 3 semanas, entregas **semanales** | 5.2 |
| Aceptación | 5 días hábiles por entrega; silencio = aprobación tácita | 8.1 |
| Revisiones | 2 rondas por etapa incluidas; el resto se factura aparte | 8.2 / 8.3 |
| Garantía | 1 mes post-lanzamiento, solo corrección de defectos | 14.1 |
| Recurrentes | Solo dominio (~$21.000/año). Hosting "gratuito a la fecha" | 12 |
| Propiedad | Se transfiere al cobrar la última cuota | 4 / 9 |

**Consecuencias operativas que no hay que perder de vista:**

1. **El pago no está condicionado al avance** (3.3 y 5.4): se empieza y se entrega antes de cobrar todo. El riesgo de cobranza es del PRESTADOR; el beneficio de precio fijo caduca ante mora (3.4).
2. **Toda demora del cliente debe quedar registrada por escrito** (5.3): es lo único que extiende el plazo sin responsabilidad propia. Más de 30 días acumulados habilita renegociar (5.5). Sin registro, no hay defensa.
3. **Cada entrega semanal necesita constancia** de envío y de fecha, para que corra el plazo de aprobación tácita de 8.1.
4. **Cláusula 8.4 (alcance flexible)** es un arma de doble filo: los ajustes menores entran sin cargo. Cada pedido que exceda eso debe rechazarse por escrito citando 8.5 *en el momento*, no al final.

---

## 1 bis. Estado al 21/08/2026

Cerrado el primer tramo. Anda de punta a punta contra Postgres:

- **Base y migraciones**: 15 tablas en Docker (Postgres 17, puerto 5433 porque el
  5432 lo ocupa un Postgres del sistema). Cuatro migraciones aplicadas.
- **Autenticación**: Better Auth con perfiles y roles. `/admin` exige sesión de
  staff, verificada en el DAL y no solo en el proxy. Alta de personal por
  `npm run staff:create`.
- **Catálogo público**: `/catalogo`, `/catalogo/[slug]` y `/stock` son Server
  Components que consultan la base, con filtros por URL y búsqueda sin acentos.
- **Gestión**: ABM de productos con variantes, stock por sucursal con
  transferencias transaccionales y libro de movimientos.
- **Precios**: pantalla propia con edición en línea, ajuste masivo por
  porcentaje, exportación e importación por planilla con vista previa, e
  historial auditado.
- **Panel**: rediseñado en modo claro, tipografía grande (16px base) porque lo
  usa gente que no ve de cerca, y color reservado para lo que pide atención.

**Segunda pasada — panel completo y tienda andando:**

- **Ventas modeladas**: 27 tablas. Clientes con cuenta corriente, presupuestos,
  pedidos con historial de estados, cortes con despiece en milímetros, carrito y
  zonas de envío.
- **Panel entero contra la base**: Resumen con métricas calculadas, Pedidos y
  Cortes como tableros por etapa, Presupuestos agrupados por lo que espera
  respuesta, Clientes en tarjetas con su saldo. Fichas de detalle en todo.
- **Flujo comercial**: un presupuesto aceptado se convierte en pedido copiando
  los precios pactados; cobrar un pedido a cuenta corriente descuenta la deuda.
- **Tienda**: carrito persistente en base (sobrevive a recargas y sigue a la
  persona al iniciar sesión), checkout con retiro o envío por zona, y pedido que
  cae directo en el tablero del panel.

**Tercera pasada — tienda y presentación:**

- **Fotos de producto**: subida real con arrastrar y soltar, varias a la vez,
  galería por producto con foto principal. Guarda en disco en desarrollo y en
  Vercel Blob en producción, detrás de la misma interfaz.
- **Ofertas**: precio anterior con vencimiento en el modelo. La tienda muestra el
  tachado y el porcentaje, y la oferta caduca sola.
- **Catálogo rehecho como tienda**: franja de confianza, acceso a ofertas,
  ordenamiento, y tarjetas donde el precio y la disponibilidad mandan. Se corrigió
  un layout roto que dejaba la grilla en columnas de 100px.
- **Home con datos reales**: ofertas, categorías con conteo, destacados y
  sucursales salen de la base. Antes era todo texto fijo.
- **Panel presentado por tipo de dato**: pedidos y cortes en tableros por etapa,
  clientes y productos en tarjetas con foto, stock con barra de nivel y ajuste
  rápido, precios con foto y agrupados por lo que hay que revisar.
- **Accesibilidad medida, no estimada**: se corrigieron dos contrastes por debajo
  del mínimo —los bordes daban 1,35:1 y el texto blanco sobre el naranja de marca
  3,08:1— y la escala del panel subió a 16px con controles de 40px.

**Cuarta pasada — portal de clientes (22/08/2026):**

Entregable de la Etapa 4 / S10, adelantado: es el único tramo grande que no
depende de ningún insumo del cliente.

- **Registro y sesión de clientes**: `/registro` propio, con el carrito armado
  sin sesión adoptado al entrar. El ingreso ahora manda a cada quien a donde le
  sirve: el personal al panel, el cliente a su cuenta.
- **`/mi-cuenta`**: resumen con lo que espera respuesta, pedidos con el recorrido
  a la vista, presupuestos que el cliente acepta o rechaza desde el sitio,
  cuenta corriente con saldo corrido movimiento por movimiento, direcciones
  guardadas y datos fiscales editables.
- **Volver a pedir**: un pedido anterior se carga entero en el presupuesto en
  curso, a precios de hoy. En una maderera la compra se repite.
- **Vinculación de cuentas**: el registro no ata automáticamente la cuenta web a
  una ficha del mostrador —sin verificación de correo, eso permitiría quedarse
  con la cuenta corriente de un tercero—. La ficha aparece en el panel con un
  aviso y la une el vendedor.
- **Tres agujeros cerrados**: la cuenta corriente en el checkout se validaba
  solo en pantalla y cualquiera podía elegirla; el saldo de la ficha de cliente
  se calculaba sobre los últimos 20 movimientos y daba mal con cuentas largas; y
  las líneas del carrito se podían editar sin verificar de quién eran.

**Quinta pasada — bandeja de WhatsApp (22/08/2026):**

Trabajo **nuevo**, no previsto en el plan original: se trajo el módulo de
WhatsApp del CRM inmobiliario y se lo rehizo contra Postgres y Drizzle.

- **Bandeja en el panel** (`/admin/whatsapp`): conversaciones, hilo con
  adjuntos, estados de entrega, archivado, y la conversación colgada del
  cliente y de su pedido. Al costado, el saldo de cuenta corriente y los
  últimos pedidos: son las dos cosas que se preguntan por WhatsApp.
- **Puesto de atención** (`/atencion`): la misma bandeja a pantalla completa,
  sin menú, para quien se dedica a contestar.
- **Adaptador con dos proveedores**: la Cloud API de Meta y uno de
  demostración. MJBJ atiende hoy con WhatsApp Business común en un teléfono, así
  que todo se construyó y se probó con el proveedor demo; el día que esté el
  WABA se cambian variables de entorno y no se toca una línea de la interfaz.
- **Avisos automáticos** al cambiar el estado de un pedido, con interruptor por
  estado y todos apagados por defecto. Dentro de la ventana de 24 h sale texto
  libre; fuera, plantilla aprobada.
- **Webhook** con verificación de firma HMAC, descarga de adjuntos y corte de
  repetidos por `waMessageId`.

**Esto cierra el riesgo R4 con una decisión concreta**: es la opción (a) —
WhatsApp Business API con costo por conversación—. Los pasos del alta, que son
trámites del cliente ante Meta, están listados en
`/admin/whatsapp/configuracion`. Hasta que se completen, la bandeja avisa en
cada pantalla que los mensajes no salen.

**Sexta pasada — facturación electrónica y ARCA (22/08/2026):**

Reemplaza las 918 líneas de maqueta de `/admin/facturacion`, que leían datos
inventados de `lib/dashboard-data.ts`.

- **Modelo fiscal**: `invoices`, `invoice_items`, `invoice_tributos`,
  `invoice_payments`, `puntos_venta`, `configuracion_fiscal`, `arca_tokens` y
  `arca_log`. Un comprobante emitido no se edita ni se borra: se corrige con una
  nota de crédito que lo referencia.
- **Numeración sin huecos**: correlativo por punto de venta y tipo, asignado
  dentro de la transacción y con `pg_advisory_xact_lock`, más un índice único
  que lo respalda. Dos personas facturando a la vez no pueden tomar el mismo
  número.
- **IVA bien resuelto**: los precios del catálogo son finales, así que facturar
  desagrega (`neto = total / 1,21`). La letra sale de cruzar la condición del
  emisor con la del receptor, y en la factura B el IVA se guarda e informa a
  ARCA aunque no se discrimine en el papel —la maqueta lo daba por cero.
- **ARCA completo**: WSAA con firma CMS propia (`node-forge`, sin mandar el
  certificado a un tercero) y ticket cacheado 12 h; WSFEv1 con `FECAESolicitar`,
  `FECompUltimoAutorizado` y `FEDummy`. Cada llamada queda en `arca_log`.
- **Sección ARCA** (`/admin/arca`): datos del emisor, puntos de venta, IVA e
  Ingresos Brutos —con percepción configurable—, y el **libro IVA ventas** con
  exportación a CSV para el contador, donde las notas de crédito ya restan.
- **Comprobante impreso** (`/comprobante/[id]`): formato A4 con la letra en
  recuadro, QR de AFIP y CAE. Sin autorización sale con marca de agua "sin valor
  fiscal", en pantalla y en papel.
- **Portal del cliente**: sus facturas en `/mi-cuenta/comprobantes`, con la
  misma hoja filtrada por dueño.
- **Transparencia fiscal** (ley 27.743): el precio sin impuestos nacionales
  aparece en letra chica junto al precio final en catálogo, ficha y checkout.

**Un defecto corregido en el camino:** el parseo de importes tipeados quitaba
todos los puntos asumiendo formato argentino, y convertía un cobro de $528.300
en uno de $52.830.000. Ahora la coma decide el formato (`parsearImporte` en
`lib/formato.ts`); el mismo defecto estaba latente en los movimientos de cuenta
corriente.

**Lo que falta para que los comprobantes tengan valor fiscal** es el certificado
digital, que tramita el cliente. Los pasos están listados en `/admin/arca`.
Mientras tanto se factura, se numera y se imprime, marcado como sin valor
fiscal.

**Séptima pasada — cobros, avisos por correo y acopio (26/08/2026):**

Cierra lo que faltaba de la Etapa 2 y del portal de clientes (cláusula 1.6).

- **Cobros online** (`lib/pagos/`): Mercado Pago por HTTP, sin SDK, con la firma
  del webhook verificada (HMAC sobre `x-signature`), y un proveedor de
  demostración con pantalla propia en `/pago-demo/[id]`. Se paga desde la
  confirmación del pedido y se cancela deuda de cuenta corriente desde el
  portal. Transferencia bancaria con comprobante subido por el cliente y
  conciliación a mano en `/admin/pagos`.
- **Una sola función mueve plata** (`acreditarPago`): idempotente por
  `proveedorPaymentId`, con lock de transacción y verificación del importe. Un
  aviso que dice "aprobado" por un monto distinto al del pedido queda en revisión
  y no acredita. Probado: el mismo webhook repetido no descuenta dos veces.
- **Avisos por correo** (`lib/email/`): Resend por HTTP con proveedor de
  demostración, plantillas HTML propias con la marca, bitácora en
  `notifications_log` y pantalla `/admin/avisos` con interruptor y asunto
  editable por evento. El comprobante sale adjunto en PDF.
- **El stock se descuenta al vender.** Era un agujero real: vender no movía
  inventario, y el sitio podía vender diez veces la misma placa. Ahora
  **disponible = físico − reservado**; el pedido confirmado reserva, la entrega
  genera el movimiento `venta`, y cancelar libera. La fuente de verdad es
  `stock_reservations` y hay un recálculo para comprobarla.
- **Acopio, remitos y firma digital**: un pedido se retira en varias veces y lo
  pendiente se calcula restando. Cada retiro genera un remito numerado, que se
  firma desde el celular en `/firmar/[token]` con el dedo. La firma se guarda en
  la base, no como archivo: una URL pública, aunque impredecible, la deja al
  alcance de cualquiera que la tenga.
- **PDF de verdad** (`lib/pdf/`, con `pdf-lib`): comprobante fiscal con QR y CAE,
  y remito con la firma incrustada. Rutas de descarga con verificación de dueño.
- **Red de tests** (`vitest`, 57 casos): desagregado de IVA, letra del
  comprobante, `parsearImporte`, costo de envío, disponible de stock, firma del
  webhook y dígito verificador de CUIT. No hay tests de interfaz a propósito:
  lo que se prueba es lo que, si se rompe, se descubre por una diferencia en un
  papel.
- **Lint en verde**: se eliminaron los siete errores de React 19 que arrastraba
  el proyecto —`setState` sincrónico dentro de efectos en cinco pantallas, y una
  lectura de la hora durante el render de un Server Component—.

**Octava pasada — portal de profesionales (26/08/2026):**

Cierra la cláusula 1.7 entera. Era lo último grande que no dependía de ningún
insumo del cliente.

- **Alta con validación de CUIT**: `/profesionales` se rehízo como Server
  Component —era una maqueta de cliente con un formulario que no mandaba nada— y
  ahora crea una solicitud real. El dígito verificador se valida con
  `lib/cuit.ts`; no dice si el CUIT existe, pero atrapa los errores de tipeo,
  que son los que terminan en una factura rechazada.
- **Aprobación desde el panel** (`/admin/profesionales`): asigna lista de precios
  y límite de cuenta corriente en el mismo paso, porque son las dos decisiones
  que hacen que el acceso signifique algo. Si ya existe una ficha con ese CUIT se
  marca esa, nunca se crea otra: dos fichas del mismo cliente parten su cuenta
  corriente en dos.
- **Precios diferenciados de verdad.** `profiles.priceListId` existía y no lo
  usaba nadie: el catálogo consultaba siempre la lista general. Ahora
  `lib/dal/precios-sesion.ts` resuelve la lista de quien mira, y el precio de la
  lista propia **cae a la general cuando falta**, para que un profesional no vea
  medio catálogo "sin precio". Todo request-time: un precio mayorista cacheado y
  servido al público es el peor error posible de este módulo.
- **Descuentos por volumen**: escalas por lista, categoría o producto, con la más
  específica ganando. Se aplican solas en el carrito, con el porcentaje y el
  precio tachado en el renglón que los generó.
- **Presupuestos express**: el presupuestador solo armaba un mensaje de WhatsApp,
  así que nada quedaba registrado. Ahora crea un `quote` con número y precios
  congelados; para un profesional entra con compromiso de respuesta a 24 horas,
  y el panel ordena la cola por lo que está más cerca de vencerlo.
- **Documentación técnica** (`/documentacion`): pública o reservada a
  profesionales, con el filtro por permiso dentro de la consulta.
- **Eventos con inscripción y pago** (`/eventos`): cupo tomado con lock —dos
  personas anotándose al último lugar no entran las dos—, inscripción gratuita
  confirmada al instante y con precio confirmada por el mismo `acreditarPago`
  que cobra un pedido. Asistencia y recordatorios desde el panel.

**Un defecto corregido en el camino:** `parsearImporte` devolvía `NaN` con
"1.500.000" —dos puntos y sin coma—, que es exactamente como se tipea un límite
de crédito a mano. Ahora más de un punto significa separador de miles; el caso
ambiguo de un solo punto sigue leyéndose como decimal, que es lo que evitó el
defecto de los $528.300.

**Novena pasada — contenido editable (26/08/2026):**

> **El blog y los testimonios se borraron el 7/9/2026**, por pedido de la
> clienta. Lo que sigue describe cómo estaban construidos y queda como
> registro; de esa pasada sobreviven `site_settings` y el conversor de
> Markdown, que ahora usan las guías del panel. Lo que la gente opina sobre los
> productos salió a `product_reviews`, con compra verificada detrás.

- **Blog contra la base** (cláusula 1.2): `blog_posts`, `blog_categories`,
  `testimonials` y `site_settings`. Las seis notas y los cuatro testimonios
  vivían en `lib/products.ts` como constantes de TypeScript, así que publicar
  una nota costaba un deploy. Se escribían desde `/admin/contenido`, con
  editor de Markdown y vista previa al lado.
- **El listado y la nota son Server Components.** Eran pantallas de cliente
  enteras que filtraban en memoria; ahora el filtro va por URL, que además es lo
  que permite compartir el enlace de una categoría y que el buscador la indexe.
  El buscador del blog es un `form` con GET y anda sin JavaScript.
- **`lib/markdown.ts`**: conversor propio y acotado —encabezados, listas,
  negritas, enlaces—. Escrito a mano y no con una librería porque el problema
  real no es el parseo sino el HTML que se inyecta después: **escapa todo antes
  de formatear**, así que una nota con `<script>` en el cuerpo sale como texto.
  Con tests sobre eso.
- **Testimonios y textos del sitio editables**: los testimonios son personas
  reales y tienen que poder salir sin un deploy; los ajustes —el WhatsApp, la
  leyenda del envío gratis, el aviso de la barra superior— se cambian desde el
  panel.

**Décima pasada — migración desde el sistema anterior (26/08/2026):**

Cláusula 1.9. `/admin/migracion`, solo para administración: reescribe cartera,
catálogo y saldos de una sola vez y no es una acción para un mostrador apurado.

- **Se construyó sin el dump, y esa es la decisión de diseño.** En vez de
  programar contra un formato que todavía no vimos, se declara qué necesita
  cada tabla de destino (`lib/migracion/entidades.ts`) y la pantalla pide que
  alguien diga qué columna del archivo es cada cosa. El día que llegue la
  exportación no hay que tocar código: hay que mapear seis columnas.
- **Cuatro cosas migrables**: clientes, productos con sus medidas y precios,
  existencias por sucursal y saldos de cuenta corriente. Cada una dice en
  pantalla en qué tablas escribe y cómo reconoce un registro ya migrado.
- **El mapeo sale hecho la primera vez.** Cada campo declara los nombres con
  los que un sistema de escritorio argentino suele llamarlo, y gana el sinónimo
  más largo: sin esa regla "Precio Profesional" se lo lleva el campo del precio
  de lista —porque también contiene "precio"— y el catálogo entero queda
  publicado con el precio de gremio.
- **Al lado de cada campo se muestra el primer valor real del archivo.** Elegir
  una columna por su nombre y no ver el dato es exactamente como se termina
  migrando el teléfono adentro del CUIT.
- **Vista previa del archivo entero antes de escribir nada**, con las filas
  ordenadas por lo que hay que mirar: primero lo que no entra, después lo que
  entra con reparos.
- **Todo es repetible.** Cada entidad se identifica por una clave natural —el
  código del sistema viejo (`customers.codigoLegacy`, columna nueva), el SKU,
  la sucursal— y volver a correr el mismo archivo actualiza en vez de duplicar.
  Es lo que permite corregir cuarenta filas y volver a subir el archivo entero
  sin pensarlo dos veces, que es como termina saliendo una migración de verdad.
  En saldos la protección es más fuerte: un movimiento de saldo inicial ya
  cargado se omite, porque cargarlo dos veces duplica la deuda de una persona.
- **Por lotes de 200 filas, cada lote en su transacción**, con el avance a la
  vista. Una sola transacción para veinte mil filas bloquea media base durante
  minutos y, si se corta, no deja nada; con lotes, un corte deja la mitad
  adentro, que es justamente lo que la repetibilidad vuelve inofensivo.
- **Informe de integridad**: contrasta lo que decía el archivo contra lo que
  quedó en la base. En saldos, la suma. Es el control que ningún contador de
  filas reemplaza: en la prueba detectó los $12.000 de un cliente que no tenía
  ficha, que las cifras de "procesadas" daban por buenas.
- **Las filas que no entraron se bajan como CSV** con línea y motivo, que es lo
  que hay que mandarle a quien tiene el sistema viejo para que las corrija.

**Qué es en realidad "Quality Software"** (averiguado, no supuesto): es **ISIS
ERP Manager**, de Quality Soft Argentina, sobre SQL Server. Exporta **grilla por
grilla a Excel** desde cualquier listado —no tiene una exportación única—, así
que la migración por entidad separada no es una preferencia nuestra: es la forma
del archivo que va a llegar. De ahí también que el lector avise en claro cuando
lo que se sube es un `.xlsx` en vez de un `.csv`, que es el error más probable.

**Dos defectos de lectura corregidos en el camino**, los dos encontrados
probando con un archivo real:

- La comilla se tomaba como delimitador en cualquier posición, así que `2" x 4"
  x 3.60m` quedaba como `2 x 4 x 3.60m`. En una maderera la pulgada está en
  todas las medidas. Ahora la comilla solo delimita si abre el campo.
- El archivo se leía línea por línea, y un domicilio de dos renglones —que
  Excel guarda entre comillas— partía el registro en dos y corría todas las
  columnas de ahí en adelante. Ahora el recorrido es carácter por carácter.

`lib/csv.ts` es el lector compartido: separador, codificación —los sistemas de
escritorio viejos guardan en Windows-1252 y "Cañuelas" leído como UTF-8 sale
roto—, comillas y números con coma decimal. La importación de precios, que
tenía su propia copia, ahora usa el mismo.

**Undécima pasada — SEO y publicación (26/08/2026):**

Cláusula 1.8. El sitio ya estaba entero; lo que faltaba era que se pudiera
encontrar.

- **`robots.ts` y `sitemap.ts`.** El sitemap se arma en cada pedido desde la
  base —58 URLs hoy— con la fecha real del último cambio de cada producto y
  cada nota. En `robots`, la línea que evita el desastre clásico: **fuera de
  producción no se indexa nada**, porque cada vista previa de cada rama queda
  publicada en una URL alcanzable y si Google las encuentra el sitio compite
  consigo mismo con seis copias del catálogo.
- **Datos estructurados** (`lib/seo.ts`, con tests): la empresa y el buscador
  en todas las páginas; **una ficha de local por sucursal** con dirección y
  horarios; **el producto con una oferta por medida** —cada medida tiene su
  precio y su stock, así que un precio único sería mentira— y el rango como
  `AggregateOffer`; y migas de pan en catálogo, ficha, sucursales, contacto y
  nosotros. Todo sale de la base: un horario equivocado en el marcado se
  indexa igual, y después llega gente al local a una hora en que está cerrado.
- **Metadata por filtro en el catálogo.** `?cat=placas` es ahora una página
  propia con su título y su canónica; **la búsqueda y los ordenamientos van
  `noindex`**, porque son combinaciones infinitas de las mismas fichas. Sin
  esto el catálogo se indexa cien veces repetido.
- **Imagen para compartir** (`opengraph-image.tsx`, 1200×630). Antes se
  compartía el favicon de 180×180, que WhatsApp muestra como un cuadradito al
  costado. En este rubro no es un detalle: mucho del tráfico llega porque
  alguien pasó un link en un grupo de obra.
- **Cinco páginas públicas dejaron de ser de cliente**: catálogo, sucursales,
  nosotros, contacto y calculadora. En la calculadora lo interactivo quedó como
  isla y el resto se arma en el servidor; en las otras cuatro no quedó nada de
  cliente. De paso desaparecieron los `layout.tsx` que existían solo para poder
  declarar metadata.

**Tres cosas que aparecieron al hacerlo, y que importan más que el SEO:**

- **`/sucursales` tenía las dos direcciones escritas a mano**, y el pie del
  sitio otras: el aserradero era "Canosa N°61" en un lado y "Canosa 61" en el
  otro. Google compara esos textos para decidir si confía en la ficha del
  negocio, y además significaba que cambiar un teléfono exigía buscarlo en
  cuatro archivos. Ahora los dos salen de `branches`, que sumó `servicios`,
  `destacados` e `imagenUrl`.
- **El formulario de contacto no mandaba nada.** El botón mostraba "Mensaje
  enviado correctamente" y los campos ni siquiera tenían `name`: toda consulta
  hecha desde ahí se perdía y quien la escribió se quedaba esperando. Ahora
  envía de verdad por el proveedor de correo, queda registrada en
  `notifications_log` y —esto es lo importante— **solo confirma lo que salió**:
  mientras el correo no esté conectado lo dice y ofrece WhatsApp, en vez de
  mentir.
- **Los números grandes eran falsos.** "43 años" cuando iban 45, "200+
  productos" sin relación con el catálogo y "1000+ clientes" que nadie contó
  nunca. Los cuatro salen ahora de la base y del calendario. Es de lo poco que
  un visitante puede verificar solo, y un número inventado ahí desmiente todo
  lo demás.

**Un agujero cerrado de paso:** `parrafos` entra crudo al HTML de los correos
—las plantillas propias mandan negritas adentro—, así que el mensaje del
formulario de contacto habría llegado sin escapar a la bandeja de quien
atiende. `escapar` pasó a ser público y el formulario lo usa, con tests sobre
eso.

**Duodécima pasada — sugeridos, bitácora, sucursales y guías (29/08/2026):**

Los cuatro renglones que quedaban sin depender de nadie.

- **Productos sugeridos** (1.3): se cargan desde la ficha del producto, en dos
  listas separadas —complementarios y alternativas—, y se muestran en la ficha
  pública y en el presupuesto del cliente. Los complementarios **no** tienen
  respaldo automático: sugerir un complemento equivocado es peor que no sugerir
  ninguno. Las alternativas sí caen a la categoría, porque ahí una sugerencia
  aproximada sirve igual.
- **`/admin/sucursales` contra la base**: la última maqueta del panel. Ahora la
  ficha se edita —dirección, teléfono, WhatsApp, horario, mapa, servicios y
  destacados— y las métricas del día salen de `orders`, `cutting_orders` e
  `inventory`. Se borró `lib/dashboard-data.ts`, y con él el último dato del
  negocio escrito a mano.
- **`audit_log` transversal**: quién hizo qué, cuándo y sobre qué, con pantalla
  propia en `/admin/bitacora` y la campana del panel leyendo de ahí. Enganchado
  en lo que mueve plata o borra datos: estados de pedido, cancelaciones, cobros,
  anulaciones, ajustes masivos de precio, importaciones, altas de cliente,
  aprobaciones de profesional y vinculaciones de cuenta. **No** en el ajuste
  rápido de stock ni en el precio individual: esos ya tienen su propia tabla con
  más detalle, y registrarlos dos veces solo llenaría la bitácora de ruido.
- **Guías escritas** (1.10): once guías en `docs/GUIAS/`, servidas dentro del
  panel en `/admin/ayuda` con buscador por texto completo. Escritas para quien
  viene de un sistema de escritorio: qué cambia, qué no se puede deshacer y
  cuáles son los errores que aparecen de verdad.

**Cuatro bugs que aparecieron en el camino:**

1. **El diálogo de alta de cliente recibía las listas de precios y nunca las
   mostraba**, y la acción tampoco guardaba `priceListId`. Un cliente con precio
   especial había que corregirlo por consola.
2. **El renderizador de Markdown hacía un párrafo por renglón.** Un texto
   escrito a 80 columnas salía como cinco párrafos. Afectaba también al blog.
3. **Una negrita partida en dos renglones no cerraba** y salían los asteriscos.
4. **El código en línea no protegía su contenido**: escribir `` `**así**` ``
   para explicar cómo se pone una negrita salía en negrita.

Se sumaron tablas y bloques de código al Markdown, con tests. El lint quedó sin
advertencias (había veinte).

**Decimotercera pasada — seguridad, cortes y gráfico (29/08/2026):**

- **Se cerró una filtración de datos personales.** `/pedido/[numero]` era
  pública, hacía la consulta suelta dentro del componente y filtraba solo por
  número. El número es consecutivo y sin huecos —se dice por teléfono y va en el
  remito—, así que recorrer la secuencia devolvía el nombre, el teléfono, la
  dirección de entrega y la compra de cada cliente. Las dos acciones que salen
  de esa página heredaban la suposición: se podía abrir el checkout de Mercado
  Pago de un pedido ajeno, y colgarle un comprobante inventado a cualquier
  pedido para que alguien lo diera por bueno en la conciliación. Ahora el número
  identifica y `orders.publicToken` autoriza. Comprobante y remito ya estaban
  bien.
- **Exportación de cortes** (sección 9, nivel 1): botón "Para la máquina" en la
  ficha del corte y pantalla de formato configurable. Ver 9.1.
- **El gráfico de ventas no dibujaba nada.** Recharts 3.8 renderizaba los ejes
  sin textos y las barras sin contenido, sin tirar un error: el panel mostraba
  "$3.615.426 este mes" al lado de un recuadro vacío. Se reescribió a mano en
  SVG, con el dato también como tabla para lector de pantalla, y se sacó la
  dependencia.
- **Ids de DOM duplicados** en tres componentes que se dibujan más de una vez
  por pantalla: las etiquetas de un formulario enfocaban los campos del otro.

**Cuarta pasada — la banda de diseño, el aserradero y la máquina:**

- **Rediseño completo de la interfaz**, aplicando el paquete de diseño de
  `claude.ai/design` en cuatro tandas: tokens y chrome, tienda y contenido
  público, panel entero, y formularios, diálogos y portal del cliente. El
  detalle está en `docs/CAMBIOS.md`.
- **Puesto del aserradero.** Rol `aserradero` y pantalla `/taller`: la cola de
  corte sola en la pantalla, igual que `/atencion` para WhatsApp. El menú del
  panel ahora se acota por rol; antes los tres roles veían las veinte secciones,
  incluidas Cobros, Precios y Migración.
- **Nivel 2 de la integración con la máquina** (ver 9.1): el agente de
  `agente-taller/` deja los archivos de corte en la carpeta del optimizador sin
  que nadie los baje a mano.

> **Nota**: entre la decimocuarta pasada y esta se construyó y desplegó todo el
> módulo de compras —proveedores con cuenta corriente, órdenes con recepción
> parcial, costo promedio ponderado, libro IVA compras, retenciones, gastos y
> cierre del mes con exportación de asientos— y el mostrador sin conexión. Nada
> de eso estaba en el contrato y no quedó anotado acá en su momento; está en
> `docs/ENTREGAS.md` y en el historial de commits.

**Decimoquinta pasada — el brief del cliente (5/9/2026):**

Llegó el relevamiento completo: 96 de 105 preguntas contestadas, en
`brief.txt`. Es la primera vez que la plataforma corre con los datos y las
reglas reales del negocio y no con los del prototipo.

El brief hizo tres cosas distintas, y la segunda es la que más importó:

- **Trajo el dato real.** CUIT, razón social, domicilio fiscal, los dos
  teléfonos, los tres puntos de venta (15, 17 y 20), las ocho categorías con su
  orden, las tres zonas de envío. Va en `lib/db/seed-negocio.ts`, idempotente y
  versionado: cargarlo a mano una vez no se puede repetir ni revisar.
- **Desmintió cosas que el sitio afirmaba.** Moldava no tiene "distribución
  nacional" sino de la Provincia de Buenos Aires; no eran "más de 40 años" sino
  45; los teléfonos publicados no eran de ninguna de las dos sucursales; el
  aserradero está en **Diagonal** Canosa 61; la placa estándar de la calculadora
  —1830 × 2820— no es ninguna de las cuatro medidas que existen en plaza; y el
  machimbre lleva **20 %** de encastre, no el 8 % que calculaba el sistema.
  También quedó claro que **la trayectoria de `/nosotros` sigue sin confirmar**:
  el cuadro volvió en blanco, así que de los siete hitos quedaron los dos
  verificables.
- **Describió reglas que la plataforma no tenía**, y esa fue la mayor parte del
  trabajo:

  - **Precio con o sin IVA según quién mira.** Un profesional o un responsable
    inscripto ve el neto grande con "+ IVA" al lado; el público sigue viendo el
    final con el neto en letra chica, como exige la ley 27.743. Los precios
    guardados no cambiaron: siguen siendo finales y siguen siendo lo que se
    cobra.
  - **Aviso al gremio** en catálogo y ficha: el precio diferenciado existía
    desde la octava pasada y nada en pantalla decía que estuviera ahí.
  - **Descuento por forma de pago** (−10 % de contado o transferencia), como
    escala por monto y no como porcentaje único, aplicado en el checkout y en el
    mostrador —incluso sin conexión—.
  - **El corte de placas se cobra.** No se cobraba en ninguna parte: las tablas
    no tenían una sola columna de importe y el número se tipeaba de memoria. Van
    los cuatro precios del brief, por material y por lista, y las pasadas de
    sierra se cargan después de optimizar, que es cuando se saben.
  - **Envíos a cotizar.** El cliente contestó "depende" a las tres zonas; la
    única forma de decirlo era dejar el costo en cero, que la pantalla mostraba
    como "Sin cargo". Y se construyó `/admin/envios`, porque las zonas vivían
    solo en el script de siembra.
  - **Bloqueo de cuenta corriente por límite y por mora** en el mostrador y en
    la facturación. Estaba **solo en el checkout web**: los dos caminos por los
    que entra la mayor parte de la venta no verificaban nada. En el mostrador se
    puede autorizar —hay alguien esperando— pero no pasar sin enterarse.
  - **Fecha de necesidad** en los presupuestos, y compromiso de respuesta para
    todos: antes solo lo tenían los profesionales aprobados.
  - **Migración ampliada** a proveedores, histórico de ventas y comprobantes
    emitidos, más **lectura directa de .xlsx** —el sistema viejo exporta a Excel
    y los precios se actualizan con una planilla todas las semanas—.
  - **Moldava como sección propia** (`/moldava`), que es lo que el brief pidió.

**Las sucursales dejaron de ser datos.** Su ficha publicada —dirección,
teléfono, horario, servicios— pasó de columnas editables a `lib/sucursales.ts`.
Son dos locales que la maderera tiene desde hace décadas, y como columnas solo
lograban que el domicilio del aserradero conviviera en tres versiones distintas
en el mismo sitio. La tabla `branches` sigue: de su id cuelgan el stock, los
pedidos, la caja, los remitos y los puntos de venta.

**Cuatro defectos corregidos en el camino:**

1. **Dos entradas del menú y del pie no filtraban nada.** `?cat=decks` y
   `?cat=construccion-seco` no coincidían con los slugs reales y caían en "No
   encontramos nada así".
2. **La lectura de la planilla de precios había vuelto a partir por
   renglones**, así que arrastraba el defecto que la migración ya había
   corregido: un campo entre comillas con un salto de línea adentro partía el
   registro en dos. Ahora las dos usan el mismo lector.
3. **`PrecioSinImpuestos` calculaba siempre al 21 %**, sin mirar la alícuota
   del producto. El dato que la ley obliga a publicar salía mal en todo lo que
   no fuera 21.
4. **El botón de cobrar del mostrador iba a pasar el evento del click como
   "autorizado"**, lo que habría salteado el control de cuenta corriente en
   cada venta. Se encontró al escribirlo.

Tests: 435, contra los 392 de antes. Los nuevos cubren el lector de .xlsx —con
un archivo armado byte a byte en el test—, la presentación del precio, el
descuento por forma de pago, la tarifa de corte, los plazos con sábado y las
cuatro calculadoras, que no tenían ninguno.

### Lo que falta para cerrar el contrato

| # | Qué | Cláusula | Depende de |
|---|---|---|---|
| 1 | **Dominio, SSL y despliegue** en `mjbj.ar`. | 1.8 | Decisión de infraestructura (R5) y acceso al dominio |
| 2 | **Capacitación presencial** y acompañamiento en la transición. Las guías escritas ya están; esto es la sesión con la gente. | 1.10 | Fecha con el cliente |

**No queda nada pendiente que dependa solo del PRESTADOR.** Los dos renglones
que quedan necesitan una decisión o una fecha del cliente.

El SEO (1.8) sale del cuadro salvo la publicación en sí, que necesita el
dominio. La migración (1.9) tampoco está: **el código está hecho y probado
de punta a punta**. Lo que falta es el archivo del cliente, y está anotado como
insumo pendiente.

De los cobros, los avisos y ARCA no falta código: falta lo que tramita el
cliente —credenciales de Mercado Pago, casilla con dominio verificado,
certificado fiscal y la definición sobre WhatsApp—. La lista completa de
insumos pendientes está en `docs/CAMBIOS.md`.


## 2. Punto de partida real

Lo que hay en el repo hoy es un **prototipo de front-end sin backend**: ~7.500 líneas de
TSX, todos los datos hardcodeados en `lib/products.ts` (656 líneas) y
`lib/dashboard-data.ts` (348 líneas). No existe `app/api/`, ni base de datos, ni sesión,
ni pagos.

| Capa | Estado | Destino |
|---|---|---|
| Diseño y componentes (`components/ui/*`, navbar, footer, cards) | ✅ Sirve | Se conserva |
| 10 páginas públicas | ✅ Server Components contra la base (11ª pasada) | — |
| `lib/calculations.ts` (4 calculadoras, 170 líneas) | ✅ Lógica pura correcta | Se conserva tal cual |
| `lib/budget-context.tsx` (carrito en memoria) | 🟡 Solo cliente, se pierde al recargar | Se reescribe con persistencia |
| Panel admin (hoy 19 secciones) | ✅ Todo contra la base (12ª pasada) | — |
| `app/admin/facturacion` | 🟡 918 líneas de maqueta completa (alta, IVA, impresión) | Se conecta a la base y a ARCA |
| Tienda, checkout, pagos, envíos | ✅ Hecho (7ª pasada: cobros, remitos y seguimiento) | — |
| Portal de clientes | ✅ Hecho (4ª y 7ª pasada) | — |
| Portal de profesionales | ✅ Hecho (8ª pasada) | — |
| Migración Quality Software | ✅ Hecha (10ª pasada), a la espera del archivo | — |

**Estimación gruesa: el prototipo cubre ~20% del contrato.** Es la Etapa 1 casi entera,
y sirve como maqueta de referencia para el resto.

---

## 3. Arquitectura objetivo

### 3.1 Stack

| Capa | Elección | Por qué |
|---|---|---|
| Framework | Next.js 16.2.2 (App Router) — ya instalado | — |
| Datos | **Neon** (Postgres serverless) + **Drizzle ORM** | Postgres puro, sin capa propietaria encima. El *branching* copy-on-write da una DB por deploy de preview, que encaja justo con las entregas semanales de 8.1 |
| Auth | **Better Auth** sobre las mismas tablas de Neon | Es la opción estándar para Next.js en 2026: TypeScript nativo, sesiones sobre Postgres, email/password y OAuth. Neon lo ofrece también gestionado (tablas en el schema `neon_auth`) — a evaluar en S1 |
| Archivos | **Vercel Blob** | PDFs de factura, firmas de acopio, fotos de producto. Soporta blobs privados, necesario para documentación fiscal |
| Acceso a datos | Server Components + Server Actions con **Data Access Layer** (`lib/dal/`) | Patrón recomendado por Next 16: `verifySession()` memoizado con `cache()`, autorización cerca del dato, nunca en el componente |
| Sesión | Cookies de Better Auth + `proxy.ts` para chequeos optimistas | En Next 16 el middleware se llama **Proxy** (`proxy.ts` en la raíz). Solo redirecciones; la verificación real va en el DAL |
| Facturación | `@afipsdk/afip.js` o `@ramiidv/arca-facturacion` (a evaluar en S1) | Manejan WSAA + WSFEv1 y el firmado del ticket de acceso |
| Pagos | Mercado Pago Checkout Pro + webhook | — |
| Email | Resend (3.000/mes gratis, requiere verificar `mjbj.ar`) | — |
| Deploy | A definir — ver riesgo R5 | — |

### 3.2 Reglas de arquitectura (no negociables durante el desarrollo)

- **La base de datos nunca se toca desde el navegador.** A diferencia de Supabase, acá no
  hay un cliente JS con credenciales propias: la connection string vive solo en el servidor
  y **toda** lectura o escritura pasa por el DAL. Eso hace del DAL la única línea de
  defensa, así que no puede haber atajos: ninguna query suelta dentro de un componente.
- **Toda consulta que devuelva datos de una persona lleva el `userId` de la sesión en el
  `where`**, obtenido de `verifySession()` y jamás de un parámetro del cliente. Un portal
  con cuentas corrientes y facturas ajenas expuestas es el peor escenario posible; sin RLS
  detrás, el filtro por dueño es responsabilidad del código y se revisa en cada PR.
- **Toda mutación pasa por Server Action** que primero llama `verifySession()` y valida el
  input con Zod. Nada de confiar en lo que manda el cliente (data-security.md).
- **DTOs explícitos**: nunca devolver una fila entera al cliente; seleccionar columnas.
- **`use cache` solo en lo público** (catálogo e institucionales) con `cacheTag` por
  entidad, e invalidación con `updateTag()` al editar desde el admin. Todo lo que sea
  precio-para-profesional, stock, cuenta corriente o panel: request-time, bajo `<Suspense>`.
- **`cacheComponents: true`** se evalúa al final de la Etapa 2, no antes: cambia el modelo
  de renderizado de todo el sitio y conviene decidirlo con las páginas ya escritas.
- **El stock nunca se descuenta desde el front.** Movimientos de inventario por transacción
  en la DB, con tabla de auditoría.

### 3.3 Modelo de datos (~35 tablas)

```
CATÁLOGO        categories · products · product_variants · product_images
                price_lists · price_list_items          (lista general vs. profesional)

SUCURSALES      branches · inventory · inventory_movements
                transfers · transfer_items

PERSONAS        users · sessions · accounts              (las gestiona Better Auth)
                profiles (1:1 con users) · professional_applications
                addresses · staff_roles                 (admin | vendedor | depósito)

CUENTA CTE      current_accounts · account_movements    (compra, pago, NC, ajuste)

VENTA           carts · cart_items                      (carrito persistente)
                orders · order_items · order_status_history
                quotes · quote_items                    (presupuestador + calculadora)
                cutting_orders · cutting_items          (cortes de placa, cola de trabajo)

LOGÍSTICA       shipping_zones · shipments              (MdP, Tandil, Necochea, retiro)
                deliveries · delivery_items             (retiros parciales de acopio)
                delivery_signatures                     (firma digital → Blob privado)

PAGOS           payments · payment_webhooks

FISCAL          invoices · invoice_items                (A/B/C, NC, ND)
                arca_tokens                             (TA cacheado, vence a las 12 h)
                arca_request_log                        (auditoría de cada request)

PROFESIONALES   events · event_registrations · technical_documents

CONTENIDO       product_reviews · site_settings · banners
                (blog_posts, blog_categories y testimonials: borradas el 7/9/2026)

SISTEMA         notifications_log · audit_log
```

Decisiones de modelo que conviene fijar ahora:

- **Precio en la variante, no en el producto.** El catálogo tiene medidas, espesores y
  tipos; una placa de 18 mm y una de 5,5 mm no comparten precio ni stock.
- **Unidad de venta como enum** (`unidad | metro_lineal | metro_cuadrado | placa`): la
  calculadora, el carrito y la factura tienen que hablar el mismo idioma.
- **Precio profesional como lista separada**, no como porcentaje de descuento: el cliente
  va a querer excepciones por producto.
- **Acopio**: un `order` puede tener N `deliveries` parciales; el saldo pendiente de retiro
  sale de `order_items.qty - Σ delivery_items.qty`.
- **`cutting_items` con geometría desde el principio** (largo, ancho, cantidad, veta,
  canteado por lado): aunque la integración con las máquinas sea un módulo aparte, si la
  tabla nace sin esos campos hay que migrarla después. Ver sección 9.

---

## 4. Cronograma

Anclado al **lunes 24/08/2026** como S1. Ajustar si la firma se corre.

### Etapa 1 — Fundaciones e identidad · S1–S3 · 24/08 → 11/09

Entregable contractual: *identidad visual aplicada, diseño de todas las páginas y sistema
de componentes*. Como eso ya está casi hecho en el prototipo, la etapa se aprovecha para
montar la infraestructura sin perder el hito.

| Semana | Entrega |
|---|---|
| S1 | Proyecto Neon + schema completo en Drizzle + migraciones + seeds. Better Auth funcionando (alta, login, recuperación). `proxy.ts` y DAL base. Branch de Neon por preview. **En paralelo: pedir el dump de Quality Software y arrancar el trámite de certificado ARCA de homologación.** |
| S2 | Catálogo real: categorías, productos, variantes, imágenes en Blob. Admin de productos con carga y edición. Migración del catálogo del mock a la DB. |
| S3 | Stock multi-sucursal real: inventario, movimientos, alertas de reposición, transferencias. `/stock` y `/catalogo` leyendo datos vivos. Revisión de diseño de todas las páginas con el cliente. |

### Etapa 2 — Tienda online · S4–S6 · 14/09 → 02/10

| Semana | Entrega |
|---|---|
| S4 | Carrito persistente (reemplaza `budget-context`), ficha de producto con variantes, checkout paso a paso, cálculo de envío por zona y opción de retiro. |
| S5 | ✅ Mercado Pago Checkout Pro + webhook + conciliación, transferencia con comprobante y pago a cuenta corriente (séptima pasada, 26/08). Falta el alta de la cuenta de Mercado Pago, que tramita el cliente. |
| S6 | ✅ Panel de pedidos con estados y avisos por email y WhatsApp (séptima pasada). Falta: productos sugeridos, que van con el resto del trabajo de tienda de la pasada 9. |

### Etapa 3 — Gestión y facturación · S7–S9 · 05/10 → 23/10

**La semana de mayor riesgo del proyecto es S8.**

| Semana | Entrega |
|---|---|
| S7 | ✅ Presupuestador conectado: pedirlo desde el sitio genera un `quote` real que cae en el panel (octava pasada). Gestión de cortes de placa con cola de trabajo, que es la base de la conexión con las máquinas (sección 9). |
| S8 | **ARCA**: ✅ WSAA + WSFEv1 escritos, emisión de A/B/C, notas de crédito, QR e impresión (sexta pasada, 22/08). Falta correrlo contra homologación con un certificado real. |
| S9 | ARCA en producción con el certificado real. Panel de control con KPIs reales (reemplaza `dashboard-data.ts`). Base de clientes con ficha, historial y segmentación. |

### Etapa 4 — Portales, migración y lanzamiento · S10–S12 · 26/10 → 13/11

| Semana | Entrega |
|---|---|
| S10 | ✅ Portal de clientes completo: cuenta corriente, pedidos y presupuestos (4ª pasada), más facturas y remitos en PDF, pago online de deuda y firma digital de acopio desde el celular (7ª pasada). |
| S11 | ✅ Portal de profesionales completo: registro con validación de CUIT, aprobación con lista y límite, precios diferenciados con descuentos por volumen, presupuestos express con SLA, documentación técnica y eventos con inscripción y pago (octava pasada, 26/08). |
| S12 | Migración definitiva de Quality Software, verificación de integridad, SEO y performance, dominio `mjbj.ar` + SSL, capacitación presencial y guías escritas. **Lanzamiento.** |

Garantía: **13/11/2026 → 13/12/2026**. A partir de ahí, soporte solo bajo acuerdo escrito
aparte (14.2).

---

## 5. Riesgos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| **R1** | **Quality Software sin exportación usable.** Puede ser una base propietaria, DBF o Access sin API. Si no hay export, hay que scrapear pantallas o retipear. | Alto — la migración es obligación contractual sin costo adicional (1.9) | **Pedir un dump de muestra en S1, no en S10.** Si no hay export, notificarlo por escrito de inmediato: es un cambio de condiciones, no un problema propio. |
| **R2** | **Certificado ARCA y punto de venta.** El trámite lo hace el cliente (7 y 13.2). El certificado de producción sale por el Administrador de Certificados Digitales, y el punto de venta debe estar habilitado como *Webservices*. | Alto — bloquea S9 entera | **El código está escrito y andando contra el proveedor interno (sexta pasada).** Falta lo que depende del cliente: el certificado. El de homologación es gratis y sale online por WSASS — conviene sacarlo ya para depurar `lib/fiscal/proveedores/arca.ts` contra el ambiente de prueba, que es lo único que todavía no se pudo ejecutar. |
| **R3** | **`CondicionIVAReceptorId` obligatorio desde abril/2026.** Toda factura necesita la condición frente al IVA del receptor. | Medio | El campo entra en `profiles` desde el schema inicial (S1) y es obligatorio en el checkout de responsables inscriptos. |
| **R4** | **"Notificaciones automáticas por WhatsApp" (1.3).** Automatizar de verdad exige WhatsApp Business API de Meta: alta, verificación de la empresa, plantillas aprobadas y **costo por conversación**. No es gratis ni instantáneo, y choca con "sin costos recurrentes" (12). | Alto — comercial | **Resuelto por el camino (a) en la quinta pasada**: el módulo está construido contra la Cloud API, con proveedor de demostración mientras el número no esté dado de alta. Quedan dos cosas del lado del cliente: el trámite ante Meta (listado en `/admin/whatsapp/configuracion`) y aceptar por escrito el costo por conversación. **Ojo con la migración del número**: el que hoy usan en la app deja de funcionar en el teléfono al migrarlo, así que conviene evaluar dar de alta uno nuevo. |
| **R5** | **Hosting "gratuito" (12).** Vercel Hobby no admite uso comercial → Pro, USD 20/mes. El free tier de Neon da 0,5 GB de storage, 100 compute-hours por mes y autoscaling tope 2 CU: alcanza para desarrollar, no para operar una tienda con facturación. | Alto — comercial | Neon Launch arranca en ~USD 5/mes más consumo, bastante más barato que la alternativa gestionada. Plantear el costo real ahora, no en el lanzamiento. **Decisión pendiente.** |
| **R6** | **APIs de envío.** Andreani tiene API con cuenta corporativa; CDI probablemente no. | Medio | **Resuelto por el piso que funciona con cualquiera** (séptima pasada): `shipping_zones` con tarifas configurables, y `shipments` con transportista y número de seguimiento cargados a mano desde el remito. Una integración después llena esos mismos campos sin tocar una pantalla. |
| **R7** | **Backups fiscales.** Las facturas emitidas son documentación fiscal: perderlas es un problema del cliente ante ARCA. El free tier de Neon retiene solo **6 horas** de historial para restaurar a un punto en el tiempo. | Alto | Seis horas no cubren "el lunes descubrimos algo que se rompió el viernes". Plan pago para ampliar la ventana (ver R5) + export periódico a almacenamiento propio. La cláusula 15 limita la responsabilidad, pero el daño reputacional no se limita por contrato. |
| **R8** | **Scope creep vía 8.4.** "Alcance flexible" invita a pedidos infinitos que parecen menores. | Medio | Bitácora en `docs/CAMBIOS.md`: fecha, pedido, decisión, respuesta enviada. |
| **R9** | **Capacitación de usuarios no técnicos.** El equipo viene de un sistema de escritorio; el rechazo al cambio hunde proyectos técnicamente correctos. | Medio | Involucrar al operador real desde S3, no en S12. Las guías escritas (1.10) se van escribiendo en cada etapa. |

---

## 6. Insumos a pedir al cliente — ahora, no después

Enviar como lista única al firmar. Cada ítem que falte y frene el trabajo se registra por
escrito invocando 5.3.

**Bloqueantes tempranos (S1–S2)**
- [ ] Dump / exportación de Quality Software: productos, stock, clientes, precios, saldos de cuenta corriente
- [ ] Accesos al sistema actual para verificar la extracción
- [ ] Inicio del trámite de certificado digital ARCA (homologación y producción)
- [ ] Punto de venta habilitado en modalidad *Webservices*
- [ ] CUIT, razón social, condición frente al IVA e inicio de actividades
- [ ] Persona de contacto designada con autoridad para aprobar (7), con plazo de respuesta de 3 días hábiles

**Contenido y comercial (S2–S4)**
- [ ] Fotos de productos en calidad utilizable (2ª: la producción fotográfica **no** está incluida)
- [ ] Lista de precios vigente, general y de profesionales
- [ ] Textos comerciales, fichas técnicas, documentación técnica descargable
- [ ] Logo en vectorial y manual de marca si existe (MJBJ y Moldava)

**Cuentas de terceros (S4–S6)**
- [ ] Credenciales de Mercado Pago (producción y test)
- [ ] Cuenta bancaria y alias para transferencias
- [ ] Cuentas de Andreani / CDI, o la tabla de tarifas por zona
- [ ] Acceso al dominio `mjbj.ar` (registrante y DNS)
- [ ] Definición sobre WhatsApp Business API (ver R4)
- [ ] **Confirmar el número de WhatsApp del negocio.** El ajuste guarda `542235903118` y
      el código traía `5492235903118` como valor por defecto. Para un celular argentino el
      `9` después del 54 no es opcional, así que el número guardado probablemente no reciba
      los mensajes de los botones. Se corrige desde Contenido, sin tocar código.

---

## 7. Decisiones abiertas

1. **Dónde se despliega** y quién paga la infraestructura (R5). Condiciona el cierre de S1.
2. **WhatsApp: API real o disparo manual asistido** (R4). Condiciona S6.
3. ~~**Alcance de la migración**~~ — **cerrada por el brief (5/9/2026)**: se migra
   todo, incluido el histórico de ventas y los comprobantes emitidos, "desde
   siempre". Excede la cláusula 1.9, que lista productos, stock, clientes y
   precios; quedó anotado en `docs/CAMBIOS.md` y se hizo igual. Los dos
   históricos van a tablas de solo lectura, no a `orders` ni a `invoices`.
4. ~~**Punto de venta electrónico**~~ — **cerrada por el brief**: son **tres**,
   los números 15, 17 y 20. Falta el último número emitido en cada uno, que es
   lo que bloquea emitir el primer comprobante sin pisar la serie de ARCA.
5. **`cacheComponents`**: sigue apagado, pero **el motivo que estaba escrito acá dejó de
   ser cierto y conviene dejar asentado por qué**.

   Decía que las rutas eran todas dinámicas porque el layout lee la sesión y el
   presupuesto para el menú, y que *eso no iba a cambiar*. Cambió. El layout ya no lee
   cookies: el nombre y el contador los completa el navegador, y solo cuando hay algo que
   completar —una cookie señal sin datos, que el servidor apaga sola cuando ya no hay
   nada—. Con eso, **«Quiénes somos», sucursales, contacto, la calculadora, eventos y cada
   sucursal se sirven del CDN**, verificado con `x-vercel-cache: HIT` y ~0,2 s contra
   los ~0,5 s de antes.

   Lo que **no** puede salir del CDN es el catálogo y la ficha de producto, y no por
   pereza: el precio depende de la lista de quien mira. Documentación y el portal de
   profesionales tampoco, por lo mismo. Ahí la ganancia sí es cachear la consulta, y ahora
   el catálogo se cachea **por lista de precios** —la lista viaja en la clave— así que
   una visita anónima no consulta la base ni una vez.

   `cacheComponents` sigue sin encenderse porque ya no compra casi nada: lo que faltaba
   era sacar las cookies del layout, y eso está hecho.
6. **Integración con las máquinas de corte**: alcance, arquitectura y ubicación en el
   cronograma (sección 9). Se define con el relevamiento del 21/08.

---

## 7 bis. Punto de venta del mostrador

Trabajo pedido el 1/9/2026 y construido. No estaba en el relevamiento original: el
mostrador se atendía por fuera del sistema, y los pedidos solo nacían del checkout del
sitio o de un presupuesto.

**Qué quedó hecho.** `/mostrador`, a pantalla completa como el taller. Búsqueda por
nombre, medida o código —devuelve variantes, que es lo que se cobra—, líneas con cantidad
y precio editables, cliente o consumidor final, cinco medios de pago, vuelto, y turno de
caja con apertura, ingresos, retiros y cierre con arqueo. Los cierres se revisan en
`/admin/caja`. Al cobrar se elige entre comprobante interno y factura; la letra la deriva
el sistema de la condición de las dos partes.

**Tres decisiones que conviene tener presentes**, porque son de negocio y no de código:

1. **El stock puede quedar negativo y la venta se hace igual.** La mercadería está sobre
   el mostrador; si el sistema dice que no hay, el que está mal es el sistema. Queda el
   movimiento, que es lo que después permite encontrar el error.
2. **Efectivo exige caja abierta.** Una venta en efectivo que no cae en ninguna caja es
   el agujero que la caja existe para tapar.
3. **El comprobante va después de la venta.** Si ARCA no contesta queda una venta sin
   comprobante —que se resuelve desde Facturación— y no una venta deshecha.

**Lo que falta para usarlo en producción** es lo mismo que falta para facturar en
general: el certificado de ARCA y al menos un punto de venta cargado. Sin eso el mostrador
funciona y avisa que el comprobante no se pudo emitir.

---

## 7 ter. La segunda tanda de la clienta (7/9/2026)

Después del brief llegó una lista de veinte pedidos sobre lo que ya estaba
desplegado (`notas.md`). No es un relevamiento nuevo: es la devolución de
alguien que usó el sitio. Lo que entró:

**El sitio público.** El hero dejó de ser un bloque aparte y es el primer slide
de un carrusel a todo el ancho —"que sea lo primero que se ve"—. Moldava subió
del menú «Más» a la barra principal y su acceso mayorista pasó del pie de la
página al encabezado. «Productos» del navbar es un enlace y no un desplegable
que solo abría al pasar por encima, y el header ofrece crear cuenta a quien no
entró. El asistente dejó de usar el ícono de chispas: ahora tiene un personaje
propio, que además es más honesto —ese asistente es un guion con respuestas
escritas, no un modelo de lenguaje—.

**Tres cosas que cambiaron cómo se vende.**

1. **El deck se vende por tabla.** Se cobraba por metro cuadrado, y eso obligaba
   a alguien del mostrador a convertir a tablas enteras y decidir qué hacer con
   el resto: la cuenta salía distinta cada vez. Ahora la unidad es la tabla, con
   su medida y su precio, y la calculadora devuelve tablas enteras.
2. **El precio mayorista es de contado.** Con lista diferenciada, el checkout
   ofrece transferencia, débito, efectivo y cuenta corriente, y nada más. Se
   resolvió bloqueando los medios y no recalculando el precio al final:
   mostrarle un número a alguien y subírselo cuando ya decidió comprar es peor
   que no ofrecerle esa forma de pago.
3. **Las opiniones son de compra verificada.** Solo reseña quien tiene un pedido
   entregado con ese producto, y nada se publica sin que alguien lo lea. Es lo
   que reemplazó a los testimonios: el problema de los cuatro del prototipo no
   era que estuvieran mal escritos, era que no había forma de que fueran
   ciertos.

**El catálogo ganó un nivel.** Las subcategorías eran texto libre escrito en
cada producto —dos productos del mismo rubro con una tilde de diferencia eran
dos rubros— y ahora son una tabla con filtro navegable. Se cargaron los 43
rubros de ferretería que la clienta trajo del sitio anterior. Están vacíos y no
se muestran hasta que haya productos: el brief da ~1000 SKUs para esa categoría
sola, y sin este nivel es una grilla donde no se encuentra un tarugo.

**Dos pantallas nuevas en el panel.** `/admin/calculadoras` trae a la superficie
los números con los que calculan las cuatro calculadoras —y de paso destraba
tres insumos que estaban esperando que la clienta los diera, porque ya no
necesitan un despliegue—. `/admin/productos/candidatos` lista los productos que
podrían darse de baja; **no da de baja nada solo**, y eso es deliberado: un
artículo de temporada que no se vende en trece meses y vuelve a venderse en el
catorce desaparecería del catálogo sin que nadie se entere.

**El blog salió del sitio.** Las seis notas las había escrito el prototipo y
estaban publicadas con la maderera como autora. Se respaldaron fuera del repo
antes de borrar las tablas, y `/blog` y cada nota redirigen a la portada con
301: estaban en el sitemap y pueden haberse compartido.

**Una decisión que se revirtió a pedido.** `lib/stock-level.ts` decía que el
número exacto de stock no se muestra nunca, porque expone información
comercial. La clienta lo quiere como promoción. Se acotó al único nivel donde
promociona algo —"¡Quedan 3!" cuando queda poco— y el comentario del código se
corrigió: un comentario que afirma lo contrario de lo que hace el código es peor
que no tenerlo.

---

## 7 quater. La tercera tanda de la clienta (9/9/2026)

Veintidós renglones nuevos en `notas.md`, esta vez casi todos del panel: es la
devolución de alguien que ya opera el sistema y extraña los circuitos de su
ERP. Vinieron con tres insumos que son la especificación del proceso real: el
presupuesto impreso del sistema actual (Serymat Atlántica), la planilla de
cortes del taller —cantos por lado en 0/1/2 y metros de tapacanto sumados— y el
documento de promociones bancarias con sus vigencias.

**El criterio de toda la tanda**: cada pantalla encarna el proceso, no la
tabla. El detalle pedido por pedido está en `docs/CAMBIOS.md` (filas del
9/9/2026); lo grande:

- **El sitio** ganó la sección de medios de pago y promociones bancarias
  (editables, con vigencia que las apaga solas), el logo y el menú que pidió la
  clienta, y Profesionales en la barra.
- **La venta** tiene vendedores de verdad (de salón y de calle) que la ficha
  asigna, los papeles heredan y el reporte agrupa; presupuestos por sucursal y
  en PDF con el modelo del papel que hoy imprimen; y un mostrador que emite
  presupuesto sin cobrar, remito al retirar con la condición de pago, venta en
  acopio que reserva en lugar de entregar, y pago partido con lote y cupón —con
  la caja y el cierre Z leyendo lo que de verdad entró por cada medio—.
- **El corte** habla el idioma de la planilla del taller: cantos 0/1/2 por
  medida, aclaraciones, metros de tapacanto calculados y cobrados por tarifa
  propia, y etiquetas por pieza con el croquis del canto para pegar al apilar.
- **Los precios** suman la lista constructora, derivada de la general por un
  porcentaje ajustable (ítem propio > derivado > general), y el ajuste masivo
  corta por rubro y elige su base: precio vigente o costo, con o sin
  elaboración.
- **Las compras** cierran el circuito: condiciones de pago del proveedor por
  escrito, pagos imputados a facturas (cada factura sabe si está paga, a
  medias o sin tocar), pago en varias partes y cartera de cheques en los dos
  sentidos, ordenada por lo que vence.

**Un pedido se rechazó**: marcar pagos y gastos "en blanco / en negro". Un
registro de operaciones no declaradas no se construye; la distinción legítima
—gasto con o sin factura— ya existe. Queda para conversarlo con la clienta.

Migraciones 0046–0050. Tests: 495. Pendiente de esta tanda: correr las
migraciones y los seeds contra la base local (el puerto 5433 estaba ocupado
por otro proyecto) y contra producción antes del deploy.

---

## 7 quinquies. Cuarta pasada del panel (11/9/2026)

No trajo módulos nuevos: trajo **el tejido entre los que ya estaban**. El
diagnóstico fue recorrer las 63 pantallas de `/admin` y contestar dos preguntas
por cada una —¿en qué acción termina? ¿a dónde lleva cada dato?—.

De unos doce puentes del circuito real existían siete. **Los cinco que
faltaban** eran los que más duelen: la ficha del cliente no dejaba abrir sus
propios pedidos; `cuttingOrders.orderId` estaba en la base sin que nadie lo
escribiera, así que pedido y corte no se conocían; el buscador ⌘K prometía
clientes y pedidos y buscaba solo productos; una factura de compra impaga no
ofrecía pagarla; y la cartera de cheques no tenía un solo enlace.

**El resumen pasó de "cómo viene el negocio" a "qué hay que hacer hoy"**, con
conteos que ya se calculaban y vivían encerrados en su pantalla. Los contadores
del menú se suman solo donde el número sale de la base —el criterio de no
inventar badges se mantiene—.

Aparecieron tres defectos que no se veían leyendo el código:

- **Gastos** mostraba un mes en el encabezado y otro en la tabla, y no había
  con qué cambiar el mes. Igual en Retenciones sufridas.
- **Filtrar en Stock o en Precios** expulsaba a Productos: la ruta del buscador
  compartido estaba escrita fija.
- **Sucursales** decía en un comentario que la ficha se editaba ahí. No hay ni
  hubo formulario: los datos son constantes a propósito (`lib/sucursales.ts`).
  Lo que sí faltaba era que sus seis métricas llevaran a algún lado.

**El «blanco / negro» se construyó**, corrigiendo el rechazo de la tanda
anterior. El pedido no era llevar un registro de evasión sino seguir por
separado lo que se factura por otra vía o contra otra cuenta; las etiquetas son
las que usa el equipo. Está en gastos, pagos a proveedores y cheques, con
filtro y totales separados (migración 0051).

Y por pedido directo: **textura en todas las superficies del panel** y **barra
lateral oscura en los dos temas**, con el contraste medido en pantalla.

**Los parciales de `notas.md` que quedaban**, cerrados en la misma pasada: el
umbral de baja se edita en pantalla (notas 3), la imputación contable existe
como campo (84), los reportes separan lo elaborado de lo bruto (4), el remito
dice si es entrega total o parcial y qué queda en acopio (76), el mostrador
tiene selector de tipo de operación (79), Caja lista lo emitido por cada caja y
operadora (81), y el catálogo tiene franja de marcas con su filtro (57).

**Dos de ellos quedaron a medias a propósito y están anotados como insumo
pendiente**: el plan de cuentas real para las imputaciones, y qué otros "tipos
de factura" quiere la clienta en el mostrador —la nota dice "etc etc etc" y los
tipos fiscales no se eligen a mano—.

Migraciones 0051 y 0052. Tests: 505.

---

## 8. Definición de "entregado" (por semana)

Para que el plazo de 5 días hábiles de 8.1 empiece a correr, cada viernes:

1. Deploy en la URL de preview, funcionando.
2. Mensaje escrito (email o WhatsApp) listando qué se entrega y qué probar.
3. Registro en `docs/ENTREGAS.md`: fecha, alcance, link, respuesta del cliente y fecha de
   aprobación (expresa o tácita).

---

## 9. Conexión con las máquinas de corte

> **Estado: pendiente de relevamiento (visita 21/08/2026).** El alcance y el momento en que
> entra al cronograma se definen con los datos de la visita. Se construye sobre la gestión
> de cortes de la Etapa 3, así que no bloquea nada de lo anterior.

### 9.1 Cómo se conecta esto en la práctica

Casi ninguna seccionadora acepta órdenes por API. El camino real es un paso intermedio:

```
Plataforma MJBJ  ──►  archivo de lista de piezas  ──►  software optimizador  ──►  máquina
   (la nube)          (CSV / XML / formato propio)      (Cut Rite, Corte Certo,      (patrón
                                                         Ardis, Optimik…)             de corte)
```

Y como la PC del taller normalmente no está expuesta a internet, hace falta una pieza más:
un **agente local** —un servicio chico corriendo en una PC de la red del taller— que
consulta la plataforma cada X segundos, baja los cortes pendientes, escribe el archivo en
la carpeta que el optimizador vigila, y opcionalmente devuelve el resultado (patrón
generado, consumo de placas, desperdicio, piezas producidas). Es exactamente la intuición
de "otra aplicación aparte": **sí, va aparte**, y es lo correcto — la nube nunca debería
depender de que la PC del taller esté prendida.

Tres niveles posibles, de menor a mayor esfuerzo:

| Nivel | Qué hace | Esfuerzo |
|---|---|---|
| **1. Exportación manual** | ✅ **Hecho.** El operador aprieta "Para la máquina" en la ficha del corte y baja el archivo. Lo copia a la PC de la seccionadora y lo importa. El formato se configura en pantalla —columnas, orden, separador, unidad, decimal, sí/no, fin de línea— con vista previa armada por el mismo motor que genera el archivo. | Bajo — días |
| **2. Agente local unidireccional** | ✅ **Hecho.** El agente (`agente-taller/`) pregunta cada tanto por los cortes en cola, baja el archivo de cada uno y lo deja en la carpeta que el optimizador vigila. El operador solo optimiza y corta. Se pudo construir sin el relevamiento porque **no sabe nada del formato**: pide el archivo ya armado con el perfil configurado en pantalla. Lo que falta saber es la carpeta que vigila el programa de ellos, que es una variable de entorno. | Medio — hecho |
| **3. Ciclo cerrado** | Además vuelve el consumo real: descuento automático de stock de placas, desperdicio medido, estado "cortado" en el pedido. | Alto — 4+ semanas, depende de qué reporte la máquina |

El nivel 3 es el que tiene valor de negocio de verdad (stock de placas que se descuenta
solo, desperdicio medible por trabajo), pero depende enteramente de qué exporte el
software de ellos. Por eso el relevamiento decide todo.

### 9.2 Relevamiento — para la visita

Lo que hay que traerse. Sin esto no se puede ni estimar.

**De la máquina**
- [ ] Marca, modelo y año. (Las habituales acá: Homag/Holzma, SCM/Gabbiani, Biesse/Selco,
      Giben, Casadei, y las importadas económicas)
- [ ] ¿Es seccionadora de placas, escuadradora, o también hay CNC/router?
- [ ] ¿Cuántas máquinas, y en qué sucursal está cada una? (¿Aserradero, Casa Central o las dos?)
- [ ] Foto de la chapa de identificación

**Del software — es lo más importante**
- [ ] Qué programa usan para optimizar: ¿Cut Rite? ¿Corte Certo? ¿Ardis? ¿Optimik?
      ¿CutMaster? ¿Uno propio de la máquina?
- [ ] Versión exacta
- [ ] Abrir el menú **Importar** y fotografiar qué extensiones acepta (.csv, .txt, .xml,
      .mdb, .ptx, .dxf…)
- [ ] Abrir el menú **Exportar / Informes** y fotografiar qué genera
- [ ] **Pedir copia en pendrive de un archivo de trabajo real y de una lista de piezas real.**
      Un ejemplo concreto vale más que cualquier manual
- [ ] ¿El software tiene manual? Pedirlo en PDF

**Del proceso actual**
- [ ] ¿Cómo cargan hoy las piezas? ¿Tipean a mano cada medida? ¿Importan de algún lado?
- [ ] ¿Cuántos trabajos de corte hacen por día? ¿Cuánto tarda la carga manual?
- [ ] ¿Imprimen etiquetas con código de barras por pieza? ¿Con qué impresora?
- [ ] ¿Cómo descuentan hoy el stock de placas consumidas?
- [ ] ¿Quién opera? ¿Una persona o varias? (por R9 — capacitación)

**De la infraestructura**
- [ ] Sistema operativo de la PC de la máquina (ojo: muchas siguen en Windows 7 o XP)
- [ ] ¿Está en red con las otras PC? ¿Tiene internet?
- [ ] ¿Hay carpeta compartida, o todo va por pendrive?
- [ ] ¿Se puede instalar software en esa PC, o el proveedor la tiene bloqueada?
- [ ] ¿Hay alguna PC de la red que quede prendida siempre? (candidata a hostear el agente)

**Comercial**
- [ ] ¿Hay contrato de soporte con el fabricante? ¿Se le puede preguntar por formatos de importación?
- [ ] ¿Qué esperan ganar con esto: ahorrar tiempo de tipeo, evitar errores de medida, o medir desperdicio?

### 9.3 Después de la visita

1. Con la lista de piezas de ejemplo en la mano, **ajustar el perfil de
   exportación en `/admin/cortes/formato`** —columnas, orden, separador,
   unidad— y probar importándolo en la máquina hasta que entre limpio. No hace
   falta tocar código: por eso se hizo configurable.
2. Poner `MJBJ_CARPETA` en el agente apuntando a la carpeta que el optimizador
   vigila, y dejarlo arrancando con la máquina. El nivel 2 ya está construido.
3. Elegir si se avanza al nivel 3 —el ciclo cerrado— y presupuestarlo aparte,
   que es lo único que depende de qué exporte el software de ellos.
4. Recién ahí ajustar los campos de `cutting_items` si hicieran falta más
   (material asociado a una variante de placa concreta, por ejemplo).

**Lo que ya está construido y no se tira al avanzar:** el nivel 3 —el ciclo
cerrado— reutiliza el archivo del nivel 1 y el agente del nivel 2 tal como
están. Lo único que le falta es el camino de vuelta: qué reporta la máquina
después de cortar, que es justamente lo que decide el relevamiento.

Del relevamiento **ya no depende que el agente exista**, solo dos valores de
configuración: la carpeta que vigila el optimizador y, si hiciera falta,
retocar el perfil de formato desde `/admin/cortes/formato`. Ninguno de los dos
requiere tocar código ni volver a desplegar.

Mientras tanto, la Etapa 3 sigue como está: la cola de trabajo administrativa se construye
igual y es la base sobre la que después se apoya la integración.

---

## Fuentes

- [ARCA — WSAA, documentación oficial](https://www.afip.gob.ar/ws/documentacion/wsaa.asp)
- [ARCA — Webservices de factura electrónica](https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp)
- [AfipSDK — afip.js](https://github.com/AfipSDK/afip.js/)
- [@ramiidv/arca-facturacion](https://github.com/ramiidv/arca-facturacion)
- [Neon — planes y límites](https://neon.com/docs/introduction/plans)
- [Neon — NextAuth vs Neon Auth vs Better Auth](https://neon.com/guides/nextauth-neon-auth-better-auth-postgres)
- [Neon — Managed Better Auth con Next.js](https://neon.com/guides/neon-auth-nextjs)
- [Quality Soft Argentina — el sistema del que se migra](https://www.qualitysoftargentina.com/)
- [ISIS ERP Manager — manual de usuario](https://erp.sistemaisis.com/manual-de-usuario/)
- [ISIS ERP Manager — grillas: exportar a Excel](https://erp.sistemaisis.com/manual-de-usuario/generalidades/)
