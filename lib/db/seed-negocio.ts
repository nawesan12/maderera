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
import { and, eq, isNull, sql } from "drizzle-orm";
import * as schema from "./schema";
import { generarSlug } from "@/lib/validation/product";

const {
  branches,
  categories,
  configuracionFiscal,
  cuttingRates,
  paymentDiscounts,
  priceLists,
  products,
  puntosVenta,
  shippingZones,
  siteSettings,
  subcategories,
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
 * Los rubros de adentro de cada categoría.
 *
 * Los 43 de ferretería los trajo la clienta: son con los que la ferretería ya
 * trabajaba en el sitio anterior. El brief da ~1000 SKUs para esa categoría
 * sola, así que sin este nivel de navegación Ferretería es una grilla de mil
 * productos donde no se encuentra un tarugo.
 *
 * Los de placas salen del pedido de "linkear las placas / melaminas /
 * enchapados / tableros / fenólicos / chapadur / terciados / mdf / ranurados":
 * eran nombres sueltos escritos en `products.subcategory` y ahora son filtros
 * navegables.
 *
 * Se siembran aunque todavía no tengan productos. No aparecen en el panel del
 * catálogo hasta que alguno los use —`rubrosDeCategoria` solo devuelve los que
 * tienen algo cargado—, así que la lista completa espera sin ensuciar nada.
 */
const RUBROS: Record<string, string[]> = {
  ferreteria: [
    "Accesorios para cortinería",
    "Adhesivos",
    "Aceites",
    "Aguarrás",
    "Barnices",
    "Bisagras",
    "Bulonería",
    "Cerraduras",
    "Cintas",
    "Clavos",
    "Colas vinílicas",
    "Correderas",
    "Diluyentes",
    "Discos para sierra",
    "Escuadras",
    "Fijación para tirantería",
    "Insecticidas",
    "Ganchos",
    "Herramientas varias",
    "Hojas para sierra",
    "Lacas poliuretánicas",
    "Lijas",
    "Manijas",
    "Masillas",
    "Mechas",
    "Membranas",
    "Ménsulas",
    "Niveles",
    "Pasadores",
    "Perfiles y complementos",
    "Pinceles",
    "Pistones",
    "Prensas y precintos",
    "Rieles",
    "Removedores",
    "Rodillos",
    "Selladores",
    "Sierras",
    "Soportes",
    "Tapacantos",
    "Tarugos",
    "Topes",
    "Tornillos",
    // Los dos que ya venían cargados como texto en los productos sembrados.
    "Herrajes",
    "Pinturas y lacas",
  ],
  placas: [
    "Melaminas",
    "MDF",
    "Fenólicos",
    "Terciados",
    "Enchapados",
    "Chapadur",
    "Ranurados",
    "Tableros",
    "Placas",
  ],
  molduras: ["Cornisas", "Marcos", "Zócalos", "Terminaciones"],
  pisos: ["Pisos flotantes", "Machimbres", "Terminaciones", "Zócalos"],
  techos: ["Chapas", "Tejados metálicos", "Aislaciones", "Machimbres", "Tirantería"],
  cubiertas: ["Chapas", "Aislantes", "Accesorios", "Tejados metálicos"],
  "decks-y-escaleras": ["Decks", "Escaleras", "Accesorios"],
  "construccion-en-seco": ["Placas", "Perfilería", "Aislantes", "Accesorios"],
};

/**
 * Siembra los rubros y engancha los productos que ya los nombraban.
 *
 * El enganche va por el texto que ya tenía cada producto en
 * `products.subcategory`, comparado sin distinguir mayúsculas ni tildes: es de
 * donde salieron los nombres, y hacerlo a mano para doscientos productos es
 * pedir que quede a medias.
 */
async function sembrarRubros() {
  let creados = 0;
  let enganchados = 0;

  for (const [slugCategoria, nombres] of Object.entries(RUBROS)) {
    const [categoria] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, slugCategoria))
      .limit(1);

    if (!categoria) {
      console.log(`  · Falta la categoría ${slugCategoria}, se saltea.`);
      continue;
    }

    for (const [orden, nombre] of nombres.entries()) {
      const slug = generarSlug(nombre);

      const [fila] = await db
        .insert(subcategories)
        .values({ categoryId: categoria.id, slug, name: nombre, sortOrder: orden })
        .onConflictDoUpdate({
          target: [subcategories.categoryId, subcategories.slug],
          set: { name: nombre, sortOrder: orden, updatedAt: new Date() },
        })
        .returning({ id: subcategories.id });

      creados += 1;

      // Los productos de esa categoría que ya nombraban el rubro como texto.
      const { rowCount } = await db
        .update(products)
        .set({ subcategoryId: fila.id })
        .where(
          and(
            eq(products.categoryId, categoria.id),
            isNull(products.subcategoryId),
            sql`lower(unaccent(${products.subcategory})) = lower(unaccent(${nombre}))`,
          ),
        );

      enganchados += rowCount ?? 0;
    }
  }

  console.log(
    `· Rubros: ${creados} cargados, ${enganchados} productos enganchados.`,
  );
}

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

  console.log("Rubros de cada categoría…");
  await sembrarRubros();

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

  console.log("Lista constructora…");
  /*
   * La tercera lista que pidió la clienta ("agregar precio constructora").
   * Nace **derivada de la general**: sin porcentaje cargado se comporta igual
   * que la general, y el número lo pone la clienta desde Precios. Los ítems
   * propios que se carguen a mano la pisan, como en cualquier lista.
   */
  await db
    .insert(priceLists)
    .values({ slug: "constructora", name: "Lista constructora" })
    // El porcentaje no se pisa: lo ajusta la clienta desde el panel.
    .onConflictDoNothing({ target: priceLists.slug });

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

  console.log("\nListo.");
  console.log(
    "\nFalta que el cliente confirme, y hasta entonces no se puede facturar:\n" +
      "  · El último número emitido en los puntos de venta 15, 17 y 20.\n" +
      "  · Desde qué monto aplica el 15 % por volumen.\n" +
      "  · La alícuota de percepción de Ingresos Brutos.\n" +
      "  · Nada del contenido: los testimonios salieron del sitio junto con el\n" +
      "    blog, y lo que opinan los clientes ahora sale de las reseñas de\n" +
      "    compra verificada.",
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
