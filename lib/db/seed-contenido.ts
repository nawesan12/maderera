/**
 * Los textos editables del sitio.
 *
 * Este script sembraba además los seis artículos del blog y los cuatro
 * testimonios que venían del prototipo. **Los dos salieron el 7/9/2026**, por
 * pedido de la clienta: las notas las había escrito el prototipo y los
 * testimonios eran personas inventadas. El contenido del blog quedó
 * respaldado fuera del repo antes de borrarlo.
 *
 * Lo que queda son los tres ajustes, y quedan porque los lee todo el sitio: el
 * número de WhatsApp de los botones, la franja de arriba de todo y la leyenda
 * del envío. Sin fila cargada, el sitio cae a valores por defecto y esos
 * textos dejan de poder cambiarse desde el panel.
 *
 * Es idempotente: se puede correr de nuevo sin pisar lo que alguien haya
 * editado a mano.
 *
 * Uso: npm run db:seed-contenido
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const { siteSettings, bankPromotions, banners } = schema;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema, casing: "snake_case" });

async function main() {
  console.log("Ajustes del sitio…");

  const { rowCount } = await db
    .insert(siteSettings)
    .values([
      {
        clave: "whatsapp_principal",
        valor: "542235903118",
        descripcion: "Número al que van los botones de WhatsApp del sitio.",
      },
      {
        clave: "aviso_barra_superior",
        valor: "",
        descripcion: "Texto de la franja de arriba de todo. Vacío la oculta.",
      },
      {
        clave: "envio_gratis_leyenda",
        valor: "Envío sin cargo en Mar del Plata a partir de $200.000",
        descripcion: "Leyenda de la franja de confianza del catálogo.",
      },
    ])
    // `DoNothing` y no `DoUpdate`: el valor de estas tres claves se edita desde
    // el panel, y volver a correr el sembrado no puede pisar lo que la clienta
    // cargó.
    .onConflictDoNothing({ target: siteSettings.clave });

  console.log("Promociones bancarias…");

  // Solo si no hay ninguna: estas filas se editan desde el panel y vencen; un
  // sembrado que las reinserte resucitaría promos que la clienta ya borró.
  const yaHay = await db
    .select({ id: bankPromotions.id })
    .from(bankPromotions)
    .limit(1);

  let promosNuevas = 0;
  if (yaHay.length === 0) {
    // La lista que trajo la clienta el 9/9/2026 ("PROMOCIONES POR FORMA DE
    // PAGO", última actualización 03/09/2026). Las vigencias son las de ahí.
    const filas = await db.insert(bankPromotions).values([
      {
        medio: "Banco Nación",
        titulo: "12 cuotas sin interés",
        detalle: "Sólo pagando con MODO BNA.",
        dias: "Todos los días",
        vigenciaHasta: new Date("2027-01-31T23:59:59-03:00"),
        orden: 1,
      },
      {
        medio: "Mercado Pago",
        titulo: "Hasta 6 cuotas sin interés",
        detalle:
          "Con Point: 2 y 3 cuotas sin interés con Mastercard de Mercado Pago, pagando con QR desde $150.000. Con link de pago: 3 y 6 cuotas sin interés con todas las tarjetas de crédito, excepto Favacard, Clipper y Amex.",
        dias: "Todos los días",
        orden: 2,
      },
      {
        medio: "MODO",
        titulo: "15 % de reintegro con QR",
        detalle:
          "A través de Point de Mercado Pago. Sin tope con débito o crédito en un pago: Visa, Master, Amex, Cabal, Diners y Maestro de Galicia, Nación, Francés, Santander, Macro, ICBC, Credicoop, Supervielle, Ciudad, Bancor y Santa Fe.",
        dias: "Todos los días",
        vigenciaHasta: new Date("2026-10-22T23:59:59-03:00"),
        orden: 3,
      },
      {
        medio: "Banco Hipotecario",
        titulo: "10 % de reintegro con débito",
        detalle:
          "A través de Clover. Débito: 10 % de reintegro en caja de ahorro todos los días. Crédito: hasta 6 cuotas sin interés, sólo los jueves.",
        dias: "Todos los días",
        orden: 4,
      },
      {
        medio: "Tarjeta Fava",
        titulo: "Hasta 20 % de descuento",
        detalle:
          "Viernes y sábados: 1 y 3 cuotas sin interés más 15 % de descuento cartera general (tope $15.000) o 20 % clientes trayectoria (tope $20.000). Todos los días: 3 y 6 cuotas sin interés.",
        dias: "Viernes y sábados",
        vigenciaHasta: new Date("2026-10-31T23:59:59-03:00"),
        orden: 5,
      },
      {
        medio: "Tarjeta Naranja",
        titulo: "Hasta 6 cuotas sin interés",
        detalle: "Plan Z: 3 cuotas sin interés. También 6 cuotas sin interés.",
        dias: "Todos los días",
        orden: 6,
      },
      {
        medio: "Clipper",
        titulo: "3 y 6 cuotas sin interés",
        detalle:
          "También 12 cuotas con tasa preferencial del 18 % (en Clover, elegir plan J).",
        dias: "Todos los días",
        orden: 7,
      },
      {
        medio: "Sport Club",
        titulo: "15 % de bonificación",
        detalle:
          "Para quienes tengan la app del club. Se acredita como puntos en la app y se descuenta de la cuota de socio.",
        dias: "Todos los días",
        orden: 8,
      },
    ]);
    promosNuevas = filas.rowCount ?? 0;
  }

  console.log("Slide de la cuenta profesional…");

  // La clienta pidió más presencia para el portal de profesionales. Un slide
  // del carrusel de portada es el lugar que ya existe para eso. Solo si no hay
  // ningún banner: los banners se administran desde el panel.
  const yaHayBanners = await db
    .select({ id: banners.id })
    .from(banners)
    .limit(1);

  let slidesNuevos = 0;
  if (yaHayBanners.length === 0) {
    const filas = await db.insert(banners).values({
      ubicacion: "portada" as const,
      etiqueta: "Portal profesionales",
      titulo: "Precios de gremio y cuenta corriente",
      bajada:
        "Carpinteros, arquitectos y constructoras compran con su propia lista y escalas por cantidad. Se solicita una vez y queda habilitada.",
      enlace: "/profesionales",
      textoEnlace: "Solicitar cuenta profesional",
      orden: 1,
    });
    slidesNuevos = filas.rowCount ?? 0;
  }

  console.log(
    `\nListo. ${rowCount ?? 0} ajuste(s) nuevo(s), ${promosNuevas} promo(s) bancaria(s), ${slidesNuevos} slide(s).`,
  );
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
