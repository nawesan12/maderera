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

### Urgente

El botón *Urgente* manda la orden al principio de la cola. Úselo con criterio:
si todo es urgente, nada lo es.

### Cortes que vienen de un pedido

Cuando el corte nace de un pedido, quedan enganchados: desde la orden se llega
al pedido y al revés.

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
