# Bitácora de cambios de alcance

> Mitigación del riesgo R8 del plan. La cláusula 8.4 admite "ajustes menores"
> sin cargo; la 8.5 deja afuera todo lo demás. La diferencia entre las dos se
> discute **en el momento del pedido**, no al final del proyecto, y para eso
> hace falta que cada pedido esté anotado con su fecha y su respuesta.

## Cómo se usa

Una fila por pedido que no estaba en la cláusula primera. Tres decisiones
posibles:

- **Incluido (8.4)**: entra sin cargo. Se anota igual, porque el volumen de
  "ajustes menores" es lo que después justifica una conversación.
- **Fuera de alcance (8.5)**: se rechaza o se presupuesta aparte. **La respuesta
  se manda por escrito el mismo día**; dejarla para después equivale a haberlo
  aceptado.
- **Trabajo nuevo asumido**: se hace sin cargo por decisión del PRESTADOR. Se
  anota para que quede claro que fue una decisión y no una obligación.

## Registro

| Fecha | Quién pidió | Qué pidió | Decisión | Respuesta enviada |
|---|---|---|---|---|
| 22/08/2026 | PRESTADOR | Bandeja de WhatsApp con puesto de atención y avisos automáticos | Trabajo nuevo asumido | — |
| 26/08/2026 | PRESTADOR | Acopio con remitos, firma digital desde el celular y descuento de stock por venta | Trabajo nuevo asumido | — |
| 29/08/2026 | PRESTADOR | Bitácora de acciones del panel (`audit_log`), con pantalla de consulta y campana de actividad | Trabajo nuevo asumido | — |
| 29/08/2026 | PRESTADOR | Exportación de la lista de piezas para el optimizador de la seccionadora, con formato configurable | Trabajo nuevo asumido | — |
| 31/08/2026 | PRESTADOR | Rediseño completo de la interfaz según el paquete de diseño: tokens, tienda, contenido público, panel y portal del cliente | Trabajo nuevo asumido | — |
| 31/08/2026 | PRESTADOR | Puesto del aserradero (`/taller`), rol propio y menú del panel acotado por rol | Trabajo nuevo asumido | — |
| 31/08/2026 | PRESTADOR | Agente local que deja los archivos de corte en la carpeta del optimizador (nivel 2 de 9.1) | Trabajo nuevo asumido | — |
| 05/09/2026 | CLIENTE (brief) | Descuento por pagar de contado o por transferencia, con escala por monto | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Cobro del corte de placas, por pasada y por material, con precio mayorista propio | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Precios sin IVA para el gremio, y aviso al mayorista de que entre con su usuario | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Moldava como sección destacada propia | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Migrar además proveedores, histórico de ventas y comprobantes emitidos | **Fuera de 1.9** — la cláusula lista productos, stock, clientes y precios. Se hizo igual | — |
| 05/09/2026 | PRESTADOR | Lectura de planillas .xlsx en la migración y en la importación semanal de precios | Trabajo nuevo asumido | — |
| 05/09/2026 | PRESTADOR | Bloqueo de cuenta corriente por límite y por deuda vencida en mostrador y facturación | Trabajo nuevo asumido | — |
| 05/09/2026 | PRESTADOR | Pantalla de zonas de envío, que existían en el modelo y no se podían editar | Trabajo nuevo asumido | — |
| 05/09/2026 | PRESTADOR | Pantallas para editar las tarifas de corte y los descuentos por forma de pago | Trabajo nuevo asumido | — |
| 05/09/2026 | PRESTADOR | Página de cambios y devoluciones: el sitio no tenía ninguna página legal | Trabajo nuevo asumido | — |
| 05/09/2026 | CLIENTE (brief) | La calculadora sugiere productos del catálogo, con precio y stock | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Lista de precios descargable en PDF, con la lista de cada profesional | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Motivos de cotización especial en el pedido de presupuesto | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Terminación y tipo/calidad como atributos de variante | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Documento obligatorio de quien retira, en el remito de acopio | Incluido (8.4) | — |
| 05/09/2026 | PRESTADOR | Avisos y promociones: banners con vigencia en franja, portada y catálogo, con carrusel | Trabajo nuevo asumido | — |
| 05/09/2026 | PRESTADOR | El catálogo dejó de sentirse otro sitio: misma franja de beneficios y barra de categorías que la portada | Trabajo nuevo asumido | — |
| 07/09/2026 | PRESTADOR | Datos de demostración para la visita: cajas del mostrador, eventos, documentación técnica, remitos, solicitudes de profesionales, escalas por volumen, sugeridos, órdenes de compra y gastos (`db:seed-demo`) | Trabajo nuevo asumido | — |
| 07/09/2026 | PRESTADOR | Guía de capacitación por puesto y consola de la demostración, las dos en HTML (`docs/capacitacion.html`, `docs/mapa-demo.html`) | Trabajo nuevo asumido | — |

