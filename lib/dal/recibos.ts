import "server-only";

import { apiInterna, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * Un recibo con sus partes, para el PDF y los avisos. Lo lee la API de Go
 * (backend/internal/cobros/lecturas.go) con el secreto interno: **quien llama
 * ya decidió que se puede ver** (la ruta del PDF mira de quién es; la cola y
 * WhatsApp mandan el recibo a su dueño).
 */

type Crudo = Esquemas["Recibo"];
type ParteCruda = Crudo["partes"][number];

export interface ParteDelRecibo extends Omit<ParteCruda, "cheque"> {
  cheque: (Omit<NonNullable<ParteCruda["cheque"]>, "fechaPago"> & { fechaPago: Date }) | null;
}

export interface ReciboCompleto extends Omit<Crudo, "fecha" | "anuladoAt" | "partes"> {
  fecha: Date;
  anuladoAt: Date | null;
  partes: ParteDelRecibo[];
}

export async function reciboCompleto(id: string): Promise<ReciboCompleto | null> {
  const r = await apiInterna.GET("/api/v1/recibos/{id}", { params: { path: { id } } });
  if (r.response.status === 404 || r.response.status === 400) return null;
  const d = datos(r);
  return {
    ...d,
    fecha: new Date(d.fecha),
    anuladoAt: d.anuladoAt ? new Date(d.anuladoAt) : null,
    partes: d.partes.map((p) => ({ ...p, cheque: p.cheque ? { ...p.cheque, fechaPago: new Date(p.cheque.fechaPago) } : null })),
  };
}

/** El cliente del recibo: null si se emitió sin ficha, undefined si no existe. */
export async function clienteDelRecibo(id: string): Promise<string | null | undefined> {
  const r = await reciboCompleto(id);
  return r ? (r.cliente?.id ?? null) : undefined;
}
