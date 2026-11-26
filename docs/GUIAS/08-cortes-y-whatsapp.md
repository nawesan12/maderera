---
titulo: Cortes y WhatsApp
resumen: La cola de corte y la bandeja de mensajes.
orden: 8
---

## Cortes

*Cortes* es la cola del taller, como un pizarrón:

**En cola → En la máquina → Terminado → Retirado**

Cada orden trae el material, la cantidad de placas y el **despiece en
milímetros**: largo, ancho, cantidad y si la pieza respeta la veta. Las medidas
van en columnas separadas y no como texto libre porque son los números que
después necesita la máquina para armar el patrón de corte. Escribirlas como
"60x40 (x4)" obliga a volver a tipearlas.

### La pantalla del taller

Quien opera la seccionadora no trabaja dentro del panel: tiene su propia
pantalla en `/taller`, que es la misma cola pero sola, sin el menú de la
izquierda ni el buscador de arriba. Está pensada para dejarla abierta todo el
día en la máquina. Con dos talleres, arriba se elige cuál mirar.

Se entra con un usuario de rol **aserradero**, y ese usuario no ve el resto del
panel: ni precios, ni cobros, ni clientes. Sí entra a la ficha de cada corte,
sin los importes. Empieza y termina los trabajos; marcarlos urgentes y
entregarlos es del mostrador.

En cada tarjeta están la **Hoja de corte** y el **Archivo** para la máquina.
**Marcar terminado** pide confirmar las pasadas que propone el plano. Si se
tocó sin querer, el aviso que aparece tiene **Deshacer**.

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

El valor se cambia en **Cortes → Tarifas**, y vale para el plano, el presupuesto y la
hoja del taller a la vez.

### La hoja de corte

Es lo que se tipea en la seccionadora, placa por placa y en el orden de la
máquina. Cada paso tiene su casilla: lo tildado queda guardado en esa tablet o
ese teléfono mientras dura el corte. Las pasadas y los retales de la hoja son
los mismos de la ficha y del plano, y son los que se cobran.

### El reporte del corte

El botón **Reporte en PDF** de la ficha baja el trabajo entero: cada placa
dibujada, la tabla de piezas con su posición, **qué sobra de cada placa y de
quién es** —de una placa vendida entera el recorte se lo lleva el cliente—, el
desperdicio y los milímetros que se llevó la sierra.

Es para guardar o mandar. La hoja del plano sigue estando, y es la que se imprime
para bajar al taller.

### El corte que pide el cliente desde el sitio

En `/corte` cualquiera puede armar su despiece, ver el dibujo y mandarlo por
WhatsApp. El mensaje trae un enlace a la consulta: desde ahí, **Pasar a corte**
abre el alta con la placa y las piezas ya cargadas.

### Urgente

El botón *Urgente* manda la orden al principio de la cola. Usalo con criterio:
si todo es urgente, nada lo es.

### Cortes que vienen de un pedido

**Mandar a cortar**, desde la ficha del pedido, arranca con la placa que vende
el pedido, el teléfono del cliente y el día de retiro. Quedan enganchados:
desde la orden se llega al pedido y al revés, y la ficha del corte no vuelve a
cobrar las placas que el pedido ya vende.

La pieza que faltó en una entrega se repone desde el mismo pedido, con
**Reposición sin cargo**. Al entregarla queda escrito en el pedido.

### Corregir o anular

Un corte que todavía no se cortó se **corrige** (se carga de nuevo con lo suyo
y el nuevo reemplaza al viejo en la cola) o se **anula** con un motivo.

### Cobrar el corte

El corte se cobra **por pasada de sierra**, y el precio depende del material y
de si el cliente es mayorista:

| Material | Público | Mayorista |
|---|---|---|
| Placas | $ 1.200 | $ 996 |
| Tableros de madera | $ 1.400 | $ 1.162 |

Las pasadas salen del plano, y el taller las confirma al terminar. Si la
máquina dio otras, se corrigen en la ficha, en «Pasadas a cobrar».

Un corte suelto —el que se toma por teléfono y se paga al retirar— no se
entrega sin cobrar: **Cobrar** lo pasa a pedido, con la mercadería reservada, y
se cobra y se entrega desde ahí. El que se vendió en el mostrador muestra lo
que se cobró en la venta.

Los precios se editan en **Cortes → Tarifas**. El material es texto libre y no
un desplegable de productos: la tarifa no depende de la placa concreta sino de
**contra qué corta la sierra**. Una melamina y un MDF cobran igual; un tablero
de madera, no.

Si el material no tiene tarifa cargada, la ficha lo avisa con el nombre exacto
que hay que dar de alta. Una lista de precios sin tarifa propia cae a la de
público, igual que el precio del catálogo.

### Pasarle el trabajo a la máquina

En la tarjeta del taller y en la ficha del corte, **Archivo para la máquina**
baja un archivo con el despiece: una fila por medida, con largo, ancho, cantidad, material y los
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

### Atender una conversación

- **Asignarla**: el desplegable de arriba dice quién la atiende. Así dos
  personas no contestan lo mismo, y el filtro **Mías** muestra lo propio.
- **Resuelta**: cuando ya no hay nada pendiente. Si el cliente vuelve a
  escribir, se reabre sola.
- **Responder a un mensaje**: pasando el mouse por lo que escribió el cliente
  aparecen *Responder* (lo cita, como en el teléfono) y las reacciones.
- **Mandar un papel**: el botón **Documento** lista los presupuestos,
  facturas, remitos, recibos y cortes del cliente, y el resumen de cuenta. Se
  elige y sale el PDF. También se puede mandar desde la pantalla del remito,
  del presupuesto, de la factura o de la ficha, con **Por WhatsApp**.
- **Fotos y archivos**: el clip, como en cualquier chat.
- **Sin ficha**: a la derecha se busca el cliente para vincularlo, o se le crea
  la ficha con el teléfono ya puesto.

Cuando un mensaje **no sale**, queda en rojo con el motivo («pasaron más de 24
horas», «el número no tiene WhatsApp») y un botón **Reintentar**: lo escrito no
se pierde.

### Avisos automáticos

Cuando un pedido cambia de estado, se registra un pago o se rechaza un cheque,
al cliente le puede salir el aviso solo. Se prenden uno por uno en
*WhatsApp → Configuración* (solo administración), y nacen apagados porque cada
mensaje lo cobra Meta.

Si un cliente escribe **BAJA**, no le sale ningún aviso más (y se le confirma);
con **ALTA** vuelve. También se puede marcar desde la conversación, a la
derecha.
