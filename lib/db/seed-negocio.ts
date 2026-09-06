/**
 * Los datos reales del negocio, tal como los dio el cliente en el brief.
 *
 * Hasta ahora la plataforma corría con datos de desarrollo inventados —el
 * README lo dice— y con supuestos heredados del prototipo: teléfonos que no
 * eran de ninguna de las dos sucursales, un WhatsApp sin el 9, y ninguna de
 * las reglas comerciales que el negocio aplica todos los días.
 *
 * **Por qué un script y no cargarlo desde el panel.** Todo esto tiene su
 * pantalla y se puede editar a mano, pero cargarlo a mano una vez no se puede
 * repetir ni revisar: no queda registro de qué se cargó, y rehacer la base
 * —una vista previa, un ambiente nuevo, una restauración— obligaría a
 * retipearlo. Acá está escrito, versionado y se vuelve a correr sin miedo.
 *
 * Es idempotente: actualiza lo que ya existe en vez de duplicarlo. Se puede
 * correr encima de una base con datos.
 *
 * Uso: npm run db:seed-negocio
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import * as schema from "./schema";

const {
  branches,
  categories,
  testimonials,
  configuracionFiscal,
  cuttingRates,
  paymentDiscounts,
  priceLists,
  puntosVenta,
  shippingZones,
  siteSettings,
} = schema;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema, casing: "snake_case" });

/* -------------------------------------------------------------------------- */
/* Los datos del brief                                                         */
/* -------------------------------------------------------------------------- */

const EMISOR = {
  razonSocial: "Maderera Juan B. Justo S.R.L.",
  nombreFantasia: "Maderera Juan B. Justo",
  cuit: "30589445259",
  condicionIva: "responsable_inscripto" as const,
  domicilio: "Av. Juan B. Justo 4153",
  localidad: "Mar del Plata",
  /*
   * Convenio multilateral y percepción de Ingresos Brutos: los dos salen del
   * brief. La alícuota queda en cero a propósito —el brief no la dice— y
   * `percibeIibb` en falso hasta que el contador la confirme: percibir de más
   * es plata que después hay que devolverle a cada cliente.
   */
  regimenIibb: "convenio_multilateral" as const,
  percibeIibb: false,
};

/*
 * Las sucursales ya no se cargan acá.
 *
 * Su ficha publicada —dirección, teléfono, horario, servicios— vive en
 * `lib/sucursales.ts`, que es código y no datos: son dos locales de siempre.
 * Las filas de `branches` las crea `db:seed`, y de su id cuelgan el stock, los
 * pedidos y los puntos de venta.
 */

/**
 * Las ocho categorías, en el orden en que el cliente las va a cargar.
 *
 * Las cinco primeras son las que el brief marca como "arrancan con contenido
 * cargado el primer día". El orden importa: es el que ve alguien que entra al
 * catálogo sin saber qué busca, y una categoría vacía arriba de todo es la
 * peor primera impresión posible.
 */
const CATEGORIAS = [
  { slug: "placas", orden: 0 },
  { slug: "construccion-en-seco", orden: 1 },
  { slug: "molduras", orden: 2 },
  { slug: "decks-y-escaleras", orden: 3 },
  { slug: "techos", orden: 4 },
  { slug: "pisos", orden: 5 },
  { slug: "ferreteria", orden: 6 },
  { slug: "cubiertas", orden: 7 },
];

/**
 * Las tres zonas del brief, las tres a cotizar.
 *
 * El cliente contestó "depende" al costo y al plazo de las tres: según el
 * volumen sale en camión propio o por comisionista. Publicar una tarifa
 * inventada sería peor que no publicar ninguna — quien compra la toma por
 * cierta y después hay que explicarle por qué no.
 */
const ZONAS = [
  { nombre: "Mar del Plata", cobertura: "7600, 7601", demoraEstimada: "Coordinamos al confirmar", orden: 0 },
  { nombre: "Tandil", cobertura: "7000", demoraEstimada: "Según volumen y transporte", orden: 1 },
  { nombre: "Necochea", cobertura: "7630", demoraEstimada: "Según volumen y transporte", orden: 2 },
];

/**
 * Los tres puntos de venta habilitados.
 *
 * `numeroInicial` queda en cero porque el brief dejó en blanco el último
 * número de cada uno. **Hay que completarlo antes de emitir el primer
 * comprobante**: si se emite con cero, la plataforma numera desde 1 y pisa una
 * serie que ARCA viene contando hace años. Se carga desde /admin/arca.
 */
