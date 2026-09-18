# Bitácora de cambios de alcance

> Mitigación del riesgo R8 del plan. La cláusula 8.4 admite "ajustes menores"
> sin cargo; la 8.5 deja afuera todo lo demás. La diferencia entre las dos se
> discute **en el momento del pedido**, no al final del proyecto, y para eso
> hace falta que cada pedido esté anotado con su fecha y su respuesta.

## Cómo se usa

Una fila por pedido que no estaba en la cláusula primera. Tres decisiones
posibles:

- **Incluido (8.4)**: entra sin cargo. Se anota igual, porque el volumen de
  "ajustes menores" es lo que después justifica una conversación.
- **Fuera de alcance (8.5)**: se rechaza o se presupuesta aparte. **La respuesta
  se manda por escrito el mismo día**; dejarla para después equivale a haberlo
  aceptado.
- **Trabajo nuevo asumido**: se hace sin cargo por decisión del PRESTADOR. Se
  anota para que quede claro que fue una decisión y no una obligación.

## Registro

| Fecha | Quién pidió | Qué pidió | Decisión | Respuesta enviada |
|---|---|---|---|---|
| 22/08/2026 | PRESTADOR | Bandeja de WhatsApp con puesto de atención y avisos automáticos | Trabajo nuevo asumido | — |
| 26/08/2026 | PRESTADOR | Acopio con remitos, firma digital desde el celular y descuento de stock por venta | Trabajo nuevo asumido | — |
| 29/08/2026 | PRESTADOR | Bitácora de acciones del panel (`audit_log`), con pantalla de consulta y campana de actividad | Trabajo nuevo asumido | — |
| 29/08/2026 | PRESTADOR | Exportación de la lista de piezas para el optimizador de la seccionadora, con formato configurable | Trabajo nuevo asumido | — |
| 31/08/2026 | PRESTADOR | Rediseño completo de la interfaz según el paquete de diseño: tokens, tienda, contenido público, panel y portal del cliente | Trabajo nuevo asumido | — |
| 31/08/2026 | PRESTADOR | Puesto del aserradero (`/taller`), rol propio y menú del panel acotado por rol | Trabajo nuevo asumido | — |
| 31/08/2026 | PRESTADOR | Agente local que deja los archivos de corte en la carpeta del optimizador (nivel 2 de 9.1) | Trabajo nuevo asumido | — |
| 05/09/2026 | CLIENTE (brief) | Descuento por pagar de contado o por transferencia, con escala por monto | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Cobro del corte de placas, por pasada y por material, con precio mayorista propio | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Precios sin IVA para el gremio, y aviso al mayorista de que entre con su usuario | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Moldava como sección destacada propia | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Migrar además proveedores, histórico de ventas y comprobantes emitidos | **Fuera de 1.9** — la cláusula lista productos, stock, clientes y precios. Se hizo igual | — |
| 05/09/2026 | PRESTADOR | Lectura de planillas .xlsx en la migración y en la importación semanal de precios | Trabajo nuevo asumido | — |
| 05/09/2026 | PRESTADOR | Bloqueo de cuenta corriente por límite y por deuda vencida en mostrador y facturación | Trabajo nuevo asumido | — |
| 05/09/2026 | PRESTADOR | Pantalla de zonas de envío, que existían en el modelo y no se podían editar | Trabajo nuevo asumido | — |
| 05/09/2026 | PRESTADOR | Pantallas para editar las tarifas de corte y los descuentos por forma de pago | Trabajo nuevo asumido | — |
| 05/09/2026 | PRESTADOR | Página de cambios y devoluciones: el sitio no tenía ninguna página legal | Trabajo nuevo asumido | — |
| 05/09/2026 | CLIENTE (brief) | La calculadora sugiere productos del catálogo, con precio y stock | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Lista de precios descargable en PDF, con la lista de cada profesional | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Motivos de cotización especial en el pedido de presupuesto | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Terminación y tipo/calidad como atributos de variante | Incluido (8.4) | — |
| 05/09/2026 | CLIENTE (brief) | Documento obligatorio de quien retira, en el remito de acopio | Incluido (8.4) | — |
| 05/09/2026 | PRESTADOR | Avisos y promociones: banners con vigencia en franja, portada y catálogo, con carrusel | Trabajo nuevo asumido | — |
| 05/09/2026 | PRESTADOR | El catálogo dejó de sentirse otro sitio: misma franja de beneficios y barra de categorías que la portada | Trabajo nuevo asumido | — |
| 07/09/2026 | PRESTADOR | Datos de demostración para la visita: cajas del mostrador, eventos, documentación técnica, remitos, solicitudes de profesionales, escalas por volumen, sugeridos, órdenes de compra y gastos (`db:seed-demo`) | Trabajo nuevo asumido | — |
| 07/09/2026 | PRESTADOR | Guía de capacitación por puesto y consola de la demostración, las dos en HTML (`docs/capacitacion.html`, `docs/mapa-demo.html`) | Trabajo nuevo asumido | — |
| 07/09/2026 | CLIENTE (notas) | Portal de profesionales: CUIT opcional, DNI o CUIT, red social en vez de localidad, y sin matrícula | Incluido (8.4) | — |
| 07/09/2026 | CLIENTE (notas) | «Wood frame» como rubro del alta de profesionales | Incluido (8.4) | — |
| 07/09/2026 | CLIENTE (notas) | El precio mayorista solo con transferencia, débito o efectivo; nunca en cuotas | Incluido (8.4) | — |
| 07/09/2026 | CLIENTE (notas) | Mostrar cuántas unidades quedan cuando queda poco, como promoción | Incluido (8.4) | — |
| 07/09/2026 | CLIENTE (notas) | Hero integrado en un slider a todo el ancho, primero en la portada | Incluido (8.4) | — |
| 07/09/2026 | CLIENTE (notas) | Más presencia al catálogo, a Moldava y a crear cuenta; personaje propio en vez del ícono de IA | Incluido (8.4) | — |
| 07/09/2026 | CLIENTE (notas) | **Los 43 rubros de ferretería como filtro navegable**: subcategorías pasan de texto libre a tabla propia, con ABM y filtro público | **Excede 8.4** — es un nivel nuevo de navegación en el catálogo, no un ajuste. Se hizo igual | — |
| 07/09/2026 | CLIENTE (notas) | **El deck se vende por tabla y no por metro cuadrado**, con pantalla de parámetros de las calculadoras | **Excede 8.4** — cambia la unidad de venta, el precio y la fórmula. Se hizo igual | — |
| 07/09/2026 | CLIENTE (notas) | **Reseñas de compra verificada**, con moderación en el panel y estrellas en el buscador | **Excede 8.4** — es un módulo nuevo con su propio modelo y moderación. Se hizo igual | — |
| 07/09/2026 | CLIENTE (notas) | **Sacar el blog del sitio**, y con él los testimonios y la sección de contenido del prototipo | Incluido (8.4), pero **irreversible**: se respaldaron los seis artículos fuera del repo antes del borrado y las direcciones viejas redirigen a la portada | — |
| 07/09/2026 | CLIENTE (notas) | Utilidad por rubro en los reportes, que hoy llevan en Excel | Incluido (8.4) | — |
| 07/09/2026 | CLIENTE (notas) | Baja de productos «automática según parámetros» | **Se entregó como pantalla de candidatos, sin automatismo**: un producto de temporada que no se vende en trece meses y vuelve a venderse en el catorce desaparecería sin que nadie se entere | — |
| 07/09/2026 | CLIENTE (notas) | **Importar la lista de precios de cada proveedor con su propio formato**: perfil de mapeo guardado por proveedor y código del proveedor por variante | **Excede 8.4** — la importación que existía era una sola planilla de formato propio. Se hizo igual. **El PDF queda afuera**: sacar una tabla de un PDF es adivinar, y adivinar precios de compra sale caro | — |
| 07/09/2026 | PRESTADOR | **Aprobar una solicitud profesional le quitaba el rol de staff a quien fuera del equipo**: alguien de la casa prueba el formulario público, se aprueba, y queda sin acceso al panel sin ninguna pista de por qué | Trabajo nuevo asumido | — |
| 07/09/2026 | PRESTADOR | El formulario de alta de profesionales se vaciaba entero al rechazar un dato: equivocarse en un dígito obligaba a retipear los seis campos | Trabajo nuevo asumido | — |
| 07/09/2026 | PRESTADOR | El mostrador avisaba de la restricción del precio mayorista recién al cobrar; ahora el crédito se apaga al elegir el cliente | Trabajo nuevo asumido | — |
| 07/09/2026 | PRESTADOR | El contador del carrito se refrescaba una sola vez por visita: vaciar el presupuesto o que venciera la sesión dejaba el ícono con el número viejo hasta recargar | Trabajo nuevo asumido | — |
| 07/09/2026 | PRESTADOR | Cambiar un filtro del catálogo no volvía a la primera página: el «ver más» acumula páginas en la URL y arrastraba el número al cambiar de categoría | Trabajo nuevo asumido | — |
| 07/09/2026 | PRESTADOR | Sinónimos de búsqueda para chapadur, enchapado, ranurado, OSB y fibrofácil, y corrección del atajo de decks, que apuntaba a una categoría inexistente | Trabajo nuevo asumido | — |
| 09/09/2026 | CLIENTE (notas) | Medios de pago y promociones bancarias en el inicio, editables y con vigencia (traídas del documento real de promociones) | Incluido (8.4) | — |
| 09/09/2026 | CLIENTE (notas) | Logo más grande y siempre visible; menú en imprenta mayúscula con más cuerpo; Profesionales en la barra principal | Incluido (8.4) | — |
| 09/09/2026 | CLIENTE (notas) | **Vendedores como entidad** (de salón y de calle): asignados al cliente, heredados por presupuestos y pedidos, y el reporte de ventas agrupa por ellos | Incluido (8.4) | — |
| 09/09/2026 | CLIENTE (notas) | Presupuestos distinguidos por sucursal (filtro central/Canosa) y **descargables en PDF** con el modelo del papel actual: vendedor, código de cliente, IVA discriminado para inscriptos, leyendas y datos bancarios | Incluido (8.4) | — |
| 09/09/2026 | CLIENTE (notas) | **Mostrador**: botón de presupuesto sin cobrar, remito al retirar con la condición de pago, venta en acopio que reserva stock, y pago partido en varios medios con nro. de lote y cupón de la tarjeta | **Excede 8.4** — cambia el modelo de cobro del punto de venta (tabla de pagos por venta, caja y cierre Z por medio real). Se hizo igual | — |
| 09/09/2026 | CLIENTE (notas) | **Cortes**: tapacantos por lado (0/1/2, como la planilla del taller), aclaraciones por pieza, metros lineales calculados y **cobrados por tarifa propia**, y **etiquetas por pieza** con el croquis del canto | **Excede 8.4** — el pegado pasa a ser un servicio cobrable con su tarifa. Se hizo igual | — |
| 09/09/2026 | CLIENTE (notas) | Productos: IVA editable (21/10,5/exento), recargo de elaboración, y la «dirección web» fuera del formulario (el slug se genera solo) | Incluido (8.4) | — |
| 09/09/2026 | CLIENTE (notas) | **Lista constructora** derivada de la general por porcentaje ajustable, y ajuste masivo por rubro y con base a elegir (precio vigente o costo, con o sin elaboración) | **Excede 8.4** — es una lista de precios nueva y otro modelo de derivación. Se hizo igual | — |
| 09/09/2026 | CLIENTE (notas) | **Reporte de reposición**: stock por sucursal y rubro cruzado con las ventas del período, cobertura en días y compra sugerida, con CSV y PDF | **Excede 8.4** — es un reporte nuevo con lógica propia. Se hizo igual | — |
| 09/09/2026 | CLIENTE (notas) | **Compras**: condiciones de pago del proveedor por escrito (modalidades, plazos, bonificaciones, convenios), pagos imputados a facturas (total/parcial a la vista), pago en varias partes y **cartera de cheques** en los dos sentidos con vencimientos 30/60/90 | **Excede 8.4** — tres módulos nuevos sobre compras. Se hizo igual | — |
| 09/09/2026 | CLIENTE (notas) | Marcar pagos y gastos «en blanco / en negro» | ~~Rechazado~~ → **Hecho el 11/9/2026.** Ver la fila del 11/9 | — |
| 11/09/2026 | CLIENTE (aclaración) | **Circuito de facturación en gastos, pagos a proveedores y cheques**, con filtro y totales separados | Incluido (8.4). **Corrige el rechazo del 9/9**: el pedido no era llevar un registro de evasión sino seguir por separado lo que se factura por otra vía o contra otra cuenta. Las etiquetas dicen «en blanco» y «en negro» porque es como lo nombra el equipo | — |
| 11/09/2026 | PRESTADOR | **El buscador del panel (⌘K) buscaba solo productos** con un campo que prometía «Buscar cliente, pedido, producto…». Ahora encuentra clientes, pedidos, presupuestos, comprobantes, cortes y proveedores, agrupados y filtrados por rol | Trabajo nuevo asumido | — |
| 11/09/2026 | PRESTADOR | **`cuttingOrders.orderId` estaba en la base y no lo escribía ni lo leía nadie**: el corte se cargaba suelto y el pedido no sabía que lo estaba esperando. Ahora el corte nace desde la ficha del pedido y se ve desde las dos puntas | Trabajo nuevo asumido | — |
| 11/09/2026 | PRESTADOR | **La ficha del cliente era un callejón sin salida**: listaba sus pedidos y presupuestos sin poder abrir ninguno, teniendo el id a mano. Es la pantalla que más se abre, con el cliente al teléfono | Trabajo nuevo asumido | — |
| 11/09/2026 | PRESTADOR | **Gastos mostraba un mes en el encabezado y otro en la tabla**: `listarGastos()` ignoraba el período que sí se aplicaba al desglose por categoría, y el selector de mes no existía en pantalla. Lo mismo en Retenciones sufridas | Trabajo nuevo asumido | — |
| 11/09/2026 | PRESTADOR | **Filtrar en Stock o en Precios expulsaba a Productos**: el buscador compartido tenía la ruta escrita fija. Ahora sale de `usePathname` | Trabajo nuevo asumido | — |
| 11/09/2026 | PRESTADOR | Bloque «Para hoy» en el resumen, con conteos que ya se calculaban y vivían encerrados en cada pantalla; las cuatro tarjetas pasan a ser enlaces al listado ya filtrado | Trabajo nuevo asumido | — |
| 11/09/2026 | PRESTADOR | Puente factura de compra → pago (el formulario llega con el proveedor y la factura imputada), certificados de retención descargables desde la tabla, y cheques enlazados a su cliente y a su proveedor | Trabajo nuevo asumido | — |
| 11/09/2026 | CLIENTE (notas 85) | **«Generar orden de compra» desde el reporte de reposición**: el reporte decía qué y cuánto comprar y no dejaba hacer nada con eso, que es lo que la nota pedía («tiene que ser accionable») | Incluido (8.4) | — |
| 11/09/2026 | PRESTADOR | Bitácora y campana de actividad con enlace a la entidad tocada; menú reagrupado (Ventas gana grupo propio, «Administración» tenía 16 ítems de cuatro circuitos distintos) | Trabajo nuevo asumido | — |
| 11/09/2026 | CLIENTE (pedido directo) | Textura en todas las superficies del panel y barra lateral oscura en los dos temas | Incluido (8.4) | — |
| 11/09/2026 | CLIENTE (notas 3) | **El umbral de candidatos a baja se edita en pantalla** y queda en la bitácora. Era una constante del código: cambiar doce meses por dieciocho pedía un despliegue | Incluido (8.4) | — |
| 11/09/2026 | CLIENTE (notas 84) | **Imputación contable por producto.** Era el único de los cuatro que pidió —subrubros, IVA, imputaciones, SKU— que no existía. Va como texto con sugerencia de lo ya usado: **el plan de cuentas todavía no lo dio el contador** | Incluido (8.4) | — |
| 11/09/2026 | CLIENTE (notas 4) | **Corte «Elaborado vs. bruto» en reportes**: el «qué porcentaje dejan las materias que se maquinan» que falta al lado de la utilidad por rubro | Incluido (8.4) | — |
| 11/09/2026 | CLIENTE (notas 76) | **El remito se rotula «entrega total» o «entrega parcial»** y, cuando queda acopio, imprime qué queda. Se calcula al momento de ese remito, no al de hoy: reimprimirlo dice lo mismo que decía | Incluido (8.4) | — |
| 11/09/2026 | CLIENTE (notas 79) | **Selector de tipo de operación en el mostrador** (contado / cuenta corriente / acopio). **No son tipos de comprobante fiscal**: la letra la decide la condición de IVA y no se elige. El «etc etc etc» de la nota queda pendiente de que la clienta enumere qué más | Incluido (8.4) | — |
| 11/09/2026 | CLIENTE (notas 81) | **«Emitido en el mostrador» en Caja**: qué vendió cada caja y cada operadora, con el número provisorio del ticket, para reimprimir desde cualquier equipo | Incluido (8.4) | — |
| 11/09/2026 | CLIENTE (notas 57) | **Franja de marcas en el catálogo**, con filtro por marca —que existía en el DAL y no se podía alcanzar—. Por nombre hasta que lleguen los logos sueltos | Incluido (8.4) | — |
| 11/09/2026 | PRESTADOR | La ficha del pedido traía **todas** las filas de `delivery_items` de la base y filtraba en memoria | Trabajo nuevo asumido | — |
| 11/09/2026 | PRESTADOR | El costo en la orden de compra y en la recepción salía con cuatro decimales (`44992.5600`), como lo guarda la base | Trabajo nuevo asumido | — |
| 11/09/2026 | PRESTADOR | **El enlace de WhatsApp al cliente abría un número que no existe**: la ficha armaba `wa.me/54…` sin el 9 de celular y la lista no ponía prefijo. Ahora sale de una sola función, con tests | Trabajo nuevo asumido | — |
| 11/09/2026 | PRESTADOR | Acciones rápidas en la lista de clientes (ficha, presupuesto nuevo con el cliente puesto, WhatsApp, resumen de cuenta), y `/admin/presupuestos/nuevo?cliente=` que antes ignoraba el parámetro | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | **El cierre del mes mandaba revisar asientos que no mostraba.** Decía «N asientos no cierran, no exportes hasta revisarlos» y el listado no estaba en ninguna parte; el botón de exportar seguía apretándose igual. Ahora los lista con la diferencia de cada uno y exportar con asientos rotos pregunta antes | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | **Anular un cheque era un clic sin vuelta atrás**, pegado a «Depositar» con seis píxeles de por medio, y el estado `anulado` no tiene salida. Un comentario del propio archivo decía que no debía estar ahí y el código no lo cumplía | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | **Se podía dar de baja una caja con ventas cobradas sin subir.** La pantalla mostraba «N sin subir» al lado del botón y la acción del servidor no lo miraba | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | Confirmación unificada para todo lo que no tiene vuelta (`components/admin/confirmar.tsx`). El problema no era que faltaran confirmaciones sino que estaban repartidas: anular una factura pedía motivo y anular un cheque no preguntaba nada | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | **Dar de baja un documento técnico era un tacho de 32 píxeles sin etiqueta, sin confirmar y sin vuelta atrás**: la lista de dados de baja solo ofrecía «Ver archivo». Ahora tiene texto, pregunta, y «Volver a publicar» | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | **`/taller` no se alcanzaba desde ningún lado**: el rol aserradero cae ahí al entrar, pero cualquier otro tenía que tipear la dirección. Es la puerta que `/admin/whatsapp` ya tenía hacia `/atencion` | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | **El aviso de «se guardó» salía abajo a la derecha, cuatro segundos, y clavado en tema claro** con el tema oscuro andando. Ahora sale arriba al centro, dura seis segundos y sigue el tema real de la app | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | El componente de estado vacío existía y lo usaban 3 de ~20 pantallas. El caso de manual: Vendedores decía «todavía no hay vendedores» y el formulario de alta estaba al final de la página, debajo de la lista de inactivos | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | **Jerga visible, barrida**: «ítem» (28 apariciones) pasa a «producto» o «renglón», `"Datos inválidos."` (10 pantallas) a mensajes que nombran el campo, `Close` de los diálogos a `Cerrar`, y encabezados abreviados (`Cant.`, `Percep.`, `Neto`, `Medio`, `Circuito`) escritos completos | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | **La bitácora mostraba nombres de tablas**: el filtro «Sobre qué» ofrecía elegir entre `orden_compra`, `condicion_proveedor` y `retencion_sufrida`, y el rol salía «deposito» cuando la barra de arriba decía «Depósito». Con test que lo vigila | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | Las tres pantallas de configuración que eran un muro —WhatsApp, ARCA y el formato del corte— separan lo que hace el dueño del negocio de lo que hace quien mantiene el sistema. El operario de la seccionadora ya no elige entre «Windows (CRLF)» y «Unix (LF)» | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | **`tabla` faltaba en el selector de unidad de venta.** Es la unidad del deck: el modelo y el sembrado se cambiaron cuando la clienta pidió dejar de venderlo por metro cuadrado (notas 8) y el formulario se quedó atrás, así que un deck nuevo no se podía cargar bien. `formatearUnidad` también tenía cuatro unidades sin nombre y el kilo escrito `kilo` cuando el enum dice `kg`. Con test atado al enum | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | **Los precios no decían si eran con o sin IVA** en la pantalla donde se cargan, y los cuatro campos de stock no decían de qué unidad hablaban. Los dos precios se guardan finales, con IVA: es la regla de `lib/precios/vista.ts` | Trabajo nuevo asumido | — |
| 13/09/2026 | PRESTADOR | Las etiquetas de **Largo (mm)**, **Ancho (mm)**, **Cantidad** y **Etiqueta** del despiece estaban en 12 px gris apagado —donde equivocarse significa cortar mal una placa—, y el mostrador achicaba los campos de tarjeta, lote y cupón justo en el momento de cobrar | Trabajo nuevo asumido | — |
| 13/09/2026 | CLIENTE (notas 61) | **«Hacer más promoción de hacer una cuenta»: estaba a un tercio.** Había un solo enlace a `/registro` en toda la app, en la barra y solo desde pantallas anchas: en celular y en tablet no existía ninguno. Ahora está en el menú móvil, en el pie y en el cierre de la portada | Incluido (8.4) | — |
| 13/09/2026 | CLIENTE (notas 85) | **El reporte de reposición no cortaba por rubro.** El rubro era columna de la tabla pero el filtro solo aceptaba categoría; el PDF y el CSV ahora respetan el mismo corte que la pantalla | Incluido (8.4) | — |
| 13/09/2026 | PRESTADOR | El listado de pagos a proveedores era el final del circuito de compras y no decía contra qué facturas se imputó cada pago, teniendo el dato guardado. Los últimos movimientos de Stock no abrían la ficha del producto, y «Proveedores activos» no llevaba a su filtro, que ya existía | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **Las 24 etiquetas del panel que no estaban atadas a su campo.** Hacer clic en «Precio de lista» no llevaba el cursor al campo, y con zoom o lector de pantalla el campo quedaba sin nombre. Incluye las que rotulan un selector propio, que se atan al disparador | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **El aviso de éxito no llegaba a verse** al desactivar un vendedor ni al anular un cheque: la fila se muda de grupo, el componente se vuelve a montar y el mensaje propio se pierde antes de que nadie lo lea. El éxito va ahora por aviso global; el error sigue al lado, porque ahí la fila no se mueve | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | Controles de 32 y 36 px llevados a 44 en donde son la acción principal: moderar reseñas, alta de vendedor, «Transferir stock», y los selectores de canto del despiece, que habían quedado chicos al lado de las medidas ya agrandadas | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **El aserradero no podía abrir una sola guía.** `/admin/ayuda` no estaba declarada en `ACCESO`, así que heredaba de `/admin` —que lo excluye— y encima la excepción del layout lo sacaba de todo lo que no colgara de `/admin/cortes`. La única persona sin panel detrás, la que está parada frente a la seccionadora, era la única sin ayuda; y la guía 8 está escrita para ella. Ahora la abre, y `/taller` tiene el acceso en su encabezado. Con test | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **El mismo remito decía dos cosas distintas según cómo se imprimiera.** El PDF decía «Remito de entrega total» o «parcial» y listaba lo que quedaba en acopio (notas 76); la impresión desde pantalla decía «Remito de entrega» a secas y no listaba nada. Dos papeles con el mismo número que no coinciden es peor que cualquiera de los dos | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **Un remito de retiro mostraba «Domicilio de entrega»** con la dirección del cliente. En un retiro no se entrega nada ahí: es un dato de la ficha, y rotularlo así invita a cargar el camión para un pedido que la persona ya se llevó. Corregido en las dos salidas | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | En las etiquetas de las piezas, la flecha que marca «respeta la veta» estaba dibujada y sin explicar, al lado de una leyenda que sí explicaba el lado grueso. Y el texto para lector de pantalla decía «2 lado(s)»: el plural entre paréntesis es de programador y se pronuncia | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | El presupuesto vacío invitaba a «usá la calculadora», que hoy no se alcanza desde ningún lado del sitio. Un texto que nombra una herramienta invisible manda a buscar algo que no está | Trabajo nuevo asumido | — |
| 14/09/2026 | CLIENTE (pedido directo) | **El plano de corte, adentro de la plataforma.** No se puede vender un corte sin ver cómo entran las piezas en la placa: de ese acomodo salen las placas que hacen falta, si se vende el corte o la placa entera, y las pasadas que se cobran. Hoy eso lo contesta CutMaster en el taller, y en el mostrador se decía un precio a ojo | Trabajo nuevo asumido | — |
| 14/09/2026 | CLIENTE (pedido directo) | **La regla de la media placa.** Si de una placa sale más de la mitad, se vende la placa entera y el corte va sin cargo: lo que queda ya no sirve para otro trabajo. Por debajo de la mitad se cobra el corte y el sobrante queda en la maderera. **La decisión se toma placa por placa**, no por trabajo | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | El plano se dibuja **mientras se carga el despiece**, en la misma pantalla del alta y sin esperar al servidor: el cálculo es geometría pura y corre en el navegador. Cargar una medida y ver que se pasó a una segunda placa es la información que hace falta antes de decir un precio, no después | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **El acomodo pasó de tiras a partición recursiva** y gasta un 9,8 % menos de placas: 876 contra 971, medido sobre 200 despieces. Una pieza baja en una tira alta desperdiciaba esa altura para siempre; ahora cada pieza va al hueco donde mejor calza y el resto se parte con un corte recto, que es como trabaja la seccionadora | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **Un error propio, corregido por escrito.** El primer informe comparaba «nuestro 64 % contra el 70-80 % de un optimizador». Está mal: para un despiece dado la superficie útil es fija, así que el porcentaje depende **solo de cuántas placas se usaron**. Un optimizador con tres placas da el mismo 64 %. Lo que sí distingue un acomodo es cuántas placas gasta y de qué tamaño es el retal que deja | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | El campo de pasadas deja de tipearse de memoria: llega con la propuesta del plano y un botón para aceptarla. Sigue decidiendo el operario —el patrón real lo arma el optimizador del taller— pero ya se puede presupuestar un corte sin haberlo optimizado antes | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | La ficha del corte muestra la cuenta desglosada —placas enteras a precio de placa, pasadas de las que no lo son, tapacanto aparte— con la explicación escrita de por qué el precio es ese, y avisa qué falta cuando no se puede cobrar | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **La ficha del corte imprimía «null»** en el encabezado cuando el trabajo no tenía sucursal: `branchId` la admite en nulo y se concatenaba sin preguntar | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **La ficha del corte era una pared de texto.** Cuatro párrafos explicaban el acomodo —"de dos placas sale más de la mitad, así que se venden enteras", "queda un retal de 1540 × 1540"— y cada uno repetía un número que ya estaba en pantalla dos veces. Lo que faltaba no era explicación: era ver la placa. Los párrafos salieron y entró el dibujo, con la decisión escrita en cada una | Trabajo nuevo asumido | — |
| 14/09/2026 | CLIENTE (pedido directo) | **Meter mano en el plano con el mouse**, como un programa del rubro. Se arrastra una pieza a otra placa y se la manda ahí; doble clic la gira; cada pieza movida queda marcada y se puede devolver al automático de a una o todas juntas | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **Se arrastra a una placa, no a un punto, y es deliberado.** El primer intento guardaba la coordenada exacta y no se podía reconstruir: esa esquina existía por las otras piezas, y en una placa virgen no hay dónde apoyarla. Peor: soltar piezas en coordenadas libres arma patrones con forma de molinete que **la seccionadora no puede cortar**, porque no sabe hacer una L. La placa la elige la persona; el milímetro lo resuelve el cálculo, que además no se equivoca con el ancho de sierra | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **La hoja del taller decía mal de quién es el sobrante.** De una placa que se vende entera el recorte es del cliente y se va con él; de una que se cobró por corte, vuelve al stock. Estaban rotulados todos igual, así que el taller habría guardado material ajeno. Ahora cada recorte dice a quién pertenece y cada placa lleva su sello | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | El campo «Placas» del alta se completa solo con lo que calculó el plano, y la ficha muestra ese número en vez del cargado a mano —avisando cuando no coinciden—. Antes la misma pantalla decía «1 placa a cortar» arriba y «3 placas» en el plano | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **El acomodo corregido a mano no se guardaba.** Movías una pieza, apretabas Guardar y volvía al automático sin avisar: la corrección solo existía mientras la pantalla estaba abierta. Ahora se guarda con el corte (migración 0053, columna `acomodo_manual`), lo respetan la ficha y la hoja del taller, y queda en la bitácora | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | El acomodo también se corrige **después** de cargado el trabajo, no solo en el alta: un corte entra a la cola y al mirarlo con calma se decide que esa puerta salga de la placa nueva. Se prueba en el navegador y recién se escribe al apretar Guardar | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **El corte se vende desde el mostrador.** Antes se cobraba como un renglón escrito a mano —"corte a medida" y un precio de memoria— y el trabajo se cargaba después, o no se cargaba: eran dos sistemas para la misma venta. Ahora el buscador ofrece «Cortar» sobre cualquier placa con medida, se carga el despiece, se ve el plano y de ahí salen los renglones: las placas enteras con su variante —que descuentan stock— y el corte y el tapacanto sin variante | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **El trabajo nace con la venta, dentro de la misma transacción**, y no al armar el despiece: una venta que se cancela no puede dejar un corte fantasma en la cola del taller, con el aserradero cortando una placa que nadie pagó. Queda atado al pedido por `orderId` | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **Sin conexión no se puede vender un corte, y se dice.** El botón no aparece: la venta se encola pero el despiece no viaja en la cola, y cobrar un corte que nunca llega al aserradero es peor que no poder venderlo —el cliente se va con el comprobante y vuelve a buscar piezas que nadie cortó— | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **La copia local del mostrador no se enteraba de los campos nuevos.** El delta solo trae lo que cambió, así que una variante ya guardada nunca volvía a bajar y se quedaba sin la medida de placa: el botón de cortar no aparecía y no había nada roto que mirar. Ahora la copia lleva versión de forma y subirla obliga a bajar todo una vez | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | **Las promociones bancarias ahora dicen quién pone la plata** (migración 0054). Un reintegro de MODO o del Hipotecario lo paga el banco: el cliente abona el total y se lo devuelven. Descontarlo en el mostrador sería que la maderera ponga de su bolsillo lo que iba a poner otro, y sobre el 15 % de una venta de placas es mucho. El campo es obligatorio al cargar la promoción: no se puede dejar sin decidir | Trabajo nuevo asumido | — |
| 14/09/2026 | PRESTADOR | El mostrador muestra las promociones vigentes, **plegadas y sin tocar el total**, con la etiqueta de quién las paga. Lo que sí se descuenta solo —el 10 % de contado y transferencia— sigue viviendo en Formas de pago, que es la única pantalla que mueve precios: dos listas de descuentos es lo que hace que alguien aplique el mismo dos veces | Trabajo nuevo asumido | — |
| 14/09/2026 | CLIENTE (pedido directo) | **Cuotas en el mostrador** (migración 0055). Se elige en cuántas se paga cuando el medio es crédito —1, 3, 6, 9, 12, 18 o 24, que son los planes que aparecen en las promociones—, y sale en el ticket. **No cambia lo que se cobra**: las sin interés las financia el banco y la maderera cobra el total igual. Se guarda para el comprobante y para conciliar contra la liquidación de la terminal, donde una venta en doce cuotas se acredita distinto de una en un pago | Incluido (8.4) | — |
| 14/09/2026 | PRESTADOR | **El corte no se cobraba en ningún lado, y nadie lo había notado.** Las tarifas se cargan por familia —«Placas», «Tableros de madera», como las dio el brief— y el corte guarda el nombre completo de lo que se corta: «Melamina Blanca — 1830 x 2600mm — 18mm». La búsqueda comparaba esas dos cadenas por igualdad, así que **nunca coincidía**: la ficha decía «no hay tarifa cargada» para todo y el trabajo salía en cero. Ahora se busca por la categoría del producto. Se descubrió vendiendo un corte desde el mostrador; el mismo trabajo pasó de $ 0 a $ 20.400. Con tests | Trabajo nuevo asumido | — |
| 14/09/2026 | CLIENTE (pedido directo) | El diálogo de corte del mostrador era angosto y apilaba los campos de a uno: el `sm:max-w-md` del diálogo base le ganaba a la clase sin prefijo. Rehecho en dos columnas —se carga a la izquierda, se ve el plano a la derecha—, con los rótulos alineados y los dos cantos en un solo renglón | Incluido (8.4) | — |
| 14/09/2026 | PRESTADOR | Circuito del corte verificado de punta a punta con una venta real: el renglón entra con el descuento por transferencia, el trabajo nace en la cola del taller atado al pedido, y aparece en `/taller` y en el panel | Trabajo nuevo asumido | — |
| 17/09/2026 | CLIENTE (notas) | **Treinta y una observaciones de usar el sistema** (`notas.md`). Atendidas todas el mismo día salvo una. El grueso son ajustes de jerga y de operación —«Facturas / B» en vez de «en blanco / en negro», `/carrito` en vez de `/checkout`, sacar «dónde se corta», Enter entre campos— más cinco cosas que sí son trabajo: el corte para el cliente en el sitio, el reporte de corte en PDF, la cobranza con prioridad y bloqueo, el tablero de seguimiento y los avisos de venta en el teléfono | Incluido (8.4) las de jerga y operación; **trabajo nuevo asumido** las cinco últimas | — |
| 17/09/2026 | PRESTADOR | **Defecto: aprobar una cuenta profesional se caía entera** cuando quien la pedía ya se había registrado en el sitio. La aprobación buscaba la ficha solo por CUIT, no encontraba la del registro —que no tiene CUIT— e insertaba otra con la misma cuenta web, contra el índice único `customers_user_idx`. La transacción abortaba: ni ficha, ni solicitud aprobada, ni aviso, y el profesional habilitado no aparecía en Clientes. Con test | Trabajo nuevo asumido | — |
| 17/09/2026 | PRESTADOR | **Los 5 mm de la sierra se descontaban y no se veían.** El motor de corte los restaba desde el primer día, pero ninguna pantalla lo decía, así que la clienta no entendía por qué dos piezas de 900 no entraban en una placa de 1830. Ahora se dibujan a escala sobre cada corte, se escriben en las tres pantallas y en el reporte, y el valor sale de `/admin/calculadoras` en vez de una constante que nadie leía | Trabajo nuevo asumido | — |
| 17/09/2026 | CLIENTE (notas) | **El e-Cheq no puede salir por el circuito B.** Pedido textual: «para pagos en negro no usar los echeq, para que no crucen». Se rechaza en el pago a proveedores y en el alta manual de cheques, y el medio desaparece de la pantalla al elegir ese circuito | Incluido (8.4) | — |
| 17/09/2026 | CLIENTE (notas) | **Retenciones: solo Ingresos Brutos.** Se sembraron IIBB Misiones y Buenos Aires con jurisdicción, y Ganancias, IVA y SUSS quedaron **en cero sin borrarse**, como pidió la clienta. Las alícuotas ahora se cambian desde `/admin/arca/retenciones` sin tocar la base: las actualiza ARCA por resolución varias veces al año | Incluido (8.4) | Las alícuotas cargadas son las vigentes al 17/9; confirmarlas con el contador antes de retener |

