# Plan de proyecto — Plataforma Digital Integral MJBJ

> Documento de trabajo interno del PRESTADOR. Traduce el contrato firmado
> (`Contrato — Maderera Juan B. Justo.pdf`, 15 pp.) a un plan ejecutable.
> Última actualización: 22/08/2026 (cuarta pasada).

---

## 1. Marco contractual que gobierna el plan

| Ítem | Valor | Cláusula |
|---|---|---|
| Precio | $6.400.000 ARS fijo, sin ajuste | 3.1 |
| Cobro | 5 × $1.280.000 — sep/26 a ene/27 | 3.2 |
| Plazo | 2 a 3 meses desde la firma | 5.1 |
| Etapas | 4 etapas de 3 semanas, entregas **semanales** | 5.2 |
| Aceptación | 5 días hábiles por entrega; silencio = aprobación tácita | 8.1 |
| Revisiones | 2 rondas por etapa incluidas; el resto se factura aparte | 8.2 / 8.3 |
| Garantía | 1 mes post-lanzamiento, solo corrección de defectos | 14.1 |
| Recurrentes | Solo dominio (~$21.000/año). Hosting "gratuito a la fecha" | 12 |
| Propiedad | Se transfiere al cobrar la última cuota | 4 / 9 |

**Consecuencias operativas que no hay que perder de vista:**

1. **El pago no está condicionado al avance** (3.3 y 5.4): se empieza y se entrega antes de cobrar todo. El riesgo de cobranza es del PRESTADOR; el beneficio de precio fijo caduca ante mora (3.4).
2. **Toda demora del cliente debe quedar registrada por escrito** (5.3): es lo único que extiende el plazo sin responsabilidad propia. Más de 30 días acumulados habilita renegociar (5.5). Sin registro, no hay defensa.
3. **Cada entrega semanal necesita constancia** de envío y de fecha, para que corra el plazo de aprobación tácita de 8.1.
4. **Cláusula 8.4 (alcance flexible)** es un arma de doble filo: los ajustes menores entran sin cargo. Cada pedido que exceda eso debe rechazarse por escrito citando 8.5 *en el momento*, no al final.

---

## 1 bis. Estado al 21/08/2026

Cerrado el primer tramo. Anda de punta a punta contra Postgres:

- **Base y migraciones**: 15 tablas en Docker (Postgres 17, puerto 5433 porque el
  5432 lo ocupa un Postgres del sistema). Cuatro migraciones aplicadas.
- **Autenticación**: Better Auth con perfiles y roles. `/admin` exige sesión de
  staff, verificada en el DAL y no solo en el proxy. Alta de personal por
  `npm run staff:create`.
- **Catálogo público**: `/catalogo`, `/catalogo/[slug]` y `/stock` son Server
  Components que consultan la base, con filtros por URL y búsqueda sin acentos.
- **Gestión**: ABM de productos con variantes, stock por sucursal con
  transferencias transaccionales y libro de movimientos.
- **Precios**: pantalla propia con edición en línea, ajuste masivo por
  porcentaje, exportación e importación por planilla con vista previa, e
  historial auditado.
- **Panel**: rediseñado en modo claro, tipografía grande (16px base) porque lo
  usa gente que no ve de cerca, y color reservado para lo que pide atención.

**Segunda pasada — panel completo y tienda andando:**

- **Ventas modeladas**: 27 tablas. Clientes con cuenta corriente, presupuestos,
  pedidos con historial de estados, cortes con despiece en milímetros, carrito y
  zonas de envío.
- **Panel entero contra la base**: Resumen con métricas calculadas, Pedidos y
  Cortes como tableros por etapa, Presupuestos agrupados por lo que espera
  respuesta, Clientes en tarjetas con su saldo. Fichas de detalle en todo.
- **Flujo comercial**: un presupuesto aceptado se convierte en pedido copiando
  los precios pactados; cobrar un pedido a cuenta corriente descuenta la deuda.