const PUNTOS_VENTA = [
  { numero: 15, nombre: "Punto de venta 15", sucursal: "casa-central" },
  { numero: 17, nombre: "Punto de venta 17", sucursal: "aserradero" },
  { numero: 20, nombre: "Punto de venta 20", sucursal: null },
];

/**
 * Descuento por pagar de contado.
 *
 * El brief: "-10% de contado/transferencia, -15% en compras de mayor volumen".
 * **El 15 % no se carga acá porque el brief no dice desde qué monto**, y un
 * umbral inventado regala plata o no la regala nunca. La escala está lista:
 * cuando lo definan es una fila más desde el panel.
 */
const DESCUENTOS_DE_PAGO = [
  { medio: "transferencia" as const, desdeMonto: "0", porcentaje: "10", etiqueta: "10% por transferencia" },
  { medio: "efectivo" as const, desdeMonto: "0", porcentaje: "10", etiqueta: "10% en efectivo" },
];

/**
 * Lo que sale cada pasada de sierra, del brief.
 *
 * Precios finales con IVA, como todo el catálogo. La familia de material —y no
 * la placa concreta— es lo que define la tarifa: contra qué corta la sierra.
 */
const TARIFAS_DE_CORTE = [
  { material: "Placas", lista: null, precio: "1200" },
  { material: "Tableros de madera", lista: null, precio: "1400" },
  { material: "Placas", lista: "profesional", precio: "996" },
  { material: "Tableros de madera", lista: "profesional", precio: "1162" },
];

/* -------------------------------------------------------------------------- */

