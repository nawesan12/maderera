import Image from "next/image";
import Link from "next/link";
import { Barcode, FileSpreadsheet, ImageOff, Package } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { leerPagina, Paginador } from "@/components/admin/paginador";
import { NivelStock } from "@/components/admin/nivel-stock";
import { fechaHora, plural } from "@/components/admin/formato";
import { BuscadorProductos } from "@/app/admin/productos/buscador";
import { listarCategoriasAdmin, marcasDeProductos } from "@/lib/dal/admin/products";
import {
  estadoDeStock,
  listarStock,
  STOCK_POR_PAGINA,
  ultimosMovimientos,
  type FilaStock,
} from "@/lib/dal/admin/inventory";
import { loQueEstaPorLlegar } from "@/lib/dal/admin/ordenes-compra";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { formatearCantidad } from "@/lib/unidades";
import { AjusteRapido } from "./ajuste-rapido";
import { DialogoTransferencia } from "./dialogo-transferencia";

const etiquetaMovimiento: Record<string, string> = {
  ingreso: "Ingreso",
  egreso: "Egreso",
  ajuste: "Ajuste",
  transferencia_salida: "Salida",
  transferencia_entrada: "Entrada",
  venta: "Venta",
  devolucion: "Devolución",
};

type Params = {
  buscar?: string;
  cat?: string;
  estado?: string;
  marca?: string;
  prov?: string;
  pagina?: string;
};

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

  const [grilla, categorias, marcas, proveedores, movimientos, enCamino] =
    await Promise.all([
      listarStock({
        busqueda: params.buscar,
        categoria: params.cat,
        estado: params.estado,
        marca: params.marca,
        proveedor: params.prov,
        pagina,
      }),
      listarCategoriasAdmin(),
      marcasDeProductos(),
      conProveedores ? proveedoresParaElegir() : Promise.resolve(undefined),
      ultimosMovimientos(8),
      /*
       * Lo que ya está pedido y todavía no llegó.
       *
       * Es la respuesta a "¿ya pedimos esto?" en el lugar donde la pregunta
       * aparece. Sin esto, el encargado que ve tres placas en el estante pide
       * de nuevo lo que ya viene en camino.
       */
      loQueEstaPorLlegar(),
    ]);
  const { filas, total, conteos, sucursales } = grilla;
  const estado = estadoDeStock(params.estado) ?? "todos";

  const pedido = new Map(
    enCamino.map((p) => [
      p.variantId,
      { cantidad: Number(p.pendiente), llega: p.proximaEntrega },
    ]),
  );

  const verFicha = puedeEntrar("/admin/productos", usuario.staffRole);
  const paraAtender = conteos.reponer + conteos.sinStock;

  return (
    <div>
      <EncabezadoPanel
        titulo="Stock"
        resumen={
          paraAtender > 0
            ? `${plural(paraAtender, "medida")} para atender de ${conteos.todas}`
            : `${plural(conteos.todas, "medida")} en inventario`
        }
      >
        {/* El cruce de stock y ventas vive en su propio reporte: acá se mira
            cuánto hay, allá qué conviene comprar. */}
        <Link
          href="/admin/reportes/reposicion"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          Qué reponer
        </Link>
        <Link
          href="/admin/stock/etiquetas"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Barcode className="h-5 w-5" aria-hidden="true" />
          Etiquetas
        </Link>
        {puedeEntrar("/admin/migracion", usuario.staffRole) && (
          <Link
            href="/admin/migracion?que=stock"
            className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
          >
            <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
            Cargar desde Excel
          </Link>
        )}
        <DialogoTransferencia
          sucursales={sucursales.map((s) => ({ id: s.id, name: s.nombre }))}
        />
      </EncabezadoPanel>

      {/* Los grupos en el orden en que se atienden: lo que no hay, lo que se
          está por acabar y lo que está bien. */}
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
          { valor: "sin-stock", texto: "Sin stock", cantidad: conteos.sinStock, atencion: true },
          { valor: "reponer", texto: "Hay que reponer", cantidad: conteos.reponer, atencion: true },
          { valor: "con-stock", texto: "Con stock", cantidad: conteos.conStock },
        ]}
      />

      {filas.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed py-16 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">Ninguna medida coincide</p>
          <p className="mt-1 text-base text-muted-foreground">
            Probá con otro nombre, código o categoría.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 2xl:grid-cols-[1fr_320px]">
          <div>
            <Grilla filas={filas} enCamino={pedido} verFicha={verFicha} />
            <Paginador
              pagina={pagina}
              total={total}
              porPagina={STOCK_POR_PAGINA}
              params={params}
            />
          </div>

          <aside className="2xl:sticky 2xl:top-24 2xl:self-start">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Últimos movimientos
            </h2>
            {movimientos.length === 0 ? (
              <p className="rounded-xl border border-dashed px-3 py-6 text-center text-base text-muted-foreground">
                Todavía no se registró ningún movimiento.
              </p>
            ) : (
              <ul className="tarjeta-hundida overflow-hidden">
                {movimientos.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-baseline justify-between gap-3 border-b border-border/60 px-3 py-3 last:border-0"
                  >
                    <div className="min-w-0">
                      <EnlaceSi
                        si={verFicha}
                        href={`/admin/productos/${m.productId}`}
                        className="block truncate text-base hover:text-brand-orange hover:underline"
                      >
                        {m.productName}
                      </EnlaceSi>
                      <p className="truncate text-sm text-muted-foreground">
                        {m.label}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {etiquetaMovimiento[m.type] ?? m.type} · {m.branchName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {fechaHora.format(m.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`tabular shrink-0 text-base font-medium ${
                        m.qty > 0 ? "text-green-700" : "text-muted-foreground"
                      }`}
                    >
                      {m.qty > 0 ? `+${formatearCantidad(m.qty)}` : formatearCantidad(m.qty)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

/** `enCamino` es lo pedido y no recibido, por variante. Ver `loQueEstaPorLlegar`. */
function Grilla({
  filas,
  enCamino,
  verFicha,
}: {
  filas: FilaStock[];
  enCamino: Map<string, { cantidad: number; llega: Date | null }>;
  verFicha: boolean;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {filas.map((fila) => (
        <TarjetaStock
          key={fila.variantId}
          fila={fila}
          enCamino={enCamino.get(fila.variantId)}
          verFicha={verFicha}
        />
      ))}
    </div>
  );
}

function TarjetaStock({
  fila,
  enCamino,
  verFicha,
}: {
  fila: FilaStock;
  enCamino?: { cantidad: number; llega: Date | null };
  /** El depósito no entra a la ficha: el enlace lo rebotaba al inicio. */
  verFicha: boolean;
}) {
  const necesitaAtencion =
    fila.total === 0 || fila.sucursales.some((s) => s.nivel === "bajo");

  return (
    <article
      className={`flex gap-4 p-4 ${
        necesitaAtencion ? "tarjeta-atencion" : "tarjeta"
      }`}
    >
      <EnlaceSi
        si={verFicha}
        href={`/admin/productos/${fila.productId}`}
        className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg bg-muted"
      >
        {fila.imagen ? (
          <Image
            src={fila.imagen}
            alt={fila.productName}
            fill
            className="object-cover"
            sizes="96px"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-5 w-5" />
          </span>
        )}
      </EnlaceSi>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <EnlaceSi
              si={verFicha}
              href={`/admin/productos/${fila.productId}`}
              className="text-base font-medium leading-snug hover:text-brand-orange"
            >
              {fila.productName}
            </EnlaceSi>
            <p className="text-sm text-muted-foreground">{fila.label}</p>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="tabular">{fila.sku}</span>
              <Link
                href={`/admin/stock/etiquetas?m=${fila.variantId}`}
                aria-label={`Etiquetas de ${fila.productName} ${fila.label}`}
                title="Etiquetas"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
              >
                <Barcode className="h-4 w-4" aria-hidden="true" />
              </Link>
            </p>
          </div>
          {/* Mono solo en el número: «total», «en camino» y la fecha van en la
              letra del texto. En mono y sin encogerse le comían el ancho al
              nombre, y la tarjeta de la bisagra se desarmaba. */}
          <p className="shrink-0 text-right [font-variant-numeric:tabular-nums]">
            <span className="tabular block text-xl font-semibold">{formatearCantidad(fila.total)}</span>
            <span className="block text-sm text-muted-foreground">total</span>
            {/* Lo pedido va acá arriba, al lado del número que se mira para
                decidir si hay que reponer. Puesto en cualquier otro lado sería
                un dato que nadie cruza a tiempo. */}
            {enCamino && (
              <span className="estado-espera mt-1 block text-sm font-medium">
                +{formatearCantidad(enCamino.cantidad)} en camino
                {enCamino.llega
                  ? ` · ${new Date(enCamino.llega).toLocaleDateString("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                    })}`
                  : ""}
              </span>
            )}
          </p>
        </div>

        {/* Una columna por sucursal activa de la base: estaban escritas
            «Casa Central» y «Aserradero», y una sucursal nueva no aparecía. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
          {fila.sucursales.map((s) => (
            <div key={s.id}>
              <NivelStock
                sucursal={s.nombre}
                cantidad={s.qty}
                reservado={s.reservado}
                minimo={s.min}
                nivel={s.nivel}
                unidad={fila.unidad}
                largoMm={fila.unidad === "metro_lineal" ? fila.largoMm : null}
              />
              <div className="mt-2">
                <AjusteRapido
                  variantId={fila.variantId}
                  branchSlug={s.slug}
                  actual={s.qty}
                  unidad={fila.unidad}
                  largoMm={fila.largoMm}
                  sucursal={s.nombre}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

/** Un enlace, o el mismo contenido sin enlace para quien no puede entrar. */
function EnlaceSi({
  si,
  href,
  className,
  children,
}: {
  si: boolean;
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  if (si) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return <span className={`block ${className.replace(/hover:\S+/g, "")}`}>{children}</span>;
}
