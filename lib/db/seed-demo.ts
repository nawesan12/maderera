/**
 * Lo que le falta a la base para que ninguna pantalla quede en blanco.
 *
 * `db:seed-negocio` carga las reglas reales del negocio y `db:seed-ventas` el
 * movimiento comercial de desarrollo. Entre los dos quedaron ocho tablas en
 * cero, y una tabla en cero no se lee como "todavía no cargaron nada": se lee
 * como que la sección no anda. Eventos, documentación técnica, remitos,
 * solicitudes de profesionales, escalas por volumen, productos sugeridos, cajas
 * del mostrador y órdenes de compra son secciones construidas, probadas y
 * vacías.
 *
 * **Esto son datos de demostración y no del negocio.** Van en un script aparte
 * de `seed-negocio` justamente por eso: lo de allá sale del brief de la clienta
 * y se queda; lo de acá se borra el día que entren los datos de verdad.
 *
 * Es idempotente: cada bloque busca por su clave natural y actualiza en vez de
 * duplicar. Se puede correr encima de una base con datos y se puede correr dos
 * veces.
 *
 * Uso:
 *   npm run db:seed-demo
 *   # contra producción, con un archivo de entorno que apunte DATABASE_URL a Neon
 *   node --env-file=.env.produccion node_modules/.bin/tsx lib/db/seed-demo.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import * as schema from "./schema";

const {
  branches,
  customers,
  deliveries,
  deliveryItems,
  events,
  eventRegistrations,
  expenses,
  orderItems,
  orders,
  posDevices,
  priceLists,
  products,
  productVariants,
  professionalApplications,
  purchaseOrders,
  purchaseOrderItems,
  relatedProducts,
  shippingZones,
  suppliers,
  technicalDocuments,
  volumeDiscounts,
} = schema;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema, casing: "snake_case" });

/** Días desde hoy, a las 10 de la mañana. Los eventos tienen hora, no momento. */
function enDias(dias: number, hora = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(hora, 0, 0, 0);
  return d;
}

function haceHoras(horas: number): Date {
  return new Date(Date.now() - horas * 3600_000);
}

/* -------------------------------------------------------------------------- */

/**
 * Las tres zonas de envío con tarifa inventada.
 *
 * Salieron de `seed-ventas` —datos de desarrollo— y quedaron conviviendo con
 * las tres del brief, que son las buenas y van **a cotizar** porque la clienta
 * contestó "depende" al costo de las tres. El resultado en el checkout es que
 * hoy aparecen dos "Mar del Plata": una a $18.000 y otra a $0.
 *
 * Se desactivan, no se borran: los pedidos sembrados guardan el nombre de su
 * zona y el histórico tiene que seguir leyéndose igual.
 */
const ZONAS_INVENTADAS = [
  "Mar del Plata — centro y macrocentro",
  "Mar del Plata — resto de la ciudad",
  "Sierra de los Padres y alrededores",
];

