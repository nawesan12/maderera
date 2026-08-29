import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cuttingExportProfiles } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import {
  PERFIL_GENERICO,
  type ClaveColumna,
  type ColumnaConfigurada,
  type PerfilDeExportacion,
} from "@/lib/cortes/formatos";

/**
 * Los perfiles de exportación guardados, traducidos al tipo que usa el motor.
 *
 * La fila guarda `columnas` como JSON y `finDeLinea` como `crlf`/`lf`, porque
 * en una columna de texto es lo que se puede editar sin inventar un tipo nuevo
 * en Postgres. La traducción vive acá, en un solo lugar.
 */
function aPerfil(fila: typeof cuttingExportProfiles.$inferSelect): PerfilDeExportacion {
  let columnas: ColumnaConfigurada[];

  try {
    const crudo = JSON.parse(fila.columnas) as ColumnaConfigurada[];
    columnas = Array.isArray(crudo) && crudo.length > 0 ? crudo : PERFIL_GENERICO.columnas;
  } catch {
    // Un perfil con el JSON roto no puede dejar sin exportar: se cae al
    // genérico, que es peor que el configurado pero mejor que nada.
    columnas = PERFIL_GENERICO.columnas;
  }

  return {
    nombre: fila.nombre,
    separador: fila.separador === "tab" ? "\t" : fila.separador,
    conEncabezado: fila.conEncabezado,
    unidad: (["mm", "cm", "m"] as const).includes(fila.unidad as never)
      ? (fila.unidad as PerfilDeExportacion["unidad"])
      : "mm",
    decimal: fila.decimal === "." ? "." : ",",
    siNo: [fila.valorSi, fila.valorNo],
    finDeLinea: fila.finDeLinea === "lf" ? "\n" : "\r\n",
    columnas: columnas.filter((c) => esClave(c.clave)),
  };
}

function esClave(valor: string): valor is ClaveColumna {
  return [
    "largo",
    "ancho",
    "cantidad",
    "material",
    "etiqueta",
    "veta",
    "cantoLargo",
    "cantoAncho",
    "numero",
    "cliente",
  ].includes(valor);
}

export async function listarPerfiles() {
  await requireStaff();

  return db
    .select()
    .from(cuttingExportProfiles)
    .orderBy(desc(cuttingExportProfiles.porDefecto), asc(cuttingExportProfiles.nombre));
}

/**
 * El perfil con el que se va a exportar.
 *
 * Si no hay ninguno cargado devuelve el genérico, que abre en Excel y que
 * cualquier importador acepta con un mapeo manual. Es lo correcto mientras no
 * sepamos qué programa usa el taller: exportar algo utilizable es mejor que
 * mostrar "configurá un perfil primero" y no dar nada.
 */
export async function perfilParaExportar(id?: string): Promise<PerfilDeExportacion> {
  await requireStaff();

  const filas = id
    ? await db
        .select()
        .from(cuttingExportProfiles)
        .where(eq(cuttingExportProfiles.id, id))
        .limit(1)
    : await db
        .select()
        .from(cuttingExportProfiles)
        .where(eq(cuttingExportProfiles.porDefecto, true))
        .limit(1);

  return filas[0] ? aPerfil(filas[0]) : PERFIL_GENERICO;
}
