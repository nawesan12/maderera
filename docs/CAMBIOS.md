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
| Confirmación de la historia de la empresa | La trayectoria de `/nosotros` viene del prototipo y no está verificada: el hito de 2010 mencionaba una sucursal en Av. Constitución que no es ninguna de las dos que operan. Ese se sacó; los demás siguen sin confirmar | — | Pendiente |
| Acceso al dominio `mjbj.ar` | Publicación (1.8) | — | Pendiente |
| Relevamiento del taller: qué programa optimiza el corte, su versión, y **un archivo de trabajo real** | Ajustar el formato de exportación a la máquina. El mecanismo ya está hecho y se configura en pantalla; sin el archivo no se sabe a qué apuntarle | — | Pendiente |
| Ruta de la carpeta que vigila el optimizador, y si esa PC puede salir a internet | Poner en marcha el agente del taller, que ya está construido. Es una variable de entorno, no código | — | Pendiente |
| Escalas de descuento por volumen para la lista profesional | El banner de profesionales de la portada muestra las escalas leyéndolas de la base. Sin ninguna cargada, sale sin la lista en vez de inventar números. Se cargan desde `/admin/profesionales` | — | Pendiente |

### Qué pedir exactamente para la migración

El sistema anterior es **ISIS ERP Manager** (Quality Soft Argentina), sobre SQL
Server. No tiene una exportación única: **cada listado exporta su propia grilla
a Excel**. Así que no hay que pedir "un dump", hay que pedir cuatro archivos, y
cada uno se sube por separado en `/admin/migracion`:

| Archivo | De qué listado sale | Qué columnas conviene que tenga |
|---|---|---|
| Clientes | Listado de clientes | Código, razón social, CUIT, condición IVA, correo, teléfono, domicilio, límite de crédito |
| Artículos | Listado de artículos con precios | Código, descripción, rubro, medida, unidad, precio de lista, precio profesional |
| Existencias | Informe de stock por depósito | Código, depósito, existencia, stock mínimo |
| Cuentas corrientes | Resumen de saldos al día del corte | Código de cliente, nombre, saldo |

Tres precisiones que evitan una vuelta entera:

- **Guardados como CSV, no como .xlsx.** En Excel: «Guardar como» → «CSV UTF-8».
  Si llega un .xlsx, la pantalla lo detecta y lo dice, pero es un viaje perdido.
- **Los nombres de las columnas no importan**: el asistente pregunta cuál es
  cuál. Lo que importa es que **estén** las de la tabla, sobre todo el **código
  de cliente**, que es lo que ata cada saldo a su ficha y lo que permite volver
  a correr la migración sin duplicar la cartera.
- **El orden importa**: clientes antes que saldos, artículos antes que
  existencias.

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
