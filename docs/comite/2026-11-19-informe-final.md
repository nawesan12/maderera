# Comité final: rama n211-panel (T1..T8 y uniones de carriles)

Revisaron ocho personas: dueño, operario, contador, carpintero, diseñador, seguridad, QA y escala. También se recorrieron las pantallas con los 4 roles y el sitio público, a 1440 y a 390 px (176 capturas en esta carpeta). Todos los usuarios locales existen y entran por `/ingresar`. Nadie escribió en la base. Revisé yo mismo, en el código y con consultas SQL de solo lectura, cada hallazgo alto y medio. No hubo que descartar ninguno de fondo. Dos los bajé de severidad y otro lo pasé a decisión; abajo explico cada caso.

## Veredicto: todavía no se despliega

Las tandas cumplen lo que prometían en casi todo. La unión de carriles quedó limpia: los generados coinciden byte a byte, `go build`, `go vet` y `tsc` pasan, y las migraciones no se repiten. En escritorio no hay nada roto. Pero quedan **cinco problemas altos** que tocan la plata o el CSV del estudio, y una **regresión de seguridad de T3**. Tres de los altos los trajeron las tandas (el corte cobrado dos veces, los topes de la devolución de T6 y el padrón con el tope de T8). Los otros dos ya estaban antes. Hace falta una tanda corta: los seis puntos se arreglan con cambios chicos y bien localizados. Después de eso se puede desplegar.

---

## Altos

### A1. «Plata hoy» no suma lo que el mostrador cobra con tarjeta, transferencia o MP
- **Archivo:** `backend/internal/reportes/dueno.go:438`. Filtra por `o.cobrada_at >= $1`, y `mostrador/venta.go:513` guarda `cobrada_at` solo en las ventas sin conexión.
- **Verificado:** PED-1098, 1099 y 1101 (transferencia, $1.111,05) tienen `cobrada_at` NULL, y en el Panel «Plata hoy» da $0. Ya estaba antes de las tandas (8e03179).
- **Arreglo:** usar `coalesce(o.cobrada_at, o.created_at)`, como hacen `caja/panel.go:141` y `reportes/cobros.go:272`. Sumar en dueno_test una venta con conexión pagada por transferencia.

### A2. Corregir un corte ya agregado lo cobra dos veces, y al taller llega un solo despiece
- **Archivos:** `app/mostrador/vista.tsx:1037` (onAgregar hace `setLineas(prev => [...prev, ...nuevas])` y no reemplaza nada), `app/mostrador/lineas.tsx:78-94` y `backend/internal/mostrador/controles.go:183-228` (faltaDelCorte controla que no falte cobrar, pero no que sobre).
- **Qué pasa:** T4 sacó la cantidad de los renglones del corte («se corrige reabriéndolo»). Al reabrir, el diálogo arranca vacío. Los renglones nuevos se suman a los viejos, mientras `setCorte` se queda solo con el último despiece. Resultado: se cobran dos placas, dos cortes y dos tapacantos sin pedir PIN. Con dos placas distintas en la misma venta pasa lo mismo.
- **Arreglo:**
  - En onAgregar, sacar primero las líneas que están en `renglonesDelCorte`.
  - Al reabrir «Cortar» con un corte ya en la venta, cargarlo para editarlo.
  - Si la placa es otra, preguntar «¿Reemplazar el corte?».
  - En Go, rechazar la venta cuando lo cobrado del corte pasa lo que da el plano.

### A3. Devolución parcial «por caja» de un pedido que no se cobró, o que se cobró con recibo por otro medio
Unifica el hallazgo del dueño (topes) con el del contador (asiento).
- **Archivos:** `backend/internal/facturacion/devolucion.go:160-178` (partesDeLaVenta) y `:820-848` (tramosDelEfectivo).
- **Qué pasa:**
  - Sin `order_payments`, la función toma el total del pedido como cobrado por el `medio_pago` original. Ningún pedido de presupuesto tiene `order_payments`: se cobran con recibo.
  - Entonces sale efectivo del turno por plata que nunca entró, o que entró por banco.
  - `tramosDelEfectivo` busca en `payments`, no encuentra nada y devuelve `nil` sin anotar el tramo. La nota de crédito acredita Deudores, la caja tiene la salida y el CSV no tiene el asiento Deudores/Caja.
  - Además, `SinCobrarDelPedido` no resta lo devuelto, así que «Me deben» le sigue reclamando el total al cliente.
