---
titulo: Clientes y cuenta corriente
resumen: La ficha del cliente, el saldo, el límite de crédito y cómo se une con su cuenta del sitio.
orden: 2
---

## La ficha

En *Clientes* cada persona o empresa es una tarjeta con su saldo a la vista. La
ficha guarda tres grupos de datos:

- **Quién es** — nombre, empresa, **a qué se dedica** y quién lo atiende.
- **Cómo se factura** — CUIT y condición frente al IVA. Cárguelos al dar de
  alta: sin eso, a la hora de facturar hay que frenar y pedirlos.
- **Cómo compra** — lista de precios y límite de cuenta corriente.

### A qué se dedica

La lista de clientes se corta por **rubro** —arquitectura, carpintería,
cementista, constructora, Moldava, wood frame…— y no por «tipo de cliente». Es lo
que permite ver cómo viene cada gremio, que es la pregunta que se hace mirando la
cartera; «particular» no es un rubro, es no tener ninguno.

Elegir un rubro del gremio propone marcar **cuenta profesional**, que es lo que
decide qué precio paga y si tiene cuenta corriente. Se puede desmarcar: hay
carpinteros que compran una vez por año y pagan como cualquiera.

### La lista de precios

Si no elige ninguna, el cliente paga la lista general. Elegir una lista distinta
—la de profesionales, por ejemplo— cambia los precios que ve **en todo el
sistema**: en el presupuesto, en el pedido y en el sitio si tiene cuenta web.

### El límite de cuenta corriente

Es cuánta deuda puede tener antes de que el sistema deje de aceptarle compras a
cuenta. **En cero significa que no opera a cuenta**: paga siempre al contado.
Este número lo fija administración y queda registrado quién lo puso.

### Cuándo se le corta la cuenta

El sistema frena una venta a cuenta corriente por tres motivos, y los tres se
verifican **en la tienda, en el mostrador y al cobrar una factura**:

1. **No tiene cuenta habilitada** (el límite está en cero).
2. **La ficha está marcada como morosa.** Es el interruptor manual de
   administración.
3. **Tiene deuda vencida.** El plazo lo fija cada ficha —«paga a 30 días», «paga
   a 60»— y lo que pase de ahí frena la venta. Antes eran 30 días para toda la
   cartera, y la constructora a la que se le dan 60 aparecía siempre en falta.
4. **Alguien le bloqueó la cuenta corriente.** Es el corte que administración
   hacía en papel: se aprieta en la ficha, con el motivo escrito, y **el mostrador
   no lo puede saltear** —a diferencia de los otros tres—. Se levanta desde la
   misma ficha.

En el mostrador el aviso trae un botón **«Cobrar igual, bajo mi
responsabilidad»**: hay un cliente parado del otro lado y la decisión es del
negocio. Lo que el sistema garantiza es que nadie lo haga sin enterarse; queda
en la bitácora.

Al cobrar una factura desde Facturación **no hay ese botón**: ahí hay tiempo de
resolverlo —cobrar de otra forma o ampliarle el límite desde la ficha—.

Una venta que se hizo **sin conexión** entra igual cuando la caja recupera
internet, aunque el cliente esté pasado. La plata ya está en el cajón y la
mercadería salió: rechazarla no la deshace, solo la dejaría sin registrar.

## A quién llamar primero

La lista de clientes arranca con **los que deben, del más atrasado al menos**. No
ordena por saldo, y es a propósito: deber dos millones comprados ayer no es un
problema; deber trescientos mil de hace cuatro meses sí, y por saldo ese queda
abajo de todo.

Cada tarjeta dice cuánto está vencido y hace cuántos días pasó del plazo **de ese
cliente**. Arriba de todo van las cuentas bloqueadas.

## El seguimiento

*Clientes → Seguimiento* es el pizarrón de las gestiones: «cobrar la factura
1234», «contestar el presupuesto de la obra de Alem». Cada una tiene su etapa
—para hacer, hablando, prometió, cerrado—, lo que se fue hablando y, sobre todo,
**cuándo hay que volver**.

Lo que se vence aparece solo en el «Para hoy» del panel. Una gestión sin fecha
queda en el tablero, pero no avisa: es una anotación, no un recordatorio.

Las notas **se suman, no se pisan**: «no atiende», «dijo que paga el viernes»,
«pagó la mitad». Es la conversación completa, que es lo que sirve cuando la
retoma otra persona.

## La cuenta corriente

La solapa de cuenta corriente muestra el saldo movimiento por movimiento, con el
corrido a la derecha. Se puede **imprimir** o **bajar en PDF** —para adjuntarlo a
un correo o mandarlo por WhatsApp cuando se reclama—. Los tipos de movimiento son:

| Tipo | Efecto |
|---|---|
| Compra | Suma deuda |
| Pago | Resta deuda |
| Nota de crédito | Resta deuda |
| Nota de débito | Suma deuda |
| Ajuste | Corrige una diferencia |

**El signo lo pone el tipo, no usted.** Cargue siempre el importe en positivo y
elija el tipo: un pago de $50.000 se carga como "Pago" y "50000", no como
"-50000". Dejar que se escriba el signo a mano es la forma más rápida de que una
cuenta termine al revés.

## La cuenta del sitio

Un cliente puede tener dos cosas distintas:

- **La ficha del mostrador**, que es esta, con su historial y su saldo.
- **Una cuenta web**, que se creó solo desde el sitio.

El sistema **no las une automáticamente**, ni siquiera cuando el correo
coincide. El registro del sitio no verifica el mail, así que unirlas solas
permitiría que alguien se registre con la dirección de un tercero y le quede a
la vista la cuenta corriente ajena.

Cuando aparece una cuenta web que parece ser de un cliente ya fichado, el panel
lo avisa en su ficha. **La unión la hace usted**, con el botón *Vincular*, y
solo cuando está seguro de que es la misma persona: al unirlas se mudan pedidos,
presupuestos, movimientos y direcciones de una ficha a la otra.

Es la acción más delicada del panel. Queda registrada en la bitácora con su
nombre.


## La ficha del cliente, con el cliente al teléfono

Es la pantalla que más se abre y la que contesta casi todo sin colgar:

- **Sus pedidos y presupuestos** están abajo, y **cada uno se abre con un
  clic**. No hace falta anotar el número e ir a buscarlo a *Pedidos*.
- **Los movimientos de cuenta** muestran de qué comprobante salió cada uno, y
  los que vienen de un pedido llevan a ese pedido: es la respuesta a «¿de dónde
  salió este cargo?».
- El **vendedor asignado** lleva a la lista de vendedores.
- El botón de **WhatsApp** abre la conversación con esa persona.

Si el cliente da un número de pedido o de comprobante por teléfono, más rápido
todavía: **Ctrl+K** y pegarlo.
