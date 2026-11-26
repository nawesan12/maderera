import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PackagePlus, Plus } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { listarRecepciones, ordenesPorRecibir } from "@/lib/dal/admin/recepciones";
import { fechaCorta, formatearMonto, plural } from "@/lib/formato";
import { PorRecibir } from "./por-recibir";

export const metadata: Metadata = { title: "Recepciones" };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "estado-espera" },
  confirmada: { texto: "Confirmada", clase: "estado-ok" },
  anulada: { texto: "Anulada", clase: "estado-problema" },
};

/**
 * La mercadería que entró, y la que se espera.
 *
 * Una recepción en borrador no tocó nada todavía: ni el stock ni el costo.
 * Confirmar es el acto que mueve las dos cosas.
 *
 * La recibe quien baja el camión: también el depósito (mes simulado, H097),
 * que no ve precios. Arriba, las órdenes que se esperan, con el remito a
 * mano; cargar una recepción suelta, con sus costos, queda para el admin.
 */
export default async function RecepcionesPage() {
  const usuario = await requireStaff();
  if (!puedeEntrar("/admin/recepciones", usuario.staffRole)) notFound();
  const veCostos = puedeEntrar("/admin/recepciones/nueva", usuario.staffRole);

  const [recepciones, esperadas] = await Promise.all([listarRecepciones(), ordenesPorRecibir()]);
  const borradores = recepciones.filter((r) => r.estado === "borrador").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[26px] font-bold tracking-tight">Recepciones</h1>
        {veCostos && (
          <Link
            href="/admin/recepciones/nueva"
            className="boton-accion inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-base font-medium"
          >
            <Plus className="h-4 w-4" />
            Nueva recepción
          </Link>
        )}
      </header>

      {esperadas.length > 0 && <PorRecibir ordenes={esperadas} />}

      {borradores > 0 && (
        <p className="estado-espera rounded-xl bg-[var(--estado-fondo)] px-4 py-3 text-base">
          {plural(borradores, "recepción en borrador", "recepciones en borrador")}: todavía no entró al stock.
        </p>
      )}

      <section className="tarjeta @container overflow-hidden">
        {recepciones.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <PackagePlus className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-base text-muted-foreground">Todavía no se cargó ninguna recepción.</p>
          </div>
        ) : (
          <>
            <table className="hidden w-full text-base @4xl:table" data-tabla="fija">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Fecha</th>
                  <th className="px-5 py-2.5 font-semibold">Proveedor</th>
                  <th className="px-5 py-2.5 font-semibold">Remito</th>
                  <th className="px-5 py-2.5 font-semibold">Sucursal</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Renglones</th>
                  {veCostos && <th className="px-5 py-2.5 text-right font-semibold">Neto</th>}
                  <th className="px-5 py-2.5 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {recepciones.map((r) => (
                  <tr key={r.id} className="hover:bg-hundida">
                    <td className="tabular px-5 py-3 text-muted-foreground">{fechaCorta.format(r.fecha)}</td>
                    <td className="px-5 py-3">
                      <Link href={`/admin/recepciones/${r.id}`} className="font-semibold hover:underline">
                        {r.proveedor}
                      </Link>
                    </td>
                    <td className="codigo px-5 py-3 text-muted-foreground">{r.numeroRemito ?? "—"}</td>
                    <td className="px-5 py-3 text-muted-foreground">{r.sucursal ?? "—"}</td>
                    <td className="tabular px-5 py-3 text-right">{r.lineas}</td>
                    {veCostos && <td className="tabular px-5 py-3 text-right font-semibold">{formatearMonto(r.neto)}</td>}
                    <td className="px-5 py-3">
                      <Estado estado={r.estado} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* En el teléfono, tres renglones: el proveedor con el estado, el
                remito, y la sucursal con la fecha y el neto. */}
            <ul className="divide-y divide-linea @4xl:hidden">
              {recepciones.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/recepciones/${r.id}`} className="block space-y-1 px-4 py-3 hover:bg-hundida">
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[17px] font-semibold">{r.proveedor}</span>
                      <Estado estado={r.estado} />
                    </span>
                    <span className="codigo block truncate text-base text-muted-foreground">
                      {r.numeroRemito ? `Remito ${r.numeroRemito}` : "Sin remito"}
                    </span>
                    <span className="tabular flex items-baseline justify-between gap-3 text-base text-muted-foreground">
                      <span className="min-w-0 truncate">
                        {r.sucursal ?? "—"} · {fechaCorta.format(r.fecha)}
                      </span>
                      {veCostos && <span className="shrink-0 font-semibold text-foreground">{formatearMonto(r.neto)}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Estado({ estado }: { estado: string }) {
  const e = ESTADOS[estado] ?? ESTADOS.borrador;
  return (
    <span className={`${e.clase} inline-flex shrink-0 items-center rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold`}>
      {e.texto}
    </span>
  );
}