| 17/09/2026 | PRESTADOR | **Lo que cuesta tener el sitio prendido.** Las pantallas públicas se armaban en el servidor en cada visita —incluidas las de los buscadores y las de los robots—, y cada cambio del carrito vaciaba la caché del sitio entero. Ahora el catálogo, la ficha de producto, Moldava y el armador de cortes se sirven ya armados, con el precio del profesional corregido en su navegador. Documentado en `docs/COSTOS-Y-BOTS.md` | Trabajo nuevo asumido | — |
| 17/09/2026 | PRESTADOR | **Límite de frecuencia y robots.** No había ninguno: el formulario de ingreso se podía probar sin tope, y confirmar una compra —que quema numeración, reserva stock y manda trabajo al aserradero— era una dirección pública sin freno. Se agregó un limitador propio contra Postgres en las diez acciones que cuestan plata, y los robots que copian el catálogo para entrenar quedaron afuera del sitio. Con test | Trabajo nuevo asumido | — |

## Insumos pendientes del cliente

Lo que está trabado esperando algo del cliente. Cada ítem que frene el trabajo
se notifica por escrito invocando la cláusula 5.3.

| Insumo | Bloquea | Pedido el | Estado |
|---|---|---|---|
| Certificado digital ARCA (homologación y producción) | Que los comprobantes tengan valor fiscal | — | Pendiente |
| Punto de venta habilitado en modalidad *Webservices* | Lo mismo | — | Pendiente |
| Credenciales de Mercado Pago (producción y prueba) | Que los cobros online sean reales | — | Pendiente |
| Cuenta bancaria, CBU y alias | Pagos por transferencia | — | Pendiente |
| Alta del número en WhatsApp Business API | Que los avisos salgan de verdad | — | Pendiente |
| Casilla de correo y dominio verificado para el remitente | Que los avisos por correo salgan de verdad | — | Pendiente |
| Exportaciones del sistema anterior en CSV | Usar la migración de datos (1.9), que ya está construida | — | Pendiente |
| Fotos de productos y lista de precios vigente | Reemplazar los datos de desarrollo | — | Pendiente |
| Fotos reales de las dos sucursales | Hoy la página muestra una placa de marca en vez de una foto ajena | — | Pendiente |
| **Los hitos de la trayectoria** | El brief pedía el cuadro «año / qué pasó» y volvió con una sola fila —1981— y la columna del hecho vacía. Los cinco hitos intermedios que traía el prototipo se sacaron: no se inventa la historia de otro. `/nosotros` muestra hoy solo 1981 y 2026 | 05/09/2026 | Pendiente |
| **Último número emitido en los puntos de venta 15, 17 y 20** | **Bloquea emitir el primer comprobante.** La plataforma numera desde `puntos_venta.numeroInicial`; en cero arranca en 1 y pisa una serie que ARCA viene contando hace años. Un salto de numeración fiscal no se corrige después. Se carga en `/admin/arca` | 05/09/2026 | Pendiente |
| **Desde qué monto aplica el −15 %** por volumen | El brief dice «si son compras de mayor volumen se hace un -15%» sin decir desde cuánto. Está cargado el −10 % de contado y transferencia; el escalón del 15 % entra como una fila más en `payment_discounts` | 05/09/2026 | Pendiente |
| **Alícuota de percepción de Ingresos Brutos** | Quedó en cero y `percibeIibb` apagado: percibir de más es plata que después hay que devolverle a cada cliente. La confirma el contador (Nigro) | 05/09/2026 | Pendiente |
| **Alícuotas de retención de Ingresos Brutos** | Las cargadas —1,5 % Misiones, 0 % Buenos Aires— son las de referencia al 17/9. Retener de menos deja una deuda con la provincia; de más, plata del proveedor. Las confirma el contador y se cambian desde `/admin/arca/retenciones` sin tocar el sistema | 17/09/2026 | Pendiente |
| **Claves de Google Places** (`GOOGLE_PLACES_API_KEY` y `GOOGLE_PLACE_ID`) | Que las reseñas de Google se traigan solas. **No bloquea nada**: mientras tanto se cargan a mano desde Contenido → Reseñas del negocio, que además es lo que permite elegir cuáles se muestran | 17/09/2026 | Pendiente |
| **Claves VAPID para los avisos del panel** | Que el panel avise en el teléfono cuando entra una venta, como pidió la clienta. Se generan de nuestro lado con `npx web-push generate-vapid-keys` y se cargan como variables de entorno: **es lo único que falta** para encenderlo | 17/09/2026 | Pendiente (lo genera el PRESTADOR al desplegar) |
| **Qué se quiere con CDI** | La nota decía «CDI para la maderera» y resultó ser una empresa de envíos, no el documento fiscal. Sin saber qué se espera —¿que figure como transporte en el remito? ¿un acuerdo de flete?— no hay nada que construir | 17/09/2026 | Pendiente de definición |
| ~~**Texto del testimonio de Ezequiel**~~ | **Cerrado el 7/9/2026.** Los testimonios salieron del sitio junto con el blog. Lo que opinan los clientes ahora sale de las reseñas de compra verificada, que exigen un pedido entregado detrás: es el mismo dato sin depender de que alguien consiga y firme un texto | 05/09/2026 | Cerrado |
| ~~**Los seis artículos del blog**~~ | **Cerrado el 7/9/2026**: la clienta decidió sacar el blog. Se respaldaron los seis artículos fuera del repo antes de borrar las tablas, y `/blog` y cada nota redirigen a la portada con 301 para no romper lo que alguien haya compartido | 05/09/2026 | Pendiente |
| **Revisión del texto de cambios y devoluciones** | La página nueva dice lo que el brief describe —se mira caso por caso y se resuelve por WhatsApp— en vez de inventar un plazo fijo. El propio cliente escribió «aceptamos sugerencias»: conviene que lo lea antes del lanzamiento | 05/09/2026 | Pendiente |
| **Definición del correo: `mjbj.ar` o `mjbj.com.ar`** | El dominio del plan es `.ar` y los correos del brief son `.com.ar`; la propia clienta escribió «capaz que tema de mail deberíamos reveerlo». Define el remitente verificado de los avisos y el marcado de Google | 05/09/2026 | Pendiente |
| **Desperdicio aceptable por material** en placas | El brief dice «depende del material» sin dar los porcentajes. Sigue en un único margen del 12 %, pero **ya no hace falta un despliegue para cambiarlo**: se carga en `/admin/calculadoras` | 05/09/2026 | Pendiente, ya no bloquea |
| **Pendiente de techo y solape de membrana** | El brief preguntaba por el solape y no lo contestó. Se aplica el 10 cm que trae impreso el rollo —especificación del material, no un supuesto— y una pendiente del 15 %. **Los dos se cargan ahora en `/admin/calculadoras`** | 05/09/2026 | Pendiente, ya no bloquea |
| **¿Quién paga cada promoción bancaria?** | De las ocho cargadas, seis son claramente del banco o la tarjeta (BNA, Mercado Pago, MODO, Hipotecario, Naranja, Clipper). **Tarjeta Fava «hasta 20 % de descuento» y Sport Club «15 % de bonificación» son ambiguas**: si las pone la maderera hay que cargarlas además en Formas de pago para que se descuenten. Quedaron marcadas como del banco, que es el lado seguro —no descontar de más— | 14/09/2026 | Pendiente |
| **¿Cómo son los links de pago de los bancos?** | La clienta menciona convenios donde el banco da un link de pago. Qué da cada banco, en qué formato y cómo se concilia contra la venta es un relevamiento propio, parecido al del taller: sin ver uno real no se puede diseñar | 14/09/2026 | Pendiente |
| ~~**Cuotas en el mostrador**~~ | **Cerrado el 14/9/2026.** El cobro registra en cuántas cuotas se pagó y sale en el ticket. Los planes ofrecidos son 3, 6, 9, 12, 18 y 24: si usan alguno más, se agrega a una constante | 14/09/2026 | Cerrado |
| **¿El umbral de media placa es 50 %?** | Es la regla que decide si se cobra el corte o se vende la placa entera. Quedó en 50 % porque es lo que se dijo —«si se necesita más de media placa, se le vende la placa entera»—, y vive en una constante con nombre: moverlo es cambiar un número, no un despliegue | 14/09/2026 | Pendiente |
| **¿Desde qué medida un sobrante es retal?** | Hoy 150 mm de lado: por debajo no entra ni un travesaño y guardarlo ocupa depósito sin que nadie lo use. Es criterio de taller y conviene confirmarlo en la visita | 14/09/2026 | Pendiente |
| **Correr el mismo despiece en CutMaster y en la plataforma** | Es la única forma de saber cuántas placas de diferencia hay de verdad, que es lo único que se paga. Con un archivo de trabajo real alcanza | 14/09/2026 | Pendiente |
| **¿La calculadora vuelve al menú?** | Salió del menú por pedido del cliente, pero el brief contestó en detalle las cuatro fórmulas y trata la herramienta como viva. Las fórmulas ya se corrigieron; volver a enlazarla es una decisión suya y no se revirtió sola | 05/09/2026 | Pendiente |
| **El plan de cuentas del contador** | La imputación contable de productos ya se carga, como texto libre con sugerencia de lo ya usado. Con el plan real pasa a ser una lista cerrada y esa columna es de dónde se migra | 11/09/2026 | Pendiente |
| **Qué otros «tipos de factura» del mostrador** | La nota 79 dice «de acopio, cuenta corriente contado, etc etc etc». Los tres nombrados están; el «etc» no se puede adivinar, y los tipos fiscales (A/B/C) no se eligen a mano: los decide la condición de IVA | 11/09/2026 | Pendiente |
| **¿La calculadora vuelve a algún lado?** | Está construida, con las sugerencias de productos que pide la nota 55 funcionando, y **hoy no la ve nadie**: no la enlaza el menú, ni el pie, ni la portada, ni el mapa del sitio. Se llega solo si el asistente la sugiere. Salió del menú a pedido de la clienta, así que no se la vuelve a enlazar por la puerta de atrás: la decisión es suya | 13/09/2026 | Pendiente |
| **¿«Rubro» es la categoría o el subrubro?** | El reporte de utilidad corta por **categoría** —«que es lo que ellos llaman rubro», dice el comentario del código—. Era cierto antes de que existiera la tabla de subrubros; ahora son dos niveles distintos y el reporte quedó en el de arriba. Es el vocabulario de la clienta, no el nuestro: lo define ella | 13/09/2026 | Pendiente |
| **Los PDF de proveedores no se leen, y es una decisión** | La nota 5 nombra primero los PDF. El flujo de listas de precios resuelve planillas muy bien —perfil de mapeo por proveedor, código del proveedor por variante— pero el importador acepta solo `.csv` y `.xlsx`: un PDF hay que pasarlo a planilla antes. Estaba enterrado en una línea de código; queda dicho acá | 13/09/2026 | Pendiente |
| **¿Corrieron los sembrados contra producción?** | `db:seed-negocio` es un script aparte de `db:seed`, y de él salen los 43 rubros de ferretería, los 9 de placas y la lista constructora. **En la base local corrieron** (78 rubros, 3 listas, 8 promociones bancarias); contra producción no se pudo comprobar desde acá. Si no corrieron, las notas 9, 64 y 88 no existen para la clienta por más que el código esté | 13/09/2026 | Pendiente |
| **Logos de las marcas de ferretería** | Las notas del 7/9 dan la imagen del sitio anterior (`mjbj.ar/mdh/2023/12/marcas-ferreteria.jpg`), que es una plancha con todos los logos juntos. Para usarla en el catálogo conviene tener los logos sueltos | 07/09/2026 | Pendiente |
| **Qué calculadoras considera «en proceso»** | Las notas dicen que «la mayoría de las calculadoras están en proceso» sin decir cuáles ni qué les falta. Las cuatro funcionan y sus parámetros ya se editan desde el panel | 07/09/2026 | Pendiente |
| **Los rubros de ferretería que faltan** | Los 43 que dio la clienta están cargados y navegables, pero **vacíos**: no aparecen en el sitio hasta que haya productos en cada uno. El brief da ~1000 SKUs para esa categoría | 07/09/2026 | Pendiente |
| Acceso al dominio `mjbj.ar` | Publicación (1.8) | — | Pendiente |
| Relevamiento del taller: qué programa optimiza el corte, su versión, y **un archivo de trabajo real** | Ajustar el formato de exportación a la máquina. El mecanismo ya está hecho y se configura en pantalla; sin el archivo no se sabe a qué apuntarle | — | Pendiente |
| Ruta de la carpeta que vigila el optimizador, y si esa PC puede salir a internet | Poner en marcha el agente del taller, que ya está construido. Es una variable de entorno, no código | — | Pendiente |
| Escalas de descuento por volumen para la lista profesional | El banner de profesionales de la portada muestra las escalas leyéndolas de la base. Sin ninguna cargada, sale sin la lista en vez de inventar números. Se cargan desde `/admin/profesionales` | — | Pendiente |

