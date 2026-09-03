import type { Metadata } from "next";
import Link from "next/link";
import { PackagePlus, Plus } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { listarRecepciones } from "@/lib/dal/admin/recepciones";
import { formatearMonto } from "@/lib/formato";

export const metadata: Metadata = { title: "Recepciones" };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "estado-espera" },
  confirmada: { texto: "Confirmada", clase: "estado-ok" },
  anulada: { texto: "Anulada", clase: "estado-problema" },
};

/**
 * La mercadería que entró.
 *
 * Una recepción en borrador no tocó nada todavía: ni el stock ni el costo.
 * Confirmar es el acto que mueve las dos cosas, y el listado lo marca porque la
 * diferencia importa —el costo promedio no se puede revertir—.
 */
export default async function RecepcionesPage() {
  await requireStaffRole("admin");

  const recepciones = await listarRecepciones();
  const borradores = recepciones.filter((r) => r.estado === "borrador").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Recepciones</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Lo que entró al depósito, con el costo que trajo.
          </p>
        </div>
        <Link
          href="/admin/recepciones/nueva"
          className="inline-flex h-11 items-center gap-1.5 rounded-lg boton-accion px-4 text-base font-medium transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nueva recepción
        </Link>
      </header>

      {borradores > 0 && (
        <p className="estado-espera rounded-xl bg-[var(--estado-fondo)] px-4 py-3 text-base">
          {borradores} recepci{borradores > 1 ? "ones" : "ón"} en borrador: la
          mercadería todavía no entró al stock ni movió el costo.
        </p>
      )}

      <section className="tarjeta overflow-hidden">
        {recepciones.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <PackagePlus className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-base text-muted-foreground">
              Todavía no se cargó ninguna recepción.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Fecha</th>
                  <th className="px-5 py-2.5 font-semibold">Proveedor</th>
                  <th className="px-5 py-2.5 font-semibold">Remito</th>
                  <th className="px-5 py-2.5 font-semibold">Sucursal</th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    Renglones
                  </th>
                  <th className="px-5 py-2.5 text-right font-semibold">Neto</th>
                  <th className="px-5 py-2.5 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {recepciones.map((r) => {
                  const estado = ESTADOS[r.estado] ?? ESTADOS.borrador;
                  return (
                    <tr key={r.id} className="hover:bg-hundida">
                      <td className="tabular px-5 py-3 text-muted-foreground">
                        {new Date(r.fecha).toLocaleDateString("es-AR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                        })}
                      </td>
                      <td className="px-5 py-3">
                        <Link
                          href={`/admin/recepciones/${r.id}`}
                          className="font-semibold hover:underline"
                        >
                          {r.proveedor}
                        </Link>
                      </td>
                      <td className="tabular px-5 py-3 text-muted-foreground">
                        {r.numeroRemito ?? "—"}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {r.sucursal ?? "—"}
                      </td>
                      <td className="tabular px-5 py-3 text-right">
                        {r.lineas}
                      </td>
                      <td className="tabular px-5 py-3 text-right font-semibold">
                        {formatearMonto(r.neto)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`${estado.clase} inline-flex items-center rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold`}
                        >
                          {estado.texto}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
