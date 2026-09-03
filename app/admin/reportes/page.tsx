import { Suspense } from "react";
import { Download } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { FiltroPeriodo } from "@/components/admin/filtro-periodo";
import { formatearMonto, plural } from "@/components/admin/formato";
import {
  CORTES,
  leerCorte,
  reporteDeVentas,
} from "@/lib/dal/admin/reportes";
import { leerPeriodo, resolverPeriodo } from "@/lib/periodos";
import { requireStaff } from "@/lib/dal/session";
import { ElegirCorte } from "./elegir-corte";

export const metadata = { title: "Reportes" };

/**
 * Los números de venta, cortados por donde se los mira.
 *
 * El resumen del panel contesta "cómo venimos". Acá están las preguntas que
 * vienen después —qué se vende, quién compra, quién vende, dónde— que hasta
 * ahora había que contestar a mano o no se contestaban.
 *
 * Todo sale exportado en CSV: el pedido más común no es mirar la pantalla, es
 * mandarle la planilla al contador o al dueño.
 */
export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; corte?: string }>;
}) {
  await requireStaff();

  const params = await searchParams;
  const clave = leerPeriodo(params.periodo);
  const periodo = resolverPeriodo(clave);
  const corte = leerCorte(params.corte);

  const filas = await reporteDeVentas(corte, periodo);

  const total = filas.reduce((suma, f) => suma + f.total, 0);
  const operaciones = filas.reduce((suma, f) => suma + f.cantidad, 0);

  const etiquetaCorte =
    CORTES.find((c) => c.clave === corte)?.etiqueta ?? "Por producto";

  const parametros = new URLSearchParams({ corte });
  if (params.periodo) parametros.set("periodo", params.periodo);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Reportes"
        detalle={
          filas.length > 0
            ? `${etiquetaCorte.toLowerCase()} · ${formatearMonto(total)} en ${plural(operaciones, "operación", "operaciones")}`
            : "Sin ventas en el período elegido"
        }
      >
        <a
          href={`/admin/reportes/exportar?${parametros}`}
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Download className="h-5 w-5" />
          Exportar CSV
        </a>
      </EncabezadoPanel>

      <div className="flex flex-wrap items-center gap-3">
        <Suspense fallback={null}>
          <FiltroPeriodo actual={clave} />
        </Suspense>
        <Suspense fallback={null}>
          <ElegirCorte actual={corte} />
        </Suspense>
      </div>

      {filas.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <p className="text-base font-medium">No hay ventas en este período</p>
          <p className="mt-1 text-base text-muted-foreground">
            Probá con un período más largo.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[560px] text-base">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-5 py-2.5 font-semibold">
                  {etiquetaCorte.replace("Por ", "")}
                </th>
                <th className="px-5 py-2.5 text-right font-semibold">
                  {corte === "producto" ? "Unidades" : "Operaciones"}
                </th>
                <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                <th className="px-5 py-2.5 text-right font-semibold">
                  Participación
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filas.map((f) => {
                const parte = total > 0 ? (f.total / total) * 100 : 0;

                return (
                  <tr key={f.clave}>
                    <td className="px-5 py-3">
                      {f.etiqueta}
                      {f.detalle && (
                        <span className="ml-2 text-sm text-muted-foreground">
                          {f.detalle}
                        </span>
                      )}
                    </td>
                    <td className="tabular px-5 py-3 text-right">
                      {f.cantidad.toLocaleString("es-AR")}
                    </td>
                    <td className="tabular px-5 py-3 text-right font-semibold">
                      {formatearMonto(f.total)}
                    </td>
                    <td className="px-5 py-3">
                      {/* La barra vale más que el porcentaje solo: el ojo
                          encuentra al que se lleva la mitad sin leer números. */}
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${parte}%` }}
                          />
                        </div>
                        <span className="tabular w-12 text-right text-sm text-muted-foreground">
                          {parte.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
