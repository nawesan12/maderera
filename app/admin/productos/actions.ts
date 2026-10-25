"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * La ficha de producto. La valida y la guarda la API de Go
 * (backend/internal/productos): el producto, sus medidas, los precios de las
 * dos listas y el stock de las dos sucursales en una transacción, con el
 * candado del stock y un movimiento por cada cantidad que cambió. Acá queda
 * pasar el formulario y revalidar.
 */

export interface EstadoFormulario {
  error?: string;
  campo?: string;
}

const texto = (formData: FormData, campo: string) => String(formData.get(campo) ?? "");

/** El formulario como lo leía parsearFormulario: todo texto, lo valida Go. */
function cuerpo(formData: FormData) {
  const variantes = formData.get("variantes");
  return {
    name: texto(formData, "name"),
    slug: texto(formData, "slug"),
    categoryId: texto(formData, "categoryId"),
    subcategory: texto(formData, "subcategory"),
    subcategoryId: texto(formData, "subcategoryId"),
    description: texto(formData, "description"),
    brand: texto(formData, "brand"),
    unit: texto(formData, "unit"),
    formaDeVenta: texto(formData, "formaDeVenta") || "entera",
    precioMediaPct: (texto(formData, "precioMediaPct") || "50").replace(",", "."),
    alicuotaIva: texto(formData, "alicuotaIva") || "21",
    recargoElaboracionPct: texto(formData, "recargoElaboracionPct"),
    imputacion: texto(formData, "imputacion"),
    featured: formData.get("featured") === "on",
    aPedido: formData.get("aPedido") === "on",
    active: formData.get("active") === "on",
    imagen: texto(formData, "imagen"),
    variantes: variantes ? JSON.parse(String(variantes)) : [],
  };
}

export async function guardarProducto(_previo: EstadoFormulario, formData: FormData): Promise<EstadoFormulario> {
  const id = texto(formData, "id");
  const cliente = await api();
  const r = id
    ? await cliente.PUT("/api/v1/admin/productos/{id}", { params: { path: { id } }, body: cuerpo(formData) })
    : await cliente.POST("/api/v1/admin/productos", { body: cuerpo(formData) });
  if (r.error) {
    const p = r.error as Problema;
    const [campo] = Object.keys(p.errores ?? {});
    return { error: mensajeDe(p, "Revisá los datos del formulario."), ...(campo ? { campo } : {}) };
  }
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/catalogo");
  revalidatePath("/stock");
  revalidatePath("/admin/productos");
  redirect("/admin/productos?guardado=1");
}

export async function alternarActivo(id: string, activo: boolean) {
  await (await api()).POST("/api/v1/admin/productos/{id}/activo", { params: { path: { id } }, body: { activo } });
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/catalogo");
  revalidatePath("/admin/productos");
}
