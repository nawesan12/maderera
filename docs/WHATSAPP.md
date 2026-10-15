# WhatsApp: conectar el número de la maderera

Cómo pasar la bandeja de WhatsApp del modo demostración a la Cloud API de Meta,
qué se decide antes, qué cuesta, y cómo probar todo sin Meta. Revisado contra
la documentación oficial de Meta el **14/10/2026**
(`developers.facebook.com/documentation/business-messaging/whatsapp`).

## Qué hace la plataforma con WhatsApp

- **Bandeja** (`/admin/whatsapp`, y `/atencion` a pantalla completa): las
  conversaciones con la ficha del cliente al costado (saldo, últimos pedidos),
  asignar a alguien, marcar resuelta, crear la ficha desde la conversación,
  responder citando, reaccionar, mandar fotos, archivos y **los PDF de la
  plataforma** (presupuesto, factura, remito, recibo, resumen de cuenta, plano
  de corte). En el VPS se actualiza en vivo (`lib/vivo`); en Vercel consulta
  cada 10 segundos.
- **Recibe** todo tipo de mensaje: texto, foto, documento, audio, video,
  sticker, ubicación, contactos, respuestas a botones y listas, reacciones,
  mensajes citados; lo que WhatsApp no deja ver entra igual con un aviso. Los
  adjuntos se bajan apenas llegan (la dirección de Meta vence a los 5 minutos)
  y se guardan **fuera de lo público**: solo los ve el personal de la bandeja.
- **Estados** de cada mensaje que sale: enviado, entregado, leído, o «no se
  envió» con el motivo en castellano y un botón para reintentar. Un mensaje
  que Meta rechaza no se pierde.
- **Ventana de 24 h**: fuera de ella la bandeja lo dice y ofrece las plantillas.
- **Avisos automáticos** (pedido recibido, preparando, listo, en camino,
  entregado, presupuesto, recibo, cheque rechazado): nacen apagados y se
  prenden uno por uno en `/admin/whatsapp/configuracion`.
- **Bajas**: quien escribe BAJA deja de recibir avisos (se registra y se le
  confirma); con ALTA vuelve. También se carga desde la conversación.
- **Configuración** (solo admin): chequeo real contra Meta, mensaje de prueba,
  gasto del mes contra el tope, estado de cada plantilla y lista de bajas.
- **Botón «Avisar por WhatsApp» (gratis)** en pedidos, cortes, cheques,
  presupuestos, facturas, remitos y la ficha del cliente: abre la app del
  teléfono con el mensaje escrito (ver «Qué cuesta»).

El código: `lib/whatsapp/` (adaptador, webhook, plantillas, ventana, números),
`app/admin/whatsapp/` (pantallas), `app/api/whatsapp/` (webhook, adjuntos,
subida de archivos).

## Antes de empezar: ¿el mismo número o uno nuevo?

Es la decisión que más importa, y la tiene que tomar la clienta.

**Hoy el número `+54 9 223 590-3118` está en la app WhatsApp Business del
teléfono.** Hay tres caminos:

1. **Pasar ese número a la Cloud API (sin coexistencia).** Es lo que se puede
   hacer directo. Meta lo dice así: para usarlo con la Cloud API hay que
   borrar la cuenta de la app, y *«el historial de mensajes se pierde y el
   número no se puede volver a usar en la app de WhatsApp Business»* mientras
   esté en la Cloud API. Desde ese día se atiende solo por la plataforma
   (`/atencion`, que anda en el celular).
2. **Coexistencia: el mismo número en la app y en la plataforma a la vez.**
   Existe y funciona en Argentina, pero **Meta solo la habilita a través de un
   Solution Partner o Tech Provider** (el alta va por *Embedded Signup*): un
   negocio que se integra directo, como este, no la puede activar solo. Lo que
   trae: se sincronizan los chats de los últimos 6 meses y los contactos; lo
   que se escribe desde el teléfono llega a la bandeja (ver «Coexistencia: lo
   que llega del teléfono» más abajo); la velocidad queda fija en 20
   mensajes por segundo (de sobra). Lo que se pierde en la app: mensajes
   temporales, «ver una vez», ubicación en tiempo real y crear listas de
   difusión (las que hay quedan de solo lectura). Si el teléfono no abre la app
   durante unos **14 días**, Meta corta la coexistencia. Requiere la app 2.24.17
   o más nueva.
