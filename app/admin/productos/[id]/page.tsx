import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  ImageOff,
  Package,
  Tags,
} from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { moneda } from "@/components/admin/formato";
import {
  candidatosParaSugerir,
  listarCategoriasAdmin,
  obtenerProductoAdmin,
  sugeridosDelProducto,
} from "@/lib/dal/admin/products";
import { FormularioProducto } from "../formulario";
import { ProductosSugeridos } from "../sugeridos";

export default async function EditarProductoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [producto, categorias, sugeridos, candidatos] = await Promise.all([
    obtenerProductoAdmin(id),
    listarCategoriasAdmin(),
    sugeridosDelProducto(id),
    candidatosParaSugerir(id),
  ]);

  if (!producto) notFound();

  // El encabezado resume lo que hay que saber antes de editar: si se ve en el
  // sitio, cuánto stock queda y en qué rango está el precio.
  const stockTotal = producto.variantes.reduce(
    (s, v) => s + v.stockCentral + v.stockAserradero,
    0,
  );
  const precios = producto.variantes
    .map((v) => Number(v.precioGeneral))
    .filter((p) => p > 0);
  const sinPrecio = producto.variantes.length - precios.length;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/productos"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a productos
      </Link>

      {/* Encabezado con contexto */}
      <div className="tarjeta flex flex-wrap items-start gap-5 p-5">
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl bg-muted">
          {producto.imagen ? (
            <Image
              src={producto.imagen}
              alt={producto.name}
              fill
              className="object-cover"
              sizes="112px"
            />
          ) : (
            <span className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
              <ImageOff className="h-6 w-6" />
              <span className="text-sm">Sin foto</span>
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              {producto.name}
            </h1>
            <EtiquetaEstado estado={producto.active ? "activo" : "inactivo"} />
            {producto.featured && (
              <span className="rounded-full bg-brand-orange/15 px-2.5 py-1 text-sm font-medium text-brand-orange-dark">
                Destacado
              </span>
            )}
          </div>

          <p className="mt-0.5 text-base text-muted-foreground">
            {[
              categorias.find((c) => c.id === producto.categoryId)?.name,
              producto.subcategory,
              producto.brand,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
            <Dato
              etiqueta="Medidas"
              valor={String(producto.variantes.length)}
              detalle={sinPrecio > 0 ? `${sinPrecio} sin precio` : undefined}
              alerta={sinPrecio > 0}
            />
            <Dato
              etiqueta="Stock total"
              valor={String(stockTotal)}
              detalle={stockTotal === 0 ? "agotado" : undefined}
              alerta={stockTotal === 0}
            />
            <Dato
              etiqueta="Precio"
              valor={
                precios.length > 0
                  ? moneda.format(Math.min(...precios))
                  : "Sin cargar"
              }
              detalle={
                precios.length > 1
                  ? `hasta ${moneda.format(Math.max(...precios))}`
                  : undefined
              }
              alerta={precios.length === 0}
            />
            <Dato
              etiqueta="Fotos"
              valor={String(producto.galeria.length)}
              detalle={producto.galeria.length === 0 ? "falta cargar" : undefined}
              alerta={producto.galeria.length === 0}
            />
          </dl>
        </div>

        <div className="flex flex-col gap-2">
          {producto.active && (
            <a
              href={`/catalogo/${producto.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
            >
              Ver en el sitio
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <Link
            href={`/admin/stock?buscar=${encodeURIComponent(producto.name)}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
          >
            <Package className="h-4 w-4" />
            Stock
          </Link>
          <Link
            href={`/admin/precios?buscar=${encodeURIComponent(producto.name)}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
          >
            <Tags className="h-4 w-4" />
            Precios
          </Link>
        </div>
      </div>

      <FormularioProducto
        categorias={categorias}
        galeria={producto.galeria}
        inicial={{
          id: producto.id,
          name: producto.name,
          slug: producto.slug,
          categoryId: producto.categoryId,
          subcategory: producto.subcategory ?? "",
          description: producto.description,
          brand: producto.brand ?? "",
          unit: producto.unit,
          featured: producto.featured,
          active: producto.active,
          imagen: producto.imagen,
          variantes: producto.variantes,
        }}
      />

      <ProductosSugeridos
        productId={producto.id}
        cargados={sugeridos}
        candidatos={candidatos}
      />
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
  detalle,
  alerta = false,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  alerta?: boolean;
}) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{etiqueta}</dt>
      <dd
        className={`tabular text-lg font-semibold ${
          alerta ? "text-brand-orange" : ""
        }`}
      >
        {valor}
      </dd>
      {detalle && (
        <dd
          className={`text-sm ${alerta ? "text-brand-orange" : "text-muted-foreground"}`}
        >
          {detalle}
        </dd>
      )}
    </div>
  );
}