- **Tienda**: carrito persistente en base (sobrevive a recargas y sigue a la
  persona al iniciar sesión), checkout con retiro o envío por zona, y pedido que
  cae directo en el tablero del panel.

**Tercera pasada — tienda y presentación:**

- **Fotos de producto**: subida real con arrastrar y soltar, varias a la vez,
  galería por producto con foto principal. Guarda en disco en desarrollo y en
  Vercel Blob en producción, detrás de la misma interfaz.
- **Ofertas**: precio anterior con vencimiento en el modelo. La tienda muestra el
  tachado y el porcentaje, y la oferta caduca sola.
- **Catálogo rehecho como tienda**: franja de confianza, acceso a ofertas,
  ordenamiento, y tarjetas donde el precio y la disponibilidad mandan. Se corrigió
  un layout roto que dejaba la grilla en columnas de 100px.
- **Home con datos reales**: ofertas, categorías con conteo, destacados y
  sucursales salen de la base. Antes era todo texto fijo.
- **Panel presentado por tipo de dato**: pedidos y cortes en tableros por etapa,
  clientes y productos en tarjetas con foto, stock con barra de nivel y ajuste
  rápido, precios con foto y agrupados por lo que hay que revisar.
- **Accesibilidad medida, no estimada**: se corrigieron dos contrastes por debajo
  del mínimo —los bordes daban 1,35:1 y el texto blanco sobre el naranja de marca
  3,08:1— y la escala del panel subió a 16px con controles de 40px.

**Cuarta pasada — portal de clientes (22/08/2026):**

Entregable de la Etapa 4 / S10, adelantado: es el único tramo grande que no
depende de ningún insumo del cliente.

- **Registro y sesión de clientes**: `/registro` propio, con el carrito armado
  sin sesión adoptado al entrar. El ingreso ahora manda a cada quien a donde le
  sirve: el personal al panel, el cliente a su cuenta.
- **`/mi-cuenta`**: resumen con lo que espera respuesta, pedidos con el recorrido
  a la vista, presupuestos que el cliente acepta o rechaza desde el sitio,
  cuenta corriente con saldo corrido movimiento por movimiento, direcciones
  guardadas y datos fiscales editables.
- **Volver a pedir**: un pedido anterior se carga entero en el presupuesto en
  curso, a precios de hoy. En una maderera la compra se repite.
- **Vinculación de cuentas**: el registro no ata automáticamente la cuenta web a
  una ficha del mostrador —sin verificación de correo, eso permitiría quedarse
  con la cuenta corriente de un tercero—. La ficha aparece en el panel con un
  aviso y la une el vendedor.
- **Tres agujeros cerrados**: la cuenta corriente en el checkout se validaba
  solo en pantalla y cualquiera podía elegirla; el saldo de la ficha de cliente
  se calculaba sobre los últimos 20 movimientos y daba mal con cuentas largas; y
  las líneas del carrito se podían editar sin verificar de quién eran.

**Quinta pasada — bandeja de WhatsApp (22/08/2026):**

Trabajo **nuevo**, no previsto en el plan original: se trajo el módulo de
WhatsApp del CRM inmobiliario y se lo rehizo contra Postgres y Drizzle.

- **Bandeja en el panel** (`/admin/whatsapp`): conversaciones, hilo con
  adjuntos, estados de entrega, archivado, y la conversación colgada del
  cliente y de su pedido. Al costado, el saldo de cuenta corriente y los
  últimos pedidos: son las dos cosas que se preguntan por WhatsApp.
- **Puesto de atención** (`/atencion`): la misma bandeja a pantalla completa,
  sin menú, para quien se dedica a contestar.
- **Adaptador con dos proveedores**: la Cloud API de Meta y uno de
  demostración. MJBJ atiende hoy con WhatsApp Business común en un teléfono, así
  que todo se construyó y se probó con el proveedor demo; el día que esté el
  WABA se cambian variables de entorno y no se toca una línea de la interfaz.
- **Avisos automáticos** al cambiar el estado de un pedido, con interruptor por
  estado y todos apagados por defecto. Dentro de la ventana de 24 h sale texto
  libre; fuera, plantilla aprobada.
