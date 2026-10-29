import "server-only";

import { revalidateTag } from "next/cache";
import { and, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tareasCorridas, trabajos } from "@/lib/db/schema";
import { ETIQUETAS } from "@/lib/cache-publico";
import { procesarCola } from "@/lib/cola";
import { iniciarProgramadas } from "@/lib/campanas/envio";
import { limpiarVentanasViejas } from "@/lib/limites";
import { enviarRecordatorios } from "@/lib/notificaciones/eventos";
import { avisarAlPanel } from "@/lib/notificaciones/push";
import { pendientesDelRol } from "@/lib/dal/admin/pendientes";
import { periodoDe, type Frecuencia } from "./periodo";

/**
 * Las tareas programadas.
 *
 * Mientras el sitio estuvo en Vercel no había ningún proceso periódico, y lo
 * que tenía que pasar solo no pasaba: los recordatorios de eventos eran un
 * botón, la tabla de límites crecía sin fin y un banner que vencía a la
 * medianoche seguía en la portada hasta un día más. En el servidor propio el
 * contenedor `cron` (ver `servidor/cron/crontab`) llama a `/api/tareas/<nombre>`.
 *
 * **Corren dentro del proceso de Next** y no en un script aparte por una sola
 * razón: `revalidateTag` solo invalida la caché del proceso que la tiene.
 *
 * Cada tarea con frecuencia deja una fila en `tareas_corridas` por período:
 * dispararla dos veces —el cron que se reinicia, alguien que la prueba a
 * mano— hace el trabajo una sola vez. La de cada minuto no deja fila (serían
 * 1440 por día): ella no necesita candado, porque la cola ya toma cada trabajo
 * con `SKIP LOCKED`.
 */

type Resultado = Record<string, number | string | boolean | null>;

interface Tarea {
  frecuencia: Frecuencia | null;
  descripcion: string;
  ejecutar: () => Promise<Resultado>;
}

export const TAREAS = {
  "cada-minuto": {
    frecuencia: null,
    descripcion:
      "Arranca las campañas programadas y procesa la cola: pagos, mensajes y tandas de correo.",
    ejecutar: async () => {
      const campanas = await iniciarProgramadas();
      return { campanasIniciadas: campanas, ...(await procesarCola({ limite: 100 })) };
    },
  },

  "cada-hora": {
    frecuencia: "hora",
    descripcion: "Vence en la portada lo que venció: banners, promociones y eventos.",
    ejecutar: async () => {
      /*
       * `expire: 0` y no "max": con "max" el próximo visitante vería todavía el
       * banner vencido mientras se rearma en segundo plano. Un banner de «hasta
       * el 30/9» el 1/10 es exactamente lo que esta tarea existe para evitar.
       */
      revalidateTag(ETIQUETAS.contenido, { expire: 0 });
      revalidateTag(ETIQUETAS.eventos, { expire: 0 });
      return { invalidadas: 2 };
    },
  },

  diaria: {
    frecuencia: "dia",
    descripcion:
      "Recordatorios de eventos, el parte del día al panel y la limpieza de tablas que crecen solas.",
    ejecutar: async () => {
      const recordatorios = await enviarRecordatorios();
      const parte = await mandarParteDelDia();
      // Las plantillas de WhatsApp las copia el worker de Go (tarea
      // «plantillas-whatsapp»).

      const limites = await limpiarVentanasViejas();
      const hace90 = new Date(Date.now() - 90 * 86_400_000);
      const hace30 = new Date(Date.now() - 30 * 86_400_000);
      const corridas = await db
        .delete(tareasCorridas)
        .where(lt(tareasCorridas.iniciadaAt, hace90))
        .returning({ id: tareasCorridas.id });
      // Los fallidos no se borran: son los que alguien tiene que mirar.
      const hechos = await db
        .delete(trabajos)
        .where(and(inArray(trabajos.estado, ["hecho"]), lt(trabajos.terminadoAt, hace30)))
        .returning({ id: trabajos.id });

      return {
        recordatorios,
        parte,
        limitesBorrados: limites,
        corridasBorradas: corridas.length,
        trabajosBorrados: hechos.length,
      };
    },
  },

  // La semanal (reseñas de Google y candidatos a baja) la corre el worker de
  // Go: tareas «resenas-google» y «candidatos-baja».
} satisfies Record<string, Tarea>;

