import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download, FileText, ShoppingCart } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { GrupoListado } from "@/components/admin/grupo";
import { plural } from "@/components/admin/formato";
import { formatearMonto, unidadConcordada } from "@/lib/formato";

// Las cantidades con coma, como en Stock: «36,5» y no «36.5».
const cantidad = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
import {
  reporteDeReposicion,
  type FilaDeReposicion,
} from "@/lib/dal/admin/reposicion";
import { rubrosPorCategoria } from "@/lib/dal/admin/products";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { SelectorDeRubro } from "@/components/admin/selector-de-rubro";
import { Vacio } from "@/components/admin/vacio";

export const metadata: Metadata = { title: "Reposición" };

const PERIODOS = [30, 60, 90] as const;
// Cortas, para que las tres entren en un renglón a 375 px (M2S3-057).
const SUCURSALES = {
  todos: "Las dos",
  "casa-central": "Central",
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
    rubro?: string;
    sucursal?: string;
  }>;
}) {
  const params = await searchParams;
  const dias = leerDias(params.dias);
  const objetivo = Math.min(Math.max(Number(params.objetivo) || 30, 7), 180);
  const sucursal = params.sucursal ?? "todos";
  const rubro = params.rubro ?? "todos";

  const [reporte, rubros, sucursales] = await Promise.all([
    reporteDeReposicion({
      diasDelPeriodo: dias,
      coberturaObjetivo: objetivo,
      categoria: params.cat,
      rubro,
      sucursal,
    }),
    rubrosPorCategoria(),
    listarSucursalesPublicas(),
  ]);
  const orden = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es");
  const gruposDeRubros = [...rubros]
    .sort(orden)
    .map((c) => ({ categoria: c.name, rubros: c.rubros.filter((r) => r.active).sort(orden) }))
    .filter((g) => g.rubros.length > 0);

  // Lo que hay que comprar o traer de la otra sucursal, con lo vendido de
  // más (en negativo) arriba de todo (M2S4-001).
  const paraComprar = reporte.filas.filter(
    (f) => f.sugerido > 0 || f.trasladoACentral > 0 || f.trasladoAAserradero > 0 || f.negativo,
  );
  const aComprar = paraComprar.filter((f) => f.sugerido > 0);
  /*
   * Una orden por proveedor habitual: juntos, la bisagra de Herrajes salía en
   * la orden de Placas del Sur y había que sacarla a mano (simulación del mes,
   * H377). Con la sucursal elegida en el reporte, la orden nace con esa
   * sucursal. Los que no tienen proveedor van en su propia orden, al final.
   */
  const sucursalId = sucursales.find((x) => x.slug === sucursal)?.id;
  const porProveedor = new Map<string, { nombre: string | null; filas: typeof paraComprar }>();
  for (const f of aComprar) {
    const clave = f.proveedorId ?? "";
    const grupo = porProveedor.get(clave) ?? { nombre: f.proveedor ?? null, filas: [] };
    grupo.filas.push(f);
    porProveedor.set(clave, grupo);
  }
  const ordenes = [...porProveedor.entries()]
    .sort(([a, x], [b, y]) => (a === "" ? 1 : b === "" ? -1 : y.filas.length - x.filas.length))
    .map(([id, g]) => {
      const q = new URLSearchParams({
        sugeridos: g.filas
          .slice(0, 40)
          .map((f) => `${f.variantId}:${f.sugerido}`)
          .join(","),
      });
      if (id) q.set("proveedor", id);
      if (sucursalId) q.set("sucursal", sucursalId);
      return { id, nombre: g.nombre, cantidad: g.filas.length, href: `/admin/compras/ordenes/nueva?${q}` };
    });
  const enLista = new Set(paraComprar.map((f) => f.variantId));
  const seMovieron = reporte.filas.filter((f) => !enLista.has(f.variantId) && f.vendido > 0);
  const sinMovimiento = reporte.filas.filter((f) => !enLista.has(f.variantId) && f.vendido === 0);
  const maxVendidoCategoria = Math.max(
    ...reporte.porCategoria.map((c) => c.vendido),
    1,
  );

  const consulta = (cambios: Record<string, string>) => {
    const p = new URLSearchParams();
    if (dias !== 30) p.set("dias", String(dias));
    if (objetivo !== 30) p.set("objetivo", String(objetivo));
    if (params.cat) p.set("cat", params.cat);
    if (rubro !== "todos") p.set("rubro", rubro);
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
  }${rubro !== "todos" ? `&rubro=${rubro}` : ""}${
    sucursal !== "todos" ? `&sucursal=${sucursal}` : ""
  }`;

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
        resumen={`Últimos ${dias} días · cobertura de ${objetivo} días`}
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
              className={`h-10 whitespace-nowrap rounded-lg px-3 text-base font-medium leading-10 transition-colors ${
                sucursal === valor
                  ? "boton-accion"
                  : "border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {texto}
            </Link>
          ))}
        </div>

        {/* Sin rubros cargados el selector traía solo «Todos los rubros»:
            un control que no filtra nada (mes 23, M2S4-034). */}
        {gruposDeRubros.some((g) => g.rubros.length > 0) && (
          <div className="w-full sm:w-auto">
            <SelectorDeRubro actual={rubro} grupos={gruposDeRubros} />
          </div>
        )}
      </div>

      {/* Lo vendido por categoría, como barras. A mano y sin librería, como
          el resto de los gráficos del panel; el dato exacto va en el número. */}
      {reporte.porCategoria.length > 0 && (
        <section className="tarjeta p-5">
          <h2 className="text-base font-semibold">
            Qué se vendió, por categoría
          </h2>
          {/* En pesos, y la barra sobre su propio carril: medida contra el
              ancho de toda la fila, 363 y 53 salían casi del mismo largo, y
              en unidades se sumaban m² con tornillos (M2S3-058). */}
          <ul className="mt-4 space-y-3">
            {reporte.porCategoria.map((c) => (
              <li key={c.nombre} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
                <span className="truncate text-base">{c.nombre}</span>
                <span className="col-span-2 row-start-2 h-3 overflow-hidden rounded-full bg-hundida sm:col-span-1 sm:row-start-1 sm:col-start-2" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-brand-orange/70"
                    style={{ width: `${Math.max((c.vendido / maxVendidoCategoria) * 100, 1)}%` }}
                  />
                </span>
                <span className="tabular text-right text-base font-medium sm:col-start-3">
                  {formatearMonto(c.vendido)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reporte.filas.length === 0 ? (
        <Vacio
          icono={ShoppingCart}
          titulo="No hay nada con ese filtro"
          accion={{ texto: "Ver todo", href: "/admin/reportes/reposicion" }}
        />
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
            {ordenes.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {ordenes.map((o, i) => (
                  <Link
                    key={o.id || "sin-proveedor"}
                    href={o.href}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-base font-medium transition-opacity hover:opacity-90 ${
                      i === 0 ? "bg-accion text-white" : "border border-linea"
                    }`}
                  >
                    <ShoppingCart className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {ordenes.length === 1 && !o.nombre ? "Generar orden de compra" : `Orden a ${o.nombre ?? "otro proveedor"}`}
                    <span className="tabular rounded-full bg-black/10 px-2 text-sm">{Math.min(o.cantidad, 40)}</span>
                  </Link>
                ))}
              </div>
            )}
            <Tabla filas={paraComprar} conSugerido sucursal={sucursal} />
          </GrupoListado>

          <GrupoListado
            titulo="Se venden y el stock alcanza"
            cantidad={seMovieron.length}
          >
            <Tabla filas={seMovieron.slice(0, 40)} sucursal={sucursal} />
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
              {/* Son los candidatos a no recomprar; los que además llevan más de
                  un año así aparecen en candidatos a baja. */}
              {plural(sinMovimiento.length, "medida")} sin movimiento en {dias}{" "}
              días · más de un año, en{" "}
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

/** La unidad de la fila: la lata de 4 litros se cuenta por lata (M2S2-086). */
function unidadDe(f: FilaDeReposicion, n: number): string {
  return unidadConcordada(n, f.unidad, `${f.producto} ${f.medida}`);
}

/**
 * Lo que una sucursal compra y lo que trae de la otra, en chico debajo de su
 * stock, con su unidad: «traer 12» no decía si eran latas o litros (mes 23,
 * M2S2-086).
 */
function Movimiento({ f, comprar, traer, desde }: { f: FilaDeReposicion; comprar: number; traer: number; desde: string }) {
  if (comprar <= 0 && traer <= 0) return null;
  return (
    <span className="block text-sm font-medium">
      {comprar > 0 && <span className="text-foreground">comprar {cantidad(comprar)} {unidadDe(f, comprar)}</span>}
      {comprar > 0 && traer > 0 && " · "}
      {traer > 0 && <span className="estado-espera">traer {cantidad(traer)} {unidadDe(f, traer)} {desde}</span>}
    </span>
  );
}

function Stock({ n }: { n: number }) {
  return <span className={`tabular ${n < 0 ? "estado-problema font-semibold" : ""}`}>{cantidad(n)}</span>;
}

/**
 * La lista de medidas. En la computadora, una tabla; en el teléfono, una
 * tarjeta por medida (M2S1-040): el nombre a lo ancho, la medida y el código
 * debajo, el stock de cada sucursal y lo que se compra en una línea, con el
 * número grande; rubro, vendido y cobertura en chico. La tabla apilada daba
 * siete renglones por medida y «Fenólic / o» en una columna angosta.
 *
 * Lo que se compra va en la columna de la sucursal para la que es, y lo que
 * conviene traer de la otra al lado (M2S1-033).
 */
function Tabla({
  filas,
  conSugerido = false,
  sucursal,
}: {
  filas: FilaDeReposicion[];
  conSugerido?: boolean;
  sucursal: string;
}) {
  if (filas.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-3 text-base text-muted-foreground">
        Nada por acá.
      </p>
    );
  }
  const verCentral = sucursal !== "aserradero";
  const verAserradero = sucursal !== "casa-central";
  const cobertura = (f: FilaDeReposicion) =>
    f.cobertura === null ? null : f.cobertura > 365 ? "más de un año" : `${cantidad(f.cobertura)} días`;

  return (
    <>
      <ul className="tarjeta divide-y divide-linea sm:hidden">
        {filas.map((f) => (
          <li key={f.variantId} className={`px-4 py-3 ${f.negativo ? "bg-[var(--estado-fondo)] estado-problema" : ""}`}>
            <Link href={`/admin/productos/${f.productId}`} className="block text-base font-semibold text-foreground hover:underline">
              {f.producto}
            </Link>
            <p className="text-sm text-muted-foreground">
              {f.medida}
              {f.sku ? ` · ${f.sku}` : ""}
            </p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div className="min-w-0 space-y-0.5 text-base">
                {verCentral && (
                  <p>
                    <span className="text-sm text-muted-foreground">Central </span>
                    <span className="font-medium">
                      <Stock n={f.disponibleCentral} />
                    </span>
                    {conSugerido && <Movimiento f={f} comprar={f.comprarCentral} traer={f.trasladoACentral} desde="del Aserradero" />}
                  </p>
                )}
                {verAserradero && (
                  <p>
                    <span className="text-sm text-muted-foreground">Aserradero </span>
                    <span className="font-medium">
                      <Stock n={f.disponibleAserradero} />
                    </span>
                    {conSugerido && <Movimiento f={f} comprar={f.comprarAserradero} traer={f.trasladoAAserradero} desde="de Central" />}
                  </p>
                )}
              </div>
              {conSugerido && f.sugerido > 0 && (
                <p className="shrink-0 text-right">
                  <span className="tabular block text-[26px] font-bold leading-none text-foreground">{cantidad(f.sugerido)}</span>
                  <span className="text-sm text-muted-foreground">{unidadDe(f, f.sugerido)} a comprar</span>
                </p>
              )}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {f.rubro ?? f.categoria} · vendido {cantidad(f.vendido)}
              {cobertura(f) ? ` · cubre ${cobertura(f)}` : ""}
            </p>
          </li>
        ))}
      </ul>

      <div className="tarjeta hidden overflow-x-auto sm:block">
        <table className="w-full" data-tabla="fija">
          <thead>
            <tr className="border-b text-left">
              <th className="px-5 py-3 text-sm font-medium text-muted-foreground">Producto</th>
              <th className="px-4 py-3 text-sm font-medium text-muted-foreground">Rubro</th>
              {verCentral && <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Central</th>}
              {verAserradero && <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Aserradero</th>}
              <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Vendido</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Cobertura</th>
              {conSugerido && <th className="px-5 py-3 text-right text-sm font-medium text-muted-foreground">Comprar</th>}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.variantId} className={`border-b last:border-0 ${f.negativo ? "estado-problema bg-[var(--estado-fondo)]" : ""}`}>
                <td className="px-5 py-3">
                  {/* Señalar un producto y no dejar abrirlo era el paso que
                      faltaba: el reporte dice "comprá 12 de esto" y había que
                      ir a buscarlo al listado para ver de qué se trata. */}
                  <Link href={`/admin/productos/${f.productId}`} className="text-base font-medium hover:text-brand-orange hover:underline">
                    {f.producto}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {f.medida}
                    {f.sku ? ` · ${f.sku}` : ""}
                  </p>
                </td>
                <td className="px-4 py-3 text-base text-muted-foreground">{f.rubro ?? f.categoria}</td>
                {verCentral && (
                  <td className="px-4 py-3 text-right text-base">
                    <Stock n={f.disponibleCentral} />
                    {conSugerido && <Movimiento f={f} comprar={f.comprarCentral} traer={f.trasladoACentral} desde="del Aserradero" />}
                  </td>
                )}
                {verAserradero && (
                  <td className="px-4 py-3 text-right text-base">
                    <Stock n={f.disponibleAserradero} />
                    {conSugerido && <Movimiento f={f} comprar={f.comprarAserradero} traer={f.trasladoAAserradero} desde="de Central" />}
                  </td>
                )}
                <td className="tabular px-4 py-3 text-right text-base">{cantidad(f.vendido)}</td>
                <td className="tabular px-4 py-3 text-right text-base">
                  {f.cobertura === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    // Menos de una semana de cobertura pide atención: es lo que
                    // se queda sin stock antes del próximo pedido al proveedor.
                    <span className={f.cobertura <= 7 ? "font-semibold text-brand-orange-dark" : ""}>{cobertura(f)}</span>
                  )}
                </td>
                {conSugerido && (
                  <td className="tabular px-5 py-3 text-right text-base font-semibold">
                    {f.sugerido > 0 ? `${cantidad(f.sugerido)} ${unidadDe(f, f.sugerido)}` : <span className="text-muted-foreground">—</span>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