- **Webhook** con verificación de firma HMAC, descarga de adjuntos y corte de
  repetidos por `waMessageId`.

**Esto cierra el riesgo R4 con una decisión concreta**: es la opción (a) —
WhatsApp Business API con costo por conversación—. Los pasos del alta, que son
trámites del cliente ante Meta, están listados en
`/admin/whatsapp/configuracion`. Hasta que se completen, la bandeja avisa en
cada pantalla que los mensajes no salen.

Pendiente: Mercado Pago para cobrar de verdad (hoy el pedido se crea y el pago se
coordina por WhatsApp), facturación ARCA, el portal de profesionales y la
migración desde Quality Software.

## 2. Punto de partida real

Lo que hay en el repo hoy es un **prototipo de front-end sin backend**: ~7.500 líneas de
TSX, todos los datos hardcodeados en `lib/products.ts` (656 líneas) y
`lib/dashboard-data.ts` (348 líneas). No existe `app/api/`, ni base de datos, ni sesión,
ni pagos.

| Capa | Estado | Destino |
|---|---|---|
| Diseño y componentes (`components/ui/*`, navbar, footer, cards) | ✅ Sirve | Se conserva |
| 10 páginas públicas | 🟡 Maqueta con mock | Se reconectan a datos reales |
| `lib/calculations.ts` (4 calculadoras, 170 líneas) | ✅ Lógica pura correcta | Se conserva tal cual |
| `lib/budget-context.tsx` (carrito en memoria) | 🟡 Solo cliente, se pierde al recargar | Se reescribe con persistencia |
| Panel admin (7 secciones) | 🟡 Tablas con datos falsos | Se reescribe contra la DB |
| `app/admin/facturacion` | 🟡 918 líneas de maqueta completa (alta, IVA, impresión) | Se conecta a la base y a ARCA |
| Tienda, checkout, pagos, envíos | ❌ No existe | Se construye entero |
| Portal de clientes | ❌ No existe | Se construye entero |
| Portal de profesionales | ❌ Solo landing | Se construye entero |
| Migración Quality Software | ❌ No arrancada | Se construye entero |

**Estimación gruesa: el prototipo cubre ~20% del contrato.** Es la Etapa 1 casi entera,
y sirve como maqueta de referencia para el resto.

---

## 3. Arquitectura objetivo

### 3.1 Stack

| Capa | Elección | Por qué |
|---|---|---|
| Framework | Next.js 16.2.2 (App Router) — ya instalado | — |
| Datos | **Neon** (Postgres serverless) + **Drizzle ORM** | Postgres puro, sin capa propietaria encima. El *branching* copy-on-write da una DB por deploy de preview, que encaja justo con las entregas semanales de 8.1 |
| Auth | **Better Auth** sobre las mismas tablas de Neon | Es la opción estándar para Next.js en 2026: TypeScript nativo, sesiones sobre Postgres, email/password y OAuth. Neon lo ofrece también gestionado (tablas en el schema `neon_auth`) — a evaluar en S1 |
| Archivos | **Vercel Blob** | PDFs de factura, firmas de acopio, fotos de producto. Soporta blobs privados, necesario para documentación fiscal |
| Acceso a datos | Server Components + Server Actions con **Data Access Layer** (`lib/dal/`) | Patrón recomendado por Next 16: `verifySession()` memoizado con `cache()`, autorización cerca del dato, nunca en el componente |
| Sesión | Cookies de Better Auth + `proxy.ts` para chequeos optimistas | En Next 16 el middleware se llama **Proxy** (`proxy.ts` en la raíz). Solo redirecciones; la verificación real va en el DAL |
| Facturación | `@afipsdk/afip.js` o `@ramiidv/arca-facturacion` (a evaluar en S1) | Manejan WSAA + WSFEv1 y el firmado del ticket de acceso |
| Pagos | Mercado Pago Checkout Pro + webhook | — |
| Email | Resend (3.000/mes gratis, requiere verificar `mjbj.ar`) | — |
| Deploy | A definir — ver riesgo R5 | — |

