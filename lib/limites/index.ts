import "server-only";

import { headers } from "next/headers";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rateLimits } from "@/lib/db/schema";
import {
  cuantoFalta,
  evaluar,
  inicioDeVentana,
  type Limite,
  type Veredicto,
} from "@/lib/limites/ventana";

export { cuantoFalta, type Limite, type Veredicto };

/**
 * El freno de mano de las acciones públicas.
 *
 * Todo lo que escribe en la base, manda un correo o quema un número de serie
 * pasa por acá antes de hacer nada. La aritmética está en
 * `lib/limites/ventana.ts`, con su test; esto es el guardado y el nombre de la
 * clave.
 *
 * **Nunca frena por un error propio.** Si la consulta del límite falla —la base
 * cayó, la tabla no existe todavía— la acción sigue. Un límite que se rompe y
 * deja a todo el mundo sin poder comprar es peor que el abuso que viene a
 * frenar: es el mismo criterio que `degradar()` usa en el layout.
 */

/**
 * Los límites de cada acción, todos en un lugar.
 *
 * Los números salen de lo que hace una persona de verdad. Nadie intenta
 * ingresar diez veces en un minuto, ni manda tres consultas por el formulario de
 * contacto en una hora. Están holgados a propósito: el objetivo es la ráfaga
 * automática, no el cliente apurado que toca dos veces el botón.
 */
export const LIMITES = {
  /** Cada intento es un hash de contraseña: CPU cara a propósito. */
  ingresar: { maximo: 10, ventanaSegundos: 300 },
  /** Crea usuario, perfil y ficha de cliente, sin verificación de correo. */
  registrarse: { maximo: 5, ventanaSegundos: 3600 },
  /** Quema numeración, reserva stock y manda trabajo al taller. */
  comprar: { maximo: 10, ventanaSegundos: 3600 },
  /** El pico de CPU más alto alcanzable desde afuera. */
  corte: { maximo: 30, ventanaSegundos: 600 },
  /** Quema numeración de presupuestos y manda un correo. */
  presupuesto: { maximo: 10, ventanaSegundos: 3600 },
  /** Es un relay de correo: quema la reputación del dominio. */
  contacto: { maximo: 3, ventanaSegundos: 3600 },
  /** Crea preferencias reales en Mercado Pago. */
  evento: { maximo: 5, ventanaSegundos: 3600 },
  /** Su dedupe por documento se saltea variando el número. */
  profesional: { maximo: 3, ventanaSegundos: 86400 },
  /** El PDF más caro del sitio, y alcanza con registrarse. */
  listaDePrecios: { maximo: 10, ventanaSegundos: 3600 },
  /** Sube hasta 16 MB a Blob con solo el token del pedido. */
  comprobante: { maximo: 10, ventanaSegundos: 3600 },
} as const satisfies Record<string, Limite>;

export type Accion = keyof typeof LIMITES;

/**
 * De dónde viene el pedido.
 *
 * En Vercel el primer valor de `x-forwarded-for` lo escribe la plataforma y no
 * se puede falsificar desde afuera; los que siguen sí, por eso se toma solo el
 * primero. Sin IP —en desarrollo, o detrás de algo raro— se usa una constante:
 * es preferible un límite compartido por todos a no tener ninguno.
 */
export async function ipDelPedido(): Promise<string> {
  const cabeceras = await headers();

  const adelantada = cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (adelantada) return adelantada;

  return cabeceras.get("x-real-ip")?.trim() || "sin-ip";
}

/**
 * ¿Se puede hacer esto ahora?
 *
 * `sujeto` es contra quién se cuenta. Casi siempre la IP; a veces conviene
 * además el correo o el documento, porque **limitar solo por IP deja pasar al
 * que rota de IP, y solo por correo, al que rota de correo**. Donde importa se
 * llaman los dos y basta con que uno frene.
 */
export async function permitido(
  accion: Accion,
  sujeto: string,
  ahora: Date = new Date(),
): Promise<Veredicto> {
  const limite = LIMITES[accion];
  const clave = `${accion}:${sujeto}`;
  const ventana = inicioDeVentana(ahora, limite.ventanaSegundos);

  try {
    /*
     * Un solo viaje, y atómico.
     *
     * El incremento lo hace la base, así que dos requests simultáneas no pueden
     * leer la misma cuenta y colarse las dos: `ON CONFLICT DO UPDATE` serializa
     * sobre la clave primaria. Con `SELECT` y después `UPDATE` habría una
     * ventana entre los dos, que es justo lo que explota una ráfaga.
     */
    const [fila] = await db
      .insert(rateLimits)
      .values({ clave, ventana, cuenta: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.clave, rateLimits.ventana],
        set: { cuenta: sql`${rateLimits.cuenta} + 1` },
      })
      .returning({ cuenta: rateLimits.cuenta });

    return evaluar(fila?.cuenta ?? 1, limite, ahora, ventana);
  } catch (error) {
    // Ver la regla de arriba: el límite nunca voltea la operación.
    console.error(`No se pudo contar el límite de ${accion}`, error);
    return { permitido: true, quedan: limite.maximo, esperaSegundos: 0 };
  }
}

/**
 * Lo mismo, pero contando por IP **y** por otra cosa a la vez.
 *
 * Frena si cualquiera de los dos se pasó. Las dos cuentas se piden en paralelo:
 * son dos operaciones de una fila cada una.
 */
export async function permitidoPorAmbos(
  accion: Accion,
  segundo: { nombre: string; valor: string },
  ahora: Date = new Date(),
): Promise<Veredicto> {
  const ip = await ipDelPedido();

  const [porIp, porSegundo] = await Promise.all([
    permitido(accion, `ip:${ip}`, ahora),
    permitido(accion, `${segundo.nombre}:${segundo.valor.toLowerCase()}`, ahora),
  ]);

  return porIp.permitido ? porSegundo : porIp;
}

/** El aviso que ve una persona cuando la frenan. Nunca un 429 seco. */
export function avisoDeEspera(veredicto: Veredicto): string {
  return `Probaste varias veces seguidas. Esperá ${cuantoFalta(
    veredicto.esperaSegundos,
  )} y volvé a intentar.`;
}

/**
 * Barre las ventanas que ya pasaron.
 *
 * Las filas viejas no molestan —nadie las consulta— pero tampoco se van solas.
 * Se llama desde el mismo lugar que ya hace limpieza en segundo plano, sin
 * bloquear a nadie.
 */
export async function limpiarVentanasViejas(
  antesDe: Date = new Date(Date.now() - 24 * 60 * 60 * 1000),
): Promise<number> {
  const borradas = await db
    .delete(rateLimits)
    .where(lt(rateLimits.ventana, antesDe))
    .returning({ clave: rateLimits.clave });

  return borradas.length;
}

/** Suelta el límite de una clave. Lo usa el ingreso cuando la contraseña acierta. */
export async function soltar(accion: Accion, sujeto: string): Promise<void> {
  try {
    await db
      .delete(rateLimits)
      .where(
        and(
          eq(rateLimits.clave, `${accion}:${sujeto}`),
          eq(
            rateLimits.ventana,
            inicioDeVentana(new Date(), LIMITES[accion].ventanaSegundos),
          ),
        ),
      );
  } catch {
    // Que no se pueda soltar no rompe nada: la ventana vence sola.
  }
}
