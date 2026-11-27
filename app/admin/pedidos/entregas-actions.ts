"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import type { Autorizacion } from "@/components/autorizacion/campo-pin";

export interface EstadoEntrega {
  error?: string;
  ok?: string;
  /** Link de firma del remito recién creado, para mostrarlo o mandarlo. */
  linkFirma?: string;
  numero?: string;
  /** Anular un remito firmado: falta el PIN de un admin. */
  autorizacion?: Autorizacion;
  /** En qué campo está el error (el motivo de la anulación). */
  campo?: string;
}

/**
 * Prepara un remito con lo que el cliente se lleva ahora.
 *
 * Lo hace Go (backend/internal/entregas): valida el formulario como el
 * esquema de siempre —en un retiro el documento es obligatorio: la firma sola
 * no identifica a nadie—, controla las cantidades contra lo que queda en
 * acopio y saca la mercadería del depósito, todo con el candado de la serie
 * de remitos. El correo con el enlace para firmar lo encola ahí mismo.
 */
export async function prepararRemito(
  _previo: EstadoEntrega,
  formData: FormData,
): Promise<EstadoEntrega> {
  const orderId = String(formData.get("orderId") ?? "");

  // Las cantidades llegan como `cantidad-<orderItemId>`, una por renglón.
  const cantidades: { orderItemId: string; valor: string }[] = [];
  // Lo de otros acopios del mismo cliente que sale en la misma visita:
  // `otro-<orderId>-<orderItemId>`.
  const otros = new Map<string, { orderItemId: string; valor: string }[]>();
  for (const [clave, valor] of formData.entries()) {
    if (clave.startsWith("cantidad-")) {
      cantidades.push({ orderItemId: clave.slice("cantidad-".length), valor: String(valor) });
    }
    const otro = /^otro-([0-9a-f-]{36})-([0-9a-f-]{36})$/.exec(clave);
    if (otro && String(valor).trim() !== "" && String(valor).trim() !== "0") {
      otros.set(otro[1], [...(otros.get(otro[1]) ?? []), { orderItemId: otro[2], valor: String(valor) }]);
    }
  }

  const r = await (await api()).POST("/api/v1/admin/remitos", {
    body: {
      orderId,
      tipo: String(formData.get("tipo") ?? "retiro"),
      receptorNombre: (formData.get("receptorNombre") as string) || undefined,
      receptorDocumento: (formData.get("receptorDocumento") as string) || undefined,
      transportista: (formData.get("transportista") as string) || undefined,
      numeroSeguimiento: (formData.get("numeroSeguimiento") as string) || undefined,
      notas: (formData.get("notas") as string) || undefined,
      ...(formData.get("pin") ? { pin: String(formData.get("pin")) } : {}),
      cantidades,
      ...(otros.size > 0 ? { otros: [...otros].map(([id, c]) => ({ orderId: id, cantidades: c })) } : {}),
    },
  });

  if (!r.data) {
    if (r.response.status >= 500) console.error(`prepararRemito: la API respondió ${r.response.status}`);
    // Soltar lo que no se cobró: el depósito (o quien vende, según la
    // regla) pide el PIN de un admin (entregas.AutorizarSinCobrar).
    const autorizacion = autorizacionSinCobrar(r.error as Problema | undefined);
    if (autorizacion) return autorizacion;
    return {
      error: r.response.status >= 500 ? "No pudimos preparar el remito." : mensajeDe(r.error as Problema | undefined),
    };
  }

  const entrega = r.data;
  revalidatePath(`/admin/pedidos/${orderId}`);
  for (const id of otros.keys()) revalidatePath(`/admin/pedidos/${id}`);
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/reparto");
  revalidatePath("/admin/stock");

  return { ok: entrega.ok, numero: entrega.numero, linkFirma: `/firmar/${entrega.firmaToken}` };
}

/** El 422 del PIN para soltar lo que no se cobró, o null. */
function autorizacionSinCobrar(p: Problema | undefined): EstadoEntrega | null {
  const e = p?.errores;
  if (!e?.pin || e.pinMotivo !== "sin_cobrar") return null;
  return {
    error: e.pin,
    autorizacion: {
      motivo: "sin_cobrar",
      monto: Number(e.pinMonto ?? 0),
      pinIncorrecto: e.pinIncorrecto === "si",
      sinAdmins: e.pinSinAdmins === "si" || undefined,
      conClave: e.pinConClave === "si" || undefined,
      bloqueadoHasta: e.pinHasta,
    },
  };
}

/** Anula un remito y devuelve la mercadería al stock. */
export async function anularRemito(
  _previo: EstadoEntrega,
  formData: FormData,
): Promise<EstadoEntrega> {
  const deliveryId = String(formData.get("deliveryId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");

  if (!deliveryId) return { error: "Falta el remito." };

  // Un remito firmado pide por qué y el PIN de un admin (Go, entregas).
  const motivo = String(formData.get("motivo") ?? "").trim();
  const pin = String(formData.get("pin") ?? "").trim();
  const r = await (await api()).POST("/api/v1/admin/remitos/{id}/anular", {
    params: { path: { id: deliveryId } },
    body: { ...(motivo ? { motivo } : {}), ...(pin ? { pin } : {}) },
  });
  if (!r.data) {
    const e = (r.error as Problema | undefined)?.errores;
    if (e?.pin) {
      return {
        error: e.pin,
        autorizacion: {
          motivo: "remito",
          monto: 0,
          pinIncorrecto: e.pinIncorrecto === "si",
          bloqueadoHasta: e.pinHasta,
        },
      };
    }
    if (e?.motivo) return { error: e.motivo, campo: "motivo" };
    return { error: mensajeDe(r.error as Problema | undefined) };
  }

  revalidatePath(`/admin/pedidos/${orderId}`);
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/reparto");
  revalidatePath("/admin/stock");

  return { ok: r.data.ok };
}