### 3.2 Reglas de arquitectura (no negociables durante el desarrollo)

- **La base de datos nunca se toca desde el navegador.** A diferencia de Supabase, acá no
  hay un cliente JS con credenciales propias: la connection string vive solo en el servidor
  y **toda** lectura o escritura pasa por el DAL. Eso hace del DAL la única línea de
  defensa, así que no puede haber atajos: ninguna query suelta dentro de un componente.
- **Toda consulta que devuelva datos de una persona lleva el `userId` de la sesión en el
  `where`**, obtenido de `verifySession()` y jamás de un parámetro del cliente. Un portal
  con cuentas corrientes y facturas ajenas expuestas es el peor escenario posible; sin RLS
  detrás, el filtro por dueño es responsabilidad del código y se revisa en cada PR.
- **Toda mutación pasa por Server Action** que primero llama `verifySession()` y valida el
  input con Zod. Nada de confiar en lo que manda el cliente (data-security.md).
- **DTOs explícitos**: nunca devolver una fila entera al cliente; seleccionar columnas.
- **`use cache` solo en lo público** (catálogo, blog, institucionales) con `cacheTag` por
  entidad, e invalidación con `updateTag()` al editar desde el admin. Todo lo que sea
  precio-para-profesional, stock, cuenta corriente o panel: request-time, bajo `<Suspense>`.
- **`cacheComponents: true`** se evalúa al final de la Etapa 2, no antes: cambia el modelo
  de renderizado de todo el sitio y conviene decidirlo con las páginas ya escritas.
- **El stock nunca se descuenta desde el front.** Movimientos de inventario por transacción
  en la DB, con tabla de auditoría.

### 3.3 Modelo de datos (~35 tablas)

```
CATÁLOGO        categories · products · product_variants · product_images
                price_lists · price_list_items          (lista general vs. profesional)

SUCURSALES      branches · inventory · inventory_movements
                transfers · transfer_items

PERSONAS        users · sessions · accounts              (las gestiona Better Auth)
                profiles (1:1 con users) · professional_applications
                addresses · staff_roles                 (admin | vendedor | depósito)

CUENTA CTE      current_accounts · account_movements    (compra, pago, NC, ajuste)

VENTA           carts · cart_items                      (carrito persistente)
                orders · order_items · order_status_history
                quotes · quote_items                    (presupuestador + calculadora)
                cutting_orders · cutting_items          (cortes de placa, cola de trabajo)

LOGÍSTICA       shipping_zones · shipments              (MdP, Tandil, Necochea, retiro)
                deliveries · delivery_items             (retiros parciales de acopio)
                delivery_signatures                     (firma digital → Blob privado)

PAGOS           payments · payment_webhooks

FISCAL          invoices · invoice_items                (A/B/C, NC, ND)
                arca_tokens                             (TA cacheado, vence a las 12 h)
                arca_request_log                        (auditoría de cada request)

PROFESIONALES   events · event_registrations · technical_documents

CONTENIDO       blog_posts · blog_categories · testimonials · site_settings

SISTEMA         notifications_log · audit_log
```

Decisiones de modelo que conviene fijar ahora:

- **Precio en la variante, no en el producto.** El catálogo tiene medidas, espesores y
  tipos; una placa de 18 mm y una de 5,5 mm no comparten precio ni stock.
- **Unidad de venta como enum** (`unidad | metro_lineal | metro_cuadrado | placa`): la
  calculadora, el carrito y la factura tienen que hablar el mismo idioma.
- **Precio profesional como lista separada**, no como porcentaje de descuento: el cliente
  va a querer excepciones por producto.
- **Acopio**: un `order` puede tener N `deliveries` parciales; el saldo pendiente de retiro
  sale de `order_items.qty - Σ delivery_items.qty`.
- **`cutting_items` con geometría desde el principio** (largo, ancho, cantidad, veta,
  canteado por lado): aunque la integración con las máquinas sea un módulo aparte, si la
  tabla nace sin esos campos hay que migrarla después. Ver sección 9.