async function limpiarZonas() {
  const tocadas = await db
    .update(shippingZones)
    .set({ activa: false })
    .where(
      and(
        inArray(shippingZones.nombre, ZONAS_INVENTADAS),
        eq(shippingZones.activa, true),
      ),
    )
    .returning({ nombre: shippingZones.nombre });

  console.log(
    `· Zonas de envío: ${tocadas.length} con tarifa inventada, desactivadas. ` +
      "Quedan las tres del brief, a cotizar.",
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Las cajas físicas del mostrador.
 *
 * Sin al menos una, el punto de venta no se puede vincular y **la venta sin
 * conexión no se puede mostrar**: el número provisorio del ticket sale del
 * código de la caja (`CAJA1-017`), y el código lo asigna el servidor
 * justamente para que dos máquinas no se autobauticen igual.
 */
const CAJAS = [
  { codigo: "CAJA1", nombre: "Mostrador — puesto 1", sucursal: "casa-central" },
  { codigo: "CAJA2", nombre: "Mostrador — puesto 2", sucursal: "casa-central" },
  { codigo: "CAJA3", nombre: "Aserradero — mostrador", sucursal: "aserradero" },
];

async function sembrarCajas(sucursal: Map<string, string>) {
  for (const caja of CAJAS) {
    const branchId = sucursal.get(caja.sucursal);
    if (!branchId) continue;

    await db
      .insert(posDevices)
      .values({
        codigo: caja.codigo,
        nombre: caja.nombre,
        branchId,
        // El secreto no autoriza nada: sirve para que una máquina no se
        // apropie del contador de otra. Se genera acá y no se escribe fijo,
        // para que dos bases no compartan el mismo.
        secreto: randomBytes(24).toString("hex"),
      })
      .onConflictDoUpdate({
        target: posDevices.codigo,
        // El secreto **no** se pisa: si esta caja ya está vinculada a una
        // máquina, reescribirlo la desvincularía sin que nadie se entere.
        set: { nombre: caja.nombre, branchId, activo: true },
      });
  }
  console.log(`· Cajas del mostrador: ${CAJAS.length}.`);
}

/* -------------------------------------------------------------------------- */

const DOCUMENTOS = [
  {
    titulo: "Placa OSB estructural — ficha técnica",
    descripcion: "Espesores, medidas, clase de emisión y condiciones de almacenamiento.",
    categoria: "Placas",
    url: "/fichas/ficha-tecnica-osb.pdf",
    soloProfesionales: false,
    orden: 0,
  },
  {
    titulo: "Tirantería de pino — tabla de cargas",
    descripcion: "Escuadrías, humedad de entrega y luces máximas orientativas.",
    categoria: "Estructura",
    url: "/fichas/tabla-de-cargas-tirantes.pdf",
    soloProfesionales: true,
    orden: 1,
  },
  {
    titulo: "Machimbre — instructivo de colocación",
    descripcion: "Aclimatación, encastre, fijación oculta y separación de clavaderas.",
    categoria: "Techos",
    url: "/fichas/instructivo-colocacion-machimbre.pdf",
    soloProfesionales: false,
    orden: 2,
  },
];

/**
 * Documentación técnica.
 *
 * Los tres PDF son reales y están en `public/fichas/`: un enlace que descarga
 * un 404 se ve peor que una sección vacía. Cada uno dice al pie que es un
 * ejemplo de demostración, porque la ficha buena la tiene el fabricante y la
 * carga el cliente.
 */
async function sembrarDocumentacion() {
  for (const doc of DOCUMENTOS) {
    const [previo] = await db
      .select({ id: technicalDocuments.id })
      .from(technicalDocuments)
      .where(eq(technicalDocuments.titulo, doc.titulo))
      .limit(1);

    if (previo) {
      await db
        .update(technicalDocuments)
        .set({ ...doc, activo: true, updatedAt: new Date() })
        .where(eq(technicalDocuments.id, previo.id));
    } else {
      await db.insert(technicalDocuments).values({ ...doc, formato: "pdf" });
    }
  }
  console.log(`· Documentación técnica: ${DOCUMENTOS.length} fichas.`);
}

/* -------------------------------------------------------------------------- */

const EVENTOS = [
  {
    slug: "wood-frame-experiencia",
    titulo: "Wood Frame Experiencia",
    resumen: "Una jornada de construcción en seco con madera, de la platea al cerramiento.",
    descripcion:
      "Jornada práctica sobre sistema Wood Frame: fundación, entramado, placas de OSB, " +
      "barrera de agua y viento, aislación y terminación. Se arma un panel completo en el " +
      "taller. Incluye material y certificado de asistencia.",
    lugar: "Aserradero — Diagonal Canosa 61",
    sucursal: "aserradero",
    dias: 21,
    cupo: 30,
    precio: "45000",
    soloProfesionales: false,
    anotados: [
      { nombre: "Arq. Carolina Méndez", email: "carolina@estudiocm.com.ar", estado: "confirmada" as const },
      { nombre: "Roberto Fernández", email: "roberto@rfconstrucciones.com.ar", estado: "confirmada" as const },
      { nombre: "Martín Pérez", email: "carpinteriaperez@gmail.com", estado: "reservada" as const },
    ],
  },
  {
    slug: "optimizacion-de-corte-de-placas",
    titulo: "Optimización de corte de placas",
    resumen: "Cómo sacar más piezas de la misma placa, con la seccionadora al lado.",
    descripcion:
      "Taller corto para carpinteros y mueblistas: lectura del despiece, veta y sentido de " +
      "corte, ancho de sierra, y cómo llega la lista de piezas desde la plataforma al " +
      "optimizador de la máquina. Cupo reducido porque se hace parado frente a la seccionadora.",
    lugar: "Aserradero — Diagonal Canosa 61",
    sucursal: "aserradero",
    dias: 38,
    cupo: 12,
    precio: "0",
    soloProfesionales: true,
    anotados: [
      { nombre: "Ana Torres", email: "ana@atdiseno.com.ar", estado: "confirmada" as const },
    ],
  },
];

async function sembrarEventos(
  sucursal: Map<string, string>,
  cliente: Map<string, string>,
) {
  let inscripciones = 0;

  for (const ev of EVENTOS) {
    const valores = {
      titulo: ev.titulo,
      resumen: ev.resumen,
      descripcion: ev.descripcion,
      lugar: ev.lugar,
      branchId: sucursal.get(ev.sucursal) ?? null,
      inicia: enDias(ev.dias, 9),
      termina: enDias(ev.dias, 17),
      cupo: ev.cupo,
      precio: ev.precio,
      soloProfesionales: ev.soloProfesionales,
      estado: "publicado" as const,
      updatedAt: new Date(),
    };

    const [evento] = await db
      .insert(events)
      .values({ slug: ev.slug, ...valores })
      .onConflictDoUpdate({ target: events.slug, set: valores })
      .returning({ id: events.id });

    for (const persona of ev.anotados) {
      await db
        .insert(eventRegistrations)
        .values({
          eventId: evento.id,
          customerId: cliente.get(persona.email) ?? null,
          nombre: persona.nombre,
          email: persona.email,
          estado: persona.estado,
        })
        // Ya anotado es ya anotado: el índice único por evento y correo es lo
        // que impide que correr esto dos veces duplique el cupo ocupado.
        .onConflictDoNothing();
      inscripciones += 1;
    }
  }

  console.log(
    `· Eventos: ${EVENTOS.length} publicados, con ${inscripciones} inscripciones.`,
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Escalas de descuento por volumen para la lista profesional.
 *
 * Son las que lee el banner de profesionales de la portada, que hoy sale sin
 * la lista porque no hay ninguna cargada. Los porcentajes son de
 * demostración: **el brief no los dio**, y el escalón del −15 % sigue anotado
 * como insumo pendiente en `docs/CAMBIOS.md` porque nadie dijo desde qué monto
 * aplica. Estas son por cantidad, que es otra cosa y no lo reemplaza.
 */
const ESCALAS = [
  { desdeCantidad: "10", porcentaje: "3" },
  { desdeCantidad: "25", porcentaje: "5" },
  { desdeCantidad: "50", porcentaje: "8" },
];

async function sembrarEscalas() {
  const [lista] = await db
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(eq(priceLists.slug, "profesional"))
    .limit(1);

  if (!lista) {
    console.warn("· Escalas por volumen: no existe la lista profesional, se saltea.");
    return;
  }

  for (const escala of ESCALAS) {
    const [previa] = await db
      .select({ id: volumeDiscounts.id })
      .from(volumeDiscounts)
      .where(
        and(
          eq(volumeDiscounts.priceListId, lista.id),
          eq(volumeDiscounts.desdeCantidad, escala.desdeCantidad),
          sql`${volumeDiscounts.variantId} is null`,
          sql`${volumeDiscounts.categoryId} is null`,
        ),
      )
      .limit(1);

    if (previa) {
      await db
        .update(volumeDiscounts)
        .set({ porcentaje: escala.porcentaje, activo: true })
        .where(eq(volumeDiscounts.id, previa.id));
    } else {
      await db.insert(volumeDiscounts).values({ priceListId: lista.id, ...escala });
    }
  }
  console.log(`· Escalas por volumen: ${ESCALAS.length} sobre la lista profesional.`);
}

/* -------------------------------------------------------------------------- */

const SOLICITUDES = [
  {
    nombre: "Ezequiel Barrios",
    razonSocial: "Wood Framer",
    cuit: "20315678903",
    email: "ezequiel@woodframer.com.ar",
    telefono: "2235287248",
    rubro: "constructora" as const,
    volumenEstimado: "Entre 8 y 12 viviendas por año en sistema Wood Frame.",
    localidad: "Mar del Plata",
    mensaje:
      "Trabajamos con ustedes hace tres años comprando por mostrador. Queremos la " +
      "lista de profesionales y cuenta corriente para poder pedir sin ir hasta el local.",
    horas: 20,
  },
  {
    nombre: "Valeria Sosa",
    razonSocial: "Sosa Carpintería de Obra",
    cuit: "27289876541",
    email: "valeria@sosacarpinteria.com.ar",
    telefono: "2234109876",
    rubro: "carpintero" as const,
    matricula: null,
    volumenEstimado: "Placas y tapacantos, unas 40 placas por mes.",
    localidad: "Mar del Plata",
    mensaje: "Necesito precio de melamina cortada y saber si hacen entrega en Batán.",
    horas: 52,
  },
];

/**
 * Dos solicitudes esperando respuesta.
 *
 * La pantalla de profesionales sin ninguna no muestra lo que hay que ver: que
 * aprobar es asignarle a alguien una lista de precios y un límite de cuenta
 * corriente, que son las dos decisiones caras de ese formulario.
 */
async function sembrarSolicitudes() {
  for (const s of SOLICITUDES) {
    const { horas, ...datos } = s;
    const [previa] = await db
      .select({ id: professionalApplications.id })
      .from(professionalApplications)
      .where(eq(professionalApplications.cuit, s.cuit))
      .limit(1);

    if (previa) {
      await db
        .update(professionalApplications)
        .set({ ...datos, updatedAt: new Date() })
        .where(eq(professionalApplications.id, previa.id));
    } else {
      await db
        .insert(professionalApplications)
        .values({ ...datos, estado: "pendiente", createdAt: haceHoras(horas) });
    }
  }
  console.log(`· Solicitudes de profesionales: ${SOLICITUDES.length} pendientes.`);
}

/* -------------------------------------------------------------------------- */

/**
 * Productos sugeridos, por slug.
 *
 * Complementario es "lo que hace falta además": la placa y el tapacanto, el
 * tirante y el tornillo. Similar es "lo mismo más barato o más caro", que es
 * lo que se ofrece cuando no hay stock.
 */
const SUGERIDOS: Record<string, { complementario?: string[]; similar?: string[] }> = {
  "melamina-blanca": {
    complementario: ["bisagra-cierre-suave", "corredera-telescopica"],
    similar: ["mdf", "fenolico"],
  },
  mdf: {
    complementario: ["laca-poliuretanica", "moldura-zocalo-moldava"],
    similar: ["melamina-blanca"],
  },
  "machimbre-pino": {
    complementario: ["tirante-pino-tratado", "laca-poliuretanica"],
    similar: ["piso-melaminico-roble-natural"],
  },
  "tirante-pino-tratado": {
    complementario: ["machimbre-pino", "membrana-asfaltica"],
    similar: ["tirante-saligna"],
  },
  "deck-grandis": {
    complementario: ["tornillo-autoperforante-cubierta", "laca-poliuretanica"],
    similar: ["deck-pvc"],
  },
  "chapa-acanalada-galvanizada": {
    complementario: ["tornillo-autoperforante-cubierta", "lana-de-vidrio"],
    similar: ["curvin-tejado-metalico"],
  },
};

async function sembrarSugeridos() {
  const filas = await db
    .select({ id: products.id, slug: products.slug })
    .from(products);
  const porSlug = new Map(filas.map((p) => [p.slug, p.id]));

  let pares = 0;

  for (const [slug, grupos] of Object.entries(SUGERIDOS)) {
    const productId = porSlug.get(slug);
    if (!productId) continue;

    for (const [tipo, slugs] of [
      ["complementario", grupos.complementario ?? []],
      ["similar", grupos.similar ?? []],
    ] as const) {
      let orden = 0;
      for (const otro of slugs) {
        const relatedProductId = porSlug.get(otro);
        if (!relatedProductId || relatedProductId === productId) continue;

        await db
          .insert(relatedProducts)
          .values({ productId, relatedProductId, tipo, orden: orden++ })
          .onConflictDoNothing();
        pares += 1;
      }
    }
  }
  console.log(`· Productos sugeridos: ${pares} relaciones sobre ${Object.keys(SUGERIDOS).length} productos.`);
}

/* -------------------------------------------------------------------------- */

/**
 * Dos remitos sobre pedidos que ya existen.
 *
 * Uno firmado y entregado, que es la constancia; y uno preparado con su token
 * de firma vivo, que es el que se abre en el celular y se firma con el dedo
 * durante la demostración. Sin el segundo no hay nada que firmar.
 *
 * El token se genera acá y se imprime al final, porque el enlace de firma es
 * `/firmar/<token>` y no hay forma de adivinarlo — que es justamente lo que lo
 * hace seguro.
 */
async function sembrarRemitos(): Promise<{ numero: string; token: string } | null> {
  const pedidos = await db
    .select({
      id: orders.id,
      numero: orders.numero,
      branchId: orders.branchId,
      contacto: orders.contactoNombre,
    })
    .from(orders)
    .where(inArray(orders.numero, ["PED-1204", "PED-1205"]));

  if (pedidos.length < 2) {
    console.warn("· Remitos: faltan los pedidos sembrados, se saltea.");
    return null;
  }

  const porNumero = new Map(pedidos.map((p) => [p.numero, p]));
  let porFirmar: { numero: string; token: string } | null = null;

  const RECEPTORES = [
    {
      pedido: "PED-1204",
      remito: "REM-0001",
      receptorNombre: "Roberto Fernández",
      receptorDocumento: "28.456.789",
      firmado: true,
    },
    {
      pedido: "PED-1205",
      remito: "REM-0002",
      receptorNombre: "Carolina Méndez",
      receptorDocumento: "32.456.789",
      firmado: false,
    },
  ];

  for (const r of RECEPTORES) {
    const pedido = porNumero.get(r.pedido);
    if (!pedido) continue;

    const [previo] = await db
      .select({ id: deliveries.id, firmaToken: deliveries.firmaToken })
      .from(deliveries)
      .where(eq(deliveries.numero, r.remito))
      .limit(1);

    const token = previo?.firmaToken ?? randomBytes(24).toString("base64url");

    const valores = {
      orderId: pedido.id,
      branchId: pedido.branchId,
      tipo: "retiro" as const,
      estado: r.firmado ? ("entregada" as const) : ("preparada" as const),
      receptorNombre: r.receptorNombre,
      receptorDocumento: r.receptorDocumento,
      firmaToken: token,
      /*
       * El remito firmado se deja **sin `firmaUrl`**: la firma es un PNG en
       * almacenamiento privado y no se puede inventar un archivo que no
       * existe. Queda con fecha de entrega y receptor, que es lo que se
       * consulta; la firma con el dedo se muestra en vivo con el otro.
       */
      firmadoAt: r.firmado ? haceHoras(30) : null,
      entregadoAt: r.firmado ? haceHoras(30) : null,
      updatedAt: new Date(),
    };

    const [remito] = previo
      ? await db
          .update(deliveries)
          .set(valores)
          .where(eq(deliveries.id, previo.id))
          .returning({ id: deliveries.id })
      : await db
          .insert(deliveries)
          .values({ numero: r.remito, ...valores })
          .returning({ id: deliveries.id });

    // Los renglones: todo lo del pedido, que es el caso normal del retiro.
    const renglones = await db
      .select({ id: orderItems.id, cantidad: orderItems.cantidad })
      .from(orderItems)
      .where(eq(orderItems.orderId, pedido.id));

    await db.delete(deliveryItems).where(eq(deliveryItems.deliveryId, remito.id));
    if (renglones.length > 0) {
      await db.insert(deliveryItems).values(
        renglones.map((linea, i) => ({
          deliveryId: remito.id,
          orderItemId: linea.id,
          cantidad: linea.cantidad,
          orden: i,
        })),
      );
    }

    if (!r.firmado) porFirmar = { numero: r.remito, token };
  }

  console.log("· Remitos: 1 entregado y 1 esperando firma.");
  return porFirmar;
}

/* -------------------------------------------------------------------------- */

/**
 * Dos órdenes de compra **enviadas**, y ninguna recepción.
 *
 * A propósito: recibir mercadería mueve stock y costo promedio ponderado en
 * una transacción, y escribir eso a mano acá sería una segunda implementación
 * de `confirmarRecepcion` que puede quedar distinta de la buena. Lo que hace
 * falta para la demostración es que "lo que está por llegar" tenga algo; la
 * recepción se confirma en vivo desde la pantalla y ahí se ve moverse el stock,
 * que es mejor demostración que un dato ya cargado.
 */
const ORDENES = [
  {
    numero: "OC-0001",
    proveedor: "Tableros del Sur S.A.",
    sucursal: "casa-central",
    dias: 6,
    notas: "Reposición de placas. Confirmaron flete propio.",
    items: [
      { slug: "melamina-blanca", cantidad: "40", costo: "38500" },
      { slug: "mdf", cantidad: "30", costo: "24800" },
    ],
  },
  {
    numero: "OC-0002",
    proveedor: "El Ombú S.R.L.",
    sucursal: "aserradero",
    dias: 12,
    notas: "Tirantería seca en cámara. Pedir remito con humedad declarada.",
    items: [
      { slug: "tirante-pino-tratado", cantidad: "120", costo: "12400" },
      { slug: "machimbre-pino", cantidad: "200", costo: "9800" },
    ],
  },
];

async function sembrarCompras(sucursal: Map<string, string>) {
  const provs = await db
    .select({ id: suppliers.id, razonSocial: suppliers.razonSocial })
    .from(suppliers);
  const porProveedor = new Map(
    provs.filter((p) => p.razonSocial).map((p) => [p.razonSocial!, p.id]),
  );

  // La primera variante de cada producto: la orden de compra apunta a variante,
  // no a producto, porque lo que se pide es una medida concreta.
  const variantes = await db
    .select({
      variantId: productVariants.id,
      slug: products.slug,
      nombre: products.name,
      label: productVariants.label,
      orden: productVariants.sortOrder,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId));

  const primeraVariante = new Map<string, (typeof variantes)[number]>();
  for (const v of [...variantes].sort((a, b) => a.orden - b.orden)) {
    if (!primeraVariante.has(v.slug)) primeraVariante.set(v.slug, v);
  }

  let cargadas = 0;

  for (const oc of ORDENES) {
    const supplierId = porProveedor.get(oc.proveedor);
    const branchId = sucursal.get(oc.sucursal);
    if (!supplierId || !branchId) continue;

    const valores = {
      supplierId,
      branchId,
      estado: "enviada" as const,
      fechaPrometida: enDias(oc.dias, 9),
      notas: oc.notas,
      enviadaAt: haceHoras(oc.dias * 2),
    };

    const [orden] = await db
      .insert(purchaseOrders)
      .values({ numero: oc.numero, ...valores })
      .onConflictDoUpdate({ target: purchaseOrders.numero, set: valores })
      .returning({ id: purchaseOrders.id });

    // Los renglones se reescriben enteros: es la forma simple de que correr
    // esto dos veces no deje una orden con los renglones duplicados.
    await db
      .delete(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, orden.id));

    const renglones = oc.items
      .map((item, i) => {
        const v = primeraVariante.get(item.slug);
        if (!v) return null;
        return {
          purchaseOrderId: orden.id,
          variantId: v.variantId,
          descripcion: v.label ? `${v.nombre} — ${v.label}` : v.nombre,
          cantidad: item.cantidad,
          costoUnitario: item.costo,
          orden: i,
        };
      })
      .filter((x) => x !== null);

    if (renglones.length > 0) {
      await db.insert(purchaseOrderItems).values(renglones);
      cargadas += 1;
    }
  }

  console.log(`· Órdenes de compra: ${cargadas} enviadas, esperando recepción.`);
}

/* -------------------------------------------------------------------------- */

const GASTOS = [
  { categoria: "flete" as const, descripcion: "Flete de entrega — zona sur", importe: "85000", medio: "efectivo" as const, dias: 2, sucursal: "casa-central" },
  { categoria: "combustible" as const, descripcion: "Combustible camión Iveco", importe: "142000", medio: "debito" as const, dias: 4, sucursal: "casa-central" },
  { categoria: "mantenimiento" as const, descripcion: "Afilado de sierras de la seccionadora", importe: "96000", medio: "transferencia" as const, dias: 9, sucursal: "aserradero" },
  { categoria: "servicios" as const, descripcion: "Energía eléctrica — bimestre", importe: "418000", medio: "transferencia" as const, dias: 14, sucursal: "aserradero" },
];

async function sembrarGastos(sucursal: Map<string, string>) {
  for (const g of GASTOS) {
    const { dias, sucursal: slug, ...datos } = g;
    const fecha = haceHoras(dias * 24);

    const [previo] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.descripcion, g.descripcion))
      .limit(1);

    if (previo) {
      await db
        .update(expenses)
        .set({ ...datos, fecha, branchId: sucursal.get(slug) ?? null })
        .where(eq(expenses.id, previo.id));
    } else {
      await db
        .insert(expenses)
        .values({ ...datos, fecha, branchId: sucursal.get(slug) ?? null });
    }
  }
  console.log(`· Gastos: ${GASTOS.length}.`);
}

/* -------------------------------------------------------------------------- */

async function main() {
  console.log("Datos de demostración\n");

  const sucursales = await db
    .select({ id: branches.id, slug: branches.slug })
    .from(branches);
  const sucursal = new Map(sucursales.map((b) => [b.slug, b.id]));

  const fichas = await db
    .select({ id: customers.id, email: customers.email })
    .from(customers);
  const cliente = new Map(
    fichas.filter((c) => c.email).map((c) => [c.email!, c.id]),
  );

  await limpiarZonas();
  await sembrarCajas(sucursal);
  await sembrarDocumentacion();
  await sembrarEventos(sucursal, cliente);
  await sembrarEscalas();
  await sembrarSolicitudes();
  await sembrarSugeridos();
  const porFirmar = await sembrarRemitos();
  await sembrarCompras(sucursal);
  await sembrarGastos(sucursal);

  console.log("\nListo.");

  if (porFirmar) {
    console.log(
      `\nEl remito ${porFirmar.numero} está esperando firma. El enlace no se puede\n` +
        "adivinar —ese es el punto— así que se anota acá:\n\n" +
        `  /firmar/${porFirmar.token}\n`,
    );
  }

  console.log(
    "Lo que sigue vacío y es a propósito:\n" +
      "  · Comprobantes emitidos. `puntos_venta.numeroInicial` está en cero en los\n" +
      "    tres puntos: emitir uno de prueba arrancaría el correlativo en 1 y pisaría\n" +
      "    la serie que ARCA viene contando. Se emite en vivo, en modo demostración.\n" +
      "  · Recepciones, facturas de compra y pagos a proveedor. Se hacen en vivo desde\n" +
      "    la orden OC-0001, que es donde se ve moverse el stock y el costo.",
  );

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
