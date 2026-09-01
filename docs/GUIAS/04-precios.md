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

## Ofertas

Un producto en oferta lleva el **precio anterior** cargado y una fecha de
vencimiento. La tienda muestra el número tachado y calcula el porcentaje solo, y
la oferta caduca sin que nadie tenga que acordarse.

El precio anterior tiene que ser **el que realmente estuvo vigente**. Inventar
uno para simular un descuento es publicidad engañosa.
