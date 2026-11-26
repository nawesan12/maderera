# Comprobantes sin CAE y el archivo de asientos

Para el estudio contable. Lo que el sistema hace hoy y lo que necesitamos que
ustedes decidan.

## Qué quedó emitido sin CAE, y por qué

Mientras el sistema no tenga cargado el certificado de ARCA, cada comprobante
se numera y se entrega, pero no se autoriza: queda **sin CAE y sin valor
fiscal**, y así lo dice el PDF. No entra al libro IVA ni al archivo de asientos.

ARCA autoriza cada punto de venta y tipo en orden, sin saltear números. Cuando
se cargue el certificado, hay que resolver lo pendiente de una de dos formas.

## Las dos salidas

1. **Autorizarlo con la fecha de hoy.** Al mandarlo a ARCA, el comprobante
   sale con la fecha del día en que se autoriza, porque ARCA no acepta fechas
   de más de unos pocos días atrás. El número no cambia. La fecha original
   queda guardada y anotada en la bitácora.
2. **Darlo de baja y reemitir.** Si el comprobante no tiene que salir así
   (letra equivocada, datos que no corresponden, una venta que se anuló), se
   da de baja: se libera su número y los pendientes que vienen detrás bajan
   uno. Después se emite de nuevo lo que corresponda. Antes de dar de baja un
   comprobante cobrado, hay que anular su recibo, y queda registrado quién lo
   hizo, cuándo y por qué.

Nada de esto se hace solo: cada comprobante lo decide alguien desde el panel.
Una venta nueva del mostrador no arrastra lo pendiente de días anteriores:
queda esperando hasta que esto se resuelva. Un comprobante de una venta que
se anuló no se manda a ARCA: se da de baja.

**A decidir:** ¿se autoriza todo lo pendiente con fecha de hoy, o prefieren
dar de baja y reemitir alguna parte (por ejemplo, lo de meses ya cerrados)?

## El mes de cada comprobante

Un comprobante autorizado con la fecha de hoy es una venta del mes en que se
autoriza, no del mes en que se entregó. Si era de un mes que ya cerraron, la
venta pasa al mes nuevo: no aparece dos veces ni se pierde. El cierre de ese
mes lo marca como **«Autorizados fuera de su mes»** para que lo vean.

**A decidir:** si eso es aceptable o si alguno tiene que reemitirse.

## El monto desde el que la Factura B identifica al comprador

Desde **$10.000.000** (RG 5700/2025), una Factura B a consumidor final tiene
que llevar el DNI o el CUIT del comprador. El sistema no deja emitirla sin el
documento, y el mostrador lo pide antes de cobrar.

**A confirmar:** el monto y la resolución vigentes. Si ARCA lo cambia, el
sistema guarda la fecha desde la que rige cada monto.

## El archivo de asientos: los dos circuitos

El archivo para el estudio lleva **solo el circuito blanco**. Lo marcado «en
negro» (gastos y pagos a proveedores) y lo cobrado por ventas sin factura van
en otro archivo, con la B en el nombre.

Cada recibo de un cliente se reparte en el momento en que se emite, y ese
reparto no se recalcula después:

- **Deudores por ventas:** lo que cancela facturas con CAE. Las retenciones
  que practica el cliente van siempre acá.
- **Anticipos de clientes** (cuenta nueva, 2.1.06): lo que se cobra de más
  cuando el cliente tiene algo por facturar (un pedido abierto o una factura
  que espera el CAE), hasta el importe de eso. Es la seña. Cuando la factura
  de ese pedido sale con CAE, el anticipo se le aplica con un asiento de
  Anticipos a Deudores; a otra factura del cliente no.
- **Circuito B:** lo que se cobra de más sin nada pendiente de facturar, es
  decir, lo que paga una venta sin factura ya cerrada.

Lo que se mira es lo que había el día del recibo, no lo de hoy. Los recibos
de antes de este reparto se fijan una sola vez, con la misma regla, antes de
mandarles el primer cierre.