---

## 4. Cronograma

Anclado al **lunes 24/08/2026** como S1. Ajustar si la firma se corre.

### Etapa 1 — Fundaciones e identidad · S1–S3 · 24/08 → 11/09

Entregable contractual: *identidad visual aplicada, diseño de todas las páginas y sistema
de componentes*. Como eso ya está casi hecho en el prototipo, la etapa se aprovecha para
montar la infraestructura sin perder el hito.

| Semana | Entrega |
|---|---|
| S1 | Proyecto Neon + schema completo en Drizzle + migraciones + seeds. Better Auth funcionando (alta, login, recuperación). `proxy.ts` y DAL base. Branch de Neon por preview. **En paralelo: pedir el dump de Quality Software y arrancar el trámite de certificado ARCA de homologación.** |
| S2 | Catálogo real: categorías, productos, variantes, imágenes en Blob. Admin de productos con carga y edición. Migración del catálogo del mock a la DB. |
| S3 | Stock multi-sucursal real: inventario, movimientos, alertas de reposición, transferencias. `/stock` y `/catalogo` leyendo datos vivos. Revisión de diseño de todas las páginas con el cliente. |

### Etapa 2 — Tienda online · S4–S6 · 14/09 → 02/10

| Semana | Entrega |
|---|---|
| S4 | Carrito persistente (reemplaza `budget-context`), ficha de producto con variantes, checkout paso a paso, cálculo de envío por zona y opción de retiro. |
| S5 | Mercado Pago Checkout Pro + webhook + conciliación. Transferencia bancaria con comprobante. Pago con cuenta corriente para clientes habilitados. |
| S6 | Panel de pedidos con estados y notificaciones (email + WhatsApp — ver riesgo R4). Productos sugeridos. Integración de envíos con el transportista definido. |

### Etapa 3 — Gestión y facturación · S7–S9 · 05/10 → 23/10

**La semana de mayor riesgo del proyecto es S8.**

| Semana | Entrega |
|---|---|
| S7 | Calculadora y presupuestador conectados: los resultados generan un `quote` real que cae en el admin. Gestión de cortes de placa con cola de trabajo. Es la base sobre la que se apoya después la conexión con las máquinas (sección 9). |
| S8 | **ARCA**: WSAA + WSFEv1 en homologación. Emisión de A/B/C, notas de crédito y débito, QR, PDF. |
| S9 | ARCA en producción con el certificado real. Panel de control con KPIs reales (reemplaza `dashboard-data.ts`). Base de clientes con ficha, historial y segmentación. |

### Etapa 4 — Portales, migración y lanzamiento · S10–S12 · 26/10 → 13/11

| Semana | Entrega |
|---|---|
| S10 | Portal de clientes: ✅ cuenta corriente, pedidos y presupuestos (hecho en la cuarta pasada, 22/08). Falta: facturas y remitos en PDF, pago online de deuda, firma digital de acopio desde el celular. |
| S11 | Portal de profesionales: registro con validación de CUIT y aprobación, precios diferenciados, presupuestos express, documentación técnica, módulo de eventos con inscripción y pago. |
| S12 | Migración definitiva de Quality Software, verificación de integridad, SEO y performance, dominio `mjbj.ar` + SSL, capacitación presencial y guías escritas. **Lanzamiento.** |

Garantía: **13/11/2026 → 13/12/2026**. A partir de ahí, soporte solo bajo acuerdo escrito
aparte (14.2).

---