- **Arreglo:**
  - Calcular los topes con lo cobrado de verdad: `order_payments`, o si no hay, las `receipt_parts` de los recibos vivos del pedido, por medio, más los `payments` aprobados.
  - Si no se cobró nada, solo queda la opción de bajar la deuda.
  - Anotar el tramo como reintegro del recibo.
  - Que `tramosDelEfectivo` dé error en vez de `nil` cuando la caja paga y no encuentra el cobro.
  - Restar las devoluciones en `SinCobrarDelPedido`.

### A4. El cobro de un pedido sin cliente va entero al circuito B, y su factura queda abierta en Deudores
- **Archivos:**
  - `backend/internal/cobros/reparto.go:299-302` (claveDeRecibo): sin cliente ni `invoice_payments`, cae en `'r:<id>'`.
  - `reparto.go:323-338` (pendientesDelRecibo): busca por `r.customer_id`, que es NULL.
  - `backend/internal/cobros/recibo.go:208-229`: `FijarReparto` corre solo con cliente.
  - El camino es `cobros/pedido.go:137` (CobrarPedido → EmitirRecibo con `OrderID` y sin `invoice_payments`).
- **Qué pasa:** los 27 pedidos de presupuesto locales no tienen cliente. Se factura una B con CAE, se cobra desde la ficha, y el CSV blanco debita Deudores sin acreditarlo nunca. La plata, aunque sea una transferencia, va al CSV B. No hay ningún test de CobrarPedido.
- **Arreglo:**
  - Usar `r.order_id` en claveDeRecibo y en pendientesDelRecibo: con una factura con CAE la clave es `'f:<factura>'`, y sin factura el destino es `'o:<pedido>'`, que va como anticipo.
  - Llamar a `FijarReparto` siempre.
  - Sumar un test: pedido sin cliente, facturado y cobrado con recibo, donde Deudores del CSV blanco cierra en 0.

### A5. La importación del padrón de ARBA muere a los 30 s
- **Archivos:** `backend/cmd/mjbj/api.go:109` (T8: `Sentencia: 30s` en el pool principal) y `:398` (`facturacion.Nuevo(pool, log)`), contra `backend/internal/facturacion/padron.go:142,181`.
- **Qué pasa:** el padrón es un `CopyFrom` que va leyendo la subida de unos 200 MB, y después un `INSERT … SELECT DISTINCT ON` de millones de renglones, todo sin `SET LOCAL`. Es el cruce de dos carriles: T6 subió el padrón a Go y T8 le puso el tope al pool.
- **Agravante:** `plataforma/ocupado.go:28` traduce el 57014 en un 503 que dice «otra operación en curso», así que el contador reintenta sin fin.
- **Arreglo:**
  - Ejecutar `SET LOCAL statement_timeout = '20min'` como primera sentencia de la transacción, o darle al padrón un pool propio.
  - Que el 57014 no diga «otra operación en curso».
  - Una prueba con un pool con `topesDeLaAPI` y un lector lento.

---

## Medios

**Regresión de seguridad (T3)**
- **M1. La cola sin conexión vuelve a cargar a cuenta corriente a un cliente bloqueado.**
  - **Archivo:** `backend/internal/mostrador/venta.go:285`. La condición `if !cr.Puede && !sinConexion` deja pasar todo lo que llega con `numeroProvisorio`, un campo que manda el cliente (`:146`). Antes de T3 se rechazaba lo no autorizable.
  - **Arreglo:** `if !cr.Puede && (!sinConexion || !cr.Autorizable) { if !cr.Autorizable { return fallo(...) }; pideCredito = true }`, más un test de una venta de la cola con `cuenta_bloqueada=true`.

**Plata y números del dueño**
- **M2. Cancelar un pedido no mira los pagos en línea aprobados, y el depósito puede hacerlo.**
  - **Archivo:** `backend/internal/pedidos/acciones.go:250-275`. Frena por recibos y remitos, pero no consulta `payments`.
  - **Verificado:** en la base local hay 6 pedidos cancelados con el pago aprobado y sin reintegro.
  - **Arreglo:** si hay un pago aprobado sin reintegro completo, responder «primero devolvé el pago», y dejar esa cancelación solo para `roles.ManejanPlata`.