En cada recibo, lo que va al archivo de ustedes sale primero de lo
bancarizado (transferencia, depósito, Mercado Pago, tarjeta, cheques) y lo
del B, primero del efectivo; un cheque marcado «en negro» va entero al B.
Cuando algo bancarizado igual queda en el B (o se paga en negro por
transferencia), el cierre lo marca como **«Movimientos bancarios en el
circuito B»**: el extracto no va a conciliar.

El cierre también marca las **«Señas del mes sin factura»** y los
**«Anticipos sin aplicar»** (de pedidos que se entregaron o cancelaron sin
factura con CAE), con el importe. Y como el reparto no se recalcula, marca
los recibos que mandaron plata al B y conviene mirar: **«Cobros en el B de
ventas facturadas después»** (el pedido se cobró entregado y sin factura, y
se facturó más tarde: la factura queda en su archivo sin el cobro) y
**«Recibos partidos entre los dos archivos»** (una parte a su archivo y el
resto al B).

**A decidir:** en esos dos casos, ¿el cobro tiene que pasar a su archivo?

**A decidir:** ¿las señas congelan precio? Si es así, el cobro de la seña
perfecciona el hecho imponible (art. 5, inc. b, Ley de IVA): hay que
facturarla al cobrarla y el débito es de ese mes, no del de la factura del
pedido.

**A decidir:** el pedido no dice si una venta es del circuito B. Ante la
duda, el sistema manda el excedente a Anticipos y no al B. ¿Les sirve ese
criterio?

## Cuándo cuenta una venta

Las ventas del mes y el resultado cuentan cada venta **cuando se entrega o se
factura, lo que pase primero**, no cuando se confirma el pedido. Un pedido de
octubre que se prepara y se factura en noviembre es venta de noviembre. Lo
que se devuelve resta en el mes de la devolución.

**A confirmar:** ¿les sirve ese criterio para el resultado que les mandamos?

## Pagos en negro de facturas de compra en blanco

Si una factura de compra en blanco se paga con un pago marcado «en negro», el
pago no entra al archivo del estudio y la factura queda abierta en
Proveedores. El cierre lo marca como **«Pagos en negro de facturas en
blanco»**.

**A decidir:** dejarlo abierto o asentarlo en el archivo del estudio contra
una cuenta como «Proveedores – cancelación no documentada».

## Las reglas que eligen ustedes

Lo que quedó «a decidir» en este documento, y otras políticas que esperan
su respuesta o la de la dueña, ya están construidas con las dos salidas. Se
eligen en **Reglas del negocio** del panel (solo el admin, y cada cambio
queda en la bitácora con quién lo hizo y de qué a qué). Hasta que ustedes
digan otra cosa, cada una sigue como funcionaba: la de **arranque**.

| Regla | Arranque | La otra salida |
|---|---|---|
| Cuándo cuenta una venta (H162) | Al entregar o facturar, lo primero | Al tomar el pedido · al entregar · al facturar |
| Lo cobrado antes de facturar (H374) | Al circuito B si no había nada pendiente | A Anticipos de clientes, y se imputa a la factura cuando sale con CAE |
| Lo que sobra de un cobro a cuenta (H407) | Al circuito B | A Anticipos de clientes (saldo a favor), y se imputa a la próxima factura |
| El cobro de una factura sin CAE (H160) | Sin asiento hasta que llega el CAE | Contra una cuenta transitoria, que se cancela al llegar el CAE |
| Al monotributista (H207) | Factura A con la leyenda de la Ley 27.618 (RG 5003/2021) | Factura B |
| Cómo se nombra el circuito sin factura (H167) | «B» | «Sin factura» · «Interno» |

