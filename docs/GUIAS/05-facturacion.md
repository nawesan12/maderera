---
titulo: Facturación y ARCA
resumen: Emitir, autorizar, cobrar y anular un comprobante, y qué significa cada estado.
orden: 5
---

## Qué comprobante sale

El tipo lo decide la condición frente al IVA **del cliente**, no usted:

| El cliente es | Sale |
|---|---|
| Responsable inscripto | Factura A |
| Monotributista, exento o consumidor final | Factura B |

Por eso importa cargar la condición en la ficha del cliente: sin ese dato hay
que frenar la facturación para pedirlo.

## Emitir

Hay dos caminos:

- **Desde el pedido** — botón *Facturar*. Trae las líneas, las cantidades y los
  importes ya cargados. Es el camino normal.
- **A mano** — para la venta de mostrador que no pasó por un pedido. Se cargan
  las líneas una por una.

Los precios del catálogo son finales; el sistema desagrega el IVA al armar el
comprobante.

## Los estados

| Estado | Qué significa |
|---|---|
| Borrador | Se armó y todavía no se mandó a ARCA |
| Autorizada | ARCA le dio el CAE. Es el comprobante válido |
| Rechazada | ARCA no la aceptó. El motivo está en la ficha |
| Anulada | Se dio de baja con una nota de crédito |

Un comprobante **autorizado no se edita ni se borra**. Si está mal, se anula.

## La numeración no tiene huecos

ARCA exige que los comprobantes de un punto de venta vayan uno atrás del otro,
sin saltos. El sistema se ocupa de eso solo. Es la razón por la que un
comprobante mal emitido se anula con nota de crédito en vez de borrarse: borrar
dejaría un hueco en la numeración.

## Anular

Anular emite una **nota de crédito** por el total, que es la forma correcta de
dar de baja una factura ya autorizada. Pide un motivo y solo lo puede hacer
administración. Queda en la bitácora.

## Cobrar

Un comprobante se puede cobrar **en varias veces y con distintos medios**, que
es como se cobra de verdad en el mostrador. Cada cobro se carga con su importe,
su medio y su referencia. La ficha muestra cuánto falta.

## Imprimir

El comprobante se imprime con el **código QR** que exige ARCA. Sale también por
correo al cliente, automáticamente, apenas queda emitido.

## Si ARCA no contesta

Pasa. El comprobante queda en borrador y se puede reintentar la autorización
desde su ficha con el botón *Autorizar*. Los intentos, con su respuesta, quedan
registrados: si después hay que reclamar, está la constancia.
