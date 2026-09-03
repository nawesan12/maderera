# Bitácora de entregas

> Lo pide el propio plan (§8) y lo exige el contrato: el plazo de aprobación de
> la cláusula 8.1 —cinco días hábiles, con silencio equivalente a aprobación
> tácita— **solo empieza a correr desde una entrega con constancia de fecha**.
> Sin este registro no hay forma de demostrar cuándo se entregó cada cosa.

Cada viernes, por cada entrega semanal:

1. Deploy en la URL de preview, funcionando.
2. Mensaje escrito (correo o WhatsApp) listando qué se entrega y qué probar.
3. Una fila acá.

## Registro

| # | Fecha de envío | Alcance | Link | Respuesta del cliente | Aprobación |
|---|---|---|---|---|---|
| — | — | *Sin entregas formales todavía: el trabajo hecho hasta hoy se adelantó a la firma.* | — | — | — |
| — | *(pendiente de envío)* | Publicación en Vercel con base Neon y datos de demostración. Sitio público servido desde el CDN. Reportes de ventas exportables, resumen de cuenta corriente con antigüedad de deuda, cierre Z por medio de pago. Alta de presupuestos y de órdenes de corte desde el panel. Asistente en el sitio. | https://mjbj.vercel.app | — | — |

> La fila de arriba **todavía no es una entrega**: falta el mensaje al cliente,
> que es lo que hace correr el plazo de la cláusula 8.1. Se completa la fecha
> cuando se manda.

## Publicación de demostración — 3/9/2026

Lo que quedó andando en `https://mjbj.vercel.app`, con el detalle de lo que se
puede mostrar y lo que conviene aclarar de entrada.

**Infraestructura.** Neon (Postgres) del marketplace de Vercel, con el esquema
migrado y los datos de demostración cargados: catálogo, ventas, contenido y
conversaciones. Vercel Blob para las subidas. `SEO_INDEXAR=no`, así que
`robots.txt` bloquea a los buscadores mientras sea una demostración.

**Accesos.** `admin@mjbj.com.ar`, `vendedor@`, `deposito@` y `taller@`, todos
con clave `Demo1234`. Del lado del cliente, `roberto@rfconstrucciones.com.ar`
con la misma clave: es un cliente profesional, sirve para mostrar la lista de
precios diferenciada y la cuenta corriente con saldo.

**Los cuatro proveedores externos siguen en modo demostración** —ARCA, Mercado
Pago, WhatsApp y correo— porque faltan las credenciales que tramita el cliente.
El código de demostración recorre el mismo camino que el real y cada pantalla lo
avisa. Está listado en `CAMBIOS.md`.

**Lo que no está construido**, para decirlo de frente si se pregunta: compras y
proveedores, costos y márgenes, libro IVA compras, retenciones, y el punto de
venta funcionando sin internet. Nada de eso estaba en el contrato.

## Cómo se completa

- **Fecha de envío**: la del mensaje, no la del deploy. Es la que hace correr el plazo.
- **Alcance**: en una línea, en el idioma del cliente. "Pagos online y remitos
  con firma digital", no "pasada 7".
- **Respuesta**: qué contestó y cuándo. Si no contestó, se deja en blanco.
- **Aprobación**: la fecha en que quedó aprobada. Si fue por silencio, escribir
  "tácita (8.1)" con la fecha del quinto día hábil.

Toda demora del cliente que frene el trabajo se registra además en
`CAMBIOS.md`, invocando la cláusula 5.3 por escrito **en el momento**. Sin ese
registro, la demora se computa como propia.