## Tres agujeros de acceso, cerrados el 7/9/2026

Aparecieron preparando la demostración, entrando a producción con un usuario de
cada rol y tecleando las direcciones a mano. Los tres son de la misma familia
que el que se cerró el 1/9: **una regla escrita en dos lugares, y uno de los dos
quedó atrás.**

| Qué abría de más | Quién | Por qué |
|---|---|---|
| `/atencion`, la bandeja de WhatsApp a pantalla completa, con las conversaciones de los clientes y su saldo al costado | Depósito y aserradero | Vive fuera de `/admin`, así que el layout del panel no la cubría, y la página solo pedía ser personal. `/admin/whatsapp`, que es la misma bandeja, sí rebotaba |
| `GET /api/mostrador/clientes` y `/catalogo`: el padrón entero con CUIT, domicilio y límite de crédito, y las dos listas de precios | Depósito y aserradero | La página `/mostrador` los rebotaba bien, pero la guardia de sus endpoints aceptaba cualquier rol de staff |
| `/admin/cortes/tarifas`, el precio por pasada del corte | Aserradero | La excepción que le abre `/admin/cortes` era un `else if` y esa rama no consultaba `ACCESO` en absoluto |

**Cómo quedaron.** Las tres rutas se declaran ahora en `ACCESO` —`/atencion`,
`/taller` y `/admin/cortes`— y la página y la API preguntan ahí en vez de
escribir el par cada una por su lado. La excepción del aserradero acota y no
habilita: lo saca de todo lo que no cuelga de `/admin/cortes`, y después decide
la lista igual que para los demás. Hay tests nuevos en `tests/acceso.test.ts`.