3. **Un número nuevo para la plataforma** y dejar el actual en el teléfono.
   No corta nada, pero la gente sigue escribiendo al número de siempre: el
   botón del sitio (`whatsapp_principal`) y los avisos pasarían a salir del
   nuevo.

Para empezar a probar con clientes reales sin tocar el número de siempre, el 3
es el más seguro; el 2 es el mejor resultado si se consigue un partner a un
costo razonable.

## Qué cuesta (Argentina, vigente desde el 1/10/2026)

Meta cobra **por mensaje entregado por la Cloud API**, según la categoría, en
dólares (hoja de precios oficial de Meta, y
`developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages`):

| Qué | USD por mensaje |
|---|---|
| Plantilla de **utilidad** (avisos de pedido, recibo, presupuesto) | 0,026 |
| Plantilla de **marketing** (promociones) | 0,0618 |
| Plantilla de autenticación | 0,026 |
| **Respuesta dentro de las 24 h** (servicio), texto o archivo | 0,026 |

**Cambió el 1/10/2026:** hasta septiembre contestar dentro de las 24 h era
gratis; desde octubre cuesta lo mismo que una plantilla de utilidad. Lo único
que sigue sin cobrarse por la API es lo que llega desde un anuncio de Facebook
o Instagram que abre WhatsApp, durante esa ventana.

Terceros mencionan **«1.000 respuestas gratis por mes»**: no está en la página
oficial de precios de Meta (revisada el 14/10/2026), así que la plataforma no lo
cuenta. Y aunque existiera, no cubriría las plantillas, que es lo que usan los
avisos.

**Hay que cargar un medio de pago en Meta**: sin él, Meta dejó de entregar
incluso las respuestas desde el 1/10/2026.

### Lo que es gratis

- **Todo lo que se manda desde la app WhatsApp Business** (el teléfono, o
  WhatsApp Desktop / Web con el número de la maderera). Con coexistencia o sin
  ninguna API. Meta lo dice así en la guía de coexistencia: *«los mensajes que
  el negocio manda desde la app de WhatsApp Business siguen siendo gratis»*, y
  no abren, no estiran ni afectan la ventana de 24 h de la API.
- **El correo** (los avisos salen siempre también por correo, por la casilla
  propia).
- **El botón «Avisar por WhatsApp»** de la plataforma: abre
  `https://wa.me/<número del cliente>?text=<mensaje>` en otra pestaña, con el
  texto ya escrito, y la persona solo toca enviar en su WhatsApp. No pasa por
  Meta, así que anda aunque no haya nada conectado. Está en:
  - el pedido y su tarjeta del tablero (recibido, preparando, **listo**, **en
    camino**, entregado), con el enlace de seguimiento con token
    (`/pedido/<número>?t=…`, el mismo del correo);
  - el corte **terminado** (ficha y tablero de `/admin/cortes`; en `/taller` no);
  - el **cheque rechazado** (`/admin/cheques`);
  - el presupuesto, la factura, el remito (con el enlace para firmarlo, si está
    sin firmar), el resumen de cuenta, el **recordatorio de saldo** y el recibo
    recién hecho (ficha del cliente).

  El texto sale de las mismas plantillas (`lib/whatsapp/plantillas-base.ts`),
  rellenado con los datos reales: el cliente lee lo mismo salga por donde
  salga. **Un PDF no viaja por wa.me**: salvo el pedido (que tiene su enlace con
  token), los papeles no tienen una dirección pública y no se inventa una; el
  botón ofrece «PDF para adjuntar» y avisa que hay que adjuntarlo en el chat.
  Cada uso queda en la bitácora de avisos con el canal `whatsapp_manual` y quién
  lo mandó; el botón pasa a «Volver a avisar» y **el aviso automático no manda
  el mismo evento si ya se avisó a mano**. Atajo: `Alt + W` en las fichas.
  Lo ven los roles de la bandeja (admin y vendedor); depósito y aserradero no.
- **«Contestar desde el teléfono (gratis)»** en la bandeja: abre el chat del
  cliente en WhatsApp Business con lo que se haya escrito en el campo (`Alt +
  W`). Desde la app no hay ventana de 24 h ni plantilla que aprobar. En el
  compositor de plantillas está «Mandarlo desde el teléfono (gratis)» con el
  texto completo.