## 5. Riesgos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| **R1** | **Quality Software sin exportación usable.** Puede ser una base propietaria, DBF o Access sin API. Si no hay export, hay que scrapear pantallas o retipear. | Alto — la migración es obligación contractual sin costo adicional (1.9) | **Pedir un dump de muestra en S1, no en S10.** Si no hay export, notificarlo por escrito de inmediato: es un cambio de condiciones, no un problema propio. |
| **R2** | **Certificado ARCA y punto de venta.** El trámite lo hace el cliente (7 y 13.2). El certificado de producción sale por el Administrador de Certificados Digitales, y el punto de venta debe estar habilitado como *Webservices*. | Alto — bloquea S9 entera | Arrancar el trámite en **S1**. Homologación (WSASS) se puede usar mientras tanto. |
| **R3** | **`CondicionIVAReceptorId` obligatorio desde abril/2026.** Toda factura necesita la condición frente al IVA del receptor. | Medio | El campo entra en `profiles` desde el schema inicial (S1) y es obligatorio en el checkout de responsables inscriptos. |
| **R4** | **"Notificaciones automáticas por WhatsApp" (1.3).** Automatizar de verdad exige WhatsApp Business API de Meta: alta, verificación de la empresa, plantillas aprobadas y **costo por conversación**. No es gratis ni instantáneo, y choca con "sin costos recurrentes" (12). | Alto — comercial | **Resuelto por el camino (a) en la quinta pasada**: el módulo está construido contra la Cloud API, con proveedor de demostración mientras el número no esté dado de alta. Quedan dos cosas del lado del cliente: el trámite ante Meta (listado en `/admin/whatsapp/configuracion`) y aceptar por escrito el costo por conversación. **Ojo con la migración del número**: el que hoy usan en la app deja de funcionar en el teléfono al migrarlo, así que conviene evaluar dar de alta uno nuevo. |
| **R5** | **Hosting "gratuito" (12).** Vercel Hobby no admite uso comercial → Pro, USD 20/mes. El free tier de Neon da 0,5 GB de storage, 100 compute-hours por mes y autoscaling tope 2 CU: alcanza para desarrollar, no para operar una tienda con facturación. | Alto — comercial | Neon Launch arranca en ~USD 5/mes más consumo, bastante más barato que la alternativa gestionada. Plantear el costo real ahora, no en el lanzamiento. **Decisión pendiente.** |
| **R6** | **APIs de envío.** Andreani tiene API con cuenta corporativa; CDI probablemente no. | Medio | Diseñar `shipping_zones` con tarifas configurables desde el admin, y la API como mejora encima. Cumple 1.3 sin depender de un tercero. |
| **R7** | **Backups fiscales.** Las facturas emitidas son documentación fiscal: perderlas es un problema del cliente ante ARCA. El free tier de Neon retiene solo **6 horas** de historial para restaurar a un punto en el tiempo. | Alto | Seis horas no cubren "el lunes descubrimos algo que se rompió el viernes". Plan pago para ampliar la ventana (ver R5) + export periódico a almacenamiento propio. La cláusula 15 limita la responsabilidad, pero el daño reputacional no se limita por contrato. |
| **R8** | **Scope creep vía 8.4.** "Alcance flexible" invita a pedidos infinitos que parecen menores. | Medio | Bitácora en `docs/CAMBIOS.md`: fecha, pedido, decisión, respuesta enviada. |
| **R9** | **Capacitación de usuarios no técnicos.** El equipo viene de un sistema de escritorio; el rechazo al cambio hunde proyectos técnicamente correctos. | Medio | Involucrar al operador real desde S3, no en S12. Las guías escritas (1.10) se van escribiendo en cada etapa. |

---

## 6. Insumos a pedir al cliente — ahora, no después

Enviar como lista única al firmar. Cada ítem que falte y frene el trabajo se registra por
escrito invocando 5.3.

**Bloqueantes tempranos (S1–S2)**
- [ ] Dump / exportación de Quality Software: productos, stock, clientes, precios, saldos de cuenta corriente
- [ ] Accesos al sistema actual para verificar la extracción
- [ ] Inicio del trámite de certificado digital ARCA (homologación y producción)
- [ ] Punto de venta habilitado en modalidad *Webservices*
- [ ] CUIT, razón social, condición frente al IVA e inicio de actividades
- [ ] Persona de contacto designada con autoridad para aprobar (7), con plazo de respuesta de 3 días hábiles

