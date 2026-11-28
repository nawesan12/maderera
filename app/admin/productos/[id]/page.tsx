import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import {
  ArrowLeft,
  Barcode,
  CheckCircle2,
  Copy,
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
  listarRubrosAdmin,
  obtenerProductoAdmin,
  sugeridosDelProducto,
  imputacionesUsadas,
  atributosUsados,
} from "@/lib/dal/admin/products";
import { FormularioProducto } from "../formulario";
import { stocksDeFicha } from "../stocks";
import { ProductosSugeridos } from "../sugeridos";

export default async function EditarProductoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ guardado?: string; pestana?: string }>;
}) {
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const { guardado, pestana } = await searchParams;
  const [producto, categorias, rubros, sugeridos, candidatos, imputaciones, atributos] =
    await Promise.all([
      obtenerProductoAdmin(id),
      listarCategoriasAdmin(),
      listarRubrosAdmin(),
      sugeridosDelProducto(id),
      candidatosParaSugerir(id),
      imputacionesUsadas(),
      atributosUsados(),
    ]);

  if (!producto) notFound();

  // El encabezado resume lo que hay que saber antes de editar: si se ve en el
  // sitio, cuánto stock queda y en qué rango está el precio.
  const stockTotal = producto.variantes.reduce(
    (s, v) => s + v.stocks.reduce((t, st) => t + st.stock, 0),
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

      {guardado && (
        <p
          role="status"
          className="estado-ok flex items-center gap-2 rounded-lg bg-[var(--estado-fondo)] px-4 py-3 text-base text-[var(--estado-tinta)]"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          {pestana === "fotos" ? "Producto creado. Ahora sus fotos." : "Guardado."}
        </p>
      )}

      {/* Encabezado con contexto. El nombre va a todo el ancho y las
          acciones en una fila debajo: en una columna a la derecha, a 375 el
          título se partía letra por letra y el estado quedaba tapado (mes
          simulado, M2S2-033 y M3S2-011). */}
      <div className="tarjeta space-y-5 p-5">
        <div className="flex items-start gap-4">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden sm:h-28 sm:w-28 rounded-xl bg-muted">
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
              <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">
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
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
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

        <div className="flex flex-wrap gap-2">
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
            href={`/admin/productos/nuevo?copiar=${producto.id}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
          >
            <Copy className="h-4 w-4" />
            Duplicar
          </Link>
          <Link
            href={`/admin/stock?buscar=${encodeURIComponent(producto.name)}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
          >
            <Package className="h-4 w-4" />
            Stock
          </Link>
          <Link
            href={`/admin/stock/etiquetas?producto=${producto.id}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
          >
            <Barcode className="h-4 w-4" />
            Etiquetas
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
        key={guardado ?? "ficha"}
        categorias={categorias}
        rubros={rubros}
        imputaciones={imputaciones}
        atributos={atributos}
        pestanaInicial={pestana === "fotos" || pestana === "medidas" ? pestana : "datos"}
        galeria={producto.galeria}
        inicial={{
          id: producto.id,
          name: producto.name,
          slug: producto.slug,
          categoryId: producto.categoryId,
          subcategory: producto.subcategory ?? "",
          subcategoryId: producto.subcategoryId ?? "",
          description: producto.description,
          brand: producto.brand ?? "",
          unit: producto.unit,
          formaDeVenta: producto.formaDeVenta,
          precioMediaPct: String(producto.precioMediaPct),
          alicuotaIva: String(Number(producto.alicuotaIva ?? 21)),
          recargoElaboracionPct: producto.recargoElaboracionPct
            ? String(Number(producto.recargoElaboracionPct))
            : "",
          imputacion: producto.imputacion ?? "",
          usos: producto.usos ?? "",
          cuidados: producto.cuidados ?? "",
          featured: producto.featured,
          aPedido: producto.aPedido,
          active: producto.active,
          imagen: producto.imagen,
          variantes: producto.variantes.map((v) => ({ ...v, stocks: stocksDeFicha(v.stocks) })),
        }}
        sucursales={producto.sucursales}
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
