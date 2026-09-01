---
titulo: Vender, del presupuesto a la entrega
resumen: El recorrido completo de una venta y qué pasa en el sistema en cada paso.
orden: 1
---

## El recorrido

Una venta pasa por tres pantallas y en ese orden:

**Presupuesto → Pedido → Entrega**

No hace falta empezar por el presupuesto. Una venta de mostrador puede nacer
directamente como pedido. Pero cuando hay presupuesto conviene usarlo: al
convertirlo en pedido, el sistema copia los precios **que el cliente aceptó**,
aunque la lista haya subido en el medio.

## Presupuestos

En *Presupuestos* están agrupados por lo que está esperando respuesta, que es lo
único que hay que mirar todos los días. Un presupuesto puede estar:

| Estado | Qué significa |
|---|---|
| Pendiente | Se cargó y todavía no salió |
| En revisión | Alguien lo está armando o corrigiendo |
| Enviado | El cliente lo tiene |
| Aceptado | Listo para convertir en pedido |
| Rechazado | No va |
| Vencido | Pasó el plazo sin respuesta |

Los presupuestos que el cliente pide desde el sitio caen acá solos.

### Convertirlo en pedido

Desde la ficha del presupuesto aceptado, botón **Convertir en pedido**. Eso hace
tres cosas a la vez:

1. Crea el pedido con las mismas líneas y los mismos precios.
2. **Reserva la mercadería.** Desde ese momento deja de estar disponible para
   otro, aunque siga en el galpón.
3. Deja el presupuesto marcado como aceptado.

Un presupuesto se convierte **una sola vez**. Si intenta de nuevo, el sistema le
dice cuál es el pedido que ya se creó.

## Pedidos

El tablero de *Pedidos* está por etapa, como un pizarrón: cada columna es un
estado y las tarjetas se mueven de izquierda a derecha.

**Pendiente → Preparando → Listo → En camino → Entregado**

Un pedido con retiro por sucursal saltea *En camino*: pasa de *Listo* a
*Entregado* cuando la persona lo busca.

El recorrido es de una sola dirección: **un pedido no vuelve para atrás**. Si se
avanzó de más, hay que cancelar y rehacer. Es a propósito: retroceder en
silencio esconde los errores en vez de mostrarlos.

Cada vez que un pedido avanza, al cliente le llega el aviso por correo y por
WhatsApp, si tiene el dato cargado.

### Cancelar

Cancelar pide un motivo y **libera la mercadería reservada**, que vuelve a estar
disponible para vender. El stock físico no se toca: nunca salió del galpón.

## Cobrar

En la ficha del pedido, **Marcar como cobrado**. Si el pedido era a cuenta
corriente, esa misma acción le baja la deuda al cliente. Es una sola operación y
no dos: cobrar en un lado y no en el otro es exactamente como se desincroniza
una cuenta.

## Errores que conviene evitar

- **Cargar el pedido y facturar aparte, a mano.** Facture desde el pedido: el
  comprobante sale con las líneas y los importes ya cargados.
- **Avanzar el pedido a "Listo" antes de que esté armado.** El cliente recibe el
  aviso y se presenta.
- **Cancelar para corregir una cantidad.** Se edita el pedido; cancelar es para
  las ventas que no van.
