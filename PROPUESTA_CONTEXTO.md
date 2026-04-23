# Contexto para Generacion de Propuesta Comercial - Maderera Juan B. Justo

> **Instrucciones para el LLM:** Este documento contiene toda la informacion necesaria sobre el proyecto web desarrollado para Maderera Juan B. Justo (MJBJ). Usa este contexto para generar una propuesta comercial profesional, detallando el valor entregado, las funcionalidades desarrolladas y el impacto esperado en el negocio del cliente.

---

## 1. DATOS DEL CLIENTE

| Campo | Detalle |
|---|---|
| **Razon Social** | Maderera Juan B. Justo |
| **Sigla** | MJBJ |
| **Rubro** | Venta y distribucion de maderas, materiales de construccion e insumos de carpinteria |
| **Ubicacion** | Mar del Plata, Argentina |
| **Fundacion** | 1981 (mas de 43 anos en el mercado) |
| **Cantidad de sucursales** | 2 |
| **Marca propia** | Moldava (molduras y listoneria en Pino Finger Joint, con distribucion nacional) |
| **Catalogo** | +200 productos en 8 categorias |
| **Clientes estimados** | +1000 activos |
| **Publico objetivo** | Arquitectos, constructoras, carpinteros, disenadores de interiores, desarrolladores inmobiliarios, y publico particular (DIY/refacciones) |
| **Dominio web** | mjbj.ar |

### Sucursales

- **Casa Central:** Av. Juan B. Justo 4153, Mar del Plata — Showroom, corte de placas, stock de molduras y fenolicos. Tel: (0223) 474-3328. WhatsApp: +54 223-5903118.
- **Aserradero:** Canosa N°61, Mar del Plata — Planta de produccion, techos, escaleras, decks, machimbre, ferreteria. Tel: (0223) 483-0535. WhatsApp: +54 223-5060817.
- **Horario:** Lun-Vie 8:00-16:00 | Sab 8:00-12:00
- **Emails:** info@mjbj.com.ar / info@aserradero.mjbj.com.ar

---

## 2. SLOGAN Y MENSAJES CLAVE DEL CLIENTE

- **Tagline principal:** "Tu proyecto. Nuestra madera."
- **Mensaje institucional:** "Mas de 40 anos construyendo confianza"
- **CTA recurrente:** "Presupuestos sin cargo" (gratuitos)
- **Propuesta de valor:** Proveedor integral de maderas y materiales con asesoramiento profesional, herramientas digitales y stock transparente.

---

## 3. LO QUE SE DESARROLLO (ALCANCE DEL PROYECTO)

### 3.1 Sitio Web Publico (10 paginas/secciones)

#### Home Page
- Hero animado a pantalla completa con CTA
- Strip de beneficios clave (envio, asesoramiento, financiacion, trayectoria)
- Grilla tipo bento con categorias de productos
- Seccion de herramientas digitales (Calculadora, Presupuestador, Consultor de Stock)
- Banner institucional con estadisticas (43+ anos, 2 sucursales, 200+ productos, 1000+ clientes)
- Carrusel de testimonios de clientes reales (4 resenas 5 estrellas)
- Mapa interactivo de sucursales con botones de contacto directo
- Preview del blog
- CTA final para solicitar presupuesto

#### Catalogo de Productos (`/catalogo`)
- Navegacion por 8 categorias de productos
- Buscador en tiempo real
- Filtros por categoria y disponibilidad de stock
- Tarjetas de producto con indicadores de stock por sucursal (Alto/Medio/Bajo/Sin stock)
- Grilla responsive

#### Calculadora de Materiales (`/calculadora`)
Herramienta interactiva con 4 modulos de calculo:
- **Techos:** Calcula tirantes, machimbre, aislacion, membrana y clavos segun medidas
- **Placas:** Optimiza cortes de placas/tableros minimizando desperdicio
- **Pisos:** Calcula piso flotante, zocalos y espuma niveladora
- **Decks:** Calcula materiales para decks (madera o PVC), estructura y tornilleria
- Los resultados se agregan directamente al presupuesto

#### Presupuestador Online (`/presupuesto`)
- Interfaz tipo carrito de compras
- Items provenientes de la calculadora o agregados manualmente desde el catalogo
- Ajuste de cantidades con controles +/-
- Formulario de datos del cliente (nombre, email, telefono, notas)
- Selector de sucursal
- Envio por email o por WhatsApp con un click
- Resumen del presupuesto en tarjeta lateral

#### Consultor de Stock en Tiempo Real (`/stock`)
- Consulta de disponibilidad en ambas sucursales
- Busqueda por nombre de producto
- Filtro por categoria
- Indicadores visuales de nivel de stock (Alto/Medio/Bajo/Sin stock)
- Estadisticas de disponibilidad general

#### Nosotros (`/nosotros`)
- Historia y valores de la empresa (Calidad, Servicio, Logistica, Confianza)
- Timeline de hitos desde 1981 hasta 2026
- Seccion dedicada a la marca Moldava
- Estadisticas clave animadas