### Cuánto sale por mes, según qué avisos automáticos se prendan

Ejemplo con 300 pedidos por mes (100 con envío), 150 pagos y 100 presupuestos,
a USD 0,026 cada mensaje:

| Avisos automáticos prendidos | Mensajes | USD por mes |
|---|---|---|
| Ninguno (botón gratis + correo) | 0 | **0** |
| Solo «listo» | 300 | 7,80 |
| «Listo» y «en camino» | 400 | 10,40 |
| Recibido, preparando, listo y entregado | 1.200 | 31,20 |
| Los cinco de pedido, más recibo y presupuesto | 1.550 | 40,30 |
| Además, contestar 600 consultas por la bandeja (API) | +600 | +15,60 |

Más impuestos. Contestar desde el teléfono no suma nada.

### La recomendación

1. **Coexistencia**: el número sigue en la app del teléfono y además en la
   plataforma. La atención del día a día se hace desde el teléfono (gratis), y
   lo que se escribe ahí aparece igual en la bandeja (ver más abajo).
2. **Botón gratis** para los avisos: el vendedor marca el pedido listo y toca
   «Avisar por WhatsApp».
3. **Avisos automáticos apagados**, y el **correo** prendido (es gratis).
4. **Un tope de gasto** por si alguien prende algo.

### El tope de gasto

En `/admin/whatsapp/configuracion` (solo admin), «Lo que va del mes»:

- **Tope por mes en USD** (por omisión 10) y **las tarifas por categoría**
  (utilidad, servicio y autenticación 0,026; marketing 0,0618), editables
  porque Meta las cambia cada trimestre. Un tope de 0 es «por la API, ningún
  aviso automático».
- El gasto sale de los mensajes que Meta informa como cobrables en cada estado
  (`pricing.billable`), más una estimación de lo que acaba de salir y Meta
  todavía no informó. El mes es el de Argentina (empieza a las 00:00 del día 1,
  hora de Buenos Aires, aunque el servidor esté en UTC). Barra de gastado/tope.
- **Al llegar al tope**: los avisos automáticos **dejan de salir por WhatsApp**
  hasta el mes siguiente y quedan en la bitácora como omitidos («Tope mensual de
  WhatsApp alcanzado»); **el correo sale igual**. La configuración lista los que
  no salieron, si le llegó el correo («No tiene correo: avisale a mano») y el
  enlace a donde está el botón gratis. La ficha del pedido también lo dice.
- **Lo que se manda desde la bandeja por la API no se bloquea en silencio**:
  con el tope pasado, pide confirmación («Mandar igual por la API (se cobra)») y
  ofrece contestar desde el teléfono. La confirmación de una BAJA sale siempre.
- **Aviso al teléfono del admin** (push) al 80 % y al 100 %, una sola vez por
  umbral y por mes. Cambiar el tope vuelve a habilitar esos avisos.
- La bandeja muestra, chico, «Meta este mes: USD x de USD y».

## El trámite, paso a paso

Lo que dice «la clienta» lo hace el titular (o quien tenga acceso de
administrador a la empresa en Meta); lo que dice «sistema», quien mantiene la
plataforma.

### 1. Portafolio comercial de Meta (la clienta)

En `business.facebook.com`, crear (o usar) el portafolio comercial de
«Maderera Juan B. Justo S.R.L.», con el correo de la empresa. Agregar a quien
mantiene el sistema como administrador.

### 2. Verificar el negocio (la clienta)

Configuración del negocio → Centro de seguridad → Verificación. Pide la razón
social, el CUIT (30-58944525-9), un domicilio y un documento que los muestre
(constancia de inscripción de ARCA) y un teléfono o un correo del dominio
(`@mjbj.com.ar`). Tarda de días a un par de semanas.

**Se puede empezar sin esto**, pero sin verificar Meta deja escribirle primero
(con plantilla) a **250 personas distintas por día**; verificado sube a 2.000.

### 3. La app de Meta (sistema)

En `developers.facebook.com` → Mis apps → Crear app → tipo **Business**,
asociada al portafolio. Agregarle el producto **WhatsApp**. Eso crea la cuenta
de WhatsApp Business (WABA).

- De **Configuración → Básica** se copia el **secreto de la app** →
  `WHATSAPP_APP_SECRET`.
