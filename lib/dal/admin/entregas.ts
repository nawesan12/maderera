import "server-only";

import { api, apiInterna, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * Lectura de remitos. La hace la API de Go (backend/internal/entregas); acá
 * quedan los envoltorios con los nombres y la forma de siempre (las fechas
 * como Date).
 */

type ListadoCrudo = Esquemas["RemitoDelPedido"];

export interface RemitoListado extends Omit<ListadoCrudo, "firmadoAt" | "createdAt"> {
  firmadoAt: Date | null;
  createdAt: Date;
}

/** Los remitos de un pedido, los más nuevos primero (quien entra a la ficha). */
export async function remitosDelPedido(orderId: string): Promise<RemitoListado[]> {
  const filas = datos(
    await (await api()).GET("/api/v1/admin/pedidos/{id}/remitos", { params: { path: { id: orderId } } }),
  );
  return filas.map((f) => ({
    ...f,
    firmadoAt: f.firmadoAt ? new Date(f.firmadoAt) : null,
    createdAt: new Date(f.createdAt),
  }));
}

type Crudo = Esquemas["RemitoCompleto"];
type FacturaCruda = NonNullable<Crudo["factura"]>;

/**
 * Un remito completo, para imprimirlo o mostrarlo: las líneas, lo que quedó
 * en acopio **en el momento de este remito** (lo que lo hace «de entrega
 * parcial» o «total») y la factura con su CAE, si la hay.
 */
export interface RemitoCompleto extends Omit<Crudo, "firmadoAt" | "createdAt" | "factura"> {
  firmadoAt: Date | null;
  createdAt: Date;
  factura: (Omit<FacturaCruda, "caeVencimiento"> & { caeVencimiento: Date | null }) | null;
}

function conFechas(r: Crudo): RemitoCompleto {
  return {
    ...r,
    firmadoAt: r.firmadoAt ? new Date(r.firmadoAt) : null,
    createdAt: new Date(r.createdAt),
    factura: r.factura
      ? { ...r.factura, caeVencimiento: r.factura.caeVencimiento ? new Date(r.factura.caeVencimiento) : null }
      : null,
  };
}

/**
 * Un remito completo. No verifica sesión: lo usan el panel, la hoja del
 * portal, los avisos y WhatsApp, y cada uno decide antes quién lo ve. Por eso
 * va con el secreto interno.
 */
export async function remitoCompleto(deliveryId: string): Promise<RemitoCompleto | null> {
  const r = await apiInterna.GET("/api/v1/remitos/{id}", { params: { path: { id: deliveryId } } });
  if (r.response.status === 404) return null;
  return conFechas(datos(r));
}

/** Remito buscado por su token de firma. Es lo único que conoce quien firma. */
export async function remitoPorToken(token: string): Promise<RemitoCompleto | null> {
  const r = await apiInterna.GET("/api/v1/firmar/{token}", { params: { path: { token } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  return conFechas(datos(r));
}

/** Lo que necesitan los avisos de entrega: el enlace de firma y a quién escribirle. */
export async function remitoParaAvisar(deliveryId: string): Promise<Esquemas["RemitoParaAvisar"] | null> {
  const r = await apiInterna.GET("/api/v1/remitos/{id}/aviso", { params: { path: { id: deliveryId } } });
  if (r.response.status === 404) return null;
  return datos(r);
}
