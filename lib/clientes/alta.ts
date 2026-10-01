import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { formatearCuitLargo } from "@/lib/cuit";
import type { CondicionIva, Documento } from "./documento";

type Lector = Pick<typeof db, "select" | "insert">;

/**
 * El cliente que ya tiene ese documento, si lo hay.
 *
 * El CUIT puede estar guardado con o sin guiones —según por dónde entró la
 * ficha—, así que se busca de las dos formas. Un DNI se busca solo o adentro
 * de un CUIT: la misma persona pudo haber dado uno la primera vez y el otro
 * después.
 */
export async function clientePorDocumento(
  lector: Lector,
  documento: Documento,
): Promise<{ id: string; nombre: string } | null> {
  if (documento.tipo === "ninguno") return null;

  const formas =
    documento.tipo === "cuit"
      ? [documento.digitos, formatearCuitLargo(documento.digitos)]
      : [documento.digitos];

  const [fila] = await lector
    .select({ id: customers.id, nombre: customers.nombre })
    .from(customers)
    .where(and(eq(customers.active, true), inArray(customers.cuit, formas)))
    .limit(1);

  return fila ?? null;
}

export interface ClienteNuevo {
  nombre: string;
  documento: Documento;
  condicionIva: CondicionIva;
  telefono?: string | null;
  rubro?: string | null;
  direccion?: string | null;
  notas?: string | null;
}

/**
 * Crea la ficha mínima de un cliente.
 *
 * La usan el mostrador —alta en el lugar, con el cliente enfrente— y la
 * factura manual —«guardarlo como cliente nuevo»—, que antes tenían cada una
 * su versión y ninguna miraba si el CUIT ya existía. El documento se guarda
 * solo con dígitos: es lo que permite encontrarlo escrito de cualquier forma.
 */
export async function crearClienteRapido(lector: Lector, datos: ClienteNuevo) {
  const [creado] = await lector
    .insert(customers)
    .values({
      nombre: datos.nombre.trim(),
      // A una sociedad se la factura por su razón social: si el nombre es lo
      // único que se cargó, es también la razón social.
      razonSocial: datos.condicionIva === "responsable_inscripto" ? datos.nombre.trim() : null,
      cuit: datos.documento.tipo === "ninguno" ? null : datos.documento.digitos,
      condicionIva: datos.condicionIva,
      telefono: datos.telefono?.trim() || null,
      rubro: datos.rubro || null,
      tipo: datos.rubro && datos.rubro !== "particular" ? "profesional" : "particular",
      direccion: datos.direccion?.trim() || null,
      notas: datos.notas ?? null,
    })
    .returning({
      id: customers.id,
      nombre: customers.nombre,
      razonSocial: customers.razonSocial,
      cuit: customers.cuit,
      condicionIva: customers.condicionIva,
      estado: customers.estado,
      priceListId: customers.priceListId,
      direccion: customers.direccion,
    });

  return creado!;
}
