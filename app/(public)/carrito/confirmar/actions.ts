"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { avisarPedidoNuevo } from "@/lib/dal/existencia";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { enlaceDeSeguimiento } from "@/lib/seguimiento";
import { ETIQUETAS } from "@/lib/cache-publico";

export interface EstadoDeCompra {
  error?: string;
  /** Número del pedido creado, para la pantalla de confirmación. */
  numero?: string;
}

/**
 * Cierra la compra y crea el pedido.
 *
 * Lo hace Go (backend/internal/checkout, tanda 6) en una transacción: el
 * número, las líneas con los precios de la base (nunca del formulario), los
 * cortes recalculados y mandados al taller, el costo congelado, la deuda si
 * es a cuenta corriente, la mercadería reservada, el carrito desactivado y el acuse encolado (el
 * correo, el WhatsApp y la venta nueva al panel los manda su worker).
 * Con el mismo freno por IP y correo, y con el carrito bloqueado: dos clics
 * en «Confirmar» hacen un pedido.
 *
 * Acá queda lo que es de Next: invalidar el catálogo (la disponibilidad
 * cambió), avisar que el seguimiento existe y la redirección.
 */
export async function confirmarCompra(
  _previo: EstadoDeCompra,
  formData: FormData,
): Promise<EstadoDeCompra> {
  const r = await (await api()).POST("/api/v1/carrito/confirmar", {
    body: {
      nombre: formData.get("nombre"),
      email: formData.get("email"),
      telefono: formData.get("telefono"),
      entrega: formData.get("entrega"),
      sucursalId: (formData.get("sucursalId") as string) || undefined,
      zonaId: (formData.get("zonaId") as string) || undefined,
      direccion: (formData.get("direccion") as string) || undefined,
      medioPago: formData.get("medioPago"),
      notas: (formData.get("notas") as string) || undefined,
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };

  const { numero, token } = r.data;

  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/carrito");
  revalidatePath("/admin/pedidos");
  // El seguimiento al que se va a redirigir tiene que existir aunque alguien
  // haya pedido ese número antes de que lo hubiera (ver `avisarPedidoNuevo`).
  avisarPedidoNuevo(numero);

  // El token va en la URL: el número no autoriza nada.
  redirect(enlaceDeSeguimiento(numero, token));
}

/** Saca del presupuesto los productos que todavía no tienen precio cargado. */
export async function quitarLosQueSeCotizan(): Promise<void> {
  await (await api()).POST("/api/v1/carrito/sin-precio");
  revalidatePath("/carrito/confirmar");
  revalidatePath("/carrito");
}
