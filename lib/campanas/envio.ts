import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import type { SegmentoCampana } from "@/lib/db/schema";
import { proveedorEmail } from "@/lib/email";
import { encolar } from "@/lib/cola";
import { avisarAlPanel } from "@/lib/notificaciones/push";
import { armarCorreoDeCampana } from "./correo";

/**
 * El envío de una campaña: a quién, y de a cuántos por minuto.
 *
 * **En tandas, por la cola de trabajos.** Un servidor de correo nuevo que
 * manda quinientos mensajes de golpe es exactamente lo que los filtros de
 * Gmail tratan como spam, y una IP marcada tarda semanas en limpiarse. Cada
 * tanda manda `CAMPANAS_POR_MINUTO` correos y deja encolada la siguiente para
 * dentro de un minuto.
 *
 * **Por omisión, 3 por minuto con el servidor propio y 60 con Resend.**
 * Hostinger deja salir 5 correos por minuto desde la VPS: tres para la
 * campaña dejan lugar a los avisos de pedidos y recibos, que no pueden
 * esperar. Con un relay configurado en el servidor de correo
 * (`scripts/correo.sh relay`) se sube con la variable. Si el proceso se reinicia en medio, la cola retoma: lo
 * que ya salió está marcado y no se repite.
 */

export function porMinuto(): number {
  const n = Number.parseInt(process.env.CAMPANAS_POR_MINUTO ?? "", 10);
  if (Number.isInteger(n) && n > 0 && n <= 1000) return n;
  return proveedorEmail().nombre === "smtp" ? 3 : 60;
}

/**
 * La condición SQL del segmento, sobre `customers c`.
 *
 * Siempre: ficha activa, con una dirección que parece una dirección, y que no
 * se haya dado de baja. Los morosos no se excluyen: una promoción no es una
 * venta a crédito, y el bloqueo de cuenta ya vive en el mostrador.
 */
function condicionDelSegmento(s: SegmentoCampana): SQL {
  const partes: SQL[] = [
    sql`c.active`,
    sql`c.estado <> 'inactivo'`,
    sql`c.email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`,
    sql`not exists (select 1 from bajas_de_correo b where b.email = lower(c.email))`,
  ];
  if (s.tipo !== "todos") partes.push(sql`c.tipo = ${s.tipo}`);
  if (s.rubros.length > 0) {
    partes.push(sql`c.rubro in (${sql.join(s.rubros.map((r) => sql`${r}`), sql`, `)})`);
  }
  if (s.actividad) {
    const desde = sql`now() - make_interval(months => ${s.actividad.meses})`;
    const compro = sql`exists (select 1 from orders o where o.customer_id = c.id and o.estado <> 'cancelado' and o.created_at >= ${desde})`;
    partes.push(s.actividad.tipo === "compraron" ? compro : sql`not ${compro}`);
  }
  return sql.join(partes, sql` and `);
}

/** Cuántas direcciones distintas alcanza un segmento, para mostrarlo antes de enviar. */
export async function contarDestinatarios(s: SegmentoCampana): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(sql`
    select count(distinct lower(c.email))::int as n from customers c where ${condicionDelSegmento(s)}
  `);
  return rows[0]?.n ?? 0;
}

export class ErrorDeCampana extends Error {}

/**
 * Arranca el envío: congela la lista de destinatarios y encola la primera
 * tanda.
 *
 * El `UPDATE … WHERE estado in (borrador, programada)` es el candado: dos
 * clics en «Enviar», o el cron y un clic a la vez, arrancan el envío una sola
 * vez. Todo en una transacción: si falla la lista, la campaña no queda
 * «enviando» sin nadie a quien mandarle.
 */
export async function iniciarEnvio(campanaId: string): Promise<{ destinatarios: number }> {
  if (!proveedorEmail().real) {
    throw new ErrorDeCampana(
      "El envío de correos no está conectado: con el proveedor de demostración la campaña no saldría a nadie.",
    );
  }

  const destinatarios = await db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ segmento: SegmentoCampana }>(sql`
      update campanas set estado = 'enviando', iniciada_at = now(), updated_at = now()
       where id = ${campanaId} and estado in ('borrador', 'programada')
      returning segmento
    `);
    const campana = rows[0];
    if (!campana) throw new ErrorDeCampana("Esa campaña ya se está enviando o ya se envió.");

    const insertados = await tx.execute(sql`
      insert into campana_envios (campana_id, customer_id, email, nombre)
      select distinct on (lower(c.email)) ${campanaId}::uuid, c.id, lower(trim(c.email)), c.nombre
        from customers c
       where ${condicionDelSegmento(campana.segmento)}
       order by lower(c.email), c.updated_at desc
      on conflict do nothing
    `);
    const cantidad = insertados.rowCount ?? 0;
    if (cantidad === 0) {
      throw new ErrorDeCampana("El segmento no alcanza a nadie con correo: revisalo antes de enviar.");
    }
    return cantidad;
  });

  await encolar("campana.tanda", { campanaId });
  return { destinatarios };
}

