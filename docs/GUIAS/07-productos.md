---
titulo: Productos, fotos y sugeridos
resumen: Cargar un producto con sus medidas, subir fotos y armar las sugerencias que suben el ticket.
orden: 7
---

## Producto y medidas

Un **producto** es la cosa: "Machimbre de pino". Las **medidas** son cada
presentación con su propio código, precio y stock: "1×4 × 3,00 m", "1×6 × 3,00 m".

Casi todo lo que se vende en una maderera tiene varias medidas. Cargar cada
medida como un producto aparte llena el catálogo de repetidos y obliga a
corregir la descripción cinco veces.

Cada medida necesita:

- **Código (SKU)** — único en todo el sistema. Es por donde entra la planilla de
  precios y por donde se identifica la mercadería.
- **Cómo se muestra** — el texto que ve el cliente: `1" x 4" x 3.00m`.
- Largo, ancho y espesor en **milímetros**, si corresponde. Son los números que
  después usa el corte.

## La unidad de venta

Elija con cuidado: **es la unidad en la que se factura**. Si el machimbre se
vende por metro cuadrado, la unidad es m² y el precio es por m². Cambiarla
después de haber vendido deja los pedidos viejos con la unidad vieja.

## Fotos

Se arrastran sobre el recuadro, o se elige el archivo. Se pueden subir varias
juntas. La primera es la **principal**: es la que sale en el catálogo, en el
buscador y cuando alguien comparte el link.

- JPG, PNG o WebP, hasta 8 MB cada una.
- Una foto propia del producto vende más que una genérica. Si no hay, es mejor
  dejarlo sin foto que poner una que no es.

## Productos sugeridos

Abajo de la ficha hay dos listas, y son dos preguntas distintas:

- **También vas a necesitar** — los complementos: el sellador del deck, los
  tornillos del machimbre, los clavos. Es lo que sube el ticket y lo que le
  ahorra al cliente un segundo viaje.
- **Alternativas** — con qué se reemplaza si no convence o no hay stock.

Se escriben en el buscador y se eligen de la lista. El orden es el que usted
carga: primero lo que más se lleva.

**Los complementos los tiene que cargar alguien.** Ninguna regla automática sabe
que a un deck de grandis le corresponde ese fijador y no otro, y sugerir el
equivocado es peor que no sugerir nada: al lado de algo que no sirve, todo el
bloque pierde credibilidad.

Las **alternativas**, en cambio, tienen respaldo: si no carga ninguna, la ficha
muestra otros productos de la misma categoría. Así que arranque por los
complementos, que son los que no se completan solos.

Los complementos aparecen también **en el presupuesto del cliente**, con lo que
ya tiene cargado. Es el momento en que uno se acuerda del sellador.

## Dar de baja

El botón *Dar de baja* saca el producto del sitio pero **no lo borra**: sigue en
los pedidos y las facturas viejas, que es donde tiene que seguir. Un producto no
se borra nunca.

## Imputación contable

Junto al IVA y al recargo por elaboración hay un campo **Imputación contable**:
a qué cuenta va ese producto. Se escribe libre y el campo propone las que ya se
usaron, para que la misma cuenta no termine escrita de tres maneras
—«Mercaderías», «mercaderias» y «Mercadería» son una sola para una persona y
tres para un reporte—.

Cuando el contador dé el plan de cuentas, esto pasa a ser una lista cerrada y lo
cargado hasta entonces es de donde se migra.

## Cuándo se da de baja un producto

En **Productos → Candidatos a baja**. La lista junta tres cosas: los que no se
venden hace mucho, los que no tienen stock en ninguna sucursal y los que no
tienen precio cargado.

**Nada se da de baja solo, y es a propósito.** Un artículo de temporada que no se
vende en trece meses y vuelve a venderse en el catorce desaparecería del catálogo
sin que nadie se entere; con la lista, alguien mira y decide en dos minutos.

Arriba, a la derecha, se elige **desde cuántos meses sin venta** se señala un
producto. Cambiarlo cambia la lista para todo el equipo y queda anotado en la
bitácora.
