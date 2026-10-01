import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { trabajos } from "@/lib/db/schema";
import { esperaParaElIntento } from "./espera";
import { MANEJADORES, type TipoDeTrabajo, type CargaDe } from "./manejadores";

/**
 * La cola de trabajos. Ver `lib/db/schema/tareas.ts` para el porqué.
 *
 * Dos funciones y nada más: `encolar`, que usan los webhooks, y
 * `procesarCola`, que usan el propio webhook (en `after()`, para no esperar)
 * y la tarea de cada minuto (para lo que falló o quedó cortado).
 */

/** Cuánto tiempo puede tener un procesador un trabajo en la mano. */
const TOMA_MS = 5 * 60_000;

export async function encolar<T extends TipoDeTrabajo>(
  tipo: T,
  carga: CargaDe<T>,
): Promise<string> {
  const [fila] = await db
    .insert(trabajos)
    .values({ tipo, carga: carga as unknown as Record<string, unknown> })
    .returning({ id: trabajos.id });
  return fila.id;
}

export interface ResultadoDeLaCola {
  hechos: number;
  reintentos: number;
  fallidos: number;
}

/**
 * Procesa lo que está listo para procesarse.
 *
 * Toma de a uno con `FOR UPDATE SKIP LOCKED`: si el webhook y el cron llegan a
 * la vez, cada uno agarra un trabajo distinto y ninguno espera al otro. El
 * trabajo tomado queda «procesando» con una hora de vencimiento de la toma;
 * si el proceso se muere ahí, vencida la toma vuelve a estar disponible.
 *
 * `soloId` sirve al webhook: procesa el trabajo que acaba de encolar y no se
 * pone a vaciar la cola entera en el `after()` de un pedido.
 */
export async function procesarCola(
  opciones: { limite?: number; soloId?: string } = {},
): Promise<ResultadoDeLaCola> {
  const limite = opciones.limite ?? 50;
  const resultado: ResultadoDeLaCola = { hechos: 0, reintentos: 0, fallidos: 0 };

  for (let i = 0; i < limite; i++) {
    const tomado = await tomarUno(opciones.soloId);
    if (!tomado) break;

    const manejador = MANEJADORES[tomado.tipo as TipoDeTrabajo];

    try {
      if (!manejador) throw new Error(`No hay manejador para «${tomado.tipo}».`);
      await manejador(tomado.carga as never);

      await db.execute(sql`
        update trabajos
           set estado = 'hecho', terminado_at = now(), tomado_hasta = null, ultimo_error = null
         where id = ${tomado.id}
      `);
      resultado.hechos++;
    } catch (error) {
      const mensaje = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
      const agotado = tomado.intentos >= tomado.max_intentos;

      await db.execute(sql`
        update trabajos
           set estado = ${agotado ? "fallido" : "pendiente"}::estado_trabajo,
               ultimo_error = ${mensaje},
               tomado_hasta = null,
               proximo_intento_at = now() + ${`${esperaParaElIntento(tomado.intentos)} milliseconds`}::interval,
               terminado_at = ${agotado ? sql`now()` : sql`null`}
         where id = ${tomado.id}
      `);

      console.error(
        JSON.stringify({
          scope: "cola",
          evento: agotado ? "trabajo_fallido" : "trabajo_reintento",
          tipo: tomado.tipo,
          id: tomado.id,
          intentos: tomado.intentos,
          detalle: mensaje,
        }),
      );

      if (agotado) {
        resultado.fallidos++;
        await avisarFallido(tomado.tipo, mensaje);
      } else {
        resultado.reintentos++;
      }
    }

    if (opciones.soloId) break;
  }

  return resultado;
}

interface Tomado extends Record<string, unknown> {
  id: string;
  tipo: string;
  carga: unknown;
  intentos: number;
  max_intentos: number;
}

async function tomarUno(soloId?: string): Promise<Tomado | null> {
  const filtro = soloId ? sql`and id = ${soloId}` : sql``;
  const { rows } = await db.execute<Tomado>(sql`
    update trabajos
       set estado = 'procesando',
           intentos = intentos + 1,
           tomado_hasta = now() + ${`${TOMA_MS} milliseconds`}::interval
     where id = (
       select id from trabajos
        where ((estado = 'pendiente' and proximo_intento_at <= now())
           or (estado = 'procesando' and tomado_hasta < now()))
          ${filtro}
        order by proximo_intento_at
        limit 1
        for update skip locked
     )
    returning id, tipo, carga, intentos, max_intentos
  `);
  return rows[0] ?? null;
}

/**
 * Un trabajo que agotó los reintentos no puede morir en silencio: si era un
 * pago, hay un cliente que pagó y un pedido que no se enteró.
 */
async function avisarFallido(tipo: string, mensaje: string): Promise<void> {
  try {
    const { avisarAlPanel } = await import("@/lib/notificaciones/push");
    await avisarAlPanel({
      titulo: "Un trabajo automático no se pudo hacer",
      cuerpo: `${tipo}: ${mensaje.slice(0, 140)}`,
      url: "/admin/sistema",
      etiqueta: "trabajo-fallido",
    });
  } catch {
    // El aviso es un extra; el registro del servidor ya lo dijo.
  }
}

/** Lo que el panel muestra: cuántos esperan y cuáles fallaron. */
export async function estadoDeLaCola() {
  const { rows } = await db.execute<{ pendientes: number; fallidos: number }>(sql`
    select
      (count(*) filter (where estado in ('pendiente', 'procesando')))::int as pendientes,
      (count(*) filter (where estado = 'fallido'))::int as fallidos
    from trabajos
  `);
  return rows[0] ?? { pendientes: 0, fallidos: 0 };
}
