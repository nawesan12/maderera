"use server";

import { revalidatePath, updateTag } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  priceListItems,
  priceLists,
  supplierPriceProfiles,
  supplierVariantCodes,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { ETIQUETAS } from "@/lib/cache-publico";
import { leerPlanilla } from "@/lib/planilla";
import { resolverCodigos } from "@/lib/dal/admin/proveedores";
import {
  leerListaDeProveedor,
  type PerfilDeProveedor,
} from "@/lib/precios/lista-proveedor";

export interface FilaPrevia {
  codigo: string;
  descripcion: string;
  costo: number;
  precioSugerido: number;
  /** A qué variante nuestra corresponde. Null si no se pudo aparear. */
  variantId: string | null;
  nuestro: string | null;
  precioActual: number | null;
}

export interface VistaPreviaProveedor {
  filas: FilaPrevia[];
  problemas: { fila: number; motivo: string }[];
  /** Cuántas se van a actualizar y cuántas quedan sin aparear. */
  apareadas: number;
  sinAparear: number;
  /** Los encabezados que trae el archivo, para poder armar el perfil. */
  columnas: string[];
  error?: string;
}

const TOPE = 5 * 1024 * 1024;

const perfilSchema = z.object({
  supplierId: z.string().uuid(),
  columnaCodigo: z.string().trim().min(1, "Elegí la columna del código."),
  columnaPrecio: z.string().trim().min(1, "Elegí la columna del precio."),
  columnaDescripcion: z.string().trim().optional(),
  precioEsNeto: z.boolean(),
  margenPorcentaje: z.coerce.number().min(0).max(500),
});

function leerPerfilDelFormulario(formData: FormData) {
  return perfilSchema.safeParse({
    supplierId: formData.get("supplierId"),
    columnaCodigo: formData.get("columnaCodigo"),
    columnaPrecio: formData.get("columnaPrecio"),
    columnaDescripcion: (formData.get("columnaDescripcion") as string) || undefined,
    precioEsNeto: formData.get("precioEsNeto") === "on",
    margenPorcentaje: formData.get("margenPorcentaje") || 0,
  });
}

/**
 * Lee el archivo del proveedor y muestra qué va a pasar, sin tocar nada.
 *
 * La vista previa es obligatoria por el mismo motivo que en la importación de
 * precios propia: una lista de precios mal mapeada cambia el costo de
 * doscientos productos de una, y el error se descubre cuando alguien mira el
 * margen a fin de mes.
 */
export async function previsualizarLista(
  formData: FormData,
): Promise<VistaPreviaProveedor> {
  await requireStaff();

  const vacio = (error: string): VistaPreviaProveedor => ({
    filas: [],
    problemas: [],
    apareadas: 0,
    sinAparear: 0,
    columnas: [],
    error,
  });

  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return vacio("Elegí un archivo.");
  }
  if (archivo.size > TOPE) return vacio("El archivo supera los 5 MB.");

  const { filas: grilla, error } = leerPlanilla(
    new Uint8Array(await archivo.arrayBuffer()),
  );
  if (error) return vacio(error);
  if (grilla.length < 2) return vacio("La planilla está vacía.");

  const columnas = grilla[0].map((c) => c.trim()).filter(Boolean);

  const parsed = leerPerfilDelFormulario(formData);
  if (!parsed.success) {
    // Todavía no eligió las columnas: se le devuelven las del archivo para que
    // pueda armarlo, en vez de un error que no explica qué falta.
    return {
      ...vacio(parsed.error.issues[0]?.message ?? "Revisá el perfil."),
      columnas,
    };
  }

  const perfil: PerfilDeProveedor = {
    columnaCodigo: parsed.data.columnaCodigo,
    columnaPrecio: parsed.data.columnaPrecio,
    columnaDescripcion: parsed.data.columnaDescripcion ?? null,
    precioEsNeto: parsed.data.precioEsNeto,
    margenPorcentaje: parsed.data.margenPorcentaje,
  };

  const { filas, problemas } = leerListaDeProveedor(grilla, perfil);
  const resueltos = await resolverCodigos(
    parsed.data.supplierId,
    filas.map((f) => f.codigo),
  );

  const porCodigo = new Map(resueltos.map((r) => [r.codigo, r]));

  const variantIds = resueltos
    .map((r) => r.variantId)
    .filter((id): id is string => id !== null);

  const [general] = await db
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(and(eq(priceLists.isDefault, true), eq(priceLists.active, true)))
    .limit(1);

  const actuales =
    variantIds.length > 0 && general
      ? await db
          .select({
            variantId: priceListItems.variantId,
            precio: priceListItems.price,
          })
          .from(priceListItems)
          .where(
            and(
              eq(priceListItems.priceListId, general.id),
              inArray(priceListItems.variantId, variantIds),
            ),
          )
      : [];

  const precioPorVariante = new Map(
    actuales.map((a) => [a.variantId, Number(a.precio)]),
  );

  const conMatch: FilaPrevia[] = filas.map((f) => {
    const r = porCodigo.get(f.codigo);
    return {
      ...f,
      variantId: r?.variantId ?? null,
      nuestro: r?.descripcion ?? null,
      precioActual: r?.variantId
        ? (precioPorVariante.get(r.variantId) ?? null)
        : null,
    };
  });

  return {
    filas: conMatch,
    problemas,
    apareadas: conMatch.filter((f) => f.variantId).length,
    sinAparear: conMatch.filter((f) => !f.variantId).length,
    columnas,
  };
}