## Insumos pendientes del cliente

Lo que está trabado esperando algo del cliente. Cada ítem que frene el trabajo
se notifica por escrito invocando la cláusula 5.3.

| Insumo | Bloquea | Pedido el | Estado |
|---|---|---|---|
| Certificado digital ARCA (homologación y producción) | Que los comprobantes tengan valor fiscal | — | Pendiente |
| Punto de venta habilitado en modalidad *Webservices* | Lo mismo | — | Pendiente |
| Credenciales de Mercado Pago (producción y prueba) | Que los cobros online sean reales | — | Pendiente |
| Cuenta bancaria, CBU y alias | Pagos por transferencia | — | Pendiente |
| Alta del número en WhatsApp Business API | Que los avisos salgan de verdad | — | Pendiente |
| Casilla de correo y dominio verificado para el remitente | Que los avisos por correo salgan de verdad | — | Pendiente |
| Exportaciones del sistema anterior en CSV | Usar la migración de datos (1.9), que ya está construida | — | Pendiente |
| Fotos de productos y lista de precios vigente | Reemplazar los datos de desarrollo | — | Pendiente |
| Fotos reales de las dos sucursales | Hoy la página muestra una placa de marca en vez de una foto ajena | — | Pendiente |
| **Los hitos de la trayectoria** | El brief pedía el cuadro «año / qué pasó» y volvió con una sola fila —1981— y la columna del hecho vacía. Los cinco hitos intermedios que traía el prototipo se sacaron: no se inventa la historia de otro. `/nosotros` muestra hoy solo 1981 y 2026 | 05/09/2026 | Pendiente |
| **Último número emitido en los puntos de venta 15, 17 y 20** | **Bloquea emitir el primer comprobante.** La plataforma numera desde `puntos_venta.numeroInicial`; en cero arranca en 1 y pisa una serie que ARCA viene contando hace años. Un salto de numeración fiscal no se corrige después. Se carga en `/admin/arca` | 05/09/2026 | Pendiente |
| **Desde qué monto aplica el −15 %** por volumen | El brief dice «si son compras de mayor volumen se hace un -15%» sin decir desde cuánto. Está cargado el −10 % de contado y transferencia; el escalón del 15 % entra como una fila más en `payment_discounts` | 05/09/2026 | Pendiente |
| **Alícuota de percepción de Ingresos Brutos** | Quedó en cero y `percibeIibb` apagado: percibir de más es plata que después hay que devolverle a cada cliente. La confirma el contador (Nigro) | 05/09/2026 | Pendiente |
| **Texto del testimonio de Ezequiel** (Wood Framer) | El brief da el contacto —223 528-7248— pero no el texto. **Los cuatro testimonios del prototipo ya se ocultaron**: eran personas inventadas con nombre, cargo y frase entre comillas, y publicar una recomendación firmada por alguien que no existe no es un dato provisorio, es una afirmación falsa. La sección de la portada no se muestra hasta que haya uno real | 05/09/2026 | Pendiente |
| **Los seis artículos del blog** | Están publicados con el autor «Maderera Juan B. Justo» y los escribió el prototipo, no el cliente. El brief dice que quién escribe los textos está «a definir» y propone otros cinco temas (Wood Frame, mobiliario, construcción eficiente, pymes, el poder del servicio). **No se tocaron**: bajarlos dejaría el blog vacío y esa es una decisión comercial. Se despublican desde Contenido cambiando el estado a borrador | 05/09/2026 | Pendiente |
| **Revisión del texto de cambios y devoluciones** | La página nueva dice lo que el brief describe —se mira caso por caso y se resuelve por WhatsApp— en vez de inventar un plazo fijo. El propio cliente escribió «aceptamos sugerencias»: conviene que lo lea antes del lanzamiento | 05/09/2026 | Pendiente |
| **Definición del correo: `mjbj.ar` o `mjbj.com.ar`** | El dominio del plan es `.ar` y los correos del brief son `.com.ar`; la propia clienta escribió «capaz que tema de mail deberíamos reveerlo». Define el remitente verificado de los avisos y el marcado de Google | 05/09/2026 | Pendiente |
| **Desperdicio aceptable por material** en placas | El brief dice «depende del material» sin dar los porcentajes. La calculadora ya descuenta los 5 mm de sierra por pasada, que sí los dio, y aplica un único margen de seguridad del 12 % sobre eso | 05/09/2026 | Pendiente |
| **Pendiente de techo y solape de membrana** | El brief preguntaba por el solape y no lo contestó. Se aplica el 10 cm que trae impreso el rollo —que es especificación del material, no un supuesto— y una pendiente del 15 % heredada del prototipo | 05/09/2026 | Pendiente |
| **¿La calculadora vuelve al menú?** | Salió del menú por pedido del cliente, pero el brief contestó en detalle las cuatro fórmulas y trata la herramienta como viva. Las fórmulas ya se corrigieron; volver a enlazarla es una decisión suya y no se revirtió sola | 05/09/2026 | Pendiente |
| Acceso al dominio `mjbj.ar` | Publicación (1.8) | — | Pendiente |
| Relevamiento del taller: qué programa optimiza el corte, su versión, y **un archivo de trabajo real** | Ajustar el formato de exportación a la máquina. El mecanismo ya está hecho y se configura en pantalla; sin el archivo no se sabe a qué apuntarle | — | Pendiente |
| Ruta de la carpeta que vigila el optimizador, y si esa PC puede salir a internet | Poner en marcha el agente del taller, que ya está construido. Es una variable de entorno, no código | — | Pendiente |
| Escalas de descuento por volumen para la lista profesional | El banner de profesionales de la portada muestra las escalas leyéndolas de la base. Sin ninguna cargada, sale sin la lista en vez de inventar números. Se cargan desde `/admin/profesionales` | — | Pendiente |

