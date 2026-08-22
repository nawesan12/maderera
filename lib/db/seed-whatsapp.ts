/**
 * Conversaciones de ejemplo para la bandeja de WhatsApp.
 *
 * Sin WABA dado de alta no entra ningún mensaje real, y una bandeja vacía no
 * deja ver ni probar nada. Esto siembra charlas como las que efectivamente
 * llegan a una maderera —consultas de medidas, "¿ya está listo?", el fletero
 * que no encuentra la obra— usando los clientes y pedidos que ya están en la
 * base, así el panel del costado muestra datos de verdad.
 *
 * Uso:
 *   npm run db:seed-whatsapp
 *
 * Se puede correr las veces que haga falta: borra lo sembrado antes y lo
 * vuelve a crear.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema, casing: "snake_case" });

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** Guiones de conversación, con los minutos de separación entre mensajes. */
interface Guion {
  /** Cliente al que corresponde, por su correo. Null = número desconocido. */
  email: string | null;
  telefono: string;
  nombreVisible: string;
  /** Hace cuánto arrancó la charla. */
  desdeMs: number;
  mensajes: {
    de: "cliente" | "nosotros";
    texto: string;
    /** Minutos después del mensaje anterior. */
    despues: number;
  }[];
}

const GUIONES: Guion[] = [
  {
    email: "roberto@rfconstrucciones.com.ar",
    telefono: "2235550111",
    nombreVisible: "Roberto Fernández",
    desdeMs: 3 * HORA,
    mensajes: [
      {
        de: "cliente",
        texto: "Buen día! Consulta por el pedido PED-1204, ¿ya está para retirar?",
        despues: 0,
      },
      {
        de: "nosotros",
        texto:
          "Hola Roberto! Está listo desde ayer a la tarde. Lo tenés en Casa Central, Av. Juan B. Justo 4153.",
        despues: 14,
      },
      {
        de: "cliente",
        texto: "Bárbaro. Mando al chofer mañana a la mañana entonces",
        despues: 6,
      },
      {
        de: "cliente",
        texto: "Una más: ¿les queda machimbre de 1/2 x 4 pulgadas?",
        despues: 3,
      },
    ],
  },
  {
    email: "carolina@estudiocm.com.ar",
    telefono: "2235550122",
    nombreVisible: "Caro Méndez",
    desdeMs: 26 * HORA,
    mensajes: [
      {
        de: "cliente",
        texto:
          "Hola! Necesito cotizar 40 m2 de deck de lapacho para una obra en Constitución. ¿Me pasan precio?",
        despues: 0,
      },
      {
        de: "nosotros",
        texto:
          "Hola Carolina! Te armamos el presupuesto y te lo mando por acá. ¿Va con estructura o solo la tabla?",
        despues: 22,
      },
      {
        de: "cliente",
        texto: "Con estructura, tirantería de 2x3 tratada",
        despues: 35,
      },
    ],
  },
  {
    email: "carpinteriaperez@gmail.com",
    telefono: "2235550133",
    nombreVisible: "Martín - Carpintería",
    desdeMs: 40 * MINUTO,
    mensajes: [
      {
        de: "cliente",
        texto:
          "Buenas! Necesito cortar 2 placas de melamina blanca 18mm. Te paso el despiece:",
        despues: 0,
      },
      {
        de: "cliente",
        texto:
          "4 piezas de 1800 x 400\n6 piezas de 700 x 400\n2 piezas de 1800 x 580\nTodo canteado en el largo",
        despues: 2,
      },
      {
        de: "nosotros",
        texto:
          "Perfecto Martín, lo cargo al corte. ¿Lo necesitás para esta semana?",
        despues: 9,
      },
    ],
  },
  {
    email: "compras@constructoradelsur.com.ar",
    telefono: "2235550144",
    nombreVisible: "Laura - Constructora del Sur",
    desdeMs: 2 * DIA,
    mensajes: [
      {
        de: "cliente",
        texto: "Buenas tardes, ¿cómo va el saldo de nuestra cuenta?",
        despues: 0,
      },
      {
        de: "nosotros",
        texto:
          "Hola Laura! Te paso el detalle por mail así lo tenés desglosado por comprobante.",
        despues: 18,
      },
      { de: "cliente", texto: "Gracias!", despues: 5 },
    ],
  },
  {
    email: null,
    telefono: "2236660199",
    nombreVisible: "Sergio",
    desdeMs: 5 * HORA,
    mensajes: [
      {
        de: "cliente",
        texto:
          "Hola, ¿venden chapa sinusoidal galvanizada? Necesito 8 de 3 metros",
        despues: 0,
      },
      {
        de: "cliente",
        texto: "Y si hacen entrega en Chapadmalal",
        despues: 4,
      },
    ],
  },
  {
    email: "ana@atdiseno.com.ar",
    telefono: "2235550155",
    nombreVisible: "Ana Torres",
    desdeMs: 6 * DIA,
    mensajes: [
      {
        de: "cliente",
        texto: "Hola! ¿Trabajan con placas de fenólico de 15mm?",
        despues: 0,
      },
      {
        de: "nosotros",
        texto: "Hola Ana! Sí, tenemos de 15 y de 18. ¿Cuántas necesitás?",
        despues: 11,
      },
      { de: "cliente", texto: "Después te confirmo, gracias!", despues: 40 },
    ],
  },
];