**La lección, otra vez la misma:** una ruta que vive fuera de `/admin` no está
cubierta por el layout que aplica la lista, así que hay que declararla igual. Es
lo que dice el comentario de `lib/roles.ts` y lo que las tres se saltearon.

## Un defecto de la firma del remito, corregido el 7/9/2026

Cargar un remito de retiro obliga a poner el documento de quien retira —"la
firma sola no identifica a nadie"—, pero la pantalla de firma lo pedía como
opcional, con el campo vacío, y guardaba lo que llegara. **Firmar sin
completarlo borraba el dato justo cuando el remito pasaba a ser la constancia.**
Ahora la pizarra propone el documento ya cargado y la firma sin documento no
pisa el guardado.

### Qué pedir exactamente para la migración

El sistema anterior es **ISIS ERP Manager** (Quality Soft Argentina), sobre SQL
Server. Soporte: Acosta Pablo, 223 541-1225. No tiene una exportación única:
**cada listado exporta su propia grilla a Excel**. Así que no hay que pedir "un
dump", hay que pedir **siete archivos**, y cada uno se sube por separado en
`/admin/migracion`:

| Archivo | De qué listado sale | Qué columnas conviene que tenga |
|---|---|---|
| Clientes | Listado de clientes | Código, razón social, CUIT, condición IVA, correo, teléfono, domicilio, límite de crédito |
| Artículos | Listado de artículos con precios | Código, descripción, rubro, medida, unidad, precio de lista, precio profesional |
| Existencias | Informe de stock por depósito | Código, depósito, existencia, stock mínimo |
| Cuentas corrientes | Resumen de saldos al día del corte | Código de cliente, nombre, saldo |
| Proveedores | Listado de proveedores | Código, razón social, CUIT, condición IVA, correo, teléfono, domicilio, saldo |
| Histórico de ventas | Listado de ventas del período | Número de comprobante, fecha, código de cliente, total, detalle, sucursal, vendedor |
| Comprobantes emitidos | Listado de comprobantes | Punto de venta, tipo, número, fecha, cliente, CUIT, neto, IVA, total, CAE |

