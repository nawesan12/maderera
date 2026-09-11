---
titulo: Primeros pasos
resumen: Cómo entrar, cómo está armado el panel y cómo encontrar cualquier cosa sin recorrer el menú.
orden: 0
---

## Entrar

El panel vive en la misma dirección que el sitio, con `/admin` al final. Se entra
con el correo y la contraseña que le dio administración. **No hay usuario
compartido**: cada persona tiene el suyo, y todo lo que se carga queda a nombre
de quien lo cargó. Prestar la clave es prestar la firma.

Si la sesión se cierra sola, no pasó nada malo: vuelva a entrar y siga donde
estaba.

## Cómo está armado

A la izquierda está el menú, en seis bloques, y el orden de cada uno es el del
circuito real, no el alfabético:

- **Operación** — lo del día: pedidos, WhatsApp, presupuestos, cortes y mostrador.
- **Catálogo** — lo que se vende: productos, stock, precios y calculadoras.
- **Ventas** — el cliente y su plata: clientes, profesionales, facturación,
  cobros, caja, ARCA y cierre del mes.
- **Compras** — el otro lado: proveedores, órdenes, recepciones, facturas,
  pagos, cheques y gastos.
- **Sitio** — lo que ve el público: contenido, eventos, documentación y avisos.
- **Ajustes** — lo que se toca de vez en cuando: reportes, sucursales, envíos,
  migración y bitácora.

**No todos ven lo mismo.** El menú muestra solo lo que corresponde al puesto de
cada uno: quien atiende el mostrador no ve Cobros ni Migración, y quien opera
la seccionadora directamente no entra al panel — tiene su propia pantalla en
`/taller`. Si le falta algo que necesita, pídaselo a administración: es un
cambio de un minuto, no un problema del sistema.

Arriba de todo hay un buscador y, al lado, la campana de actividad. También el
botón para pasar a **modo oscuro**, por si la pantalla del depósito o del
taller molesta de noche.

## Lo primero que se ve: «Para hoy»

El **Resumen** abre con un recuadro llamado **Para hoy**: los pedidos que faltan
preparar, los que están listos y nadie retiró, los cortes en la cola, los
cheques que vencen esta semana, las facturas de compra vencidas y los
profesionales esperando respuesta. Cada renglón lleva a la pantalla donde se
resuelve.

Es la respuesta a «¿qué tengo que hacer?» sin recorrer el menú. Lo que apremia
va en naranja; lo demás, en gris. Cada uno ve solo lo suyo.

Las cuatro tarjetas de abajo —ventas, presupuestos abiertos, productos a
reponer, clientes— **también se pueden tocar**, y llevan a la lista de
exactamente eso: si la tarjeta dice 4 presupuestos abiertos, la pantalla que se
abre muestra esos 4.

## El buscador es más rápido que el menú

El campo de arriba busca en todo el sistema a la vez: **clientes** por apellido,
razón social, CUIT o teléfono; **pedidos** y **presupuestos** por su número o
por el nombre; **comprobantes** por el número tal como está impreso
(`0015-00000123`); **cortes**, **proveedores** y **productos**. Los resultados
salen agrupados por tipo. Se abre con **Ctrl+K** (o **⌘K** en Mac) desde
cualquier pantalla, se recorre con las flechas y se entra con Enter.

Solo muestra lo que el puesto de cada uno puede abrir: quien atiende el
mostrador no va a encontrar proveedores ahí, igual que no los ve en el menú.

Si viene de un sistema de escritorio donde había que elegir primero el módulo y
después buscar, este es el cambio de costumbre que más tiempo ahorra: escriba lo
que busca y elija del resultado.

## La campana

La campana muestra lo último que hizo cualquiera en el panel. Sirve para dos
cosas: enterarse de lo que se movió mientras uno atendía a alguien, y evitar
trabajar dos veces sobre lo mismo. **Cada renglón se puede abrir**: si dice
«Marcó PED-0231 como cobrado», el clic lleva a ese pedido. El detalle completo
está en **Bitácora**, donde también se abre la cosa tocada desde la etiqueta
gris de la derecha.

## Lo que cambia respecto de un sistema de escritorio

1. **No hay botón de guardar general.** Cada pantalla guarda lo suyo cuando
   aprieta *Guardar*. Si sale de una pantalla sin guardar, se pierde lo que
   escribió ahí y nada más.
2. **No hay que cerrar el mes ni cerrar el día.** Los números se calculan
   solos cada vez que se abre una pantalla.
3. **Varios pueden estar cargando a la vez.** Si dos personas tocan el mismo
   pedido, gana la última que guardó; la bitácora deja constancia de las dos.
4. **Todo tiene su dirección.** La pantalla que está mirando tiene una URL: se
   puede copiar y pasar por WhatsApp para que otra persona abra exactamente eso.
