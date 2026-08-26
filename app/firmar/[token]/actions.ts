"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { registrarFirma } from "@/lib/entregas";
import { notificarRemitoFirmado } from "@/lib/notificaciones/entregas";

export interface EstadoFirma {
  error?: string;
  numero?: string;
}

/**
 * Tope de la imagen de firma.
 *
 * Un trazo a mano alzada en PNG monocromo pesa entre 5 y 20 KB. Cien mil bytes
 * es holgado para cualquier firma y chico para cualquier otra cosa: es lo que
 * impide que alguien use este endpoint para meter una foto en la base.
 */
const TAMANO_MAXIMO = 100_000;

const esquema = z.object({
  token: z.string().min(10).max(120),
  receptorNombre: z
    .string()
    .trim()
    .min(3, "Escribí tu nombre y apellido.")
    .max(120),
  receptorDocumento: z.string().trim().max(30).optional(),
  firma: z
    .string()
    .startsWith("data:image/png;base64,", "La firma no se guardó bien.")
    .max(TAMANO_MAXIMO, "La firma es demasiado grande."),
});

/**
 * Guarda la firma de quien retira.
 *
 * **La imagen se guarda en la base, no como archivo.** Una firma es un dato
 * personal: subirla a un almacenamiento público, aunque el nombre sea
 * impredecible, deja una URL que funciona para cualquiera que la tenga. Como
 * texto en la columna del remito, solo la ve quien puede ver el remito, que es
 * exactamente la regla que ya está escrita.
 *
 * Lo que hace que esto reemplace al remito en papel no es el dibujo sino el
 * contexto: la fecha, la hora y desde qué IP se firmó quedan guardados al lado.
 */
export async function firmarRemito(
  _previo: EstadoFirma,
  formData: FormData,
): Promise<EstadoFirma> {
  const parsed = esquema.safeParse({
    token: formData.get("token"),
    receptorNombre: formData.get("receptorNombre"),
    receptorDocumento: (formData.get("receptorDocumento") as string) || undefined,
    firma: formData.get("firma"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const cabeceras = await headers();
  const ip =
    cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    cabeceras.get("x-real-ip");

  const resultado = await registrarFirma({
    token: parsed.data.token,
    firmaUrl: parsed.data.firma,
    receptorNombre: parsed.data.receptorNombre,
    receptorDocumento: parsed.data.receptorDocumento,
    ip,
  });

  if (!resultado) {
    return {
      error:
        "Este remito ya está firmado o el link venció. Pedile uno nuevo a la maderera.",
    };
  }

  revalidatePath("/admin/pedidos");

  after(async () => {
    await notificarRemitoFirmado(resultado.deliveryId);
  });

  return { numero: resultado.numero };
}
