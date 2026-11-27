"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { apiInterna, mensajeDe, type Problema } from "@/lib/api/servidor";

export interface EstadoFirma {
  error?: string;
  numero?: string;
  /** Ya estaba firmado (otra firma, el mostrador, un doble toque): se muestra la constancia. */
  yaFirmado?: boolean;
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
 * secreto interno (si no, Go usaría la de Next). La constancia por correo la
 * encola Go con la firma.
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

  // Ya firmado (o anulado) cuando llegó esta firma: no es un error de quien
  // firma. Se vuelve a leer la página, que muestra la constancia (mes
  // simulado 2: la firma quedaba guardada y la pantalla decía «el link
  // venció, pedí otro»).
  if (r.response.status === 409) {
    revalidatePath(`/firmar/${formData.get("token")}`);
    return { yaFirmado: true };
  }
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };

  const resultado = r.data;
  revalidatePath("/admin/pedidos");

  return { numero: resultado.numero };
}