#### Portal de Profesionales (`/profesionales`)
- Beneficios exclusivos: precios especiales, descuentos por volumen, cuenta corriente, presupuestos express (24h), asesor dedicado
- Funcionalidades del portal: historial de compras, presupuestos guardados, stock en tiempo real, chat con asesor, documentacion tecnica
- Formulario de registro con campo CUIT

#### Contacto (`/contacto`)
- Boton destacado de WhatsApp directo
- Tarjetas de ambas sucursales con toda la info de contacto
- Formulario con chips de categoria (Presupuesto, Producto, Obra, Otro)
- Mapas embebidos de ambas ubicaciones

#### Blog (`/blog`)
- Estructura para marketing de contenidos y SEO
- Categorias, fechas, tiempo de lectura
- Preparado para carga de articulos

#### Sucursales (`/sucursales`)
- Info detallada de cada sucursal con imagenes
- Botones de WhatsApp y llamada directa

### 3.2 Panel de Administracion (`/admin`)

Dashboard completo con:
- **KPIs principales:** Ventas mensuales, presupuestos pendientes, productos con stock bajo, clientes activos
- **Grafico de ventas:** Barras apiladas por sucursal (ultimos 6 meses)
- **Alertas de stock:** Widget con productos que requieren reposicion
- **Presupuestos recientes:** Tabla con estado y acciones
- **Pedidos del dia:** Tabla con seguimiento

Secciones de gestion:
- `/admin/pedidos` — Gestion de pedidos
- `/admin/cortes` — Gestion de cortes de placas
- `/admin/stock` — Control de inventario
- `/admin/clientes` — Base de datos de clientes
- `/admin/presupuestos` — Administracion de presupuestos recibidos
- `/admin/sucursales` — Gestion de sucursales

### 3.3 Componentes Transversales

- **Navbar sticky** con menu de productos, contador de presupuesto y datos de contacto
- **Footer** con 4 columnas (Marca, Productos, Navegacion, Contacto)
- **Boton flotante de WhatsApp** presente en todas las paginas
- **Diseno responsive** mobile-first
- **Animaciones fluidas** en transiciones y elementos interactivos
- **SEO optimizado** con metadata por pagina (keywords: maderera mar del plata, molduras moldava, presupuesto madera, decks, etc.)

---

## 4. STACK TECNOLOGICO

| Tecnologia | Version | Proposito |
|---|---|---|
| Next.js | 16.2.2 | Framework principal (App Router, SSR, SSG) |
| React | 19.2.4 | Libreria de UI |
| TypeScript | 5.x | Tipado estatico |
| Tailwind CSS | 4 | Sistema de estilos utility-first |
| shadcn/ui | Ultima | Componentes UI accesibles y personalizables |
| Framer Motion | 12.38 | Animaciones y transiciones |
| Lucide React | 1.7 | Iconografia |
| ESLint | 9 | Calidad de codigo |

---

## 5. CATEGORIAS DE PRODUCTOS (8)

| # | Categoria | Productos | Descripcion |
|---|---|---|---|
| 1 | Techos | 24 | Tirantes (pino tratado, saligna), machimbre, aislacion, membrana, clavos |
| 2 | Placas | 32 | Melamina, MDF, fenolicos, terciados. Servicio de corte a medida |
| 3 | Pisos | 18 | Piso flotante Decno Flooring, zocalos, espuma niveladora |
| 4 | Molduras | 45 | Marca Moldava: zocalos, marcos, cornisas en Pino Finger Joint. Distribucion nacional |
| 5 | Ferreteria | 60 | Tornilleria, bisagras, pinturas, lacas, terminaciones |
| 6 | Decks y Escaleras | 15 | Deck grandis tratado, deck PVC, escaleras a medida |
| 7 | Construccion en Seco | 28 | Placas Durlock, perfileria metalica, aislantes, accesorios |
| 8 | Cubiertas | 12 | Chapas, tejas, cubiertas metalicas Curvin |

**Total: +200 productos catalogados con stock por sucursal.**

---

## 6. DIFERENCIADORES DIGITALES (VALOR AGREGADO DEL PROYECTO)

Estas son las funcionalidades que distinguen al sitio de un sitio web informativo comun:

### Calculadora de Materiales
- **Problema que resuelve:** El cliente (profesional o particular) necesita saber cuanto material comprar para su obra. Normalmente debe llamar o ir fisicamente a la maderera.
- **Solucion:** 4 calculadoras especializadas que, con solo ingresar las medidas del proyecto, devuelven la lista exacta de materiales con cantidades.
- **Impacto:** Reduce consultas telefonicas, acelera el proceso de presupuestacion, y posiciona a MJBJ como referente tecnologico en el rubro.

