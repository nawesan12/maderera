# Handoff: Correo MJBJ (webmail propio, v2)

## Resumen
Cliente de correo web para Maderera JBJ, integrado al panel existente (`nawesan12/maderera`) pero con su propio menú. Una sola pantalla: carpetas · lista · correo abierto, y a la derecha una ficha del cliente (saldo, pedidos abiertos, botones Presupuesto/Pedido) que aparece solo cuando el remitente es cliente. Incluye escritorio y teléfono, claro y oscuro, y todos los estados (vacío, cargando, sin conexión, error, sospechoso).

## Sobre los archivos
`Correo MJBJ v2.dc.html` es una **referencia de diseño en HTML**, no código de producción. La tarea es **recrearlo en el código del repo** (Next.js / React, `app/globals.css`, componentes de `components/admin/`) usando sus patrones y librerías. No copiar el HTML tal cual.

Para abrirlo: servir la carpeta con cualquier servidor estático y abrir `Correo MJBJ v2.dc.html` (necesita `support.js` al lado y `public/cropped-icon-180x180.png`). Es un lienzo grande y pesado; tarda en cargar. La tweak `temas` (Ambos / Solo claro / Solo oscuro) reduce la carga.

## Fidelidad
**Alta fidelidad.** Colores, tipografía, tamaños y textos son finales. Recrear al píxel con los tokens del repo.

## Pantallas (ids del lienzo)
Todas se dibujan en un marco de **1600×1000** (escritorio) o **390** de ancho (teléfono), en claro y oscuro.

**Estructura base (escritorio, 2a)**
- Barra superior 72px, padding 0 20px, gap 16px:
  - Marca 236px: logo 36×36 r8 + «Correo» 19/600 + «Maderera JBJ» 14 `--mut`.
  - Buscador 720×50, r12, fondo `--srch`, ícono 20px, texto 17px «Buscar en el correo», ícono filtros a la derecha.
  - Derecha: «Volver al panel» (h42, padding 0 14, r10, 16px, ícono layout-grid), botón tema (claro/oscuro), ajustes (42×42), avatar 40 círculo `oklch(0.68 0.19 48)` blanco 15/600.
- Columna carpetas 272px (padding 4 14 16 16):
  - Botón Redactar h58, r16, fondo `--acc`, blanco 18/600, sombra `0 2px 0 oklch(0.45 0.17 42), 0 8px 20px -8px rgb(120 50 10/.55)`.
  - Panel de carpetas (margin-top 14, padding 8, r16, `--panel` + blur 8px). Filas h46, r10, 16px, gap 12; activa con `--side-act`.
- Lista de correos ~440px: fila con remitente (17/600 si no leído), asunto, primera línea (`--mut`), hora, clip de adjunto, etiqueta. Padding vertical = densidad (`--py`: Cómoda 18 / Media 14 / Compacta 10).
- Lectura (flex 1) sobre `--card`: asunto 24px, remitente, cuerpo 17/1.55, adjuntos como tarjetas, acciones Responder / Reenviar.
- Ficha de cliente 300px fondo `--cli`: saldo, pedidos abiertos, botones «Presupuesto» y «Pedido». Solo si el remitente es cliente.
- Fondo: madera clara con veta (ruido SVG `feTurbulence` en capas, ver `madera` en la lógica); en oscuro, la misma textura muy tenue.

**Grupos**
- **2a Bandeja con el correo abierto** — layout base descrito arriba.
- **2b Redactar** — ventana abajo a la derecha, minimizable, varias a la vez. Sugiere clientes al escribir el nombre. Avisa si el texto menciona adjunto y no hay.
- **2c Buscar** — resultados mientras se escribe; filtros como botones (chips r999).
- **2d Estados** (en contexto, dentro de pantallas reales):
  - Sin correos: confirma que está todo leído, botón volver a «Todos».
  - Cargando: filas esqueleto con la forma real + barra fina arriba. Sin saltos al llegar datos.
  - Sin conexión: franja arriba; se sigue leyendo lo descargado; lo enviado queda en cola.
  - Error del servidor: en palabras simples, cuándo reintenta, botón «Reintentar ahora».
  - Correo sospechoso: aviso arriba del mensaje, enlace engañoso explicado al pasar el mouse, ejecutable bloqueado.