## Tres agujeros de acceso, cerrados el 7/9/2026

Aparecieron preparando la demostración, entrando a producción con un usuario de
cada rol y tecleando las direcciones a mano. Los tres son de la misma familia
que el que se cerró el 1/9: **una regla escrita en dos lugares, y uno de los dos
quedó atrás.**

| Qué abría de más | Quién | Por qué |
|---|---|---|
| `/atencion`, la bandeja de WhatsApp a pantalla completa, con las conversaciones de los clientes y su saldo al costado | Depósito y aserradero | Vive fuera de `/admin`, así que el layout del panel no la cubría, y la página solo pedía ser personal. `/admin/whatsapp`, que es la misma bandeja, sí rebotaba |
| `GET /api/mostrador/clientes` y `/catalogo`: el padrón entero con CUIT, domicilio y límite de crédito, y las dos listas de precios | Depósito y aserradero | La página `/mostrador` los rebotaba bien, pero la guardia de sus endpoints aceptaba cualquier rol de staff |
| `/admin/cortes/tarifas`, el precio por pasada del corte | Aserradero | La excepción que le abre `/admin/cortes` era un `else if` y esa rama no consultaba `ACCESO` en absoluto |

**Cómo quedaron.** Las tres rutas se declaran ahora en `ACCESO` —`/atencion`,
`/taller` y `/admin/cortes`— y la página y la API preguntan ahí en vez de
escribir el par cada una por su lado. La excepción del aserradero acota y no
habilita: lo saca de todo lo que no cuelga de `/admin/cortes`, y después decide
la lista igual que para los demás. Hay tests nuevos en `tests/acceso.test.ts`.

**La lección, otra vez la misma:** una ruta que vive fuera de `/admin` no está
cubierta por el layout que aplica la lista, así que hay que declararla igual. Es
lo que dice el comentario de `lib/roles.ts` y lo que las tres se saltearon.

## Un defecto de la firma del remito, corregido el 7/9/2026

