"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { headers } from "next/headers";
import { apiInterna, mensajeDe, type Problema } from "@/lib/api/servidor";
import { notificarRemitoFirmado } from "@/lib/notificaciones/entregas";

export interface EstadoFirma {
  error?: string;
  numero?: string;
}

/**
 * Guarda la firma de quien retira.
 *
 * Lo hace Go (backend/internal/entregas): el esquema de siempre —el nombre,
 * el documento y la firma en PNG, de hasta cien mil bytes—, y un solo remito
 * «preparada» se firma una sola vez. **La imagen se guarda en la base, no
 * como archivo**: una firma es un dato personal, y como texto en la columna
 * del remito solo la ve quien puede ver el remito.
 *
 * Lo que hace que esto reemplace al remito en papel es el contexto: la fecha,
 * la hora y desde qué IP se firmó. La IP la ve Next y se la pasa a Go con el
 * secreto interno (si no, Go usaría la de Next).
 */
export async function firmarRemito(
  _previo: EstadoFirma,
  formData: FormData,
): Promise<EstadoFirma> {
  const cabeceras = await headers();
  const ip =
    cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    cabeceras.get("x-real-ip");

  const r = await apiInterna.POST("/api/v1/firmar", {
    body: {
      token: formData.get("token"),
      receptorNombre: formData.get("receptorNombre"),
      receptorDocumento: (formData.get("receptorDocumento") as string) || undefined,
      firma: formData.get("firma"),
      ip: ip ?? null,
    },
  });

  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };

  const resultado = r.data;
  revalidatePath("/admin/pedidos");

  after(async () => {
    await notificarRemitoFirmado(resultado.deliveryId);
  });

  return { numero: resultado.numero };
}
