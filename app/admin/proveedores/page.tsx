import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { listarProveedores } from "@/lib/dal/admin/proveedores";
import { formatearMonto, haceCuanto } from "@/lib/formato";
import { BuscadorDeProveedores } from "./buscador";
import { DialogoProveedor } from "./dialogo";

export const metadata: Metadata = { title: "Proveedores" };

/**
 * Los proveedores y lo que se les debe.
 *
 * **El signo va al revés que en clientes**: acá el rojo es lo que la maderera
 * debe, no lo que le deben. Se usan los mismos tokens de color a propósito —el
 * rojo siempre significa "plata que falta de este lado"— porque inventar una
 * segunda gramática de color para la misma idea es lo que hace que nadie
 * confíe en ninguna de las dos.
 */
export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string }>;
}) {
  await requireStaffRole("admin");

  const { q, estado } = await searchParams;
  const proveedores = await listarProveedores({ busqueda: q, estado });

  const deuda = proveedores.reduce((t, p) => t + Math.max(0, p.saldo), 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Proveedores</h1>
          <p className="mt-1 text-base text-muted-foreground">
            A quién se le compra y cuánto se le debe hoy.
          </p>
        </div>
        <DialogoProveedor />
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <article className="tarjeta p-4">
          <p className="text-sm text-muted-foreground">Deuda total</p>
          <p className="tabular mt-0.5 text-2xl font-bold text-saldo-debe">
            {formatearMonto(deuda)}
          </p>
        </article>
        <article className="tarjeta p-4">
          <p className="text-sm text-muted-foreground">Proveedores activos</p>
          <p className="tabular mt-0.5 text-2xl font-bold">
            {proveedores.filter((p) => p.estado === "activo").length}
          </p>
        </article>
      </section>

      <BuscadorDeProveedores />

      <section className="tarjeta overflow-hidden">
        {proveedores.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Truck className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-base text-muted-foreground">
              {q
                ? "Ningún proveedor coincide con esa búsqueda."
                : "Todavía no hay proveedores cargados."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Proveedor</th>
                  <th className="px-5 py-2.5 font-semibold">Contacto</th>
                  <th className="px-5 py-2.5 font-semibold">Rubro</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Pago</th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    Se le debe
                  </th>
                  <th className="px-5 py-2.5 font-semibold">Último mov.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {proveedores.map((p) => (
                  <tr key={p.id} className="hover:bg-hundida">
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/proveedores/${p.id}`}
                        className="font-semibold hover:underline"
                      >
                        {p.nombre}
                      </Link>
                      {p.estado === "inactivo" && (
                        <span className="ml-2 text-sm text-muted-foreground">
                          (inactivo)
                        </span>
                      )}
                      {p.cuit && (
                        <p className="tabular text-sm text-muted-foreground">
                          {p.cuit}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {p.contacto ?? "—"}
                      {p.telefono && (
                        <p className="tabular text-sm">{p.telefono}</p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {p.rubro ?? "—"}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-muted-foreground">
                      {p.diasPago === 0 ? "contado" : `${p.diasPago} días`}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {/* Positivo es lo que le debemos: el espejo del libro de
                          clientes, con el mismo rojo para "plata que falta de
                          este lado". */}
                      <span
                        className={`tabular font-semibold ${
                          p.saldo > 0.005
                            ? "text-saldo-debe"
                            : p.saldo < -0.005
                              ? "text-saldo-favor"
                              : "text-saldo-cero"
                        }`}
                      >
                        {formatearMonto(p.saldo)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {p.ultimoMovimiento
                        ? haceCuanto(new Date(p.ultimoMovimiento))
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
