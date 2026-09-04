---
titulo: Compras y proveedores
resumen: Pedir, recibir, cargar la factura y pagar: el costo, el crédito fiscal y las retenciones.
orden: 11
---

Todo lo de compras vive en el menú **Compras**. El orden en que se usa es casi
siempre el mismo: se le pide algo a un proveedor, llega el camión, después llega
la factura, y en algún momento se le paga.

Ninguno de esos cuatro pasos es obligatorio para el siguiente. La mitad de las
entregas de una maderera se piden por teléfono y llegan sin orden; una factura
puede cubrir tres remitos. El sistema no obliga a inventar papeles que no
existen.

## Proveedores

La ficha es la de siempre —nombre, CUIT, con quién se habla— más tres cosas que
solo sirven acá: **días de pago**, **CBU** y **alias**. Conviene cargar los datos
bancarios al dar de alta, cuando se tiene el mail del proveedor abierto: pedirlos
en el momento de pagar es garantizar que se escriban a las apuradas.

Abajo de la ficha está la cuenta corriente. **Positivo significa que le
debemos**, al revés que en clientes. El monto se carga siempre en positivo y el
signo lo pone el tipo de movimiento.

## Órdenes de compra

Contestan la pregunta que antes se contestaba de memoria: **¿ya pedimos esto?**
Sin eso, el encargado que ve tres placas en el estante pide de nuevo lo que ya
viene en camino.

Una orden nace en borrador y **no cuenta como "en camino" hasta que se marca como
enviada**. Cuando llega el camión, el botón *Recibir el remito* arma la recepción
con lo que falta ya cargado: hay que confirmar cantidades, no volver a buscar
cada producto. Si vino de menos, se corrige y la orden queda como parcial sola.

La fecha prometida se marca en rojo cuando vence con la orden todavía abierta.
Es el motivo por el que alguien levanta el teléfono.

## Recepciones

Es lo que hace entrar la mercadería al depósito **y** mueve el costo. Son dos
cosas distintas que pasan juntas.

Una recepción se carga en borrador y no toca nada. **Confirmar es lo que la hace
efectiva, y no se puede deshacer del todo:** anular después saca el stock y deja
el costo como quedó. Eso no es un olvido, es cómo funciona un costo promedio:
para revertirlo habría que recalcular todas las recepciones posteriores de esa
mercadería, y esos costos ya se usaron para poner precios.

Los costos se cargan **netos**, como los factura el proveedor. El flete va en su
campo y se reparte entre los renglones en proporción a su valor: el flete de un
camión con veinte tablas y un tornillo no se divide en dos.

Al lado de cada renglón se ve a cuánto venía costando. Si el costo cambia más del
doble, aparece un aviso: casi siempre es un error de tipeo o una unidad distinta,
y verlo ahí cuesta un segundo. Descubrirlo después cuesta el costo promedio.

## Facturas de compra

Es la capa fiscal, y va aparte de la recepción a propósito: **de acá sale el
crédito fiscal del mes**.

El total no se pide, se suma: se cargan el neto, cada alícuota de IVA, lo exento
y las percepciones, y el sistema arma el total. Un total tipeado que no coincide
con sus partes no se descubre hasta que el libro no cierra contra el mayor.

Cargar dos veces el mismo comprobante está bloqueado. Es el error más común de
todos —la factura llega por mail, alguien la carga, llega en papel, alguien la
vuelve a cargar— y computar dos veces el mismo crédito rompe la posición de IVA
del mes.

**La factura B y la C no dan crédito fiscal.** El IVA está adentro del precio y
no se puede computar. El sistema lo separa solo y lo dice en el libro.

## Pagos y retenciones

El importe que se carga es **lo que se le imputa a la deuda**, retenciones
incluidas. Lo que sale del banco lo calcula el sistema restando lo retenido.

Eso es lo que más se confunde: **una retención no es un gasto, es parte del
pago**. Se le pagan $100.000 con $95.000 de transferencia y $5.000 de retención,
y la deuda queda saldada en $100.000. El proveedor recibe la transferencia y el
certificado, y con el certificado recupera esos $5.000 contra su impuesto.

Puede pasar que se cargue una base y el sistema no retenga nada. No es un error:
Ganancias mira el **acumulado del mes**, no cada pago suelto. Cuatro pagos chicos
no llegan al mínimo mirados de a uno y sí lo superan mirados juntos, que es como
los mira ARCA.

El certificado se imprime en PDF desde el mismo lugar donde se registró el pago.
Hay que entregárselo al proveedor: sin él, le retuvimos plata que no puede
recuperar.

Las alícuotas y los mínimos de cada régimen se cargan en la base y **hay que
revisarlas con el contador**: ARCA las actualiza por resolución varias veces al
año.

## Gastos

El flete, el combustible, la luz. Antes solo existía el "retiro" de caja, que
además exige turno abierto: un gasto pagado por transferencia un domingo no tenía
dónde anotarse.

Cuando el gasto es en efectivo, además de anotarse **sale de la caja**: se
descuenta del turno que estaba abierto en ese momento. Si no había ninguno, el
gasto se anota igual y el arqueo va a mostrar la diferencia, que es mejor que no
tener el gasto en ningún lado.