async function main() {
  console.log("Sembrando conversaciones de WhatsApp...\n");

  // Se borra lo anterior para poder correrlo las veces que haga falta.
  const jids = GUIONES.map((g) => `549${g.telefono}@s.whatsapp.net`);

  const previas = await db
    .select({ id: schema.conversaciones.id })
    .from(schema.conversaciones)
    .where(inArray(schema.conversaciones.waJid, jids));

  if (previas.length > 0) {
    await db.delete(schema.conversaciones).where(
      inArray(
        schema.conversaciones.id,
        previas.map((p) => p.id),
      ),
    );
    console.log(`Borré ${previas.length} conversaciones anteriores.`);
  }

  for (const guion of GUIONES) {
    const waJid = `549${guion.telefono}@s.whatsapp.net`;

    let customerId: string | null = null;
    let orderId: string | null = null;

    if (guion.email) {
      const [cliente] = await db
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(eq(schema.customers.email, guion.email))
        .limit(1);

      customerId = cliente?.id ?? null;

      if (customerId) {
        // El teléfono del guion se carga en la ficha: así la vinculación
        // automática por número queda demostrada de punta a punta.
        await db
          .update(schema.customers)
          .set({ telefono: guion.telefono, updatedAt: new Date() })
          .where(eq(schema.customers.id, customerId));

        const [pedido] = await db
          .select({ id: schema.orders.id })
          .from(schema.orders)
          .where(eq(schema.orders.customerId, customerId))
          .orderBy(desc(schema.orders.createdAt))
          .limit(1);

        orderId = pedido?.id ?? null;
      }
    }

    let momento = Date.now() - guion.desdeMs;
    let ultimoEntrante: Date | null = null;
    let ultimoTexto = "";
    let sinLeer = 0;

    const [conversacion] = await db
      .insert(schema.conversaciones)
      .values({
        waJid,
        displayName: guion.nombreVisible,
        customerId,
        orderId,
      })
      .returning();

    for (const mensaje of guion.mensajes) {
      momento += mensaje.despues * MINUTO;
      const fecha = new Date(momento);
      const entrante = mensaje.de === "cliente";

      await db.insert(schema.mensajes).values({
        conversacionId: conversacion.id,
        direccion: entrante ? "entrante" : "saliente",
        waMessageId: `demo-${conversacion.id.slice(0, 8)}-${momento}`,
        cuerpo: mensaje.texto,
        estado: entrante ? "entregado" : "leido",
        ocurridoAt: fecha,
      });

      ultimoTexto = mensaje.texto;

      if (entrante) {
        ultimoEntrante = fecha;
        sinLeer += 1;
      } else {
        // Contestar deja la conversación al día.
        sinLeer = 0;
      }
    }

    await db
      .update(schema.conversaciones)
      .set({
        ultimoMensajeAt: new Date(momento),
        ultimoMensajePreview: ultimoTexto.replace(/\n/g, " ").slice(0, 120),
        ultimoEntranteAt: ultimoEntrante,
        noLeidos: sinLeer,
      })
      .where(eq(schema.conversaciones.id, conversacion.id));

    const ventana = ultimoEntrante
      ? (Date.now() - ultimoEntrante.getTime()) / HORA < 24
      : false;

    console.log(
      `  ${guion.nombreVisible.padEnd(30)} ${guion.mensajes.length} mensajes` +
        `${sinLeer > 0 ? `, ${sinLeer} sin leer` : ""}` +
        `${ventana ? "" : "  (fuera de la ventana de 24 h)"}` +
        `${customerId ? "" : "  (sin ficha de cliente)"}`,
    );
  }

  // Deja los interruptores de avisos creados y apagados.
  const [hayAvisos] = await db
    .select({ id: schema.avisosWhatsapp.id })
    .from(schema.avisosWhatsapp)
    .limit(1);

  if (!hayAvisos) {
    await db.insert(schema.avisosWhatsapp).values([
      {
        evento: "preparando",
        plantilla: "pedido_preparando",
        textoLibre:
          "Hola {{1}}! Ya estamos preparando tu pedido {{2}}. Te avisamos apenas esté listo.",
        activo: false,
      },
      {
        evento: "listo",
        plantilla: "pedido_listo",
        textoLibre:
          "Hola {{1}}! Tu pedido {{2}} ya está listo para retirar en {{3}}.",
        activo: false,
      },
      {
        evento: "en-camino",
        plantilla: "pedido_en_camino",
        textoLibre:
          "Hola {{1}}! Tu pedido {{2}} salió para la dirección que nos diste.",
        activo: false,
      },
      {
        evento: "entregado",
        plantilla: "pedido_entregado",
        textoLibre:
          "Hola {{1}}! Entregamos tu pedido {{2}}. Gracias por elegirnos.",
        activo: false,
      },
    ]);
    console.log("\nAvisos automáticos creados (apagados).");
  }

  await db
    .insert(schema.sesionWhatsapp)
    .values({ proveedor: "demo", conectado: false, ultimaSenal: new Date() })
    .onConflictDoNothing();

  const [total] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.conversaciones)
    .where(isNotNull(schema.conversaciones.ultimoMensajeAt));

  console.log(`\nListo: ${Number(total?.n ?? 0)} conversaciones en la bandeja.`);
  console.log("Miralas en http://localhost:3000/admin/whatsapp\n");

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