**Contenido y comercial (S2–S4)**
- [ ] Fotos de productos en calidad utilizable (2ª: la producción fotográfica **no** está incluida)
- [ ] Lista de precios vigente, general y de profesionales
- [ ] Textos comerciales, fichas técnicas, documentación técnica descargable
- [ ] Logo en vectorial y manual de marca si existe (MJBJ y Moldava)

**Cuentas de terceros (S4–S6)**
- [ ] Credenciales de Mercado Pago (producción y test)
- [ ] Cuenta bancaria y alias para transferencias
- [ ] Cuentas de Andreani / CDI, o la tabla de tarifas por zona
- [ ] Acceso al dominio `mjbj.ar` (registrante y DNS)
- [ ] Definición sobre WhatsApp Business API (ver R4)

---

## 7. Decisiones abiertas

1. **Dónde se despliega** y quién paga la infraestructura (R5). Condiciona el cierre de S1.
2. **WhatsApp: API real o disparo manual asistido** (R4). Condiciona S6.
3. **Alcance de la migración**: ¿se migra el histórico completo de compras y saldos, o solo
   el maestro de productos, clientes y saldos actuales? El contrato dice "productos, stock,
   clientes y precios" (1.9) — el histórico de movimientos **no** está listado. Conviene
   dejarlo explícito antes de que se asuma incluido.
4. **Punto de venta electrónico**: ¿uno para toda la plataforma o uno por sucursal? Afecta
   la numeración fiscal y no se puede cambiar cómodamente después.
5. **`cacheComponents`**: se decide al cerrar la Etapa 2.
6. **Integración con las máquinas de corte**: alcance, arquitectura y ubicación en el
   cronograma (sección 9). Se define con el relevamiento del 21/08.

---

## 8. Definición de "entregado" (por semana)

Para que el plazo de 5 días hábiles de 8.1 empiece a correr, cada viernes:

1. Deploy en la URL de preview, funcionando.
2. Mensaje escrito (email o WhatsApp) listando qué se entrega y qué probar.
3. Registro en `docs/ENTREGAS.md`: fecha, alcance, link, respuesta del cliente y fecha de
   aprobación (expresa o tácita).

---

## 9. Conexión con las máquinas de corte

> **Estado: pendiente de relevamiento (visita 21/08/2026).** El alcance y el momento en que
> entra al cronograma se definen con los datos de la visita. Se construye sobre la gestión
> de cortes de la Etapa 3, así que no bloquea nada de lo anterior.

### 9.1 Cómo se conecta esto en la práctica

Casi ninguna seccionadora acepta órdenes por API. El camino real es un paso intermedio:

```
Plataforma MJBJ  ──►  archivo de lista de piezas  ──►  software optimizador  ──►  máquina
   (la nube)          (CSV / XML / formato propio)      (Cut Rite, Corte Certo,      (patrón
                                                         Ardis, Optimik…)             de corte)
```

Y como la PC del taller normalmente no está expuesta a internet, hace falta una pieza más:
un **agente local** —un servicio chico corriendo en una PC de la red del taller— que
consulta la plataforma cada X segundos, baja los cortes pendientes, escribe el archivo en
la carpeta que el optimizador vigila, y opcionalmente devuelve el resultado (patrón
generado, consumo de placas, desperdicio, piezas producidas). Es exactamente la intuición
de "otra aplicación aparte": **sí, va aparte**, y es lo correcto — la nube nunca debería
depender de que la PC del taller esté prendida.

Tres niveles posibles, de menor a mayor esfuerzo:

| Nivel | Qué hace | Esfuerzo |
|---|---|---|
| **1. Exportación manual** | El operador aprieta "Exportar" en el admin y obtiene el archivo en el formato del optimizador. Lo abre a mano. | Bajo — días |
| **2. Agente local unidireccional** | El agente baja los cortes solo y los deja en la carpeta. El operador solo optimiza y corta. | Medio — 2 a 3 semanas |
| **3. Ciclo cerrado** | Además vuelve el consumo real: descuento automático de stock de placas, desperdicio medido, estado "cortado" en el pedido. | Alto — 4+ semanas, depende de qué reporte la máquina |

