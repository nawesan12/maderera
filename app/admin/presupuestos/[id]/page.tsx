import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { fechaCorta, moneda } from "@/components/admin/formato";
import { obtenerPresupuesto } from "@/lib/dal/admin/ventas";
import { AccionesPresupuesto } from "../acciones";

export default async function FichaPresupuestoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const p = await obtenerPresupuesto(id);

  if (!p) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/admin/presupuestos"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a presupuestos
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="tabular text-2xl font-semibold tracking-tight">
              {p.numero}
            </h1>
            <EtiquetaEstado estado={p.estado} />
          </div>
          <p className="mt-0.5 text-base text-muted-foreground">
            {fechaCorta.format(p.createdAt)}
            {p.validoHasta && ` · vale hasta ${fechaCorta.format(p.validoHasta)}`}
            {p.sucursal && ` · ${p.sucursal}`}
          </p>
        </div>
        <AccionesPresupuesto id={p.id} estado={p.estado} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className="tarjeta overflow-hidden">
          <h2 className="px-5 py-4 text-base font-medium">Detalle</h2>
          <table className="w-full border-t">
            <thead>
              <tr className="border-b text-left">
                <th className="px-5 py-3 text-sm font-medium text-muted-foreground">
                  Producto
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Cantidad
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Unitario
                </th>
                <th className="px-5 py-3 text-right text-sm font-medium text-muted-foreground">
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody>
              {p.items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-5 py-3.5 text-base">{item.descripcion}</td>
                  <td className="tabular px-4 py-3.5 text-right text-base text-muted-foreground">
                    {Number(item.cantidad)} {item.unidad.replace("_", " ")}
                  </td>
                  <td className="tabular px-4 py-3.5 text-right text-base text-muted-foreground">
                    {moneda.format(Number(item.precioUnitario))}
                  </td>
                  <td className="tabular px-5 py-3.5 text-right text-base">
                    {moneda.format(Number(item.subtotal))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40">
                <td colSpan={3} className="px-5 py-4 text-base font-medium">
                  Total
                </td>
                <td className="tabular px-5 py-4 text-right text-xl font-semibold">
                  {moneda.format(Number(p.total))}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <aside className="space-y-4">
          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Cliente
            </h2>
            {p.customerId ? (
              <Link
                href={`/admin/clientes/${p.customerId}`}
                className="text-base font-medium hover:text-brand-orange"
              >
                {p.cliente}
              </Link>
            ) : (
              <p className="text-base font-medium">{p.cliente}</p>
            )}
            {p.empresa && (
              <p className="text-base text-muted-foreground">{p.empresa}</p>
            )}
            <dl className="mt-3 space-y-1.5 text-base">
              {p.email && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Correo</dt>
                  <dd className="truncate">{p.email}</dd>
                </div>
              )}
              {p.telefono && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Teléfono</dt>
                  <dd className="tabular">{p.telefono}</dd>
                </div>
              )}
              {p.asesor && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Asesor</dt>
                  <dd>{p.asesor}</dd>
                </div>
              )}
            </dl>
          </section>

          {p.notas && (
            <section className="tarjeta p-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Notas
              </h2>
              <p className="text-base text-muted-foreground">{p.notas}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
