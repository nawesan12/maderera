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
| Acceso al dominio `mjbj.ar` | Publicación (1.8) | — | Pendiente |

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
