---
titulo: Precios
resumen: Editar un precio, aplicar un aumento a todo un rubro e importar una planilla sin romper la lista.
orden: 4
---

## Dos listas

Hay dos listas de precios: la **general**, que es la que ve cualquiera, y la
**profesional**, para arquitectos, constructoras y carpinteros aprobados.

No es un descuento sobre la otra: son dos precios independientes, porque el
margen no es igual en todos los productos y siempre hay excepciones puntuales.

**Los precios se cargan finales, con IVA incluido.** Es lo que se le dice al
cliente en el mostrador. Al facturar, el sistema desagrega el IVA solo.

## Editar uno

En *Precios*, el precio se edita en la misma fila: clic sobre el número, se
escribe el nuevo, Enter. Cada cambio queda en el historial con el valor
anterior, la fecha y quién lo hizo.

## Aumento general

Botón **Ajuste masivo**. Se elige:

- El **porcentaje** (positivo o negativo).
- Sobre qué **categoría**, o todas.
- Sobre qué **lista**, o las dos.
- El **redondeo**: a la decena, a la centena o al mil.
- Un **motivo**, que es lo que se lee después en el historial.

El ajuste se aplica en una sola operación sobre todo lo que entra en el filtro.
Antes de confirmar, revise el filtro: un ajuste sin categoría toca el catálogo
entero.

Los ajustes masivos quedan en la bitácora.

## Importar una planilla

Cuando el proveedor manda una lista nueva, se importa en vez de tipearla.

1. Botón **Importar**, se elige el archivo.
2. El sistema muestra **qué pasaría**: fila por fila, el precio actual y el
   nuevo, y en qué productos no encontró el código.
3. Recién ahí se confirma.

**Nunca se aplica nada antes de que usted mire la comparación.** Importar a
ciegas es la forma más rápida de arruinar una lista: basta una columna corrida
o un archivo viejo.

La planilla se relaciona por el **código (SKU)**. Las filas cuyo código no
existe en el sistema se saltean y aparecen listadas al final, para que se vea
qué quedó afuera.

**Se puede subir el Excel tal cual.** No hace falta pasarlo a CSV: el archivo
`.xlsx` que exporta Excel —o el sistema anterior— se lee directo. El `.csv`
también sirve. Lo único que no se puede subir es un PDF.

## Precios con IVA y sin IVA

Los precios se cargan siempre **finales, con el IVA adentro**. Eso no cambió y
es lo que se cobra.

Lo que cambia es cómo se ven, según quién esté mirando:

- **Público y consumidor final**: el precio grande es el final, y debajo, en
  letra chica, el precio sin impuestos nacionales. Esa segunda línea es
  obligatoria por ley.
- **Profesionales y responsables inscriptos**: el precio grande pasa a ser el
  **neto**, con un «+ IVA» al lado, y el final queda en letra chica. Es como
  compara precios el gremio.

No hay que cargar nada distinto: el sistema resuelve solo cuál mostrar a partir
de la lista de precios y de la condición frente al IVA de cada cliente.

## Descuento por forma de pago

El −10 % por pagar de contado o por transferencia lo aplica el sistema solo, en
la tienda y en el mostrador, sin que nadie lo tipee.

Se configura en **Precios → Formas de pago**, por **escalones de monto**: uno
desde cero, y se pueden agregar otros para compras grandes. El escalón más alto
que la compra alcanza es el que manda.

El descuento va sobre la mercadería, **no sobre el flete**: descontarle un 10 %
al envío sería regalar plata que se le paga a un tercero.

En el mostrador, **si el vendedor escribe un descuento a mano, ese gana**. Los
dos nunca se suman: un 10 % pactado no se convierte en un 20 % por accidente.

## Ofertas

Un producto en oferta lleva el **precio anterior** cargado y una fecha de
vencimiento. La tienda muestra el número tachado y calcula el porcentaje solo, y
la oferta caduca sin que nadie tenga que acordarse.

El precio anterior tiene que ser **el que realmente estuvo vigente**. Inventar
uno para simular un descuento es publicidad engañosa.
