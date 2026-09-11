import "server-only";

import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, siteSettings } from "@/lib/db/schema";
import { requireStaff, requireStaffRole } from "@/lib/dal/session";

/**
 * Los parámetros con los que el catálogo decide a quién señalar.
 *
 * La clienta pidió dar de baja productos «de manera automática según
 * parámetros». La baja automática no se construyó y el motivo sigue en pie
 * —ver `candidatosDeBaja`—, pero **el parámetro sí tenía que ser suyo**: estaba
 * escrito en el código como `UMBRALES_DE_BAJA`, así que cambiar "doce meses"
 * por "dieciocho" exigía un despliegue, que es exactamente lo que la palabra
 * "parámetro" promete que no.
 *
 * Vive en `site_settings`, la tabla de clave y valor que ya existe, y no en una
 * columna nueva: es un número suelto, no una entidad.
 */

const CLAVE = "catalogo.meses_sin_vender_baja";

/** Lo que se usaba cuando era una constante. */
export const MESES_SIN_VENDER_POR_OMISION = 12;

export async function mesesSinVenderParaBaja(): Promise<number> {
  await requireStaff();

  const [fila] = await db
    .select({ valor: siteSettings.valor })
    .from(siteSettings)
    .where(eq(siteSettings.clave, CLAVE))
    .limit(1);

  const numero = Number(fila?.valor);
  // Un valor corrupto no puede dejar la pantalla vacía ni traer el catálogo
  // entero: se cae al de siempre.
  return Number.isInteger(numero) && numero >= 1 && numero <= 60
    ? numero
    : MESES_SIN_VENDER_POR_OMISION;
}

export async function guardarMesesSinVender(meses: number) {
  await requireStaffRole("admin");

  if (!Number.isInteger(meses) || meses < 1 || meses > 60) {
    return { error: "Poné un número de meses entre 1 y 60." };
  }

  await db
    .insert(siteSettings)
    .values({
      clave: CLAVE,
      valor: String(meses),
      descripcion:
        "Meses sin una sola venta para que un producto aparezca como candidato a dar de baja.",
    })
    .onConflictDoUpdate({
      target: siteSettings.clave,
      set: { valor: String(meses), updatedAt: new Date() },
    });

  return { ok: `Ahora se señalan los que no se venden hace ${meses} meses.` };
}

/**
 * Las imputaciones ya usadas, para sugerirlas al cargar un producto.
 *
 * No es una tabla de cuentas: es lo que alguien tipeó antes. Sirve para que el
 * segundo producto de un rubro se impute igual que el primero sin depender de
 * que quien lo carga recuerde cómo se escribió —"Mercaderías" y "mercaderias"
 * son dos cuentas distintas para un reporte y la misma para una persona—.
 */
export async function imputacionesUsadas(): Promise<string[]> {
  await requireStaff();

  const filas = await db
    .selectDistinct({ imputacion: products.imputacion })
    .from(products)
    .where(isNotNull(products.imputacion))
    .orderBy(products.imputacion);

  return filas.map((f) => f.imputacion!).filter(Boolean);
}
