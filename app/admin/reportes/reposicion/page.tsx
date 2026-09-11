import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download, FileText, ShoppingCart } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { GrupoListado } from "@/components/admin/grupo";
import { plural } from "@/components/admin/formato";
import { formatearUnidad } from "@/lib/formato";
import {
  reporteDeReposicion,
  type FilaDeReposicion,
} from "@/lib/dal/admin/reposicion";

export const metadata: Metadata = { title: "Reposición" };

const PERIODOS = [30, 60, 90] as const;
const SUCURSALES = {
  todos: "Las dos sucursales",
  "casa-central": "Casa Central",
  aserradero: "Aserradero",
};

function leerDias(crudo: string | undefined): number {
  const n = Number(crudo);
  return PERIODOS.includes(n as (typeof PERIODOS)[number]) ? n : 30;
}

/**
 * Qué comprar, con qué urgencia.
 *
 * El pedido de la clienta: stock por rubro y sucursal cruzado con las ventas,
 * "accionable para tomar buenas acciones de compra". La pantalla contesta esa
 * pregunta en ese orden: primero lo que hay que reponer ya, después lo que se
 * vendió, al final lo que no se movió —que es la lista de candidatos a no
 * recomprar—.
 */
export default async function ReposicionPage({
  searchParams,
}: {
  searchParams: Promise<{
    dias?: string;
    objetivo?: string;
    cat?: string;
    sucursal?: string;
  }>;
}) {
  const params = await searchParams;
  const dias = leerDias(params.dias);
  const objetivo = Math.min(Math.max(Number(params.objetivo) || 30, 7), 180);
  const sucursal = params.sucursal ?? "todos";

  const reporte = await reporteDeReposicion({
    diasDelPeriodo: dias,
    coberturaObjetivo: objetivo,
    categoria: params.cat,
    sucursal,
  });

  const paraComprar = reporte.filas.filter((f) => f.sugerido > 0);
  const seMovieron = reporte.filas.filter(
    (f) => f.sugerido === 0 && f.vendido > 0,
  );
  const sinMovimiento = reporte.filas.filter((f) => f.vendido === 0);
  const maxVendidoCategoria = Math.max(
    ...reporte.porCategoria.map((c) => c.vendido),
    1,
  );

  const consulta = (cambios: Record<string, string>) => {
    const p = new URLSearchParams();
    if (dias !== 30) p.set("dias", String(dias));
    if (objetivo !== 30) p.set("objetivo", String(objetivo));
    if (params.cat) p.set("cat", params.cat);
    if (sucursal !== "todos") p.set("sucursal", sucursal);
    for (const [k, v] of Object.entries(cambios)) {
      if (v === "" || v === "todos" || (k === "dias" && v === "30")) p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    return `/admin/reportes/reposicion${s ? `?${s}` : ""}`;
  };

  const urlExportar = `/admin/reportes/reposicion/exportar?dias=${dias}&objetivo=${objetivo}${
    params.cat ? `&cat=${params.cat}` : ""
  }${sucursal !== "todos" ? `&sucursal=${sucursal}` : ""}`;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/reportes"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a reportes
      </Link>

      <EncabezadoPanel
        titulo="Reposición"
        detalle={`Ventas de los últimos ${dias} días contra el stock de hoy, con la compra sugerida para ${objetivo} días de cobertura.`}
      >
        <a
          href={urlExportar}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <Download className="h-5 w-5" />
          CSV
        </a>
        <a
          href={`${urlExportar}&formato=pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <FileText className="h-5 w-5" />
          PDF
        </a>
      </EncabezadoPanel>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex gap-1.5" role="group" aria-label="Período medido">
          {PERIODOS.map((p) => (
            <Link
              key={p}
              href={consulta({ dias: String(p) })}
              aria-current={dias === p ? "page" : undefined}
              className={`h-10 rounded-lg px-3 text-base font-medium leading-10 transition-colors ${
                dias === p
                  ? "boton-accion"
                  : "border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {p} días
            </Link>
          ))}
        </div>

        <div className="flex gap-1.5" role="group" aria-label="Sucursal">
          {Object.entries(SUCURSALES).map(([valor, texto]) => (
            <Link
              key={valor}
              href={consulta({ sucursal: valor })}
              aria-current={sucursal === valor ? "page" : undefined}
              className={`h-10 rounded-lg px-3 text-base font-medium leading-10 transition-colors ${
                sucursal === valor
                  ? "boton-accion"
                  : "border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {texto}
            </Link>
          ))}
        </div>
      </div>

      {/* Lo vendido por categoría, como barras. A mano y sin librería, como
          el resto de los gráficos del panel; el dato exacto va en el número. */}
      {reporte.porCategoria.length > 0 && (
        <section className="tarjeta p-5">
          <h2 className="text-base font-semibold">
            Qué se vendió, por categoría
          </h2>
          <ul className="mt-4 space-y-2.5">
            {reporte.porCategoria.map((c) => (
              <li key={c.nombre} className="flex items-center gap-3">
                <span className="w-44 shrink-0 truncate text-base">
                  {c.nombre}
                </span>
                <span className="h-5 min-w-[3px] rounded-sm bg-brand-orange/70"
                  style={{
                    width: `${Math.max((c.vendido / maxVendidoCategoria) * 100, 1)}%`,
                  }}
                  aria-hidden
                />
                <span className="tabular shrink-0 text-base font-medium">
                  {c.vendido}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reporte.filas.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <ShoppingCart className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">No hay datos con ese filtro</p>
        </div>
      ) : (
        <>
          <GrupoListado
            titulo="Para comprar"
            cantidad={paraComprar.length}
            detalle={`Cubrir ${objetivo} días al ritmo de venta del período`}
            destacado
          >
            {/*
              La acción para la que existe el reporte.

              `notas.md` lo pide con todas las letras: "tiene que ser
              accionable para tomar buenas acciones de compra". Sin esto el
              reporte terminaba en un número y el trabajo —buscar cuarenta
              productos uno por uno en el formulario de la orden— quedaba
              entero del otro lado.

              Nace en borrador y sin proveedor: la máquina sugiere qué y
              cuánto, la persona decide a quién y a qué precio.
            */}
            {paraComprar.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <Link
                  href={`/admin/compras/ordenes/nueva?sugeridos=${paraComprar
                    .slice(0, 40)
                    .map((f) => `${f.variantId}:${f.sugerido}`)
                    .join(",")}`}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-opacity hover:opacity-90"
                >
                  <ShoppingCart className="h-5 w-5" aria-hidden="true" />
                  Generar orden de compra
                </Link>
                <span className="text-base text-muted-foreground">
                  Con {Math.min(paraComprar.length, 40)} renglones y la cantidad
                  sugerida. Nace en borrador.
                </span>
              </div>
            )}
            <Tabla filas={paraComprar} conSugerido />
          </GrupoListado>

          <GrupoListado
            titulo="Se venden y el stock alcanza"
            cantidad={seMovieron.length}
          >
            <Tabla filas={seMovieron.slice(0, 40)} />
            {seMovieron.length > 40 && (
              <p className="mt-2 text-sm text-muted-foreground">
                Se muestran los 40 más vendidos. El resto sale en el CSV.
              </p>
            )}
          </GrupoListado>

          <section className="tarjeta-hundida p-5">
            <h2 className="text-base font-semibold text-muted-foreground">
              Sin ventas en el período
              <span className="tabular ml-2">{sinMovimiento.length}</span>
            </h2>
            <p className="mt-1 text-base text-muted-foreground">
              {plural(sinMovimiento.length, "medida")} sin movimiento en {dias}{" "}
              días. Son los candidatos a no recomprar; los que además llevan más
              de un año así aparecen en{" "}
              <Link
                href="/admin/productos/candidatos"
                className="font-medium text-foreground underline-offset-2 hover:underline"
              >
                candidatos a baja
              </Link>
              .
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Tabla({
  filas,
  conSugerido = false,
}: {
  filas: FilaDeReposicion[];
  conSugerido?: boolean;
}) {
  if (filas.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-3 text-base text-muted-foreground">
        Nada por acá.
      </p>
    );
  }

  return (
    <div className="tarjeta overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b text-left">
            <th className="px-5 py-3 text-sm font-medium text-muted-foreground">
              Producto
            </th>
            <th className="px-4 py-3 text-sm font-medium text-muted-foreground">
              Rubro
            </th>
            <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
              Central
            </th>
            <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
              Aserradero
            </th>
            <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
              Vendido
            </th>
            <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
              Cobertura
            </th>
            {conSugerido && (
              <th className="px-5 py-3 text-right text-sm font-medium text-muted-foreground">
                Comprar
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.variantId} className="border-b last:border-0">
              <td className="px-5 py-3">
                {/* Señalar un producto y no dejar abrirlo era el paso que
                    faltaba: el reporte dice "comprá 12 de esto" y había que
                    ir a buscarlo al listado para ver de qué se trata. */}
                <Link
                  href={`/admin/productos/${f.productId}`}
                  className="text-base font-medium hover:text-brand-orange hover:underline"
                >
                  {f.producto}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {f.medida}
                  {f.sku ? ` · ${f.sku}` : ""}
                </p>
              </td>
              <td className="px-4 py-3 text-base text-muted-foreground">
                {f.rubro ?? f.categoria}
              </td>
              <td className="tabular px-4 py-3 text-right text-base">
                {f.disponibleCentral}
              </td>
              <td className="tabular px-4 py-3 text-right text-base">
                {f.disponibleAserradero}
              </td>
              <td className="tabular px-4 py-3 text-right text-base">
                {f.vendido}
              </td>
              <td className="tabular px-4 py-3 text-right text-base">
                {f.cobertura === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  // Menos de una semana de cobertura pide atención: es lo que
                  // se queda sin stock antes del próximo pedido al proveedor.
                  <span
                    className={
                      f.cobertura <= 7 ? "font-semibold text-brand-orange-dark" : ""
                    }
                  >
                    {f.cobertura} días
                  </span>
                )}
              </td>
              {conSugerido && (
                <td className="tabular px-5 py-3 text-right text-base font-semibold">
                  {f.sugerido} {formatearUnidad(f.unidad)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