async function main() {
  console.log("Datos del emisor…");
  const [yaHay] = await db.select({ id: configuracionFiscal.id }).from(configuracionFiscal).limit(1);
  if (yaHay) {
    await db.update(configuracionFiscal).set(EMISOR).where(eq(configuracionFiscal.id, yaHay.id));
  } else {
    await db.insert(configuracionFiscal).values(EMISOR);
  }

  console.log("WhatsApp del sitio…");
  await db
    .insert(siteSettings)
    .values({
      clave: "whatsapp_principal",
      // Con el 9. Un celular argentino sin el 9 después del 54 no recibe los
      // mensajes, y el valor que estaba sembrado no lo tenía.
      valor: "5492235903118",
      descripcion: "Número al que van los botones de WhatsApp del sitio.",
    })
    .onConflictDoUpdate({
      target: siteSettings.clave,
      set: { valor: "5492235903118" },
    });

  console.log("Orden de las categorías…");
  for (const categoria of CATEGORIAS) {
    await db
      .update(categories)
      .set({ sortOrder: categoria.orden })
      .where(eq(categories.slug, categoria.slug));
  }

  console.log("Zonas de envío…");
  for (const zona of ZONAS) {
    const [existe] = await db
      .select({ id: shippingZones.id })
      .from(shippingZones)
      .where(eq(shippingZones.nombre, zona.nombre))
      .limit(1);

    const valores = {
      nombre: zona.nombre,
      cobertura: zona.cobertura,
      demoraEstimada: zona.demoraEstimada,
      orden: String(zona.orden),
      aCotizar: true,
      costo: "0",
      envioGratisDesde: "0",
      activa: true,
    };

    if (existe) {
      await db.update(shippingZones).set(valores).where(eq(shippingZones.id, existe.id));
    } else {
      await db.insert(shippingZones).values(valores);
    }
  }

  /*
   * No se dan de baja las zonas que no están en el brief.
   *
   * Podrían ser de la siembra de demostración —que hay que sacar— o una zona
   * que el cliente agregó desde el panel después, y este script no tiene forma
   * de distinguirlas. Dar de baja a ciegas le borraría el trabajo la próxima
   * vez que alguien corra el seed. Se avisa y decide una persona.
   */
  const sobrantes = await db
    .select({ nombre: shippingZones.nombre })
    .from(shippingZones)
    .where(eq(shippingZones.activa, true));

  const delBrief = new Set(ZONAS.map((z) => z.nombre));
  const ajenas = sobrantes.filter((z) => !delBrief.has(z.nombre));
  if (ajenas.length > 0) {
    console.warn(
      `  · Hay ${ajenas.length} zona(s) activa(s) que no están en el brief: ` +
        `${ajenas.map((z) => z.nombre).join(", ")}. Revisalas en /admin/envios.`,
    );
  }

  console.log("Puntos de venta…");
  const sucursalesEnBase = await db
    .select({ id: branches.id, slug: branches.slug })
    .from(branches);

  for (const punto of PUNTOS_VENTA) {
    const branchId =
      sucursalesEnBase.find((s) => s.slug === punto.sucursal)?.id ?? null;

    await db
      .insert(puntosVenta)
      .values({ numero: punto.numero, nombre: punto.nombre, branchId })
      .onConflictDoUpdate({
        target: puntosVenta.numero,
        // El número inicial no se pisa: si alguien ya lo cargó desde el panel,
        // volver a correr el seed no puede devolverlo a cero.
        set: { nombre: punto.nombre, branchId },
      });
  }

  console.log("Descuentos por forma de pago…");
  for (const descuento of DESCUENTOS_DE_PAGO) {
    await db
      .insert(paymentDiscounts)
      .values(descuento)
      .onConflictDoUpdate({
        target: [paymentDiscounts.medio, paymentDiscounts.desdeMonto],
        set: { porcentaje: descuento.porcentaje, etiqueta: descuento.etiqueta, activo: true },
      });
  }

  console.log("Tarifas de corte…");
  const listas = await db
    .select({ id: priceLists.id, slug: priceLists.slug })
    .from(priceLists);

  for (const tarifa of TARIFAS_DE_CORTE) {
    const priceListId = tarifa.lista
      ? (listas.find((l) => l.slug === tarifa.lista)?.id ?? null)
      : null;

    if (tarifa.lista && !priceListId) {
      console.warn(`  · sin lista "${tarifa.lista}": se omite la tarifa de ${tarifa.material}`);
      continue;
    }

    const [existe] = await db
      .select({ id: cuttingRates.id })
      .from(cuttingRates)
      .where(
        priceListId
          ? sql`${cuttingRates.material} = ${tarifa.material} and ${cuttingRates.priceListId} = ${priceListId}`
          : sql`${cuttingRates.material} = ${tarifa.material} and ${cuttingRates.priceListId} is null`,
      )
      .limit(1);

    if (existe) {
      await db
        .update(cuttingRates)
        .set({ precioPorPasada: tarifa.precio, activo: true })
        .where(eq(cuttingRates.id, existe.id));
    } else {
      await db.insert(cuttingRates).values({
        material: tarifa.material,
        priceListId,
        precioPorPasada: tarifa.precio,
      });
    }
  }

  /*
   * Los testimonios sembrados son de personas inventadas.
   *
   * "Arq. Carolina Méndez", "Roberto Fernández", "Martín Pérez" e "Ing. Laura
   * Gómez" vienen del prototipo, con nombre, cargo y una frase entre comillas.
   * Publicar una recomendación firmada por alguien que no existe es distinto
   * de tener un catálogo con precios de prueba: no es un dato provisorio, es
   * una afirmación falsa sobre una persona.
   *
   * Se **ocultan**, no se borran: si alguno resulta ser real se vuelve a
   * activar desde Contenido. El único testimonio ofrecido en el brief es el de
   * Ezequiel (Wood Framer), y llegó sin el texto: está anotado como pendiente
   * en `docs/CAMBIOS.md`.
   */
  console.log("Testimonios del prototipo…");
  const inventados = [
    "Arq. Carolina Méndez",
    "Roberto Fernández",
    "Martín Pérez",
    "Ing. Laura Gómez",
  ];

  let ocultados = 0;
  for (const nombre of inventados) {
    const resultado = await db
      .update(testimonials)
      .set({ activo: false })
      .where(eq(testimonials.nombre, nombre))
      .returning({ id: testimonials.id });
    ocultados += resultado.length;
  }
  if (ocultados > 0) {
    console.warn(
      `  · ${ocultados} testimonio(s) de personas inventadas, ocultos. ` +
        "El sitio no muestra ninguno hasta que haya uno real.",
    );
  }

  console.log("\nListo.");
  console.log(
    "\nFalta que el cliente confirme, y hasta entonces no se puede facturar:\n" +
      "  · El último número emitido en los puntos de venta 15, 17 y 20.\n" +
      "  · Desde qué monto aplica el 15 % por volumen.\n" +
      "  · La alícuota de percepción de Ingresos Brutos.\n" +
      "  · El texto del testimonio de Ezequiel (Wood Framer, 223 528-7248):\n" +
      "    los cuatro que había eran de personas inventadas y quedaron ocultos.",
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
