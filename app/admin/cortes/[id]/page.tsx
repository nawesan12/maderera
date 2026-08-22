import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Flame } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { ETAPAS_CORTE, Pasos } from "@/components/admin/pasos";
import { fechaHora, plural } from "@/components/admin/formato";
import { obtenerCorte } from "@/lib/dal/admin/cortes";
import { AccionesCorte } from "../acciones";

export default async function FichaCortePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const corte = await obtenerCorte(id);

  if (!corte) notFound();

  const totalPiezas = corte.piezas.reduce((s, p) => s + p.cantidad, 0);
  const superficie =
    corte.piezas.reduce(
      (s, p) => s + (p.largoMm * p.anchoMm * p.cantidad) / 1_000_000,
      0,
    ) ?? 0;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/cortes"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a cortes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {corte.cliente}
            </h1>
            <EtiquetaEstado estado={corte.estado} />
            {corte.urgente && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-orange/15 px-2.5 py-1 text-sm font-medium text-brand-orange-dark">
                <Flame className="h-4 w-4" />
                Urgente
              </span>
            )}
          </div>
          <p className="mt-0.5 text-base text-muted-foreground">
            <span className="tabular">{corte.numero}</span>
            {corte.empresa && ` · ${corte.empresa}`}
            {` · ${corte.sucursal} · ${fechaHora.format(corte.createdAt)}`}
          </p>
        </div>

        <AccionesCorte
          id={corte.id}
          estado={corte.estado}
          urgente={corte.urgente}
        />
      </div>

      <section className="tarjeta p-5">
        <Pasos etapas={ETAPAS_CORTE} actual={corte.estado} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <section className="tarjeta overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 px-5 py-4">
            <h2 className="text-base font-medium">Despiece</h2>
            <p className="text-base text-muted-foreground">
              {plural(corte.piezas.length, "medida")} · {totalPiezas} piezas
            </p>
          </div>

          <table className="w-full border-t">
            <thead>
              <tr className="border-b text-left">
                <th className="px-5 py-3 text-sm font-medium text-muted-foreground">
                  Medida
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Cantidad
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Superficie
                </th>
                <th className="px-5 py-3 text-sm font-medium text-muted-foreground">
                  Detalle
                </th>
              </tr>
            </thead>
            <tbody>
              {corte.piezas.map((pieza) => (
                <tr key={pieza.id} className="border-b last:border-0">
                  <td className="tabular px-5 py-3.5 text-base">
                    {pieza.largoMm} × {pieza.anchoMm} mm
                  </td>
                  <td className="tabular px-4 py-3.5 text-right text-base">
                    {pieza.cantidad}
                  </td>
                  <td className="tabular px-4 py-3.5 text-right text-base text-muted-foreground">
                    {(
                      (pieza.largoMm * pieza.anchoMm * pieza.cantidad) /
                      1_000_000
                    ).toFixed(2)}{" "}
                    m²
                  </td>
                  <td className="px-5 py-3.5 text-base text-muted-foreground">
                    {[
                      pieza.respetaVeta === 1 ? "Respeta veta" : null,
                      pieza.cantoLargo === 1 ? "Canto al largo" : null,
                      pieza.cantoAncho === 1 ? "Canto al ancho" : null,
                      pieza.etiqueta,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40">
              <tr>
                <td className="px-5 py-4 text-base font-medium">Total</td>
                <td className="tabular px-4 py-4 text-right text-base font-medium">
                  {totalPiezas}
                </td>
                <td className="tabular px-4 py-4 text-right text-base font-medium">
                  {superficie.toFixed(2)} m²
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </section>

        <aside className="space-y-4">
          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Material
            </h2>
            <p className="text-base">{corte.material}</p>
            <p className="mt-1 text-base text-muted-foreground">
              {plural(corte.placas, "placa")} a cortar
            </p>
          </section>

          {corte.notas && (
            <section className="tarjeta p-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Indicaciones
              </h2>
              <p className="text-base text-muted-foreground">{corte.notas}</p>
            </section>
          )}

          {corte.customerId && (
            <section className="tarjeta p-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Cliente
              </h2>
              <Link
                href={`/admin/clientes/${corte.customerId}`}
                className="text-base font-medium hover:text-brand-orange"
              >
                {corte.cliente}
              </Link>
            </section>
          )}

          <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
            Las medidas están en milímetros y listas para exportar al optimizador
            cuando se conecte la máquina.
          </p>
        </aside>
      </div>
    </div>
  );
}