Cargar un remito de retiro obliga a poner el documento de quien retira —"la
firma sola no identifica a nadie"—, pero la pantalla de firma lo pedía como
opcional, con el campo vacío, y guardaba lo que llegara. **Firmar sin
completarlo borraba el dato justo cuando el remito pasaba a ser la constancia.**
Ahora la pizarra propone el documento ya cargado y la firma sin documento no
pisa el guardado.

### Qué pedir exactamente para la migración

El sistema anterior es **ISIS ERP Manager** (Quality Soft Argentina), sobre SQL
Server. Soporte: Acosta Pablo, 223 541-1225. No tiene una exportación única:
**cada listado exporta su propia grilla a Excel**. Así que no hay que pedir "un
dump", hay que pedir **siete archivos**, y cada uno se sube por separado en
`/admin/migracion`:

| Archivo | De qué listado sale | Qué columnas conviene que tenga |
|---|---|---|
| Clientes | Listado de clientes | Código, razón social, CUIT, condición IVA, correo, teléfono, domicilio, límite de crédito |
| Artículos | Listado de artículos con precios | Código, descripción, rubro, medida, unidad, precio de lista, precio profesional |
| Existencias | Informe de stock por depósito | Código, depósito, existencia, stock mínimo |
| Cuentas corrientes | Resumen de saldos al día del corte | Código de cliente, nombre, saldo |
| Proveedores | Listado de proveedores | Código, razón social, CUIT, condición IVA, correo, teléfono, domicilio, saldo |
| Histórico de ventas | Listado de ventas del período | Número de comprobante, fecha, código de cliente, total, detalle, sucursal, vendedor |
| Comprobantes emitidos | Listado de comprobantes | Punto de venta, tipo, número, fecha, cliente, CUIT, neto, IVA, total, CAE |

Cuatro precisiones que evitan una vuelta entera:

- **El .xlsx se lee directamente.** Ya no hace falta pasarlo a CSV: se sube tal
  como lo exporta el sistema. El CSV también sirve.
- **Los nombres de las columnas no importan**: el asistente pregunta cuál es
  cuál. Lo que importa es que **estén** las de la tabla, sobre todo el **código
  de cliente**, que es lo que ata cada saldo, cada venta y cada comprobante a su
  ficha, y lo que permite volver a correr la migración sin duplicar la cartera.
- **El orden importa**: clientes antes que saldos, antes que el histórico y los
  comprobantes; artículos antes que existencias.
- **El histórico va por año.** El tope por archivo es de 100.000 filas y 8 MB;
  con 300 a 700 pedidos por mes, un archivo por año entra cómodo y, si algo
  sale mal, se vuelve a subir solo ese año.

**El histórico de ventas y los comprobantes emitidos van a un archivo aparte,
de solo lectura.** No entran a `orders` ni a `invoices`, y es deliberado: un
pedido viejo cargado como pedido dispararía reservas de stock por mercadería
entregada hace años, y un comprobante viejo contaminaría el correlativo de los
comprobantes nuevos. Se migran para poder consultarlos, que es la pregunta real
—"¿qué le vendimos a este cliente en 2019?"—.

### Qué pedir exactamente para el corte

La seccionadora no corta desde la plataforma: corta desde el programa que vino
con la máquina, que es el que arma el patrón. Lo que la plataforma le entrega es
la **lista de piezas**, para no volver a tipear medidas que ya están cargadas.

Ese archivo ya se genera y su formato se configura en `/admin/cortes/formato`.
Lo que falta para dejarlo fino es una visita corta al taller con esta lista:

- **Qué programa usan para optimizar y qué versión.** Las habituales acá: Cut
  Rite (Homag/Holzma), Ardis, Corte Certo, Optimik, o el propio de la máquina.
- **Foto del menú «Importar»**, para ver qué extensiones acepta.
- **Un archivo de trabajo real y una lista de piezas real, en un pendrive.** Es
  lo que más vale: un ejemplo concreto define el formato mejor que cualquier
  manual.
- **Si la PC de la máquina está en red o si todo va por pendrive.** Decide si
  más adelante conviene un agente local que deje el archivo solo en la carpeta,
  en vez de copiarlo a mano.

El cuestionario completo —máquina, software, proceso e infraestructura— está en
`PLAN.md`, sección 9.2.
