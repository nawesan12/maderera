import { Suspense } from "react";
import Link from "next/link";
import { Download, FileText, ShoppingCart } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { FiltroPeriodo } from "@/components/admin/filtro-periodo";
import { formatearMonto, formatearPorcentaje, plural } from "@/components/admin/formato";
import {
  CORTES,
  leerCorte,
  reporteDeVentas,
  ventasPorMes,
} from "@/lib/dal/admin/reportes";
import { leerPeriodo, resolverPeriodo } from "@/lib/periodos";
import { requireStaff } from "@/lib/dal/session";
import { ElegirCorte } from "./elegir-corte";
import { margenDelRenglon } from "@/lib/reportes-cortes";
import { FiltrosDelReporte } from "./filtros";
import { GraficoDeEvolucion } from "@/components/admin/grafico-evolucion";
import { listarSucursalesPublicas } from "@/lib/dal/envios";

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
  searchParams: Promise<{
    periodo?: string;
    corte?: string;
    rubro?: string;
    sucursal?: string;
  }>;
}) {
  await requireStaff();

  const params = await searchParams;
  const clave = leerPeriodo(params.periodo);
  const periodo = resolverPeriodo(clave);
  const corte = leerCorte(params.corte);

  // Cortar agrupa; filtrar se queda con una parte. Ver `FiltrosDelReporte`.
  const filtros = { rubro: params.rubro, sucursal: params.sucursal };

  const [reporte, meses, sucursales] = await Promise.all([
    reporteDeVentas(corte, periodo, filtros),
    ventasPorMes(periodo, filtros),
    listarSucursalesPublicas(),
  ]);
  const { filas, totales } = reporte;

  // Del período entero, no de las filas: por producto llegan las 50 que más
  // vendieron, y sumarlas daba otro total según el corte.
  const total = totales.total;
  const operaciones = totales.cantidad;
  // La participación de cada fila, sobre lo que suman las filas: en los
  // cortes por renglón el total lleva además el envío y el descuento.
  const base = totales.renglones || total;
  // Lo que los renglones no llevan: el mismo total con IVA en todos los
  // cortes y en el inicio (mes simulado, M2S4-030).
  const enviosYDescuentos = total - totales.renglones;

  /*
   * Lo vendido, el costo y el margen del período.
   *
   * **Un solo «Vendido sin IVA».** Lo calcula Go sobre el período entero
   * (`totales`), con la misma regla que el Cierre y la Ganancia del mes del
   * Resumen, en cualquier corte. Antes sumaba las filas que se veían: por
   * producto, las 50 primeras. Lo que no tiene costo se dice debajo, en el
   * color de problema: el margen se ve sano y nadie carga los costos si eso
   * no está a la vista.
   *
   * **El margen se mide contra lo que tiene costo** (`netoCosteado`, ver
   * backend/internal/reportes/ventas.go): restarle el costo de una parte a la
   * venta del todo lo inflaba. Un costo en $0 cuenta como sin costo.
   *
   * La serie de margen arranca el día que arrancó el módulo de compras. No
   * hay relleno hacia atrás: el único costo posible sería el de hoy, y eso
   * pintaría de margen inventado seis meses de ventas.
   */
  const hayMargen = totales.costo !== null;
  const vendido = totales.netoVenta;
  const conCosto = totales.netoCosteado;
  const costoTotal = totales.costo ?? 0;
  const margenTotal = conCosto - costoTotal;
  const vendidoSinCosto = vendido - conCosto;
  const sinCosto = totales.lineasSinCosto;

  // Los cortes por renglón suman subtotales y unidades, sin el envío del
  // pedido: el encabezado dice unidades (no operaciones) y el envío aparte,
  // que es la diferencia con el «Vendido con IVA» del inicio (H138).
  const porRenglon = corte === "producto" || corte === "rubro" || corte === "elaboracion";

  const etiquetaCorte =
    CORTES.find((c) => c.clave === corte)?.etiqueta ?? "Por producto";

  const parametros = new URLSearchParams({ corte });
  if (params.periodo) parametros.set("periodo", params.periodo);
  if (params.rubro) parametros.set("rubro", params.rubro);
  if (params.sucursal) parametros.set("sucursal", params.sucursal);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Reportes"
        resumen={
          filas.length > 0
            ? `${etiquetaCorte.toLowerCase()} · ${formatearMonto(total)} en ${
                porRenglon
                  ? plural(operaciones, "unidad", "unidades")
                  : plural(operaciones, "operación", "operaciones")
              }`
            : "Sin ventas en el período elegido"
        }
      >
        <Link
          href="/admin/reportes/reposicion"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <ShoppingCart className="h-5 w-5" />
          Reposición
        </Link>
        <a
          href={`/admin/reportes/exportar?${parametros}`}
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Download className="h-5 w-5" />
          Exportar CSV
        </a>
        {/* El PDF es para mandar, no para trabajar: el CSV se abre en Excel y
            esto se adjunta a un correo o se le muestra al contador. */}
        <a
          href={`/admin/reportes/exportar?${parametros}&formato=pdf`}
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <FileText className="h-5 w-5" />
          PDF
        </a>
      </EncabezadoPanel>

      <div className="flex flex-wrap items-center gap-3">
        <Suspense fallback={null}>
          <FiltroPeriodo actual={clave} />
        </Suspense>
        <Suspense fallback={null}>
          <ElegirCorte actual={corte} />
        </Suspense>
        <Suspense fallback={null}>
          <FiltrosDelReporte
            rubro={params.rubro ?? "todos"}
            sucursal={params.sucursal ?? "todas"}
            sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
          />
        </Suspense>
      </div>

      {/* Cómo viene el mes contra los anteriores. Es lo único que la tabla de
          abajo no puede contestar. */}
      {meses.length > 1 && (
        <section className="tarjeta p-5">
          <h2 className="text-base font-medium">Mes a mes</h2>
          <div className="mt-3">
            <GraficoDeEvolucion meses={meses} />
          </div>
        </section>
      )}

      {filas.length > 0 && (
        <section className="grid gap-3 sm:grid-cols-3">
          <article className="tarjeta p-4">
            <p className="text-sm text-muted-foreground">Vendido sin IVA</p>
            <p className="tabular mt-0.5 text-2xl font-bold">{formatearMonto(vendido)}</p>
            {sinCosto > 0 && vendidoSinCosto >= 0.5 && (
              <a href="#ventas" className="estado-problema mt-1 block text-base font-semibold [font-variant-numeric:tabular-nums]">
                {formatearMonto(vendidoSinCosto)} sin costo
              </a>
            )}
          </article>
          {hayMargen && (
            <>
              <article className="tarjeta p-4">
                <p className="text-sm text-muted-foreground">Costo de lo vendido</p>
                <p className="tabular mt-0.5 text-2xl font-bold">{formatearMonto(costoTotal)}</p>
              </article>
              <article className="tarjeta p-4">
                <p className="text-sm text-muted-foreground">Margen</p>
                <p
                  className={`tabular mt-0.5 text-2xl font-bold ${
                    margenTotal < 0 ? "text-saldo-debe" : "text-saldo-favor"
                  }`}
                >
                  {formatearMonto(margenTotal)}
                  {conCosto > 0 && (
                    <span className="ml-2 text-base font-semibold text-muted-foreground">
                      {formatearPorcentaje((margenTotal / conCosto) * 100)}
                    </span>
                  )}
                </p>
                {vendidoSinCosto >= 0.5 && (
                  <p className="mt-1 text-base text-muted-foreground [font-variant-numeric:tabular-nums]">
                    sobre {formatearMonto(conCosto)}
                  </p>
                )}
              </article>
            </>
          )}
        </section>
      )}

      {filas.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <p className="text-base font-medium">No hay ventas en este período</p>
        </div>
      ) : (
        <div id="ventas" className="scroll-mt-24 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] text-base">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-5 py-2.5 font-semibold">
                  {/* «Por producto» → «Producto», no «producto». */}
                  {etiquetaCorte.replace(/^Por (.)/, (_, l: string) => l.toUpperCase())}
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">
                  {corte === "producto" ? "Unidades" : "Operaciones"}
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                {hayMargen && (
                  <>
                    {/* El neto de lo que tiene costo al lado del costo,
                        como el PDF: el total lleva IVA y el costo no
                        (M2S1-039), y con renglones sin costo el neto entero
                        no cerraba contra el margen (mes 23, M2S1-045). */}
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Neto con costo
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Costo
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Margen
                    </th>
                  </>
                )}
                <th className="px-3 py-2.5 text-right font-semibold">
                  Participación
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filas.map((f) => {
                const parte = base > 0 ? (f.total / base) * 100 : 0;

                return (
                  <tr key={f.clave}>
                    {/* El nombre puede partirse y el detalle va debajo: con
                        un nombre largo la tabla no entraba a 1280 px y se
                        apilaba en tarjetas (mes simulado). */}
                    <td className="px-5 py-3 [overflow-wrap:anywhere]">
                      {/* En un solo bloque: apilada en el teléfono la celda
                          es flex, y el nombre, el detalle y lo sin costo
                          salían en tres columnas (mes 23, M2S2-083). */}
                      <div className="min-w-0">
                        {f.etiqueta}
                        {f.detalle && (
                          <span className="block text-sm font-normal text-muted-foreground">
                            {f.detalle}
                          </span>
                        )}
                        {/* Lo que quedó fuera del margen, en su renglón y en
                            pesos, como la tarjeta de arriba. */}
                        {hayMargen && f.costo !== null && f.netoVenta - f.netoCosteado >= 0.5 && (
                          <span className="estado-problema mt-0.5 block text-sm font-medium whitespace-nowrap">
                            {formatearMonto(f.netoVenta - f.netoCosteado)} sin costo
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="tabular px-3 py-3 text-right">
                      {f.cantidad.toLocaleString("es-AR")}
                    </td>
                    <td className="tabular px-3 py-3 text-right font-semibold">
                      {formatearMonto(f.total)}
                    </td>
                    {hayMargen && (
                      <>
                        <td className="tabular px-3 py-3 text-right">
                          {f.costo === null ? "—" : formatearMonto(f.netoCosteado)}
                        </td>
                        <td className="tabular px-3 py-3 text-right text-muted-foreground">
                          {f.costo === null ? "—" : formatearMonto(f.costo)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {f.costo === null ? (
                            <span className="estado-problema text-sm font-medium">
                              sin costo
                            </span>
                          ) : (
                            (() => {
                              /* Neto contra neto, y solo de lo que tiene
                                 costo: el total lleva IVA adentro y el costo
                                 no, y la venta de los renglones sin costo no
                                 tiene contra qué medirse. */
                              const { margen, pct, color } = margenDelRenglon(f.netoCosteado, f.costo);
                              return (
                                <>
                                  <span className={`tabular whitespace-nowrap font-semibold ${color}`}>
                                    {formatearMonto(margen)}
                                    {/* Con su separador: en la tarjeta del
                                        teléfono se leía «$ 221.2499,2%». */}
                                    {/* Con `whitespace-nowrap` propio: la regla del
                                        panel que deja bajar el texto de las
                                        tablas lo partía en «$ 519.270,90 ·» /
                                        «20,6%» a 1280 (tercera prueba, H068). */}
                                    {pct !== null && (
                                      <span className="whitespace-nowrap text-sm font-normal text-muted-foreground">
                                        {" · "}
                                        {formatearPorcentaje(pct)}
                                      </span>
                                    )}
                                  </span>
                                </>
                              );
                            })()
                          )}
                        </td>
                      </>
                    )}
                    <td className="py-3 pl-3 pr-5">
                      {/* La barra vale más que el porcentaje solo: el ojo
                          encuentra al que se lleva la mitad sin leer números. */}
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${parte}%` }}
                          />
                        </div>
                        <span className="tabular w-12 text-right text-sm text-muted-foreground">
                          {formatearPorcentaje(parte)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* El período entero: con el tope de filas, la suma de lo que se
                ve no es el total, y se dice cuántas faltan. */}
            <tfoot className="border-t-2 bg-muted/30 font-semibold">
              {porRenglon && Math.abs(enviosYDescuentos) >= 0.005 && (
                <tr className="font-normal text-muted-foreground">
                  <td className="px-5 py-2.5">Envíos y descuentos</td>
                  <td />
                  <td className="tabular px-3 py-2.5 text-right">{formatearMonto(enviosYDescuentos)}</td>
                  {hayMargen && (
                    <>
                      <td />
                      <td />
                      <td />
                    </>
                  )}
                  <td />
                </tr>
              )}
              <tr>
                <td className="px-5 py-3">
                  Total
                  {totales.filas > filas.length && (
                    <span className="tabular ml-2 text-sm font-normal text-muted-foreground">
                      {filas.length} de {totales.filas}
                    </span>
                  )}
                </td>
                <td className="tabular px-3 py-3 text-right">{totales.cantidad.toLocaleString("es-AR")}</td>
                <td className="tabular px-3 py-3 text-right">{formatearMonto(totales.total)}</td>
                {hayMargen && (
                  <>
                    <td className="tabular px-3 py-3 text-right">{formatearMonto(conCosto)}</td>
                    <td className="tabular px-3 py-3 text-right">{formatearMonto(costoTotal)}</td>
                    <td
                      className={`tabular px-3 py-3 text-right ${margenTotal < 0 ? "text-saldo-debe" : "text-saldo-favor"}`}
                    >
                      {formatearMonto(margenTotal)}
                    </td>
                  </>
                )}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
