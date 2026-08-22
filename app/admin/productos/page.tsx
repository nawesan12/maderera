import Image from "next/image";
import Link from "next/link";
import { ImageOff, Package, Plus, Star } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { GrupoListado } from "@/components/admin/grupo";
import { moneda, plural } from "@/components/admin/formato";
import {
  listarCategoriasAdmin,
  listarProductosAdmin,
  type ProductoAdmin,
} from "@/lib/dal/admin/products";
import { BuscadorProductos } from "./buscador";

export default async function AdminProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string; cat?: string }>;
}) {
  const params = await searchParams;
  const [productos, categorias] = await Promise.all([
    listarProductosAdmin({ busqueda: params.buscar, categoria: params.cat }),
    listarCategoriasAdmin(),
  ]);

  // Un producto sin foto en el catálogo se vende mucho menos, así que se
  // separan arriba en lugar de quedar perdidos entre los demás.
  const sinFoto = productos.filter((p) => p.sinFoto && p.active);
  const resto = productos.filter((p) => !p.sinFoto || !p.active);

  return (
    <div>
      <EncabezadoPanel
        titulo="Productos"
        detalle={
          sinFoto.length > 0
            ? `${plural(productos.length, "producto")} · ${sinFoto.length} sin foto`
            : plural(productos.length, "producto")
        }
      >
        <Link href="/admin/productos/nuevo">
          <button className="boton-accion inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-base font-medium">
            <Plus className="h-5 w-5" />
            Nuevo producto
          </button>
        </Link>
      </EncabezadoPanel>

      <BuscadorProductos
        categorias={categorias}
        busquedaActual={params.buscar ?? ""}
        categoriaActual={params.cat ?? "todos"}
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
        <>
          <GrupoListado
            titulo="Les falta la foto"
            cantidad={sinFoto.length}
            detalle="Se ven vacíos en el catálogo"
            destacado
          >
            <Grilla productos={sinFoto} />
          </GrupoListado>

          <GrupoListado
            titulo={sinFoto.length > 0 ? "El resto del catálogo" : "Catálogo"}
            cantidad={resto.length}
          >
            <Grilla productos={resto} />
          </GrupoListado>
        </>
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
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-brand-orange px-2 py-0.5 text-sm font-medium text-white">
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