/**
 * Una tanda: manda hasta `porMinuto()` correos pendientes y encola la
 * siguiente. La llama la cola (`campana.tanda`).
 *
 * Los envíos se toman con `FOR UPDATE SKIP LOCKED`: si por un reintento hay
 * dos tandas de la misma campaña corriendo, nunca le mandan dos veces a la
 * misma persona.
 */
export async function procesarTanda(campanaId: string): Promise<void> {
  const { rows: estado } = await db.execute<{ estado: string }>(sql`
    select estado from campanas where id = ${campanaId}
  `);
  // Cancelada (o borrada) a mitad de camino: lo que falta no sale.
  if (estado[0]?.estado !== "enviando") return;

  const { rows: campanaFilas } = await db.execute<{
    asunto: string;
    adelanto: string | null;
    cuerpo: string;
    imagen_url: string | null;
    boton_texto: string | null;
    boton_url: string | null;
  }>(sql`select asunto, adelanto, cuerpo, imagen_url, boton_texto, boton_url from campanas where id = ${campanaId}`);
  const c = campanaFilas[0];
  const campana = {
    asunto: c.asunto,
    adelanto: c.adelanto,
    cuerpo: c.cuerpo,
    imagenUrl: c.imagen_url,
    botonTexto: c.boton_texto,
    botonUrl: c.boton_url,
  };
  const proveedor = proveedorEmail();

  let cortar = false;
  await db.transaction(async (tx) => {
    const { rows: tanda } = await tx.execute<{ id: string; email: string; nombre: string | null; dado_de_baja: boolean }>(sql`
      select e.id, e.email, e.nombre,
             exists (select 1 from bajas_de_correo b where b.email = lower(e.email)) as dado_de_baja
        from campana_envios e
       where e.campana_id = ${campanaId} and e.estado = 'pendiente'
       order by e.email
       limit ${porMinuto()}
       for update of e skip locked
    `);

    for (const envio of tanda) {
      if (cortar) break;
      if (envio.dado_de_baja) {
        await tx.execute(sql`update campana_envios set estado = 'omitido' where id = ${envio.id}`);
        continue;
      }
      const correo = armarCorreoDeCampana(campana, envio);
      const resultado = await proveedor.enviar({
        para: envio.email,
        asunto: correo.asunto,
        html: correo.html,
        texto: correo.texto,
        cabeceras: correo.cabeceras,
      });
      // Rechazo temporal (el tope de Hostinger, un corte): queda pendiente y
      // la tanda termina acá. La siguiente lo vuelve a intentar.
      if (!resultado.enviado && resultado.temporal) {
        cortar = true;
        continue;
      }
      await tx.execute(sql`
        update campana_envios
           set estado = ${resultado.enviado ? "enviado" : "fallido"}::estado_envio_campana,
               error = ${resultado.enviado ? null : (resultado.error ?? "No salió.").slice(0, 500)},
               enviado_at = now()
         where id = ${envio.id}
      `);
    }
  });

  const { rows: quedan } = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from campana_envios where campana_id = ${campanaId} and estado = 'pendiente'
  `);

  if ((quedan[0]?.n ?? 0) > 0) {
    // Después de un rechazo temporal, se espera un poco más que una tanda.
    await encolar("campana.tanda", { campanaId }, { en: new Date(Date.now() + (cortar ? 3 : 1) * 60_000) });
  } else {
    await db.execute(sql`
      update campanas set estado = 'enviada', terminada_at = now(), updated_at = now()
       where id = ${campanaId} and estado = 'enviando'
    `);
  }
}

/** Las programadas cuya hora llegó. La llama la tarea de cada minuto. */
export async function iniciarProgramadas(): Promise<number> {
  const { rows } = await db.execute<{ id: string }>(sql`
    select id from campanas where estado = 'programada' and programada_para <= now()
  `);
  let iniciadas = 0;
  for (const { id } of rows) {
    try {
      await iniciarEnvio(id);
      iniciadas++;
    } catch (error) {
      // Una que no puede salir (segmento vacío, correo sin conectar) vuelve a
      // borrador con el motivo a la vista, en vez de reintentar cada minuto.
      await db.execute(sql`
        update campanas set estado = 'borrador', programada_para = null, updated_at = now()
         where id = ${id} and estado = 'programada'
      `);
      console.error(JSON.stringify({ scope: "campanas", id, error: (error as Error).message }));
      await avisarAlPanel({
        titulo: "Una campaña programada no salió",
        cuerpo: `${(error as Error).message} Quedó como borrador.`,
        url: `/admin/campanas/${id}`,
        etiqueta: "campana-fallida",
      });
    }
  }
  return iniciadas;
}
