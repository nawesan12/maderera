---
titulo: Cortes y WhatsApp
resumen: La cola de corte y la bandeja de mensajes.
orden: 8
---

## Cortes

*Cortes* es la cola del taller, como un pizarrón:

**En cola → En proceso → Terminado → Retirado**

Cada orden trae el material, la cantidad de placas y el **despiece en
milímetros**: largo, ancho, cantidad y si la pieza respeta la veta. Las medidas
van en columnas separadas y no como texto libre porque son los números que
después necesita la máquina para armar el patrón de corte. Escribirlas como
"60x40 (x4)" obliga a volver a tipearlas.

### La pantalla del taller

Quien opera la seccionadora no trabaja dentro del panel: tiene su propia
pantalla en **`/taller`**, que es la misma cola pero sola, sin el menú de la
izquierda ni el buscador de arriba. Está pensada para dejarla abierta todo el
día en la máquina.

Se entra con un usuario de rol **aserradero**, y ese usuario no ve el resto del
panel: ni precios, ni cobros, ni clientes. Sí entra a la ficha de cada corte y
a la pantalla de formato, que son lo suyo.

Es lo mismo que pasa con `/atencion` para quien contesta WhatsApp.

### La medida de la placa y las medias placas

La medida sale sola de la placa del catálogo, y **se puede escribir a mano**
cuando el material lo trajo el cliente o cuando la placa que hay en el depósito
no mide lo que dice la ficha. Debajo del despiece, la pantalla dice siempre con
qué medida está calculando.

Al lado está **de qué sale el trabajo**: placa entera, media a lo largo o media
al ancho. No es lo mismo: de una 2750 × 1830 salen dos de 2750 × 915 o dos de
1375 × 1830, y qué piezas entran cambia por completo. Media placa se cobra a
mitad de precio, pero del depósito sale una placa entera —el pedazo que queda
vuelve como retazo—.

Si la placa es de color, la pantalla avisa antes de partirla: el dibujo corre en
un sentido y una mitad cortada al ancho queda con la veta cruzada. **La decisión
es de quien atiende**, que es el que tiene la placa en la mano.

### Los 5 mm de la sierra

El disco se come **5 mm en cada corte**, y esos milímetros no quedan en ninguna
pieza: se hacen aserrín. El sistema los descuenta desde siempre, y ahora además
se ven —el trazo naranja del dibujo es el ancho real del disco— y se dicen en
pantalla.

Es lo que explica por qué dos piezas de 900 no entran en una placa de 1830.

El valor se cambia en **Calculadoras**, y vale para el plano, el presupuesto y la
hoja del taller a la vez.

### El reporte del corte

El botón **Reporte en PDF** de la ficha baja el trabajo entero: cada placa
dibujada, la tabla de piezas con su posición, **qué sobra de cada placa y de
quién es** —de una placa vendida entera el recorte se lo lleva el cliente—, el
desperdicio y los milímetros que se llevó la sierra.

Es para guardar o mandar. La hoja del plano sigue estando, y es la que se imprime
para bajar al taller.

### El corte que pide el cliente desde el sitio

En **`/corte`** cualquiera puede armar su despiece, ver el dibujo y el precio, y
agregarlo al carrito. No hace falta tener cuenta para mirar; sí para comprar.

Lo que entra por ahí abre su orden en la cola del taller **al confirmarse la
compra**, atada al pedido, igual que un corte vendido en el mostrador. El precio
se vuelve a calcular en ese momento: el que vio el cliente sirve para decidir, no
para cobrar.

### Urgente

El botón *Urgente* manda la orden al principio de la cola. Úselo con criterio:
si todo es urgente, nada lo es.

### Cortes que vienen de un pedido

Cuando el corte nace de un pedido, quedan enganchados: desde la orden se llega
al pedido y al revés.

### Cobrar el corte

El corte se cobra **por pasada de sierra**, y el precio depende del material y
de si el cliente es mayorista:

| Material | Público | Mayorista |
|---|---|---|
| Placas | $ 1.200 | $ 996 |
| Tableros de madera | $ 1.400 | $ 1.162 |

**Cuántas pasadas lleva el trabajo lo dice la máquina, no el sistema.** El
patrón de corte lo arma el optimizador de la seccionadora, así que el número se
carga a mano en la ficha del corte, en «Pasadas de sierra», **después de
optimizar**. Recién ahí la ficha muestra el importe.

Mientras el campo esté en cero la ficha dice «el corte todavía no se puede
cobrar». Eso es a propósito: es preferible que falte el dato a que el sistema
invente un mínimo.

Los precios se editan en **Cortes → Tarifas**. El material es texto libre y no
un desplegable de productos: la tarifa no depende de la placa concreta sino de
**contra qué corta la sierra**. Una melamina y un MDF cobran igual; un tablero
de madera, no.

Si el material no tiene tarifa cargada, la ficha lo avisa con el nombre exacto
que hay que dar de alta. Una lista de precios sin tarifa propia cae a la de
público, igual que el precio del catálogo.

### Pasarle el trabajo a la máquina

En la ficha del corte, el botón **Para la máquina** baja un archivo con el
despiece: una fila por medida, con largo, ancho, cantidad, material y los
cantos. Ese archivo se copia a la PC de la seccionadora y se importa en el
programa que optimiza el corte, en vez de tipear las medidas de nuevo.

**El sistema no corta ni arma el patrón.** Eso lo sigue haciendo el programa de
la máquina, que es el que sabe de placas, sierra y desperdicio. Acá solo se le
entrega la lista para que no haya que cargarla dos veces.

Cómo sale ese archivo se define en **Cortes → Formato para la máquina**: qué
columnas lleva y en qué orden, con qué separador, en milímetros o centímetros,
cómo se escriben el "sí" y el "no". Se ve una vista previa de cómo va a quedar
antes de guardar.

Eso se ajusta **probando contra la máquina**: se exporta, se importa, se mira
qué quedó corrido y se corrige. La primera vez lleva un rato; después queda
fijo.

### Que los archivos lleguen solos

Bajar el archivo y copiarlo a mano funciona, pero se puede evitar. Hay un
programita —el *agente del taller*— que se instala en la PC de la máquina y
hace eso solo: cada tanto pregunta qué hay en cola y deja los archivos en la
carpeta que el optimizador vigila. El operario no baja nada: abre el
optimizador y el trabajo ya está.

Lo instala quien administra el sistema una sola vez. Si un día deja de
aparecer un archivo, lo primero a mirar es que la PC tenga internet y que el
trabajo esté **en cola** y con piezas cargadas.

## WhatsApp

*WhatsApp* es la bandeja de conversaciones con los clientes. Al costado de cada
hilo se ven **el saldo de cuenta corriente y los últimos pedidos** de esa
persona: son las dos cosas que se preguntan por WhatsApp, y tenerlas ahí evita
saltar a otra pantalla en medio de la charla.

Para quien se dedica a contestar hay un **puesto a pantalla completa** en
`/atencion`: la misma bandeja, sin el menú alrededor.

### La ventana de 24 horas

WhatsApp permite escribirle libremente a alguien solo **dentro de las 24 horas**
desde su último mensaje. Pasado ese plazo, únicamente se pueden mandar
plantillas aprobadas. El sistema avisa cuando la ventana está por cerrarse.

No es una limitación del panel: es de WhatsApp, y vale para cualquier
herramienta.

### Avisos automáticos

Cuando un pedido cambia de estado, al cliente le sale el aviso solo. Se
configura en *Avisos*, evento por evento, y se puede apagar el que no
corresponda.