- **M3. La devolución parcial no baja lo vendido ni la ganancia.**
  - **Archivo:** `backend/internal/reportes/ventas.go:107` (margenesDe lee solo `order_items`), y `devolucion.go` no toca `order_items`.
  - **Qué pasa:** las mismas placas cuentan como vendidas y como disponibles a la vez. «Con factura» deja de coincidir con «Facturado neto».
  - **Arreglo:** restar en margenesDe el neto y el costo de `devolucion_items` por `order_item_id`. Sumar una prueba que dé la misma cifra en el Resumen, el Cierre y Reportes.
- **M4. «Me deben» no cuenta la mercadería que salió con remitos parciales.**
  - **Archivo:** `backend/internal/reportes/dueno.go:258` (solo `o.estado = 'entregado'`).
  - **Arreglo:** incluir los pedidos no cancelados que tengan remitos vigentes (lo remitido menos lo cobrado). Cuando el remito completa el pedido, reutilizar `NotaEntregadoSinCobrar`.
- **M5. «Ganancia del mes $0» en grande cuando lo que falta es el costo.**
  - **Archivo:** `components/admin/numeros-del-negocio.tsx:146-167`, y lo mismo en «Resultado del mes» de `app/admin/cierre/page.tsx`. Unifica dueño (baja) y diseñador (media).
  - **Arreglo:** si casi todo lo vendido está sin costo, mostrar «Sin costos cargados» y dejar el monto como dato secundario.
- **M6. La ficha del pedido da 100 % de margen con costo $0.**
  - **Archivo:** `backend/internal/pedidos/logica.go:55`. MargenDeLinea solo trata como desconocido nil o NaN; Reportes usa `costo_unitario > 0`.
  - **Arreglo:** tratar `*costo <= 0` igual que nil.

**Contador**
- **M7. El CSV «Deudores» mezcla la deuda del circuito B.**
  - **Archivo:** `backend/internal/reportes/contador.go:32-36` (todos los `account_movements`).
  - **Arreglo:** armar el aging desde el reparto, y sumar un pendiente del cierre que compare ese listado con el saldo de 1.1.03.
- **M8. Un cheque de cartera se puede endosar en un pago del otro circuito.**
  - **Archivos:** `backend/internal/compras/pagos.go:651-667` (solo frena el e-Cheq) y `reportes/asientos.go:221-235` (PartesPorCircuito completa lo blanco con un cheque negro).
  - **Arreglo:** rechazar el endoso cuando `cheques.circuito` no es el del pago, y no completar nunca lo blanco con un cheque negro.
- **M9. Las retenciones de un pago «negro» emiten certificado pero el pasivo va al CSV B.**
  - **Archivo:** `backend/internal/compras/pagos.go:404-470`. No hay control de circuito para las retenciones.
  - **Arreglo:** bloquear retenciones en un pago negro, o contarlas como pendiente del cierre. Esto lo decide el contador (ver abajo).

**Mostrador y depósito**
- **M10. El mostrador vende fracciones de artículos por unidad (vuelve la bisagra a 619,99).**
  - **Archivos:** `backend/internal/mostrador/esquemas.go:109` (solo exige `Positivo()`) y `app/mostrador/lineas.tsx:100-105`.
  - **Arreglo:** validar por renglón con `productos.AdmiteDecimales`, como `stock.go:97`, y usar `step=1` para esas unidades.
- **M11. Se puede guardar un precio de $0 desde la tabla de Precios.**
  - **Archivos:** `backend/internal/precios/servicio.go:352` (`n >= 0`) y `lib/precios/editar.ts:27`.
  - **Qué pasa:** con la lista en 0, vender a $0 no se mide como bajo la lista y no pide PIN.
  - **Arreglo:** exigir `n > 0`, igual que la importación.
- **M12. Un renglón «Cargar a mano» esquiva el control de precio.**
  - **Archivo:** `backend/internal/ventas/desvio.go:46`. Sin variante, el renglón entra a su propio precio.
  - **Arreglo:** como mínimo, mostrar los renglones a mano por vendedor en «Controles del personal». El tope con PIN lo decide el dueño.