- De **WhatsApp → Configuración de la API**, el **id de la cuenta de WhatsApp
  Business** → `WHATSAPP_BUSINESS_ACCOUNT_ID`.

### 4. El número (la clienta y sistema)

Según lo que se haya decidido arriba:

- **Número nuevo o migrado**: WhatsApp Manager → Teléfonos → Agregar. Se pide
  el **nombre visible** («Maderera Juan B. Justo»; Meta lo revisa), se verifica
  el número por SMS o llamada, y después hay que **registrarlo** con un PIN de
  seis dígitos (verificación en dos pasos), que hay que anotar:

  ```bash
  curl -X POST "https://graph.facebook.com/v26.0/<PHONE_NUMBER_ID>/register" \
    -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
    -d '{"messaging_product":"whatsapp","pin":"<6 dígitos>"}'
  ```

  Si el número estaba en la app del teléfono, antes hay que borrar la cuenta
  desde la app (Ajustes → Cuenta → Eliminar cuenta). **Ver el camino 1 de
  arriba: se pierde el historial.**
- **Coexistencia**: lo hace el partner con su Embedded Signup, escaneando un QR
  desde la app del teléfono. Después hay que pedirle el `PHONE_NUMBER_ID` y la
  WABA, y que suscriba también los webhooks `smb_message_echoes`, `history` y
  `smb_app_state_sync`.

El **id del número** (no es el teléfono) → `WHATSAPP_PHONE_NUMBER_ID`.

### 5. Medio de pago (la clienta)

WhatsApp Manager → Configuración de pago: una tarjeta del portafolio. Sin esto
no sale ni una plantilla y, desde octubre de 2026, tampoco las respuestas.

### 6. Token permanente (sistema)

Configuración del negocio → **Usuarios del sistema** → Agregar (rol
administrador) → Asignar activos: la app (control total) y la cuenta de
WhatsApp (control total) → **Generar token**, con vencimiento **Nunca** y los
permisos `whatsapp_business_messaging`, `whatsapp_business_management` y
`business_management` → `WHATSAPP_ACCESS_TOKEN`.

El token temporal que muestra la página de la app **vence en 24 horas**: no
sirve para trabajar.

### 7. El webhook (sistema)

En la app → WhatsApp → Configuración → Webhook:

- URL de devolución: `https://mjbj.com.ar/api/whatsapp/webhook`
- Token de verificación: una clave inventada (`openssl rand -hex 24`), la misma
  que va en `WHATSAPP_WEBHOOK_SECRET`.
- Campos: **`messages`** y **`message_template_status_update`** (además,
  `phone_number_quality_update` para enterarse si baja la calidad, y con
  coexistencia `smb_message_echoes`, `history`, `smb_app_state_sync` y
  `account_update`).

Meta llama a la URL para verificarla: la plataforma ya tiene que estar
desplegada con `WHATSAPP_WEBHOOK_SECRET`. Después hay que **suscribir la app a
la cuenta**, que es el paso que más se olvida (sin esto Meta no manda nada):

```bash
curl -X POST "https://graph.facebook.com/v26.0/<WABA_ID>/subscribed_apps" \
  -H "Authorization: Bearer <TOKEN>"
```

### 8. Variables y despliegue (sistema)

En `.env.produccion` (están explicadas en `.env.example`):

```
WHATSAPP_PHONE_NUMBER_ID="…"
WHATSAPP_ACCESS_TOKEN="…"
WHATSAPP_BUSINESS_ACCOUNT_ID="…"
WHATSAPP_APP_SECRET="…"
WHATSAPP_WEBHOOK_SECRET="…"
WHATSAPP_BUSINESS_PHONE="+54 9 223 590-3118"
```

`./scripts/desplegar.sh`. La migración `0077_whatsapp_completo` tiene que estar
aplicada (el script migra antes de construir).

### 9. Probar (sistema, con la clienta)

`/admin/whatsapp/configuracion` → **Probar la conexión**. Tiene que dar todo en
verde: token, número (en la Cloud API), cuenta, webhook suscripto. Después:

1. Desde un celular, escribirle al número. Tiene que aparecer en la bandeja en
   un segundo y «Último aviso de Meta» tiene que tener la hora.
2. Contestar desde la bandeja: en el celular tienen que llegar el mensaje, y en
   la bandeja los dos tildes y después los azules.
