import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import { obtenerRecepcion } from "@/lib/dal/admin/recepciones";
import { formatearMonto } from "@/lib/formato";
import { AccionesDeRecepcion } from "./acciones";

export const metadata: Metadata = { title: "Recepción" };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "estado-espera" },
  confirmada: { texto: "Confirmada", clase: "estado-ok" },
  anulada: { texto: "Anulada", clase: "estado-problema" },
};

/**
 * El detalle de una recepción, con la cuenta del costo a la vista.
 *
 * Una vez confirmada, cada renglón muestra los cuatro números que explican la
 * mezcla: cuánto había y a cuánto, cuánto costó lo que entró con el flete
 * adentro, y con qué costo quedó. Es lo que permite auditar esto dentro de ocho
 * meses sin rehacer la historia, que es justamente lo que no se puede hacer
 * porque el promedio ponderado no es reversible.
 */
export default async function RecepcionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaffRole("admin");

  const { id } = await params;
  const recepcion = await obtenerRecepcion(id);
  if (!recepcion) notFound();

  const estado = ESTADOS[recepcion.estado] ?? ESTADOS.borrador;
  const confirmada = recepcion.estado === "confirmada";

  const neto = recepcion.items.reduce(
    (t, i) => t + Number(i.cantidad) * Number(i.costoUnitario),
    0,
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/recepciones"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Recepciones
        </Link>

        <header className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">
              {recepcion.proveedor}
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              {[
                recepcion.numeroRemito
                  ? `Remito ${recepcion.numeroRemito}`
                  : "Sin remito",
                recepcion.sucursal,
                new Date(recepcion.fecha).toLocaleDateString("es-AR"),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <span
            className={`${estado.clase} inline-flex items-center rounded-lg bg-[var(--estado-fondo)] px-3 py-1.5 text-base font-semibold`}
          >
            {estado.texto}
          </span>
        </header>
      </div>

      {recepcion.estado === "borrador" && (
        <p className="estado-espera rounded-xl bg-[var(--estado-fondo)] px-4 py-3 text-base">
          Todavía no tocó nada. Al confirmar entra el stock, se mezcla el costo
          promedio y sube la deuda con el proveedor.{" "}
          <strong>El costo promedio no se puede revertir después.</strong>
        </p>
      )}

      <section className="tarjeta overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-base">
            <thead>
              <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">Mercadería</th>
                <th className="px-4 py-2.5 text-right font-semibold">Cant.</th>
                <th className="px-4 py-2.5 text-right font-semibold">Costo</th>
                <th className="px-4 py-2.5 text-right font-semibold">IVA</th>
                {confirmada && (
                  <>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      Con flete
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      Venía a
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold">
                      Quedó en
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {recepcion.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2.5">
                    {i.producto} {i.variante}
                    {i.sku && (
                      <span className="tabular block text-sm text-muted-foreground">
                        {i.sku}
                      </span>
                    )}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right">
                    {Number(i.cantidad)}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right">
                    {formatearMonto(Number(i.costoUnitario))}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-muted-foreground">
                    {Number(i.alicuotaIva)}%
                  </td>
                  {confirmada && (
                    <>
                      <td className="tabular px-4 py-2.5 text-right">
                        {i.costoConGastos
                          ? formatearMonto(Number(i.costoConGastos))
                          : "—"}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-muted-foreground">
                        {i.costoAnterior
                          ? formatearMonto(Number(i.costoAnterior))
                          : "—"}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right font-semibold">
                        {i.costoResultante
                          ? formatearMonto(Number(i.costoResultante))
                          : "—"}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-linea">
              <tr>
                <td className="px-4 py-2.5 text-muted-foreground" colSpan={3}>
                  Mercadería
                </td>
                <td
                  className="tabular px-4 py-2.5 text-right font-semibold"
                  colSpan={confirmada ? 4 : 1}
                >
                  {formatearMonto(neto)}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-muted-foreground" colSpan={3}>
                  Flete y gastos
                </td>
                <td
                  className="tabular px-4 py-2.5 text-right"
                  colSpan={confirmada ? 4 : 1}
                >
                  {formatearMonto(Number(recepcion.gastos))}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-semibold" colSpan={3}>
                  Neto total
                </td>
                <td
                  className="tabular px-4 py-3 text-right text-lg font-bold"
                  colSpan={confirmada ? 4 : 1}
                >
                  {formatearMonto(neto + Number(recepcion.gastos))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {recepcion.notas && (
        <p className="text-base text-muted-foreground">{recepcion.notas}</p>
      )}

      <AccionesDeRecepcion id={recepcion.id} estado={recepcion.estado} />
    </div>
  );
}