- **M13. La caja del mostrador lee «15.000» como $15.**
  - **Archivo:** `app/mostrador/caja.tsx:57,62,282,298,396` (`Number()` sobre `type=number`).
  - **Arreglo:** usar `type=text` con `inputMode=decimal`, leer con `parsearImporte`, y sumar un test.
- **M14. Ctrl+Enter cobra en el acto.**
  - **Archivos:** `lib/mostrador/atajos.ts:197-201` y `backend/internal/mostrador/venta.go:233-234`.
  - **Qué pasa:** sin conexión, sobre una placa, la vende entera y la cobra en efectivo. Sobre un producto en $0, responde «El descuento no puede llevarse toda la venta» aunque nadie puso un descuento.
  - **Severidad:** que Ctrl+Enter cobre es una decisión documentada, así que esa parte pasa a decisiones. Como defecto queda el $0: no agregar resultados con precio 0, y que Go diga «falta poner el precio» cuando no hubo descuento.

**Pantallas a 390 px y en tablet** (no las rompieron las tandas)
- **M15. `/mostrador` a 390 y en tablet vertical.**
  - **Archivos:** `app/mostrador/vista.tsx:864` (`h-screen overflow-hidden`) y `:925` (`aside w-[420px] shrink-0`), más `lineas.tsx`.
  - **Qué pasa:** el total se ve como «$», y Débito, Transferencia y Factura quedan cortados.
  - **Arreglo:** apilar por debajo de `lg` (`flex-col lg:flex-row`, el aside a lo ancho y la barra del total fija abajo). Si no se va a usar en el teléfono, mostrar un aviso (ver decisiones).
- **M16. Encabezado de `/taller`: scroll lateral de 453 a 508 px para todos los roles.**
  - **Archivo:** `app/taller/page.tsx:54-72`. El nombre del usuario no tiene `hidden` ni `truncate`.
  - **Arreglo:** `hidden sm:block truncate` en el nombre, `min-w-0` en el encabezado, y Formato y Ayuda en un menú.
- **M17. Las acciones del remito quedan fuera de la pantalla, y un remito anulado ofrece «Firmar».**
  - **Archivo:** `app/admin/pedidos/[id]/entregas.tsx:350` (sin `flex-wrap`) y `:369-371` (`remito.firmaToken &&` no mira el estado).
  - **Arreglo:** usar `flex-wrap`, y mostrar el link de firma solo si `estado !== "anulada" && !firmadoAt`.

**Sitio público**
- **M18. Fotos de banco en las portadas de Ferretería y Cubiertas.**
  - **Archivo:** `lib/db/portadas-datos.ts:31,36`. Además, Moldava repite la foto de Molduras (`app/(public)/page.tsx:231`).
  - **Arreglo:** misma regla que en los productos: placa con el nombre del rubro.
- **M19. La cantidad de la consulta se recorta a 9999 sin avisar, y la inválida se descarta en silencio.**
  - **Archivos:** `lib/catalogo/consulta.ts:52` y `components/catalogo/selector-variante.tsx:510-532`.
  - **Arreglo:** marcar el campo como inválido, con un texto corto, y no mandar el mensaje sin la cantidad.
- **M20. El armador dice «En el aserradero» con Casa Central elegida, y Casa Central sigue anunciando el corte.**
  - **Archivos:** `app/(public)/corte/vista.tsx:419,430` y `lib/sucursales.ts:81,88`.
  - **Arreglo:** que el subtítulo salga de la sucursal elegida, y que los servicios de Casa Central también lean de `DONDE_SE_CORTA`.
- **M21. La medida va en letra monoespaciada aunque sea una frase.**
  - **Archivos:** `components/catalogo/precio-de-tarjeta.tsx:120-123` y `selector-variante.tsx:488`. Unifica carpintero y diseñador.
  - **Ejemplos:** «A medida — consultar», «Rojo teja».
  - **Arreglo:** la sans con `tabular-nums`; la mono queda solo para importes y códigos.

---