3. **Mandar mensaje de prueba** a otro número que no escribió: sale con la
   plantilla `hello_world` que Meta crea en toda cuenta nueva.

### 10. Plantillas (la clienta carga, Meta aprueba)

Las plantillas se cargan en **WhatsApp Manager → Plantillas de mensajes →
Crear**, una por una, con:

- **Categoría: Utilidad** (*Utility*). Si Meta decide que es promoción, la
  aprueba como Marketing —más cara— y lo avisa; se puede apelar.
- **Nombre**: exactamente el de abajo, en minúsculas y con guion bajo.
- **Idioma: Español (ARG)** (`es_AR`).
- **Tipo de variable: Nombre** (*Name*), no número: el texto lleva
  `{{nombre}}`, `{{pedido}}`, y cada una pide un ejemplo, que va al lado.
- **Encabezado: Documento** en las que dicen «con el PDF» (se sube cualquier
  PDF de ejemplo).
- **Pie**: `Maderera Juan B. Justo`.

Después, en la configuración de la plataforma, **Traer de Meta**: muestra el
estado de cada una (en revisión, aprobada, rechazada con el motivo). La tarea
diaria y el webhook las mantienen al día solas.

| Nombre | Para qué | Texto | Ejemplos |
|---|---|---|---|
| `pedido_recibido` | Entra un pedido por la web | Hola {{nombre}}, recibimos tu pedido {{pedido}}. Te avisamos por acá cuando esté listo. Si tenés alguna duda, respondé este mensaje. | nombre: Marta · pedido: PED-1207 |
| `pedido_preparando` | El pedido pasa a Preparando | Hola {{nombre}}, ya estamos preparando tu pedido {{pedido}}. Te escribimos apenas esté listo. | nombre: Marta · pedido: PED-1207 |
| `pedido_listo` | Listo para retirar | Hola {{nombre}}, tu pedido {{pedido}} ya está listo para retirar en {{sucursal}}. El horario es {{horario}}. Si lo retira otra persona, avisanos por acá. | nombre: Marta · pedido: PED-1207 · sucursal: Casa Central, Av. Juan B. Justo 4153 · horario: de lunes a viernes de 8 a 16 y los sábados de 8 a 12 |
| `pedido_en_camino` | Sale el flete | Hola {{nombre}}, tu pedido {{pedido}} salió para la dirección de entrega. Si necesitás coordinar algo con el flete, respondé este mensaje. | nombre: Marta · pedido: PED-1207 |
| `pedido_entregado` | Se entregó | Hola {{nombre}}, entregamos tu pedido {{pedido}}. Si algo no llegó como esperabas, contanos por acá y lo resolvemos. | nombre: Marta · pedido: PED-1207 |
| `corte_listo` | Terminó un corte | Hola {{nombre}}, tu trabajo de corte {{corte}} está terminado y listo para retirar en {{sucursal}}. Cualquier consulta, respondé este mensaje. | nombre: Marta · corte: COR-0412 · sucursal: Aserradero |
| `presupuesto_enviado` (con el PDF) | Mandar un presupuesto pedido | Hola {{nombre}}, te mandamos el presupuesto {{presupuesto}} por {{total}} que nos pediste. Vale hasta el {{vence}}. Para confirmarlo o cambiar algo, respondé este mensaje. | nombre: Marta · presupuesto: PRE-0388 · total: $ 412.500 · vence: 24/10/2026 |
| `documento_adjunto` (con el PDF) | Factura, remito, recibo, resumen o plano | Hola {{nombre}}, te mandamos {{documento}} de tu compra en la maderera. Si tenés alguna duda, respondé este mensaje. | nombre: Marta · documento: el remito R-0001-00000452 |
| `recibo_emitido` (con el PDF) | Se registró un pago | Hola {{nombre}}, registramos tu pago de {{importe}} y te mandamos el recibo {{recibo}}. Tu saldo en cuenta corriente quedó en {{saldo}}. Gracias. | nombre: Marta · importe: $ 150.000 · recibo: REC-0042 · saldo: $ 0 |
| `cheque_rechazado` | Un cheque no se acreditó | Hola {{nombre}}, el cheque {{cheque}} por {{importe}} no se pudo acreditar ({{motivo}}). El importe volvió a tu cuenta corriente. Escribinos por acá para ver cómo lo resolvemos. | nombre: Marta · cheque: Banco Provincia N.º 00123456 · importe: $ 230.000 · motivo: sin fondos |
| `recordatorio_saldo` | Recordar el saldo de la cuenta | Hola {{nombre}}, te recordamos que tu cuenta corriente tiene un saldo de {{saldo}} al {{fecha}}. Si ya lo pagaste, no hace falta que hagas nada. Para cualquier consulta, respondé este mensaje. | nombre: Marta · saldo: $ 412.500 · fecha: 14/10/2026 |
| `retomar_conversacion` | Contestar pasadas las 24 h | Hola {{nombre}}, te escribimos por la consulta que nos hiciste. ¿Seguimos por acá? | nombre: Marta |

