import "server-only";

import { and, eq, gte, inArray, isNotNull, isNull, ne, notLike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mensajes, sesionWhatsapp } from "@/lib/db/schema";
import {
  calcularGasto,
  dolares,
  estadoDelTope,
  inicioDelMesArgentino,
  inicioDelMesSiguienteArgentino,
  mesArgentino,
  tarifasEfectivas,
  TOPE_POR_OMISION,
  umbralesPasados,
  type CategoriaCobro,
  type EstadoDelTope,
  type FilaDeGasto,
  type Gasto,
} from "./costos";

/**
 * El gasto del mes en Meta contra el tope, del lado del servidor.
 *
 * Lo leen los avisos automáticos (que dejan de salir por WhatsApp al llegar
 * al tope), `enviarYRegistrar` (que pide confirmación a la bandeja), la
 * configuración y la bandeja. Sin control de acceso acá: quien muestra el
 * número ya validó la sesión, y quien decide si un aviso sale no tiene sesión.
 */

export interface ConfigDeGasto {
  tope: number;
  tarifas: Record<CategoriaCobro, number>;
  aviso80: string | null;
  aviso100: string | null;
}

export async function configDeGasto(): Promise<ConfigDeGasto> {
  const [fila] = await db
    .select({
      tope: sesionWhatsapp.topeMensualUsd,
      tarifas: sesionWhatsapp.tarifas,
      aviso80: sesionWhatsapp.topeAviso80,
      aviso100: sesionWhatsapp.topeAviso100,
    })
    .from(sesionWhatsapp)
    .limit(1);
  const tope = Number(fila?.tope ?? TOPE_POR_OMISION);
  return {
    tope: Number.isFinite(tope) && tope >= 0 ? tope : TOPE_POR_OMISION,
    tarifas: tarifasEfectivas(fila?.tarifas),
    aviso80: fila?.aviso80 ?? null,
    aviso100: fila?.aviso100 ?? null,
  };
}

export interface GastoDelMes extends Gasto, EstadoDelTope {
  tope: number;
  mes: string;
  /** Cuándo vuelven a salir los avisos si se cortaron. */
  reinicio: Date;
  tarifas: Record<CategoriaCobro, number>;
}

/**
 * Lo que se gastó en el mes argentino en curso.
 *
 * Cuenta los salientes con el cobro que informó Meta y, aparte, los que
 * salieron por la API y todavía no tienen estado (estimados con la categoría
 * que van a tener: plantilla → utilidad, texto → servicio). Lo escrito desde
 * el teléfono (`origen = telefono`), lo importado del historial y lo del modo
 * demostración no se cuentan: no pasan por la facturación de Meta.
 */
export async function gastoDelMes(ahora: Date = new Date()): Promise<GastoDelMes> {
  const inicio = inicioDelMesArgentino(ahora);
  const config = await configDeGasto();

  const porApi = and(
    eq(mensajes.direccion, "saliente"),
    gte(mensajes.createdAt, inicio),
    eq(mensajes.importado, false),
    or(isNull(mensajes.origen), ne(mensajes.origen, "telefono")),
  );

  const [informados, pendientes] = await Promise.all([
    db
      .select({
        categoria: mensajes.cobroCategoria,
        cobrable: mensajes.cobrable,
        total: sql<number>`count(*)::int`,
      })
      .from(mensajes)
      .where(and(porApi, isNotNull(mensajes.cobroCategoria)))
      .groupBy(mensajes.cobroCategoria, mensajes.cobrable),
    db
      .select({
        plantilla: sql<boolean>`${mensajes.plantilla} is not null`,
        total: sql<number>`count(*)::int`,
      })
      .from(mensajes)
      .where(
        and(
          porApi,
          isNull(mensajes.cobroCategoria),
          isNotNull(mensajes.waMessageId),
          notLike(mensajes.waMessageId, "demo-%"),
          inArray(mensajes.estado, ["enviado", "entregado", "leido"]),
        ),
      )
      .groupBy(sql`${mensajes.plantilla} is not null`),
  ]);

  const filas: FilaDeGasto[] = [
    ...informados.map((f) => ({ categoria: f.categoria, cobrable: f.cobrable, total: Number(f.total) })),
    ...pendientes.map((f) => ({
      categoria: f.plantilla ? "utility" : "service",
      cobrable: null,
      total: Number(f.total),
      estimado: true,
    })),
  ];

  const gasto = calcularGasto(filas, config.tarifas);
  return {
    ...gasto,
    ...estadoDelTope(gasto.usd, config.tope),
    tope: config.tope,
    mes: mesArgentino(ahora),
    reinicio: inicioDelMesSiguienteArgentino(ahora),
    tarifas: config.tarifas,
  };
}

/** Si ya se llegó al tope del mes. Ante la duda (la base no contesta), no. */
export async function topeAlcanzado(): Promise<boolean> {
  try {
    return (await gastoDelMes()).alcanzado;
  } catch {
    return false;
  }
}

function log(evento: string, detalle?: string) {
  console.info(JSON.stringify({ scope: "whatsapp.gasto", evento, detalle }));
}

/**
 * Avisa al teléfono del admin cuando el gasto pasa el 80 % y el 100 %: una
 * sola vez por umbral y por mes.
 *
 * La marca se pone con un `update … where <columna> distinta del mes`, que
 * devuelve la fila solo a quien la cambió: si dos estados de Meta llegan a la
 * vez, uno solo manda el aviso. No lanza: es un extra de lo que lo llamó.
 */
export async function revisarUmbrales(): Promise<void> {
  try {
    const gasto = await gastoDelMes();
    const pasados = umbralesPasados(gasto.usd, gasto.tope);
    if (pasados.length === 0) return;

    // El más alto primero: si de golpe se pasó el 100 %, el aviso del 80 % ya
    // no dice nada nuevo y se marca sin mandarlo.
    const umbral = pasados[pasados.length - 1];
    const columna = umbral === 100 ? sesionWhatsapp.topeAviso100 : sesionWhatsapp.topeAviso80;
    const marcadas = await db
      .update(sesionWhatsapp)
      .set(
        umbral === 100
          ? { topeAviso100: gasto.mes, topeAviso80: gasto.mes }
          : { topeAviso80: gasto.mes },
      )
      .where(or(isNull(columna), ne(columna, gasto.mes)))
      .returning({ id: sesionWhatsapp.id });
    if (marcadas.length === 0) return;

    log("umbral", `${umbral} % (${gasto.usd} de ${gasto.tope})`);
    const { avisarAlPanel } = await import("@/lib/notificaciones/push");
    await avisarAlPanel(
      umbral === 100
        ? {
            titulo: "WhatsApp llegó al tope del mes",
            cuerpo: `Van ${dolares(gasto.usd)} de ${dolares(gasto.tope)}. Los avisos automáticos dejan de salir por WhatsApp hasta el mes que viene; el correo sigue. Avisá desde el teléfono, que es gratis.`,
            url: "/admin/whatsapp/configuracion",
            etiqueta: "whatsapp-tope",
            para: { pantalla: "/admin/whatsapp/configuracion" },
          }
        : {
            titulo: "WhatsApp va por el 80 % del tope",
            cuerpo: `Van ${dolares(gasto.usd)} de ${dolares(gasto.tope)} este mes. Contestar desde el teléfono es gratis.`,
            url: "/admin/whatsapp/configuracion",
            etiqueta: "whatsapp-tope",
            para: { pantalla: "/admin/whatsapp/configuracion" },
          },
    );
  } catch (error) {
    log("error", error instanceof Error ? error.message : "desconocido");
  }
}