Cuatro precisiones que evitan una vuelta entera:

- **El .xlsx se lee directamente.** Ya no hace falta pasarlo a CSV: se sube tal
  como lo exporta el sistema. El CSV también sirve.
- **Los nombres de las columnas no importan**: el asistente pregunta cuál es
  cuál. Lo que importa es que **estén** las de la tabla, sobre todo el **código
  de cliente**, que es lo que ata cada saldo, cada venta y cada comprobante a su
  ficha, y lo que permite volver a correr la migración sin duplicar la cartera.
- **El orden importa**: clientes antes que saldos, antes que el histórico y los
  comprobantes; artículos antes que existencias.
- **El histórico va por año.** El tope por archivo es de 100.000 filas y 8 MB;
  con 300 a 700 pedidos por mes, un archivo por año entra cómodo y, si algo
  sale mal, se vuelve a subir solo ese año.

**El histórico de ventas y los comprobantes emitidos van a un archivo aparte,
de solo lectura.** No entran a `orders` ni a `invoices`, y es deliberado: un
pedido viejo cargado como pedido dispararía reservas de stock por mercadería
entregada hace años, y un comprobante viejo contaminaría el correlativo de los
comprobantes nuevos. Se migran para poder consultarlos, que es la pregunta real
—"¿qué le vendimos a este cliente en 2019?"—.

### Qué pedir exactamente para el corte

La seccionadora no corta desde la plataforma: corta desde el programa que vino
con la máquina, que es el que arma el patrón. Lo que la plataforma le entrega es
la **lista de piezas**, para no volver a tipear medidas que ya están cargadas.

Ese archivo ya se genera y su formato se configura en `/admin/cortes/formato`.
Lo que falta para dejarlo fino es una visita corta al taller con esta lista:

- **Qué programa usan para optimizar y qué versión.** Las habituales acá: Cut
  Rite (Homag/Holzma), Ardis, Corte Certo, Optimik, o el propio de la máquina.
- **Foto del menú «Importar»**, para ver qué extensiones acepta.
- **Un archivo de trabajo real y una lista de piezas real, en un pendrive.** Es
  lo que más vale: un ejemplo concreto define el formato mejor que cualquier
  manual.
- **Si la PC de la máquina está en red o si todo va por pendrive.** Decide si
  más adelante conviene un agente local que deje el archivo solo en la carpeta,
  en vez de copiarlo a mano.

El cuestionario completo —máquina, software, proceso e infraestructura— está en
`PLAN.md`, sección 9.2.