Hay otras, del mostrador, los cortes y Mi cuenta, que decide la dueña y no
tocan los asientos. Están en la misma pantalla: si el material de un corte
de menos de media placa se cobra, si la lista del cliente exige contado
siempre o solo cuando le da mejor precio, si el descuento por medio de pago
alcanza al flete, si la tarjeta pide lote y cupón, si sin ningún PIN firma la
contraseña de un admin, dónde se corta un corte suelto, si el profesional ve
sus precios con la tienda apagada, si el cliente acepta un presupuesto que
no se le envió y si el cliente cambia sus datos fiscales hasta su primera
factura o nunca.

**Un mes cerrado no cambia al cambiar una regla.** Si se cambia cuándo
cuenta una venta, lo que ya contó en un mes cerrado se queda ahí. Lo que con
la regla nueva caería en un mes cerrado cuenta desde el primer día del
primer mes abierto. Un pedido cancelado después de contar como venta sigue
en su mes y resta en el de la cancelación, como una devolución.

**Lo cobrado sin destino, con Anticipos.** El cobro de un pedido sin factura
queda en Anticipos de clientes atado a ese pedido, y se aplica a su factura
cuando sale con CAE. Si nunca se factura, el cierre lo marca en «Anticipos
sin aplicar». Lo que sobra de un cobro a cuenta es un saldo a favor que se
aplica a la próxima factura del cliente; el cierre lo muestra en «Saldos a
favor en Anticipos». Se decide al emitir el recibo: cambiar la regla después
no mueve lo ya repartido.

**Al monotributista.** De arranque, Factura A con el IVA discriminado y la
leyenda de la Ley 27.618, y se pide su CUIT. Con la otra salida, Factura B,
sin IVA discriminado y sin pedir CUIT. Vale para lo que se emita desde el
cambio, no para lo ya emitido.

**El nombre del circuito sin factura** cambia solo la palabra en pantallas,
mensajes y cierre; el archivo de asientos del circuito B se sigue llamando
igual.

## Los asientos que se sumaron

- El **costo de lo vendido** va a 5.2.01 Costo de mercaderías vendidas,
  contra Mercaderías: en su archivo si la venta estaba facturada en su mes,
  en el B si no.
- El **cobro del mostrador** de un pedido sin factura va al B contra Ventas
  sin factura (o a Anticipos con esa regla). El día de la factura con CAE
  sale del B y entra a su archivo contra Deudores.
- El cobro de una venta que **espera el CAE** espera el CAE (arranque), o va
  contra 2.1.12 Cobros a imputar (facturas sin CAE) y se imputa a Deudores
  cuando llega.
- El **depósito** de la caja al banco va de Caja a Banco, y la extracción
  del banco a la caja, de Banco a Caja. Cada retiro de caja guarda a dónde
  fue (banco, caja fuerte u otro); los anteriores se leen por el motivo.
- El faltante o sobrante de cada **arqueo** va contra 5.1.12 Diferencias de
  caja.

**A definir:** ¿a qué cuenta van las diferencias de arqueo? ¿Y los ingresos
de caja que no vienen del banco? Hoy se toman como plata de la caja fuerte,
que es la misma Caja, y no se asientan.

## Devolución de una venta facturada

Desde el pedido se elige el renglón y la cantidad, y sale la nota de crédito
sobre la factura (misma letra y punto de venta; sin CAE si la factura todavía
lo espera). La nota baja lo que falta cobrar o va a la cuenta corriente, y lo
traído vuelve al stock atado a la devolución. Lo ya cobrado no se reintegra
desde ahí: vuelve por caja o banco desde la factura.

## Pedido partido y cheque rechazado

- **Pedido partido:** un pedido puede dejar una parte en la cuenta corriente
  (es una venta a cuenta: va a Deudores) y cobrar el resto como contado, con
  su recibo. El recibo del resto no pasa por la cuenta corriente.
- **Cheque rechazado:** además del admin, la vendedora registra el rechazo
  desde la ficha del cliente con la firma de un admin. Hace lo mismo que la
  cartera: nota de débito por el importe, y la deuda vuelve a la cuenta.
