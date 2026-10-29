"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

/*
 * La ficha y la cuenta del proveedor. Las valida y las guarda la API de Go
 * (backend/internal/compras), con los mismos mensajes que daban los esquemas
 * de zod de acá.
 */

export interface EstadoProveedor {
  error?: string;
  ok?: string;
  /** El id recién creado, para poder ir a la ficha sin buscarlo. */
  id?: string;
}

export interface DatosProveedor {
  id?: string;
  nombre: string;
  razonSocial?: string;
  cuit?: string;
  condicionIva: "responsable_inscripto" | "monotributista" | "exento" | "consumidor_final" | "no_categorizado";
  contacto?: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  rubro?: string;
  cbu?: string;
  aliasCbu?: string;
  diasPago: number | string;
  notas?: string;
}

function refrescar(id?: string) {
  revalidatePath("/admin/proveedores");
  if (id) revalidatePath(`/admin/proveedores/${id}`);
}

/** Alta y edición de la ficha, en una sola acción. */
export async function guardarProveedor(datos: DatosProveedor): Promise<EstadoProveedor> {
  const r = await (await api()).POST("/api/v1/admin/proveedores", { body: { ...datos } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  refrescar(r.data.id);
  return { ok: r.data.ok, id: r.data.id };
}

/** Un movimiento de la cuenta: el signo lo pone el tipo, no quien carga. */
export async function registrarMovimientoDeProveedor(datos: {
  supplierId: string;
  tipo: "factura" | "pago" | "nota_credito" | "nota_debito" | "ajuste";
  monto: number;
  detalle?: string;
  referencia?: string;
}): Promise<EstadoProveedor> {
  const { supplierId, ...resto } = datos;
  const r = await (await api()).POST("/api/v1/admin/proveedores/{id}/movimientos", {
    params: { path: { id: supplierId } },
    body: { ...resto },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Revisá los datos.") };
  refrescar(supplierId);
  return { ok: r.data.ok };
}

/** Da de baja al proveedor: queda inactivo, no se borra. */
export async function darDeBajaProveedor(id: string): Promise<EstadoProveedor> {
  const r = await (await api()).POST("/api/v1/admin/proveedores/{id}/baja", { params: { path: { id } } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "Ese proveedor no existe.") };
  refrescar(id);
  return { ok: r.data.ok };
}