## Bajos
- Efectivo de recibos, anulaciones y devoluciones que entra a un turno mientras se cierra. Falta `FOR SHARE` en `cobros/recibo.go:357`, `mostrador/anular.go:298` y `facturacion/devolucion.go:645`. Es teórico: no se reprodujo.
- Una devolución parcial cuenta dos veces si después se anula la venta (`reportes/dueno.go:284`).
- Con más de 50 comprobantes sin CAE, el mensaje es engañoso: manda a revisar el punto de venta en ARCA (`facturacion/autorizar.go:240-243`).
- Una nota de crédito en dos partes deja el neto y el IVA a un centavo del original (`fiscal/notas.go:57-68`).
- El listado del padrón hace un regexp por cliente y por renglón (`facturacion/padron.go:241-248`). Hay que pasarlo a un CTE con hash join. Crece con los clientes de ISIS; con el tope de 30 s puede subir a medio.
- El tablero de cortes trae todos los cancelados de la historia (`cortes/servicio.go:103-107`).
- El inicio recorre `purchase_invoices` tres veces (`reportes/inicio.go:289-309`). Se resuelve con una sola consulta con FILTER.
- «Sucursales como lista» (hallazgo 35) no se hizo y no figura como pendiente en `docs/go/progreso.md`.
- «Cobrar y entregar» reusa la clave del cobro anterior (`components/cobros/dialogo-cobro.tsx:71-90`).
- Horas en formato de 12 h («12:16 a. m.») y medios de pago con la clave interna: `app/mostrador/ventas-de-hoy.tsx:74-78` y la hora de la anulada en `app/admin/caja/page.tsx`. Hay que usar `hora` de `lib/formato`. Lo marcaron tres revisores.
- Hidratación: `components/admin/tablas-apilables.tsx:43-53` escribe `data-label` y `data-ancho-natural` antes de hidratar. Explica los avisos en 8 pantallas.
- Porcentajes con punto: `app/admin/reportes/page.tsx:187,287,313` y `app/admin/pedidos/[id]/page.tsx:304`.
- Corte del mostrador: el campo «Sierra» sigue editable (`app/mostrador/corte-a-medida.tsx:436-451`), y quedan «½ al largo / ½ al ancho» en `buscador.tsx:301-302` y `(public)/corte/vista.tsx:681`.
- Stock: el − rápido anota una rotura como «Ajuste» (`app/admin/stock/ajuste-rapido.tsx:126`).
- Entregas: la coma se borra sin aviso y «1,5» queda «15» (`entregas.tsx:203-215`).
- «Esta PC…» vincula la terminal sin confirmar y no tiene vuelta atrás (`components/mostrador/vincular-caja.tsx:146-168`).
- Precios: seis o siete botones del mismo peso (`app/admin/precios/page.tsx:93-140`).
- El inicio del Depósito mezcla dos estilos de títulos (`components/admin/inicio-deposito.tsx:166`).
- En la lista de Presupuestos, los «·» quedan sueltos a 390 (`app/admin/presupuestos/page.tsx:283-309`).
- El despiece de la ficha del corte queda apretado a 390 (`app/admin/cortes/[id]/page.tsx:327`).
- La ficha del cliente dice «Cuenta creada con cliente:create.» (consulta `CrearFichaManual`; hay que regenerar sqlc).
- Sitio público:
  - las tarjetas de categoría dicen «3 productos»;
  - el asistente no tiene rótulo entre 1024 y 1535 px (`components/navbar.tsx:540`);
  - el WhatsApp flotante tapa campos de formularios a 390 (`components/whatsapp-button.tsx:31`);
  - el canto del armador público sigue sin indicación, el mensaje no dice «sin canto» y el placeholder del tapacanto perdió el ejemplo (`components/cortes/selector-canto.tsx:103`).
- Permisos: los rebotes no explican por qué, y el depósito puede entrar a /taller pero no tiene el link en la barra.

---

## Qué quedó sin resolver del informe original