- **2e Ajustes** — desde la ruedita. Reglas armadas como frase. «Casillas y alias» solo para administrador.
- **2f Teléfono** — menú lateral, buscar, aviso. En teléfono el correo abre a pantalla completa; carpetas en menú lateral; deslizar fila para archivar.
- **2g Descargar adjuntos** — «Descargar todo» abre lista con casillas para elegir; guardar en la ficha del cliente; guardar el correo como PDF; descarga en curso abajo.
- **2h Ver una foto** — visor sobre todo; flechas entre adjuntos, zoom, girar, imprimir, guardar en ficha.
- **2i Ver un PDF** — lectura sin descargar; si es despiece, ofrece «Pasar a presupuesto» o «Mandar a cortes».
- **2j Ver una planilla** — solo lectura con pestañas de hojas; para editar se descarga.
- **2k Responder** — en línea debajo del mensaje; texto anterior plegado.
- **2l Reenviar** — mismo lugar; adjuntos incluidos, se puede quitar alguno.
- **2m Imprimir** — vista previa con membrete; este correo o toda la conversación; qué adjuntos imprimir.
- **2n Etiquetas y mover** — desde ⋮: casillas de colores, crear etiqueta escribiéndola, mover a carpeta.
- **2o Programar el envío** — flecha junto a Enviar; horarios del local (fin de semana → lunes a la apertura) o día/hora a elección.
- **2p Firma y respuestas guardadas** — una firma por casilla con logo y datos de sucursal, vista previa real; respuestas guardadas con atajo.

## Interacciones y comportamiento
- Ficha de cliente: visible solo si el remitente coincide con un cliente.
- Hover de filas: `--sel`. Seleccionada/activa: `--side-act`.
- Popovers/menús: fondo `--pop`, sombra `--popsh`, r12–14.
- Avisos (toast): fondo `--toast`, texto `--toastT`, abajo al centro, con «Deshacer» cuando aplica.
- Redactar: varias ventanas, minimizar a pestaña.
- Descarga de adjuntos (2g): el total «N adjuntos · X MB» **debe recalcularse al marcar/desmarcar** (en el mock queda fijo en «3 adjuntos · 2.4 MB» — bug conocido del mock, no replicar).
- Teléfono: objetivos táctiles ≥ 44px.

## Estado
- carpeta activa, filtro, texto de búsqueda
- correo abierto (id), hilo plegado/desplegado
- ventanas de redactar abiertas (lista, minimizada sí/no)
- selección de adjuntos (para descarga / reenvío / impresión) + tamaño total derivado
- visor abierto (tipo foto/pdf/planilla, índice)
- etiquetas del correo, programación de envío
- conexión (online/offline), cola de salida, estado de carga/error
- preferencias: tema, densidad

## Tokens (claro / oscuro)
Tipografía: **Geist** 400/500/600/700 y **Geist Mono** (horas, tamaños, códigos). Base 16px / 1.5. Escala usada: 13, 14, 15, 16, 17, 18, 19, 20, 22, 24 (títulos de correo), 36 (solo lienzo).