El texto exacto vive en `lib/whatsapp/plantillas-base.ts`, con tests que
comprueban las reglas de Meta (ninguna variable al principio ni al final, ni
dos seguidas, todas con su ejemplo). Si se cambia allá, hay que cambiarlo acá y
en Meta.

`retomar_conversacion` es la que más riesgo tiene de que Meta la pase a
marketing; si pasa, conviene apelar o reescribirla mencionando la consulta
concreta.

### 11. Prender los avisos (la clienta decide)

En la configuración, uno por uno. Lo recomendado es **dejarlos apagados** y usar
el botón gratis (ver «Qué cuesta»); si se prende alguno, que sea **«Cuando
queda listo»** (el que más llamadas evita), con el tope configurado. Si el
cliente escribió hace menos de 24 h sale el texto común (editable); si no, la
plantilla.

## Coexistencia: lo que llega del teléfono

Con el número en coexistencia Meta manda tres webhooks más (hay que pedirle al
partner que los suscriba). La forma está tomada de la referencia oficial
(`…/whatsapp/webhooks/reference/smb_message_echoes`, `history` y
`smb_app_state_sync`, y la guía «Onboarding WhatsApp Business app users»):

- **`smb_message_echoes`**: lo que el personal manda desde la app. Cada ítem de
  `message_echoes[]` trae `from` (el negocio), `to` (el cliente), `id`,
  `timestamp`, `type` y el contenido. Entra en la conversación como saliente
  «Desde el teléfono · gratis», **no se cobra** (no suma al gasto), **no abre ni
  estira la ventana de 24 h** (solo un mensaje del cliente la abre) y pone los no
  leídos en cero. Un eco repetido no entra dos veces (mismo índice único del id).
  Un eco sin destinatario o sin id se descarta. También llegan `edit` y
  `revoke`: la burbuja cambia o dice «Se eliminó este mensaje». Aparece en la
  bandeja en vivo, como los demás.
- **`history`**: hasta seis meses de chats, en partes (`phase` 0, 1 y 2;
  `chunk_order`; `progress` hasta 100), con `threads[]` por cliente. Quién
  escribió se sabe comparando `from` con el número del negocio. Se importa sin
  duplicar, marcado como «del historial» (`importado`), **sin avisos ni push**,
  sin no leídos y sin abrir la ventana. Los adjuntos llegan como
  `media_placeholder` y, si son de las últimas dos semanas, después llega otro
  `history` con el archivo, que se baja. Si el negocio no compartió el
  historial llega el error 2593109 y queda en el registro. Meta da **24 horas**
  desde el alta para sincronizar el historial.
- **`smb_app_state_sync`**: la agenda del teléfono. Se usa para ponerle el
  nombre agendado a una conversación que no tenía; la ficha del cliente se
  encuentra sola por el teléfono. Las bajas de la agenda se ignoran.
- **`account_update`** con `PARTNER_REMOVED` (`PRIMARY_INACTIVITY`): Meta cortó
  la coexistencia porque el teléfono no abrió la app en ~14 días. Avisa al
  teléfono del admin.

Para probarlo:

```bash
npm run whatsapp:webhook -- eco --de 5492235550123 --texto "Te lo dejo separado"
npm run whatsapp:webhook -- eco --repetir            # entra uno solo
npm run whatsapp:webhook -- eco --sin to             # se descarta
npm run whatsapp:webhook -- eco-editado --original <wamid> --texto "Mejor el lunes"
npm run whatsapp:webhook -- eco-borrado --original <wamid>
npm run whatsapp:webhook -- historial --de 5492235550123 --repetir
npm run whatsapp:webhook -- historial-medio --id wamid.HISTORIAL-3
npm run whatsapp:webhook -- historial-rechazado
npm run whatsapp:webhook -- agenda --de 5492235550123 --nombre "Marta (obra Alem)"
npm run whatsapp:webhook -- coexistencia-cortada
```

