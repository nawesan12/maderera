"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

export interface EstadoZona {
  error?: string;
  ok?: string;
}

/**
 * Las zonas de envío se veían solo en el carrito y **no se podían editar
 * desde ningún lado**: existían únicamente en el script de siembra, así que
 * cambiar una tarifa exigía un despliegue. Para un negocio cuyo flete cambia
 * con el combustible, eso es tenerlo desactualizado siempre.
 */
function refrescar() {
  // Comparten etiqueta de caché con las sucursales: las dos las lee el
  // carrito y se invalidan juntas.
  updateTag(ETIQUETAS.sucursales);
  revalidatePath("/admin/envios");
  revalidatePath("/carrito/confirmar");
}

/**
 * Guarda una zona. Lo hace Go (backend/internal/entregas/zonas.go): el
 * esquema de siempre, los importes con `parsearImporte` (acá se tipea
 * «18.000» y «18.000,50») y la bitácora.
 */
export async function guardarZona(
  _previo: EstadoZona,
  formData: FormData,
): Promise<EstadoZona> {
  const r = await (await api()).POST("/api/v1/admin/envios", {
    body: {
      id: (formData.get("id") as string) || undefined,
      nombre: formData.get("nombre"),
      cobertura: formData.get("cobertura") ?? "",
      demoraEstimada: formData.get("demoraEstimada") ?? "",
      aCotizar: formData.get("aCotizar") === "on",
      costo: (formData.get("costo") as string) || "0",
      envioGratisDesde: (formData.get("envioGratisDesde") as string) || "0",
      orden: (formData.get("orden") as string) || "0",
      activa: formData.get("activa") === "on",
    },
  });

  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };

  refrescar();
  return { ok: r.data.ok };
}
