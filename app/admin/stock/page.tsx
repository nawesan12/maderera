import Link from "next/link";
import { Vacio } from "@/components/admin/vacio";
import { hayFiltro } from "@/lib/formato";
import { Barcode, ClipboardList, FileSpreadsheet, Package, Truck } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { leerPagina, Paginador } from "@/components/admin/paginador";
import { fechaHora, plural } from "@/components/admin/formato";
import { BuscadorProductos } from "@/app/admin/productos/buscador";
import { listarCategoriasAdmin, marcasDeProductos } from "@/lib/dal/admin/products";
import {
  estadoDeStock,
  listarStock,
  STOCK_POR_PAGINA,
  trasladosEnCamino,
  ultimosMovimientos,
} from "@/lib/dal/admin/inventory";
import { loQueEstaPorLlegar } from "@/lib/dal/admin/ordenes-compra";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { formatearCantidad } from "@/lib/unidades";
import { DialogoTraslado } from "./dialogo-traslado";
import { TarjetaStock } from "./tarjeta";

type Params = {
  buscar?: string;
  cat?: string;
  estado?: string;
  marca?: string;
  prov?: string;
  pagina?: string;
};

/** Los botones secundarios del encabezado: en el teléfono, solo el ícono. */
const BOTON_SECUNDARIO =
  "inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted";