### Presupuestador Online
- **Problema que resuelve:** El proceso de pedir presupuesto era manual (llamar, esperar, ir en persona).
- **Solucion:** Interfaz tipo carrito donde el cliente arma su pedido y lo envia por WhatsApp o email al instante.
- **Impacto:** Generacion de leads automatizada 24/7, reduccion del tiempo de respuesta, mayor conversion.

### Consultor de Stock en Tiempo Real
- **Problema que resuelve:** El cliente no sabe si el producto esta disponible antes de ir a la sucursal.
- **Solucion:** Consulta publica de stock por sucursal con indicadores visuales.
- **Impacto:** Reduce visitas infructuosas, mejora la experiencia del cliente, genera confianza y transparencia.

### Portal de Profesionales
- **Problema que resuelve:** Los profesionales (arquitectos, constructoras) tienen necesidades distintas al publico general: precios diferenciados, cuenta corriente, respuesta rapida.
- **Solucion:** Portal exclusivo con registro, historial, documentacion tecnica y asesor dedicado.
- **Impacto:** Fidelizacion del segmento B2B (mayor ticket promedio y recurrencia).

### Panel de Administracion
- **Problema que resuelve:** La gestion del negocio se hacia de forma fragmentada (planillas, papel, memoria).
- **Solucion:** Dashboard centralizado con KPIs, gestion de pedidos, stock, clientes y presupuestos.
- **Impacto:** Visibilidad total del negocio, toma de decisiones basada en datos, eficiencia operativa.

---

## 7. IMPACTO ESPERADO EN EL NEGOCIO

| Area | Antes | Despues |
|---|---|---|
| **Presupuestos** | Manual (telefono/presencial), demora 24-72h | Automatizado 24/7, envio instantaneo |
| **Consultas de stock** | Llamada telefonica obligatoria | Autoservicio online en tiempo real |
| **Calculo de materiales** | Dependia del vendedor experto | Herramienta digital accesible para todos |
| **Captacion de profesionales** | Boca a boca, visitas | Portal digital con registro y beneficios |
| **Gestion interna** | Fragmentada, sin metricas | Dashboard centralizado con KPIs |
| **Presencia digital** | Basica o inexistente | Sitio moderno, SEO-optimizado, mobile-first |
| **Canal WhatsApp** | Uso informal | Integrado en todo el flujo de conversion |

---

## 8. IDENTIDAD VISUAL IMPLEMENTADA

- **Paleta de colores:** Naranja (primario/marca), Verde (secundario), Gris (neutro), Tono madera (identidad), Crema (acento)
- **Tipografia:** Geist (sans-serif moderna, optimizada con next/font)
- **Iconografia:** Lucide React (coherente y minimalista)
- **Estilo general:** Moderno, limpio, profesional, con calidez (tonos madera). Espaciado generoso, tarjetas con bordes suaves, animaciones sutiles.
- **Logo:** Icono cuadrado redondeado (180x180px)

---

## 9. TESTIMONIOS REALES DEL CLIENTE (para incluir en propuesta)

1. **Carlos M. - Arquitecto:** "Excelente calidad en maderas y un servicio de asesoramiento que marca la diferencia. Los uso para todos mis proyectos."
2. **Maria L. - Disenadora de Interiores:** "La variedad de molduras Moldava es impresionante. Siempre encuentro lo que necesito para mis disenos."
3. **Roberto S. - Constructor:** "Mas de 15 anos trabajando juntos. La logistica de entrega en obra es impecable y los precios son muy competitivos."
4. **Ana P. - Particular:** "Hice mi deck con su asesoramiento y quedo espectacular. Muy profesionales y atentos desde el primer contacto."

---

## 10. METRICAS Y ESTADISTICAS CLAVE

- **43+ anos** en el mercado (fundada en 1981)
- **2 sucursales** operativas en Mar del Plata
- **200+ productos** catalogados digitalmente
- **1000+ clientes** activos
- **8 categorias** de productos
- **4 calculadoras** especializadas de materiales
- **Marca propia Moldava** con distribucion nacional
- **10 paginas publicas** + **panel de administracion completo**

---

## 11. NOTAS PARA EL LLM DE VENTAS

- El cliente es una empresa familiar con mas de 4 decadas en el rubro. Valoran la confianza, el servicio personalizado y la calidad.
- El mercado de maderas en Argentina es tradicionalmente analogico. Este proyecto posiciona a MJBJ como pionero digital en su rubro en Mar del Plata.
- Las herramientas digitales (calculadora, presupuestador, stock) son diferenciadores unicos que ningun competidor local ofrece.
- El portal de profesionales apunta a capturar y fidelizar el segmento de mayor valor (B2B).
- La integracion con WhatsApp es estrategica: es el canal de comunicacion dominante en Argentina para negocios.
- El panel de administracion transforma la operacion interna, pasando de gestion manual a gestion digital.
- El sitio esta preparado para escalar: blog para SEO/content marketing, estructura modular, stack moderno.
- Adapta el tono de la propuesta al contexto argentino: profesional pero cercano, destacando trayectoria y confianza.