export type NombreDeTarea = keyof typeof TAREAS;

export function esTarea(nombre: string): nombre is NombreDeTarea {
  return Object.hasOwn(TAREAS, nombre);
}

export type Corrida =
  | { estado: "ok"; periodo: string | null; resultado: Resultado }
  | { estado: "ya-corrio"; periodo: string }
  | { estado: "error"; periodo: string | null; error: string };

/**
 * Corre una tarea, una sola vez por período.
 *
 * El candado es el `INSERT … ON CONFLICT`: entra si no hay fila para el
 * período, si la que hay terminó con error, o si quedó «corriendo» hace más
 * de media hora (el proceso se murió a mitad de camino). En cualquier otro
 * caso, alguien ya la corrió o la está corriendo, y no se hace nada.
 */
export async function correrTarea(nombre: NombreDeTarea, ahora: Date = new Date()): Promise<Corrida> {
  const tarea: Tarea = TAREAS[nombre];

  if (!tarea.frecuencia) {
    try {
      return { estado: "ok", periodo: null, resultado: await tarea.ejecutar() };
    } catch (error) {
      return { estado: "error", periodo: null, error: mensajeDe(error) };
    }
  }

  const periodo = periodoDe(tarea.frecuencia, ahora);

  const { rows } = await db.execute<{ id: string }>(sql`
    insert into tareas_corridas (tarea, periodo)
    values (${nombre}, ${periodo})
    on conflict (tarea, periodo) do update
      set estado = 'corriendo', iniciada_at = now(), terminada_at = null, error = null, resultado = null
      where tareas_corridas.estado = 'error'
         or (tareas_corridas.estado = 'corriendo' and tareas_corridas.iniciada_at < now() - interval '30 minutes')
    returning id
  `);

  const corrida = rows[0];
  if (!corrida) return { estado: "ya-corrio", periodo };

  try {
    const resultado = await tarea.ejecutar();
    await db.execute(sql`
      update tareas_corridas
         set estado = 'ok', terminada_at = now(), resultado = ${JSON.stringify(resultado)}::jsonb
       where id = ${corrida.id}
    `);
    return { estado: "ok", periodo, resultado };
  } catch (error) {
    const mensaje = mensajeDe(error);
    await db.execute(sql`
      update tareas_corridas
         set estado = 'error', terminada_at = now(), error = ${mensaje}
       where id = ${corrida.id}
    `);
    console.error(JSON.stringify({ scope: "tareas", tarea: nombre, periodo, error: mensaje }));
    return { estado: "error", periodo, error: mensaje };
  }
}

/**
 * El parte del día: lo urgente, en el teléfono del equipo antes de abrir.
 *
 * Es lo mismo que la tarjeta «Para hoy» del resumen del panel, con la mirada
 * del admin, que ve todo. Solo se manda si hay algo: un aviso diario que dice
 * «nada» enseña a ignorar los avisos.
 */
async function mandarParteDelDia(): Promise<number> {
  const filas = await pendientesDelRol("admin");
  if (filas.length === 0) return 0;

  const urgentes = filas.filter((f) => f.urgente);
  const primeras = (urgentes.length > 0 ? urgentes : filas).slice(0, 3);

  await avisarAlPanel({
    titulo:
      urgentes.length > 0
        ? `Para hoy: ${urgentes.length} ${urgentes.length === 1 ? "cosa urgente" : "cosas urgentes"}`
        : "Para hoy en la maderera",
    cuerpo: primeras.map((f) => `${f.cantidad} ${f.texto}`).join(" · "),
    url: "/admin",
    etiqueta: "parte-del-dia",
  });

  return filas.length;
}

function mensajeDe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

/** Lo que muestra el panel: la última corrida de cada tarea. */
export async function ultimasCorridas() {
  const { rows } = await db.execute<{
    tarea: string;
    periodo: string;
    estado: "corriendo" | "ok" | "error";
    resultado: Resultado | null;
    error: string | null;
    iniciada_at: Date;
    terminada_at: Date | null;
  }>(sql`
    select distinct on (tarea) tarea, periodo, estado, resultado, error, iniciada_at, terminada_at
      from tareas_corridas
     order by tarea, iniciada_at desc
  `);
  return rows;
}
