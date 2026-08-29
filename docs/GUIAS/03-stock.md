---
titulo: Stock, transferencias y acopio
resumen: Qué número mira cada pantalla, cómo se corrige el inventario y cómo funciona el acopio con remito firmado.
orden: 3
---

## Tres números distintos

Esta es la parte que más confunde al venir de un sistema de escritorio. El
inventario tiene tres números y no uno:

| Número | Qué es |
|---|---|
| **Físico** | Lo que hay en el galpón |
| **Reservado** | Lo que ya tiene dueño: está en un pedido sin entregar |
| **Disponible** | Físico menos reservado. **Es lo que se puede vender** |

El galpón puede tener veinte placas y no haber ninguna para vender, si están las
veinte comprometidas. El sitio y el buscador muestran siempre el **disponible**:
mostrar el físico sería vender mercadería ajena.

El disponible nunca da negativo. Si el reservado supera al físico —pasa cuando
se entregó algo sin cargarlo— el disponible queda en cero.

## Ajustar

En *Stock*, cada renglón tiene los botones de **+** y **−** para corregir en el
momento: llegó mercadería, se rompió una placa, se contó mal. Cada ajuste deja
su movimiento con su fecha y su autor, así que el inventario siempre puede
explicar por qué dice lo que dice.

El inventario **no baja de cero**. Si el depósito dice que hay menos de lo que
el sistema descuenta, lo que hay que corregir es el número, no forzar un
negativo que después nadie entiende.

## El mínimo de reposición

Cada producto tiene su mínimo **por sucursal**, porque no es lo mismo: tres
placas de fenólico pueden ser "poco" y tres rollos de membrana pueden ser "de
sobra". Cuando la cantidad baja del mínimo, el producto aparece en *Hay que
reponer*, en el resumen.

## Transferir entre sucursales

Desde *Stock*, botón **Transferir**. Se elige origen, destino y cantidad. La
operación es una sola: descuenta de un lado, suma del otro y deja los dos
movimientos que lo explican. Si algo falla en el medio, **no se aplica nada**;
no existe el caso de mercadería que salió de un galpón y no llegó al otro.

Las transferencias quedan en la bitácora.

## Acopio

El acopio es la mercadería comprada y pagada que el cliente deja guardada para
retirar de a poco. Funciona así:

1. El pedido queda en acopio en vez de entregarse entero.
2. Cada vez que el cliente retira una parte, se carga una **entrega parcial**
   con lo que se lleva.
3. El sistema arma el **remito**, que se firma en el celular con el dedo.
4. Lo que queda sigue reservado a nombre del cliente.

La firma queda guardada con el remito. Es la constancia de que esa mercadería
salió y quién la retiró.