El nivel 3 es el que tiene valor de negocio de verdad (stock de placas que se descuenta
solo, desperdicio medible por trabajo), pero depende enteramente de qué exporte el
software de ellos. Por eso el relevamiento decide todo.

### 9.2 Relevamiento — para la visita

Lo que hay que traerse. Sin esto no se puede ni estimar.

**De la máquina**
- [ ] Marca, modelo y año. (Las habituales acá: Homag/Holzma, SCM/Gabbiani, Biesse/Selco,
      Giben, Casadei, y las importadas económicas)
- [ ] ¿Es seccionadora de placas, escuadradora, o también hay CNC/router?
- [ ] ¿Cuántas máquinas, y en qué sucursal está cada una? (¿Aserradero, Casa Central o las dos?)
- [ ] Foto de la chapa de identificación

**Del software — es lo más importante**
- [ ] Qué programa usan para optimizar: ¿Cut Rite? ¿Corte Certo? ¿Ardis? ¿Optimik?
      ¿CutMaster? ¿Uno propio de la máquina?
- [ ] Versión exacta
- [ ] Abrir el menú **Importar** y fotografiar qué extensiones acepta (.csv, .txt, .xml,
      .mdb, .ptx, .dxf…)
- [ ] Abrir el menú **Exportar / Informes** y fotografiar qué genera
- [ ] **Pedir copia en pendrive de un archivo de trabajo real y de una lista de piezas real.**
      Un ejemplo concreto vale más que cualquier manual
- [ ] ¿El software tiene manual? Pedirlo en PDF

**Del proceso actual**
- [ ] ¿Cómo cargan hoy las piezas? ¿Tipean a mano cada medida? ¿Importan de algún lado?
- [ ] ¿Cuántos trabajos de corte hacen por día? ¿Cuánto tarda la carga manual?
- [ ] ¿Imprimen etiquetas con código de barras por pieza? ¿Con qué impresora?
- [ ] ¿Cómo descuentan hoy el stock de placas consumidas?
- [ ] ¿Quién opera? ¿Una persona o varias? (por R9 — capacitación)

**De la infraestructura**
- [ ] Sistema operativo de la PC de la máquina (ojo: muchas siguen en Windows 7 o XP)
- [ ] ¿Está en red con las otras PC? ¿Tiene internet?
- [ ] ¿Hay carpeta compartida, o todo va por pendrive?
- [ ] ¿Se puede instalar software en esa PC, o el proveedor la tiene bloqueada?
- [ ] ¿Hay alguna PC de la red que quede prendida siempre? (candidata a hostear el agente)

**Comercial**
- [ ] ¿Hay contrato de soporte con el fabricante? ¿Se le puede preguntar por formatos de importación?
- [ ] ¿Qué esperan ganar con esto: ahorrar tiempo de tipeo, evitar errores de medida, o medir desperdicio?

### 9.3 Después de la visita

1. Con la lista de piezas de ejemplo en la mano, definir el formato de intercambio.
2. Elegir nivel 1, 2 o 3 y presupuestar por separado.
3. Recién ahí ajustar los campos de `cutting_items` si hicieran falta más (canto, veta,
   material asociado a una variante de placa concreta).

Mientras tanto, la Etapa 3 sigue como está: la cola de trabajo administrativa se construye
igual y es la base sobre la que después se apoya la integración.

---

## Fuentes

- [ARCA — WSAA, documentación oficial](https://www.afip.gob.ar/ws/documentacion/wsaa.asp)
- [ARCA — Webservices de factura electrónica](https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp)
- [AfipSDK — afip.js](https://github.com/AfipSDK/afip.js/)
- [@ramiidv/arca-facturacion](https://github.com/ramiidv/arca-facturacion)
- [Neon — planes y límites](https://neon.com/docs/introduction/plans)
- [Neon — NextAuth vs Neon Auth vs Better Auth](https://neon.com/guides/nextauth-neon-auth-better-auth-postgres)
- [Neon — Managed Better Auth con Next.js](https://neon.com/guides/neon-auth-nextjs)
