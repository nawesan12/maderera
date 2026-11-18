import Image from "next/image";
import Link from "next/link";
import { Barcode, FileSpreadsheet, ImageOff, Package, PackageX, Plus, Star, Tags } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { leerPagina, Paginador } from "@/components/admin/paginador";
import { moneda, plural } from "@/components/admin/formato";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import {
  estadoDeProducto,
  listarCategoriasAdmin,
  listarProductosAdmin,
  marcasDeProductos,
  PRODUCTOS_POR_PAGINA,
  type ProductoAdmin,
} from "@/lib/dal/admin/products";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { BuscadorProductos } from "./buscador";

type Params = {
  buscar?: string;
  cat?: string;
  estado?: string;
  marca?: string;
  prov?: string;
  pagina?: string;
};

export default async function AdminProductosPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const usuario = await requireStaff();
  // Los proveedores son de Compras: quien no entra ahí no los ve ni filtra.
  const conProveedores = puedeEntrar("/admin/compras", usuario.staffRole);
  const pagina = leerPagina(params.pagina);
  const [lista, categorias, marcas, proveedores] = await Promise.all([
    listarProductosAdmin({
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
  ]);
  const { filas: productos, total, conteos } = lista;
  const estado = estadoDeProducto(params.estado) ?? "todos";

  return (
    <div>
      <EncabezadoPanel
        titulo="Productos"
        resumen={
          conteos.sinFoto > 0
            ? `${plural(conteos.todos, "producto")} · ${conteos.sinFoto} sin foto`
            : plural(conteos.todos, "producto")
        }
      >
        <Link href="/admin/migracion?que=productos">
          <button className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted">
            <FileSpreadsheet className="h-5 w-5" />
            Cargar desde Excel
          </button>
        </Link>
        <Link href="/admin/productos/rubros">
          <button className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted">
            <Tags className="h-5 w-5" />
            Categorías
          </button>
        </Link>
        <Link
          href="/admin/stock/etiquetas"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <Barcode className="h-5 w-5" />
          Etiquetas
        </Link>
        <Link href="/admin/productos/nuevo">
          <button className="boton-accion inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-base font-medium">
            <Plus className="h-5 w-5" />
            Nuevo producto
          </button>
        </Link>
        {/* Dar de baja es lo de menos mientras se carga el catálogo: va al final. */}
        <Link href="/admin/productos/candidatos">
          <button className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <PackageX className="h-5 w-5" />
            Candidatos a baja
          </button>
        </Link>
      </EncabezadoPanel>

      {/* Un producto sin foto en el catálogo se vende mucho menos: por eso
          «Sin foto» es el primer grupo después de todos y pide atención. */}
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
          { valor: "todos", texto: "Todos", cantidad: conteos.todos },
          { valor: "sin-foto", texto: "Sin foto", cantidad: conteos.sinFoto, atencion: true },
          { valor: "sin-precio", texto: "Sin precio", cantidad: conteos.sinPrecio, atencion: true },
          { valor: "sin-stock", texto: "Sin stock", cantidad: conteos.sinStock, atencion: true },
          { valor: "ocultos", texto: "Ocultos", cantidad: conteos.ocultos },
        ]}
      />

      {productos.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed py-16 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">Ningún producto coincide</p>
          <p className="mt-1 text-base text-muted-foreground">
            Probá con otras palabras o quitá el filtro de categoría.
          </p>
        </div>
      ) : (
        <div className="mt-[22px]">
          <Grilla productos={productos} />
          <Paginador
            pagina={pagina}
            total={total}
            porPagina={PRODUCTOS_POR_PAGINA}
            params={params}
          />
        </div>
      )}
    </div>
  );
}

function Grilla({ productos }: { productos: ProductoAdmin[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {productos.map((producto) => (
        <Tarjeta key={producto.id} producto={producto} />
      ))}
    </div>
  );
}

function Tarjeta({ producto }: { producto: ProductoAdmin }) {
  return (
    <article
      className={`tarjeta tarjeta-activa flex flex-col overflow-hidden ${
        producto.active ? "" : "opacity-70"
      }`}
    >
      <Link
        href={`/admin/productos/${producto.id}`}
        className="relative block aspect-[4/3] bg-muted"
      >
        {producto.imagen ? (
          <Image
            src={producto.imagen}
            alt={producto.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 300px"
          />
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <ImageOff className="h-7 w-7" />
            <span className="text-sm">Sin foto</span>
          </span>
        )}

        {producto.featured && (
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-accion px-2 py-0.5 text-sm font-medium text-white">
            <Star className="h-3.5 w-3.5" fill="currentColor" />
            Destacado
          </span>
        )}

        {!producto.active && (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-foreground/80 px-2 py-0.5 text-sm font-medium text-background">
            Oculto
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <p className="text-sm text-muted-foreground">
          {producto.categoryName}
          {producto.brand && ` · ${producto.brand}`}
        </p>

        <Link
          href={`/admin/productos/${producto.id}`}
          className="text-base font-medium leading-snug hover:text-brand-orange"
        >
          {producto.name}
        </Link>

        <p className="tabular mt-1.5 text-lg font-semibold">
          {producto.precioDesde
            ? moneda.format(Number(producto.precioDesde))
            : "Sin precio"}
        </p>

        <dl className="mt-auto flex items-baseline justify-between gap-3 border-t pt-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Medidas</dt>
            <dd className="tabular">{producto.variantes}</dd>
          </div>
          <div className="text-right">
            <dt className="text-muted-foreground">Stock</dt>
            <dd
              className={`tabular ${
                producto.stockTotal === 0 ? "text-brand-orange" : ""
              }`}
            >
              {producto.stockTotal}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
