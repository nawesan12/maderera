"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { z } from "zod";
import { verifySession } from "@/lib/dal/session";
import { miPedido } from "@/lib/dal/cuenta";
import { plural } from "@/lib/formato";
import { agregarVarios } from "@/app/(public)/carrito-actions";

export interface EstadoAccion {
  error?: string;
  ok?: string;
}

/* -------------------------------------------------------------------------- */
/* Presupuestos                                                                */
/* -------------------------------------------------------------------------- */

export async function responderPresupuesto(
  _previo: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const numero = String(formData.get("numero") ?? "").trim().slice(0, 40);
  if (!numero) return { error: "No pudimos guardar tu respuesta. Probá de nuevo." };
  const r = await (await api()).POST("/api/v1/cuenta/presupuestos/{numero}/respuesta", {
    params: { path: { numero } },
    body: { respuesta: String(formData.get("respuesta") ?? "") },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No pudimos guardar tu respuesta. Probá de nuevo.") };
  revalidatePath("/mi-cuenta", "layout");
  revalidatePath("/admin/presupuestos");
  return { ok: r.data.ok };
}

/* -------------------------------------------------------------------------- */
/* Volver a pedir                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Carga en el presupuesto en curso lo mismo que tenía un pedido anterior.
 *
 * En una maderera la compra se repite: la misma obra vuelve a pedir tres
 * chapas y dos tirantes cada quince días. Retipearlo desde el catálogo es
 * donde aparecen los errores de medida.
 *
 * Los precios NO se copian del pedido viejo: `agregarAlCarrito` toma el de
 * lista de hoy. Un pedido de hace tres meses no fija el precio de hoy.
 */
export async function repetirPedido(
  _previo: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const numero = z.string().trim().min(1).safeParse(formData.get("numero"));
  if (!numero.success) return { error: "No encontramos ese pedido." };

  const pedido = await miPedido(numero.data);
  if (!pedido) return { error: "No encontramos ese pedido." };

  const resultado = await agregarVarios(
    pedido.items.map((item) => ({
      variantId: item.variantId ?? undefined,
      descripcion: item.descripcion,
      unidad: item.unidad,
      cantidad: Number(item.cantidad),
      origen: "repetido",
    })),
  );

  if (resultado.error) return { error: resultado.error };

  return {
    ok: `Cargamos ${plural(pedido.items.length, "producto")} en tu presupuesto.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Mis datos                                                                   */
/* -------------------------------------------------------------------------- */

export async function guardarMisDatos(
  _previo: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const campo = (n: string) => (formData.get(n) as string | null) || undefined;
  const r = await (await api()).PUT("/api/v1/cuenta/datos", {
    body: {
      nombre: (formData.get("nombre") as string | null) ?? "",
      telefono: campo("telefono"),
      razonSocial: campo("razonSocial"),
      cuit: campo("cuit"),
      condicionIva: (formData.get("condicionIva") as string | null) ?? "",
    },
  });
  if (r.response.status === 401) redirect("/ingresar?volver=/mi-cuenta/datos");
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  revalidatePath("/mi-cuenta", "layout");
  return { ok: r.data.ok };
}

/* -------------------------------------------------------------------------- */
/* Direcciones                                                                 */
/* -------------------------------------------------------------------------- */

/** Se aborta la transacción cuando el id editado no es de esta persona. */
export async function guardarDireccion(
  _previo: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const campo = (n: string) => (formData.get(n) as string | null) || undefined;
  const r = await (await api()).POST("/api/v1/cuenta/direcciones", {
    body: {
      id: campo("id"),
      etiqueta: (formData.get("etiqueta") as string | null) ?? "",
      calle: (formData.get("calle") as string | null) ?? "",
      localidad: (formData.get("localidad") as string | null) ?? "",
      codigoPostal: campo("codigoPostal"),
      notas: campo("notas"),
      predeterminada: formData.get("predeterminada") === "on",
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá la dirección.") };
  revalidatePath("/mi-cuenta/direcciones");
  return { ok: r.data.ok };
}

export async function borrarDireccion(
  _previo: EstadoAccion,
  formData: FormData,
): Promise<EstadoAccion> {
  const r = await (await api()).DELETE("/api/v1/cuenta/direcciones/{id}", {
    params: { path: { id: String(formData.get("id") ?? "") || "-" } },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No encontramos esa dirección.") };
  revalidatePath("/mi-cuenta/direcciones");
  return { ok: r.data.ok };
}

export async function cambiarNovedades(recibir: boolean): Promise<{ ok?: string; error?: string }> {
  await verifySession();
  // Lo hace Go (backend/internal/campanas): a la dirección de la cuenta y a
  // la de la ficha.
  const r = await (await api()).PUT("/api/v1/mi-cuenta/novedades", { body: { recibir } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  revalidatePath("/mi-cuenta/datos");
  return { ok: r.data.ok };
}