export interface EstadoLista {
  error?: string;
  ok?: string;
}

/**
 * Aplica la lista: guarda el perfil, los códigos y los precios nuevos.
 *
 * **Solo toca las filas que se pudieron aparear.** Un código que no corresponde
 * a ninguna variante nuestra no crea un producto: dar de alta mercadería desde
 * una planilla de precios es cómo se llena el catálogo de artículos que nadie
 * revisó.
 */
export async function aplicarLista(
  _previo: EstadoLista,
  formData: FormData,
): Promise<EstadoLista> {
  const usuario = await requireStaff();

  const parsed = leerPerfilDelFormulario(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá el perfil." };
  }

  const crudo = formData.get("filas");
  if (typeof crudo !== "string") return { error: "No hay nada para aplicar." };

  const filas = z
    .array(
      z.object({
        codigo: z.string(),
        variantId: z.string().uuid(),
        costo: z.number(),
        precioSugerido: z.number().positive(),
      }),
    )
    .safeParse(JSON.parse(crudo));

  if (!filas.success || filas.data.length === 0) {
    return { error: "No hay filas apareadas para aplicar." };
  }

  const [general] = await db
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(and(eq(priceLists.isDefault, true), eq(priceLists.active, true)))
    .limit(1);

  if (!general) return { error: "No hay una lista de precios general." };

  const { supplierId, ...perfil } = parsed.data;

  await db.transaction(async (tx) => {
    // El perfil, para no volver a mapear la semana que viene.
    const [existe] = await tx
      .select({ id: supplierPriceProfiles.id })
      .from(supplierPriceProfiles)
      .where(eq(supplierPriceProfiles.supplierId, supplierId))
      .limit(1);

    const valores = {
      columnaCodigo: perfil.columnaCodigo,
      columnaPrecio: perfil.columnaPrecio,
      columnaDescripcion: perfil.columnaDescripcion ?? null,
      precioEsNeto: perfil.precioEsNeto,
      margenPorcentaje: perfil.margenPorcentaje.toFixed(2),
      updatedAt: new Date(),
    };

    if (existe) {
      await tx
        .update(supplierPriceProfiles)
        .set(valores)
        .where(eq(supplierPriceProfiles.id, existe.id));
    } else {
      await tx
        .insert(supplierPriceProfiles)
        .values({ supplierId, ...valores });
    }

    for (const fila of filas.data) {
      // El código del proveedor, para que la próxima aparee solo.
      await tx
        .insert(supplierVariantCodes)
        .values({
          supplierId,
          variantId: fila.variantId,
          codigo: fila.codigo,
        })
        .onConflictDoUpdate({
          target: [supplierVariantCodes.supplierId, supplierVariantCodes.codigo],
          set: { variantId: fila.variantId },
        });

      await tx
        .insert(priceListItems)
        .values({
          priceListId: general.id,
          variantId: fila.variantId,
          price: fila.precioSugerido.toFixed(2),
        })
        .onConflictDoUpdate({
          target: [priceListItems.priceListId, priceListItems.variantId],
          set: { price: fila.precioSugerido.toFixed(2), updatedAt: new Date() },
        });
    }
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "precio",
    entidadId: supplierId,
    descripcion: `Importó ${filas.data.length} precios desde la lista de un proveedor`,
  });

  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/admin/precios");
  revalidatePath(`/admin/proveedores/${supplierId}`);

  return {
    ok: `Listo: ${filas.data.length} precios actualizados. El mapeo quedó guardado.`,
  };
}