o con el simulador: `curl -X POST localhost:3199/_simulador/entrante -d
'{"tipo":"eco","de":"5492235550123","texto":"…"}'` (también `historial` y
`agenda`).

## Consentimiento

La política de WhatsApp pide que la persona haya aceptado recibir mensajes de
la empresa (puede ser un consentimiento general, no específico de WhatsApp) y
obliga a respetar cualquier pedido de no recibir más. Lo que hace la
plataforma: BAJA/ALTA por WhatsApp, la baja desde la conversación, y la lista
de bajas en la configuración. Lo que conviene sumar en el sitio (decisión de la
clienta): una línea en el checkout del tipo *«Te avisamos por WhatsApp cuando
tu pedido esté listo»*.

## Probar sin Meta

```bash
npm run whatsapp:simulador       # la Graph API de mentira, en el 3199
```

Y la aplicación con las variables del simulador (están comentadas en
`.env.example`). El simulador acepta envíos, subidas y descargas de archivos,
lista las plantillas de `plantillas-base.ts` (una «en revisión») y, después de
cada envío, **le manda a la aplicación los estados por el webhook, firmados**.
Para hacer fallar cosas:

```bash
curl -X POST localhost:3199/_simulador/error -d '{"codigo":131047}'          # fuera de la ventana
curl -X POST localhost:3199/_simulador/error -d '{"codigo":190}'             # token vencido
curl -X POST localhost:3199/_simulador/error -d '{"codigo":131026,"tarde":true}'  # sale y no llega
curl -X POST localhost:3199/_simulador/entrante -d '{"tipo":"imagen","de":"5492235550123"}'
```

Y para mandarle al webhook los payloads de la documentación, firmados:

```bash
npm run whatsapp:webhook -- verificar
npm run whatsapp:webhook -- texto --de 5492235550123 --texto "Hola" --repetir
npm run whatsapp:webhook -- texto --firma-mala      # 401
```

Los payloads están en `tests/fixtures/whatsapp/payloads.ts`, con la forma
exacta de Meta (incluido el BSUID de 2026, ver abajo), y los usan también los
tests.

## Cosas de Meta que conviene saber

- **Versión de la API**: la plataforma usa `v26.0` (la vigente; la v24 vive
  hasta febrero de 2028). Se cambia con `WHATSAPP_GRAPH_VERSION`.
- **Usuarios sin número (BSUID)**: desde abril de 2026 WhatsApp admite nombres
  de usuario, y Meta manda un identificador propio (`AR.…`). Si alguien con
  nombre de usuario escribe sin haber hablado con la maderera en los últimos
  30 días, **el webhook llega sin su teléfono**. La bandeja lo recibe igual
  («WhatsApp no comparte su número») y le contesta por ese identificador.
- **Límite de mensajes**: es del portafolio, no del número; cuenta personas
  distintas a las que se les escribe primero en 24 h (250 sin verificar, 2.000
  verificado, después 10.000, 100.000 e ilimitado). Contestar no cuenta.
- **Calidad del número**: si muchos clientes bloquean o marcan como spam, baja
  (verde → amarilla → roja) y Meta puede bajar el límite. La plataforma avisa
  al teléfono del admin si llega ese aviso.
- **Reintentos**: si el webhook no contesta, Meta reintenta durante 7 días. La
  plataforma contesta en milisegundos y procesa en la cola; un mensaje repetido
  no se duplica.
- **Adjuntos**: Meta acepta fotos JPG/PNG de hasta 5 MB, videos y audios de
  hasta 16 MB y documentos de hasta 100 MB (la plataforma limita a 25 MB, el
  tope de Caddy). Lo que llega se puede volver a pedir a Meta durante 7 días;
  la bandeja reintenta sola y tiene un botón.
- **El 9 de los celulares**: la bandeja guarda todo como `549` + característica
  + número, y reconoce la ficha aunque el teléfono esté cargado con 0, 15, +54
  o sin característica (asume 223). Ver `lib/whatsapp/numeros.ts`.
