---
titulo: Cerrar el mes
resumen: La posición de IVA, qué conviene resolver antes, y los asientos que se le mandan al estudio.
orden: 12
---

Está en **Cierre del mes**, y es la pantalla que se mira una vez por mes, cuando
el contador pide los números.

## Qué muestra

Arriba, los cuatro números del mes: ventas netas, compras netas, gastos y la
**posición de IVA**.

La posición es débito menos crédito. Positivo significa que hay que depositar;
negativo, que queda saldo a favor para el mes que viene.

El crédito que se cuenta es **solo el de los comprobantes que discriminan IVA**.
La factura B y la C lo llevan adentro del precio y no dan crédito: sumarlas
inflaría la posición contra un papel que no la respalda, y eso es lo que ARCA
reclama con intereses.

## Antes de cerrar

Si hay cosas sin terminar, aparecen arriba con un botón para ir a resolverlas.
No bloquean nada: son las cosas que el contador va a preguntar.

- **Recepciones en borrador**: mercadería que entró y todavía no movió stock ni
  costo. El margen del mes sale incompleto.
- **Turnos de caja sin cerrar**: efectivo sin arquear.
- **Recepciones sin factura de compra**: entró la mercadería y falta el papel, así
  que ese IVA todavía no se computa como crédito.

## Los asientos

El botón **Asientos en CSV** baja el archivo que el estudio importa: un renglón
por línea, con el número de asiento, la fecha, el concepto, el código y el nombre
de la cuenta, y las columnas de debe y haber.

El código de cuenta es una sugerencia —cada estudio tiene su plan— y por eso va
también el nombre: alcanza para remapearlo sin adivinar.

**Si alguna fila dice "NO CIERRA", no mandes el archivo.** Un asiento
desbalanceado hace que el sistema del estudio rechace todo, y eso se descubre el
día del vencimiento. Avisá antes.

## Lo que este sistema no hace

Libro diario, mayor, balance y plan de cuentas. Eso es contabilidad registrada y
la lleva el estudio con su sistema; lo que faltaba era que pudiera importar sin
volver a tipear, y eso es lo que hay acá.

Tampoco constata los comprobantes de proveedores contra ARCA. El CAE se guarda
para poder hacerlo más adelante, pero hoy no se verifica.