export default async function AdminStockPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const usuario = await requireStaff();
  const pagina = leerPagina(params.pagina);
  // Los proveedores son de Compras: quien no entra ahí no los ve ni filtra.
  const conProveedores = puedeEntrar("/admin/compras", usuario.staffRole);
  const filtros = {
    busqueda: params.buscar,
    categoria: params.cat,
    marca: params.marca,
    proveedor: params.prov,
  };
  const conFiltro = Boolean(params.buscar || (params.cat && params.cat !== "todos") || (params.marca && params.marca !== "todas"));

  const [grilla, categorias, marcas, proveedores, movimientos, enCamino, traslados] =
    await Promise.all([
      listarStock({ ...filtros, estado: params.estado, pagina }),
      listarCategoriasAdmin(),
      marcasDeProductos(),
      conProveedores ? proveedoresParaElegir() : Promise.resolve(undefined),
      // Los movimientos siguen al filtro: buscando un tirante, los de ese
      // tirante y no los del negocio entero (mes simulado, H206).
      ultimosMovimientos(conFiltro ? 20 : 8, filtros),
      /*
       * Lo que ya está pedido y todavía no llegó.
       *
       * Es la respuesta a "¿ya pedimos esto?" en el lugar donde la pregunta
       * aparece. Sin esto, el encargado que ve tres placas en el estante pide
       * de nuevo lo que ya viene en camino.
       */
      loQueEstaPorLlegar(),
      trasladosEnCamino(),
    ]);
  const { filas, total, conteos, sucursales } = grilla;
  const estado = estadoDeStock(params.estado) ?? "todos";

  const pedido = new Map(
    enCamino.map((p) => [
      p.variantId,
      { cantidad: Number(p.pendiente), llega: p.proximaEntrega ? new Date(p.proximaEntrega).toISOString() : null },
    ]),
  );

  const verFicha = puedeEntrar("/admin/productos", usuario.staffRole);

  return (
    <div>
      <EncabezadoPanel
        titulo="Stock"
        resumen={
          conteos.reponer > 0
            ? `${plural(conteos.reponer, "medida")} para reponer de ${conteos.todas}`
            : `${plural(conteos.todas, "medida")} en inventario`
        }
      >
        {/* El cruce de stock y ventas vive en su propio reporte, que es de
            administración: al depósito el enlace lo rebotaba al panel sin
            decir nada (mes simulado, H101). */}
        {puedeEntrar("/admin/reportes/reposicion", usuario.staffRole) && (
          <Link href="/admin/reportes/reposicion" className={BOTON_SECUNDARIO} aria-label="Qué reponer">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">Qué reponer</span>
          </Link>
        )}
        <Link href="/admin/stock/etiquetas" className={BOTON_SECUNDARIO} aria-label="Etiquetas">
          <Barcode className="h-5 w-5" aria-hidden="true" />
          <span className="hidden sm:inline">Etiquetas</span>
        </Link>
        {puedeEntrar("/admin/migracion", usuario.staffRole) && (
          <Link href="/admin/migracion?que=stock" className={BOTON_SECUNDARIO} aria-label="Cargar desde Excel">
            <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">Cargar desde Excel</span>
          </Link>
        )}
        <DialogoTraslado sucursales={sucursales.map((s) => ({ id: s.id, name: s.nombre }))} />
      </EncabezadoPanel>

      {/* Los grupos no se pisan y suman «Todas»: lo que hay que reponer
          (el mismo número que el inicio), lo que no tiene nada para vender
          y lo que está bien. */}
      <BuscadorProductos
        categorias={categorias}
        busquedaActual={params.buscar ?? ""}
        categoriaActual={params.cat ?? "todos"}
        marcas={marcas}
        marcaActual={params.marca ?? "todas"}
        proveedores={proveedores?.map((p) => ({ id: p.id, nombre: p.nombre }))}
        proveedorActual={params.prov ?? "todos"}
        estadoActual={estado}
        estados={[
          { valor: "todos", texto: "Todas", cantidad: conteos.todas },
          { valor: "reponer", texto: "Para reponer", cantidad: conteos.reponer, atencion: true },
          { valor: "sin-stock", texto: "Sin stock", cantidad: conteos.sinStock },
          { valor: "con-stock", texto: "Con stock", cantidad: conteos.conStock },
        ]}
      />

      {filas.length === 0 && hayFiltro(params) ? (
        <div className="mt-6">
          <Vacio
            icono={Package}
            titulo="Ninguna medida coincide"
            detalle="Probá con otro nombre, código o categoría."
            accion={{ texto: "Limpiar filtros", href: "/admin/stock" }}
          />
        </div>
      ) : filas.length === 0 ? (
        <div className="mt-6">
          <Vacio
            icono={Package}
            titulo="Todavía no hay mercadería"
            detalle="El stock aparece cuando hay productos cargados."
            accion={
              puedeEntrar("/admin/migracion", usuario.staffRole)
                ? { texto: "Cargar desde Excel", href: "/admin/migracion?que=stock" }
                : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <div className="grid gap-3 lg:grid-cols-2">
              {filas.map((fila) => (
                <TarjetaStock key={fila.variantId} fila={fila} enCamino={pedido.get(fila.variantId)} verFicha={verFicha} />
              ))}
            </div>
            <Paginador pagina={pagina} total={total} porPagina={STOCK_POR_PAGINA} params={params} />
          </div>

          <aside className="min-w-0 space-y-6 2xl:sticky 2xl:top-24 2xl:self-start">
            {traslados.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Traslados en camino
                </h2>
                <ul className="tarjeta-atencion overflow-hidden">
                  {traslados.map((t) => (
                    <li key={t.id} className="border-b border-border/60 last:border-0">
                      <Link
                        href={`/admin/stock/traslados/${t.id}`}
                        className="flex items-center gap-3 px-3 py-3 hover:bg-muted"
                      >
                        <Truck className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-base">
                            <span className="codigo">{t.codigo}</span> · {t.origen} → {t.destino}
                          </span>
                          <span className="tabular block text-sm text-muted-foreground">{fechaHora.format(t.createdAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section id="movimientos" className="scroll-mt-24">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {conFiltro ? "Movimientos" : "Últimos movimientos"}
              </h2>
              {movimientos.length === 0 ? (
                <p className="tarjeta-hundida px-3 py-6 text-center text-base text-muted-foreground">
                  Sin movimientos.
                </p>
              ) : (
                <ul className="tarjeta-hundida overflow-hidden">
                  {movimientos.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-baseline justify-between gap-3 border-b border-border/60 px-3 py-3 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base">
                          {m.productName} <span className="text-muted-foreground">{m.label}</span>
                        </p>
                        {/* Qué fue, con su comprobante: «Rotura», «Entrega ·
                            REM-0020», «Traslado · TRA-0003» (H106, H326). */}
                        <p className="truncate text-sm">
                          <span className="font-medium">{m.concepto}</span>
                          {m.referencia && (
                            <>
                              {" · "}
                              <span className="codigo">{m.referencia}</span>
                            </>
                          )}
                          <span className="text-muted-foreground"> · {m.branchName}</span>
                        </p>
                        <p className="tabular text-sm text-muted-foreground">{fechaHora.format(m.createdAt)}</p>
                      </div>
                      <span
                        className={`tabular shrink-0 text-base font-medium ${
                          m.qty > 0 ? "text-saldo-favor" : "text-muted-foreground"
                        }`}
                      >
                        {m.qty > 0 ? `+${formatearCantidad(m.qty)}` : formatearCantidad(m.qty)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