| Token | Claro | Oscuro |
|---|---|---|
| --bg / --side | #f3f2ef | oklch(0.13 0.01 60) |
| --card | #ffffff | oklch(0.18 0.01 60) |
| --cli | #faf8f5 | oklch(0.165 0.01 60) |
| --hun | #f3f1ed | oklch(0.21 0.01 60) |
| --srch | oklch(0.925 0.008 75) | oklch(0.21 0.01 60) |
| --mu | oklch(0.95 0.008 75) | oklch(0.25 0.01 60) |
| --pop | #ffffff | oklch(0.22 0.01 60) |
| --fg | oklch(0.15 0.01 60) | oklch(0.96 0.005 80) |
| --mut | oklch(0.42 0.012 60) | oklch(0.72 0.01 60) |
| --t3 | oklch(0.552 0.022 70) | oklch(0.62 0.012 65) |
| --ln (borde) | oklch(0.80 0.012 70) | oklch(1 0 0 / 20%) |
| --ls (borde suave) | oklch(0.90 0.008 72) | oklch(1 0 0 / 11%) |
| --acc | oklch(0.58 0.19 45) | igual |
| --accT (texto acento) | oklch(0.52 0.18 40) | oklch(0.74 0.13 52) |
| --accBg | oklch(0.68 0.19 48 / .13) | / .20 |
| --sel | oklch(0.68 0.19 48 / .09) | / .13 |
| --side-act | oklch(0.68 0.19 48 / .15) | / .20 |
| Espera bg/t | #fdf0d5 / #8a5a08 | oklch(0.27 0.05 75) / oklch(0.82 0.11 75) |
| Info | #e2ebfb / #1d4ed8 | oklch(0.27 0.055 265) / oklch(0.82 0.10 265) |
| Marcha | #fdeada / #a8480a | oklch(0.27 0.05 45) / oklch(0.82 0.11 45) |
| OK | #dcf3e3 / #186b39 | oklch(0.27 0.044 150) / oklch(0.80 0.10 150) |
| Problema | #fbe4e2 / #b3261e | oklch(0.27 0.05 25) / oklch(0.82 0.11 25) |
| Cerrado | #ecebe8 / #5c564e | oklch(0.25 0.004 70) / oklch(0.78 0.01 70) |
| Avatar cliente | oklch(0.55 0.12 148 / .15) / oklch(0.42 0.12 148) | / .24 · oklch(0.80 0.12 148) |
| --sh | 0 1px 2px rgb(60 50 40/.06) | none |
| --popsh | 0 20px 50px -12px rgb(40 30 20/.35) | … rgb(0 0 0/.8) |

Los colores de estado salen de `app/globals.css` del repo; usar esas variables si ya existen.

Radios: 3, 5–6 (chips pequeños), 8, 10 (filas/botones), 12 (buscador, menús), 14–16 (paneles, Redactar), 999 (chips).
Espaciado: 2, 4, 6, 8, 10, 12, 14, 16, 18. Alturas de control: 36, 42, 44, 46, 50, 58.

## Recursos
- Logo: `public/cropped-icon-180x180.png` (del repo).
- Íconos: Lucide (`lucide-static@0.460.0` en el mock; en el repo usar `lucide-react`). Usados: search, x, sliders-horizontal, layout-grid, settings, pencil, paperclip, ellipsis-vertical, star, download, eye, reply, forward, printer, file-down, clock, calendar-clock, tag, folder-input, archive, trash-2, send, wifi-off, cloud-off, shield-alert, mail-check, inbox, file-text, file-spreadsheet, image, zoom-in/out, rotate-cw, scissors, truck, clipboard-list, ban, lock, moon, sun, bold, italic, link, pen-line, file-pen, at-sign, bell, filter, menu, arrow-left, chevron-*.
- Textura de madera: generada con SVG `feTurbulence` inline (ver funciones `svg`, `svgC`, `capa`, `madera` en la lógica del archivo). Se puede reemplazar por una imagen.
- Fotos/PDF/planillas de adjuntos: contenido de ejemplo.

## Archivos
- `Correo MJBJ v2.dc.html` — todas las pantallas (lienzo). Datos de ejemplo y tokens en la clase `Component` al final.
- `support.js` — runtime para abrir el mock (no es parte del diseño).
- `public/cropped-icon-180x180.png` — logo.
- Origen de tokens en el repo: `app/globals.css`; patrones afines: `app/admin/whatsapp/bandeja.tsx`, `app/admin/whatsapp/panel-cliente.tsx`, `components/admin/sidebar.tsx`, `components/admin/buscador-global.tsx`, `components/admin/vacio.tsx`, `components/admin/etiqueta-estado.tsx`.
