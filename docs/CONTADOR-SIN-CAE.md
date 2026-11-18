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
  que espera el CAE). Es la seña. Cuando la factura sale con CAE, el anticipo
  se le aplica con un asiento de Anticipos a Deudores.
- **Circuito B:** lo que se cobra de más sin nada pendiente de facturar, es
  decir, lo que paga una venta sin factura ya cerrada.

**A decidir:** el pedido no dice si una venta es del circuito B. Ante la
duda, el sistema manda el excedente a Anticipos y no al B. ¿Les sirve ese
criterio?

## Pagos en negro de facturas de compra en blanco

Si una factura de compra en blanco se paga con un pago marcado «en negro», el
pago no entra al archivo del estudio y la factura queda abierta en
Proveedores. El cierre lo marca como **«Pagos en negro de facturas en
blanco»**.

**A decidir:** dejarlo abierto o asentarlo en el archivo del estudio contra
una cuenta como «Proveedores – cancelación no documentada».
