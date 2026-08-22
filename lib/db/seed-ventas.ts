/**
 * Siembra clientes, presupuestos, pedidos y cortes de ejemplo.
 *
 * Va aparte del seed de catálogo porque se corre en otro momento: el catálogo se
 * reemplaza cuando llegue la exportación de Quality Software, mientras que estos
 * datos son solo para poder ver las pantallas funcionando.
 *
 * Uso: npm run db:seed-ventas
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import * as schema from "./schema";

const {
  accountMovements,
  branches,
  cuttingItems,
  cuttingOrders,
  customers,
  orderItems,
  orderStatusHistory,
  orders,
  priceListItems,
  priceLists,
  productVariants,
  products,
  quoteItems,
  quotes,
  shippingZones,
} = schema;

const CLIENTES = [
  { nombre: "Arq. Carolina Méndez", razonSocial: "Estudio CM Arquitectura", cuit: "27-32456789-4", rubro: "Arquitectura", tipo: "profesional", asesor: "Martín", condicionIva: "responsable_inscripto", limite: "5000000", email: "carolina@estudiocm.com.ar", telefono: "223-5512345" },
  { nombre: "Roberto Fernández", razonSocial: "RF Construcciones SRL", cuit: "30-71234567-8", rubro: "Construcción", tipo: "profesional", asesor: "Diego", condicionIva: "responsable_inscripto", limite: "8000000", email: "roberto@rfconstrucciones.com.ar", telefono: "223-5598765" },
  { nombre: "Martín Pérez", razonSocial: "Carpintería Pérez", cuit: "20-28765432-1", rubro: "Carpintería", tipo: "profesional", asesor: "Diego", condicionIva: "monotributista", limite: "1500000", email: "carpinteriaperez@gmail.com", telefono: "223-5533221" },
  { nombre: "Laura Gómez", razonSocial: "Constructora del Sur SA", cuit: "30-70998877-6", rubro: "Construcción", tipo: "profesional", asesor: "Martín", condicionIva: "responsable_inscripto", limite: "12000000", email: "compras@constructoradelsur.com.ar", telefono: "223-5544332" },
  { nombre: "Ana Torres", razonSocial: "AT Diseño Interior", cuit: "27-34567890-2", rubro: "Diseño de interiores", tipo: "profesional", asesor: "Martín", condicionIva: "monotributista", limite: "2000000", email: "ana@atdiseno.com.ar", telefono: "223-5566778" },
  { nombre: "Ing. Facundo López", razonSocial: "López & Asociados", cuit: "20-30112233-9", rubro: "Ingeniería Civil", tipo: "profesional", asesor: "Diego", condicionIva: "responsable_inscripto", limite: "6000000", email: "flopez@lopezasociados.com.ar", telefono: "223-5577889" },
  { nombre: "Jorge Ruiz", razonSocial: null, cuit: null, rubro: null, tipo: "particular", asesor: "Martín", condicionIva: "consumidor_final", limite: "0", email: "jorgeruiz@gmail.com", telefono: "223-5511009" },
  { nombre: "Silvia Domínguez", razonSocial: null, cuit: null, rubro: null, tipo: "particular", asesor: "Diego", condicionIva: "consumidor_final", limite: "0", email: null, telefono: "223-5522110" },
] as const;

const ZONAS = [
  { nombre: "Mar del Plata — centro y macrocentro", cobertura: "7600", costo: "18000", envioGratisDesde: "500000", demoraEstimada: "24 a 48 horas", orden: "0" },
  { nombre: "Mar del Plata — resto de la ciudad", cobertura: "7600, 7601", costo: "26000", envioGratisDesde: "700000", demoraEstimada: "48 horas", orden: "1" },
  { nombre: "Sierra de los Padres y alrededores", cobertura: "7600", costo: "38000", envioGratisDesde: "0", demoraEstimada: "2 a 3 días", orden: "2" },
  { nombre: "Tandil", cobertura: "7000", costo: "72000", envioGratisDesde: "0", demoraEstimada: "3 a 5 días", orden: "3" },
  { nombre: "Necochea", cobertura: "7630", costo: "68000", envioGratisDesde: "0", demoraEstimada: "3 a 5 días", orden: "4" },
] as const;

function diasAtras(dias: number) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL.");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema, casing: "snake_case" });

  console.log("Limpiando ventas…");
  await db.execute(sql`
    TRUNCATE TABLE
      ${cuttingItems}, ${cuttingOrders},
      ${orderStatusHistory}, ${orderItems}, ${orders},
      ${quoteItems}, ${quotes},
      ${accountMovements}, ${customers}, ${shippingZones}
    RESTART IDENTITY CASCADE
  `);

  const sucursales = await db.select().from(branches);
  const central = sucursales.find((s) => s.slug === "casa-central")!;
  const aserradero = sucursales.find((s) => s.slug === "aserradero")!;

  const [listaProfesional] = await db
    .select()
    .from(priceLists)
    .where(eq(priceLists.slug, "profesional"));

  console.log("Zonas de envío…");
  await db.insert(shippingZones).values(ZONAS.map((z) => ({ ...z })));

  console.log("Clientes…");
  const clientesCreados = await db
    .insert(customers)
    .values(
      CLIENTES.map((c) => ({
        nombre: c.nombre,
        razonSocial: c.razonSocial,
        cuit: c.cuit,
        rubro: c.rubro,
        tipo: c.tipo as "particular" | "profesional",
        asesor: c.asesor,
        email: c.email,
        telefono: c.telefono,
        condicionIva: c.condicionIva as
          | "responsable_inscripto"
          | "monotributista"
          | "consumidor_final",
        limiteCredito: c.limite,
        priceListId: c.tipo === "profesional" ? listaProfesional?.id : null,
      })),
    )
    .returning();

  const porNombre = (nombre: string) =>
    clientesCreados.find((c) => c.nombre === nombre)!;

  console.log("Movimientos de cuenta corriente…");
  await db.insert(accountMovements).values([
    { customerId: porNombre("Roberto Fernández").id, tipo: "compra", monto: "2400000", detalle: "Factura A 0001-00012844", createdAt: diasAtras(22) },
    { customerId: porNombre("Roberto Fernández").id, tipo: "pago", monto: "-1200000", detalle: "Transferencia", createdAt: diasAtras(12) },
    { customerId: porNombre("Ana Torres").id, tipo: "compra", monto: "845000", detalle: "Factura B 0001-00012840", createdAt: diasAtras(40) },
    { customerId: porNombre("Ing. Facundo López").id, tipo: "compra", monto: "6720340", detalle: "Factura A 0001-00012847", createdAt: diasAtras(5) },
    { customerId: porNombre("Ing. Facundo López").id, tipo: "pago", monto: "-4500000", detalle: "Mercado Pago", createdAt: diasAtras(2) },
    { customerId: porNombre("Laura Gómez").id, tipo: "compra", monto: "1731994", detalle: "Pedido PED-1201", createdAt: diasAtras(9) },
    { customerId: porNombre("Laura Gómez").id, tipo: "pago", monto: "-1731994", detalle: "Efectivo", createdAt: diasAtras(8) },
  ]);

  // Variantes reales para armar líneas creíbles.
  const variantes = await db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      label: productVariants.label,
      producto: products.name,
      unidad: products.unit,
      precio: priceListItems.price,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(priceListItems, eq(priceListItems.variantId, productVariants.id))
    .limit(200);

  const buscar = (sku: string) => variantes.find((v) => v.sku === sku);

  console.log("Presupuestos…");
  const definicionesQuotes = [
    { numero: "P-2026-0421", cliente: "Arq. Carolina Méndez", estado: "pendiente", origen: "sitio", branch: central, dias: 0, skus: ["PLA-MEL-BLA-18", "PLA-FEN-018", "FER-BIS-035"] },
    { numero: "P-2026-0420", cliente: "Roberto Fernández", estado: "revision", origen: "mostrador", branch: aserradero, dias: 1, skus: ["TEC-TIR-PIN-2436", "TEC-MAC-PIN-1204", "TEC-MEM-ASF-4010"] },
    { numero: "P-2026-0419", cliente: "Laura Gómez", estado: "enviado", origen: "calculadora", branch: central, dias: 1, skus: ["CSE-YES-STD-125", "CSE-PER-MON-069"] },
    { numero: "P-2026-0418", cliente: "Martín Pérez", estado: "aceptado", origen: "mostrador", branch: central, dias: 2, skus: ["MOL-ZOC-070", "MOL-MAR-STD"] },
    { numero: "P-2026-0417", cliente: "Ana Torres", estado: "aceptado", origen: "sitio", branch: aserradero, dias: 3, skus: ["PIS-DEC-ROB-08", "PIS-ZOC-MDF-07"] },
    { numero: "P-2026-0416", cliente: "Jorge Ruiz", estado: "rechazado", origen: "telefono", branch: central, dias: 3, skus: ["DEC-PVC-GRI"] },
    { numero: "P-2026-0415", cliente: "Ing. Facundo López", estado: "pendiente", origen: "sitio", branch: aserradero, dias: 4, skus: ["CUB-CUR-ROJ", "CUB-CHA-C25", "CUB-TOR-AUT-063"] },
  ] as const;

  for (const def of definicionesQuotes) {
    const cliente = porNombre(def.cliente);
    const lineas = def.skus
      .map((sku, i) => {
        const v = buscar(sku);
        if (!v) return null;
        const cantidad = [4, 12, 30, 8, 2][i % 5];
        const precio = Number(v.precio ?? 0);
        return {
          variantId: v.id,
          descripcion: `${v.producto} — ${v.label}`,
          unidad: v.unidad,
          cantidad: String(cantidad),
          precioUnitario: precio.toFixed(2),
          subtotal: (precio * cantidad).toFixed(2),
          orden: i,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);

    const total = lineas.reduce((s, l) => s + Number(l.subtotal), 0);
    const vence = new Date();
    vence.setDate(vence.getDate() + 15 - def.dias);

    const [quote] = await db
      .insert(quotes)
      .values({
        numero: def.numero,
        customerId: cliente.id,
        contactoNombre: cliente.nombre,
        contactoEmail: cliente.email,
        contactoTelefono: cliente.telefono,
        branchId: def.branch.id,
        estado: def.estado as never,
        origen: def.origen as never,
        subtotal: total.toFixed(2),
        total: total.toFixed(2),
        asesor: cliente.asesor,
        validoHasta: vence,
        createdAt: diasAtras(def.dias),
      })
      .returning();

    if (lineas.length > 0) {
      await db
        .insert(quoteItems)
        .values(lineas.map((l) => ({ ...l, quoteId: quote.id })));
    }
  }

  console.log("Pedidos…");
  const definicionesOrders = [
    { numero: "PED-1205", cliente: "Arq. Carolina Méndez", estado: "preparando", tipo: "retiro", branch: central, horas: 3, medio: "mercado_pago", pago: "pagado", skus: ["PLA-MEL-BLA-18", "PLA-MDF-003"] },
    { numero: "PED-1204", cliente: "Roberto Fernández", estado: "listo", tipo: "envio", branch: aserradero, horas: 5, medio: "cuenta_corriente", pago: "pendiente", direccion: "Av. Colón 3200, Mar del Plata", zona: "Mar del Plata — centro y macrocentro", envio: "18000", skus: ["TEC-TIR-PIN-2436", "TEC-MAC-PIN-3406"] },
    { numero: "PED-1203", cliente: "Martín Pérez", estado: "en-camino", tipo: "envio", branch: central, horas: 8, medio: "transferencia", pago: "pagado", direccion: "Güemes 1800, Mar del Plata", zona: "Mar del Plata — resto de la ciudad", envio: "26000", skus: ["MOL-ZOC-070", "MOL-COR-045"] },
    { numero: "PED-1202", cliente: "Ana Torres", estado: "entregado", tipo: "retiro", branch: aserradero, horas: 26, medio: "efectivo", pago: "pagado", skus: ["PIS-DEC-NOG-08"] },
    { numero: "PED-1201", cliente: "Laura Gómez", estado: "entregado", tipo: "envio", branch: central, horas: 30, medio: "efectivo", pago: "pagado", direccion: "Independencia 2450, Mar del Plata", zona: "Mar del Plata — centro y macrocentro", envio: "18000", skus: ["CSE-YES-RH-125", "CSE-LAN-050"] },
    { numero: "PED-1200", cliente: "Jorge Ruiz", estado: "pendiente", tipo: "retiro", branch: central, horas: 1, medio: "mercado_pago", pago: "pendiente", skus: ["FER-LAC-POL-1"] },
  ] as const;

  for (const def of definicionesOrders) {
    const cliente = porNombre(def.cliente);
    const lineas = def.skus
      .map((sku, i) => {
        const v = buscar(sku);
        if (!v) return null;
        const cantidad = [6, 15, 3, 20][i % 4];
        const precio = Number(v.precio ?? 0);
        return {
          variantId: v.id,
          descripcion: `${v.producto} — ${v.label}`,
          unidad: v.unidad,
          cantidad: String(cantidad),
          precioUnitario: precio.toFixed(2),
          subtotal: (precio * cantidad).toFixed(2),
          orden: i,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);

    const subtotal = lineas.reduce((s, l) => s + Number(l.subtotal), 0);
    const envio = Number("envio" in def ? def.envio : 0);
    const creado = new Date();
    creado.setHours(creado.getHours() - def.horas);

    const [order] = await db
      .insert(orders)
      .values({
        numero: def.numero,
        customerId: cliente.id,
        contactoNombre: cliente.nombre,
        contactoEmail: cliente.email,
        contactoTelefono: cliente.telefono,
        branchId: def.branch.id,
        estado: def.estado as never,
        origen: "mostrador",
        tipoEntrega: def.tipo as never,
        direccionEntrega: "direccion" in def ? def.direccion : null,
        zonaEnvio: "zona" in def ? def.zona : null,
        costoEnvio: envio.toFixed(2),
        subtotal: subtotal.toFixed(2),
        total: (subtotal + envio).toFixed(2),
        medioPago: def.medio as never,
        estadoPago: def.pago as never,
        createdAt: creado,
      })
      .returning();

    if (lineas.length > 0) {
      await db
        .insert(orderItems)
        .values(lineas.map((l) => ({ ...l, orderId: order.id })));
    }

    await db.insert(orderStatusHistory).values({
      orderId: order.id,
      estado: def.estado as never,
      nota: "Carga inicial",
      createdAt: creado,
    });
  }

  // Pedidos de meses anteriores, para que el gráfico del resumen muestre una
  // serie y no una sola barra. Son montos verosímiles, no calcados de nada.
  console.log("Historial de ventas…");
  const historico: { branchId: string; total: number; mesesAtras: number }[] = [];

  const perfilPorMes = [
    { central: [1850000, 2100000, 1600000], aserradero: [980000, 1150000] },
    { central: [2300000, 1900000], aserradero: [1250000, 890000, 1050000] },
    { central: [1700000, 2450000, 1300000], aserradero: [1400000] },
    { central: [2800000, 2050000], aserradero: [1600000, 1180000] },
    { central: [2200000, 1750000, 2600000], aserradero: [1320000, 1490000] },
  ];

  perfilPorMes.forEach((perfil, i) => {
    const mesesAtras = i + 1;
    for (const total of perfil.central)
      historico.push({ branchId: central.id, total, mesesAtras });
    for (const total of perfil.aserradero)
      historico.push({ branchId: aserradero.id, total, mesesAtras });
  });

  let secuencia = 1100;
  for (const registro of historico) {
    const fecha = new Date();
    fecha.setMonth(fecha.getMonth() - registro.mesesAtras);
    fecha.setDate(5 + (secuencia % 20));

    await db.insert(orders).values({
      numero: `PED-${secuencia++}`,
      customerId: clientesCreados[secuencia % clientesCreados.length].id,
      contactoNombre:
        clientesCreados[secuencia % clientesCreados.length].nombre,
      branchId: registro.branchId,
      estado: "entregado",
      origen: "mostrador",
      tipoEntrega: "retiro",
      subtotal: registro.total.toFixed(2),
      total: registro.total.toFixed(2),
      medioPago: "efectivo",
      estadoPago: "pagado",
      createdAt: fecha,
      updatedAt: fecha,
    });
  }

  console.log("Cortes…");
  const definicionesCortes = [
    { numero: "CRT-458", cliente: "Arq. Carolina Méndez", sku: "PLA-MEL-BLA-18", placas: 4, estado: "en-cola", urgente: 1, branch: central, notas: "Obra en curso, retiran el jueves", piezas: [[600, 400, 4], [1200, 350, 2], [800, 600, 6]] },
    { numero: "CRT-457", cliente: "Martín Pérez", sku: "PLA-MDF-018", placas: 2, estado: "en-proceso", urgente: 0, branch: central, notas: null, piezas: [[900, 450, 8], [400, 400, 4]] },
    { numero: "CRT-456", cliente: "Ana Torres", sku: "PLA-MEL-BLA-15", placas: 3, estado: "terminado", urgente: 0, branch: central, notas: "Avisar cuando esté", piezas: [[1800, 600, 3], [600, 300, 10]] },
    { numero: "CRT-455", cliente: "Laura Gómez", sku: "PLA-FEN-018", placas: 6, estado: "retirado", urgente: 0, branch: aserradero, notas: null, piezas: [[2440, 600, 6]] },
    { numero: "CRT-454", cliente: "Roberto Fernández", sku: "PLA-FEN-015", placas: 5, estado: "en-cola", urgente: 0, branch: aserradero, notas: "Encofrado, medidas exactas", piezas: [[1220, 500, 10], [800, 500, 5]] },
  ] as const;

  for (const def of definicionesCortes) {
    const cliente = porNombre(def.cliente);
    const v = buscar(def.sku);

    const [corte] = await db
      .insert(cuttingOrders)
      .values({
        numero: def.numero,
        customerId: cliente.id,
        contactoNombre: cliente.nombre,
        branchId: def.branch.id,
        variantId: v?.id,
        materialDescripcion: v ? `${v.producto} — ${v.label}` : def.sku,
        placas: def.placas,
        estado: def.estado as never,
        urgente: def.urgente,
        notas: def.notas,
      })
      .returning();

    await db.insert(cuttingItems).values(
      def.piezas.map(([largo, ancho, cantidad], i) => ({
        cuttingOrderId: corte.id,
        largoMm: largo,
        anchoMm: ancho,
        cantidad,
        respetaVeta: i === 0 ? 1 : 0,
        orden: i,
      })),
    );
  }

  console.log(
    `\nListo: ${clientesCreados.length} clientes, ${definicionesQuotes.length} presupuestos, ${definicionesOrders.length} pedidos del mes + ${historico.length} históricos, ${definicionesCortes.length} cortes, ${ZONAS.length} zonas de envío.`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