| # | Estado |
|---|---|
| 2 | Resuelto salvo el tope de 50 anteriores, con un mensaje engañoso (bajo). |
| 3 | Asientos por circuito resueltos. Falta la conciliación del CSV de Deudores (M7) y aparece el hueco nuevo de CobrarPedido sin cliente (A4). |
| 5 | Resuelto en roles y recibos. «Me deben» no cuenta los remitos parciales (M4). |
| 6 | Resuelto en el Resumen, el Cierre y Reportes. La ficha del pedido sigue mal (M6). |
| 9 | Resuelto el diferido. Falta el candado en recibos, anulaciones y devoluciones (bajo). |
| 10 | Se esquiva con «Cargar a mano» (M12) y con un precio de lista en $0 (M11). |
| 13 | Resuelto, salvo los pedidos cobrados con recibo o sin cobrar (A3, M3). |
| 14 | Resuelto, salvo «Cobrar y entregar» (bajo). |
| 18 | Resuelto el mecanismo. Que Ctrl+Enter cobre se mantuvo por decisión (M14 y decisiones). |
| 21 | Parcial: el − sin motivo (bajo) y las fracciones en la venta (M10). |
| 22 | Parcial: el canto del armador público (bajo). |
| 25 | Parcial: las portadas de categoría (M18). |
| 27 | Parcial: el flotante sobre formularios, el asistente sin rótulo y verdes de WhatsApp sueltos (`components/footer.tsx:47`, `mi-cuenta/presupuestos/respuesta.tsx:47`). |
| 29 | Reaparece en el sitio público (M21). |
| 32 | Quedan `toFixed` con punto (bajo). |
| 35 | Falta «Sucursales como lista», sin anotar (bajo). Además, la importación del padrón quedó fuera de los topes (A5). |
| 42 | Quedan los cancelados del tablero y las facturas de compra del inicio (bajos). |
| 44 | El campo «Sierra» sigue en el mostrador (bajo). |
| 45 | Tope silencioso de 9999 y cantidad inválida descartada (M19). |
| 46 | Centralizado, pero espera a la clienta, y el armador se contradice (M20). |
| 48 | Sin resolver (bajo). |

Verificados como resueltos: 1, 4, 7, 8, 11, 12, 15, 16, 17, 19, 20, 23, 24, 26, 28, 30, 31, 33, 34, 36, 37, 38, 39, 40, 41, 43 y 47.

---

## Decisiones del dueño
1. **Ctrl+Enter en el buscador:** ¿sigue agregando y cobrando? Si sigue, que nunca cobre sin conexión sobre una placa ni con precio $0.
2. **¿El mostrador se usa en el teléfono?** Si se usa, se rearma la pantalla para el teléfono; si no, se muestra el aviso «Usalo en la computadora o la tablet». La tablet vertical sí hay que soportarla.
3. **Renglones «a mano»:** ¿se piden con PIN por encima de un tope, o alcanza con verlos en Controles del personal?
4. **¿Existe algún producto legítimo a $0?** Si no existe, se bloquea; si existe, va con confirmación y queda en la bitácora.
5. **Cancelar un pedido ya pagado:** ¿solo los roles que manejan plata, y siempre primero el reintegro?
6. **Una venta con varios cortes:** ¿se admite, o se reemplaza el corte anterior?
7. **Dónde se corta (hallazgo 46):** lo confirma la clienta. Mientras tanto, ¿se esconde el chip de Casa Central en /corte?
8. **«Ganancia del mes» sin costos cargados:** ¿a partir de qué porcentaje sin costo se deja de mostrar la cifra? Se propone 50 %.

## Decisiones del contador
1. **Retenciones en un pago del circuito B:** ¿se bloquean, o se parte el asiento y la retención va siempre al blanco (M9)?
2. **Cheque endosado entre circuitos:** ¿se prohíbe, o hay un caso que lo justifique (M8)?
3. **CSV de Deudores:** ¿el listado tiene que coincidir con el mayor de 1.1.03 del CSV blanco, sin la deuda del B (M7)?
4. **Cobro sin cliente de un pedido facturado:** ¿va contra la factura o como anticipo del pedido (A4)?
5. **Devolución de un pedido cobrado con recibo:** ¿el reintegro se asienta según el reparto del recibo original (A3)?
6. **Notas de crédito parciales:** ¿se toma el neto y el IVA como resto exacto del original (el centavo)?
7. **Serie trabada:** ¿cómo se autorizan más de 50 comprobantes sin CAE cuando llegue el certificado? ¿Una acción «Autorizar la serie» de a 50?

## Notas del entorno (no son defectos del código)
- La base local tiene restos de e2e:
  - «Anuló 24 ventas · 23 sin PIN», de antes de T3;
  - productos «Prueba de producto…» en el catálogo público;
  - remitos anulados en PED-1067.

  Inflan el Panel.
- El aviso «uncached data during prerendering» es de Next 16 en modo dev.
- `/login` da 404: el ingreso real es `/ingresar`.
