import "server-only";

import { api, datos } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";

/**
 * La conciliación del panel. La arma Go (backend/internal/pagos, tanda 6) en
 * un solo pedido: los cobros del período, el resumen, los últimos avisos y
 * los datos bancarios. El período se resuelve en hora argentina.
 */

export type PagoListado = Omit<Esquemas["CobroListado"], "createdAt" | "acreditadoAt"> & {
  createdAt: Date;
  acreditadoAt: Date | null;
};
export type ResumenPagos = Esquemas["ResumenPagos"];
export type AvisoListado = Omit<Esquemas["AvisoDePago"], "createdAt" | "procesadoAt"> & {
  createdAt: Date;
  procesadoAt: Date | null;
};
export type DatosBancariosDelPanel = NonNullable<Esquemas["DatosBancariosDelPanel"]>;

export async function panelDePagos(periodo: string, estado?: string) {
  const p = datos(
    await (await api()).GET("/api/v1/admin/pagos", { params: { query: { periodo, ...(estado ? { estado } : {}) } } }),
  );
  return {
    pagos: p.pagos.map(
      (x): PagoListado => ({
        ...x,
        createdAt: new Date(x.createdAt),
        acreditadoAt: x.acreditadoAt ? new Date(x.acreditadoAt) : null,
      }),
    ),
    resumen: p.resumen,
    avisos: p.avisos.map(
      (a): AvisoListado => ({
        ...a,
        createdAt: new Date(a.createdAt),
        procesadoAt: a.procesadoAt ? new Date(a.procesadoAt) : null,
      }),
    ),
    datosBancarios: (p.datosBancarios ?? null) as DatosBancariosDelPanel | null,
  };
}
