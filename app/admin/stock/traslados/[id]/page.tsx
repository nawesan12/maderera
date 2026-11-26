import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { fechaHora } from "@/components/admin/formato";
import { verTraslado } from "@/lib/dal/admin/inventory";
import { formatearUnidad } from "@/lib/formato";
import { formatearCantidad } from "@/lib/unidades";
import { esUuid } from "@/lib/uuid";
import { AccionesDelTraslado } from "./acciones";

/**
 * El comprobante de un traslado entre sucursales: el remito interno que viaja
 * con el camión y firma quien recibe (mes simulado, H009). Mientras esté en
 * camino, «Recibir» suma lo que llegó al destino.
 *
 * Se imprime tal como se ve: `.hoja-sola` le saca al panel el menú y la
 * barra en el papel (globals.css).
 */
export default async function TrasladoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const t = await verTraslado(id);
  if (!t) notFound();

  return (
    <div className="hoja-sola mx-auto max-w-3xl space-y-6">
      <Link
        href="/admin/stock"
        className="no-imprimir inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Stock
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1>
            Traslado <span className="codigo">{t.codigo}</span>
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold">
            <span>{t.origen}</span>
            <ArrowRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">a</span>
            <span>{t.destino}</span>
          </p>
          <p className="tabular mt-1 text-base text-muted-foreground">
            {fechaHora.format(t.createdAt)}
            {t.creadoPor && ` · ${t.creadoPor}`}
          </p>
        </div>
        <EtiquetaEstado estado={t.estado} />
      </header>

      <AccionesDelTraslado id={t.id} enCamino={t.estado === "en-camino"} destino={t.destino} />

      <section className="tarjeta overflow-hidden">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b text-left text-sm text-muted-foreground">
              <th className="px-4 py-3 font-medium">Producto</th>
              <th className="px-4 py-3 font-medium">Código</th>
              <th className="px-4 py-3 text-right font-medium">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {t.renglones.map((r) => (
              <tr key={r.variantId} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3">
                  <span className="font-medium">{r.producto}</span>
                  <span className="text-muted-foreground"> · {r.medida}</span>
                </td>
                <td className="tabular px-4 py-3 text-muted-foreground">{r.sku}</td>
                <td className="tabular px-4 py-3 text-right text-lg font-semibold">
                  {formatearCantidad(r.cantidad)} <span className="text-base font-normal text-muted-foreground">{formatearUnidad(r.unidad)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {t.nota && <p className="text-base">{t.nota}</p>}

      {/* Las dos firmas: la del que despacha y la del que recibe. */}
      <section className="grid gap-6 pt-6 sm:grid-cols-2">
        {[
          { quien: "Entregó", sucursal: t.origen, nombre: t.creadoPor, cuando: t.createdAt },
          {
            quien: "Recibió",
            sucursal: t.destino,
            nombre: t.recibidoPor,
            cuando: t.recibidoAt,
          },
        ].map((f) => (
          <div key={f.quien}>
            <div className="h-16 border-b border-foreground/40" aria-hidden="true" />
            <p className="mt-2 text-base font-medium">
              {f.quien} · {f.sucursal}
            </p>
            {f.cuando && (
              <p className="tabular text-sm text-muted-foreground">
                {f.nombre && `${f.nombre} · `}
                {fechaHora.format(f.cuando)}
              </p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
