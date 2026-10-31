import type { Metadata } from "next";
import { enlaceWhatsapp, numeroWhatsapp } from "@/lib/whatsapp/enlace";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronRight,
  MessageCircle,
  Ruler,
  Store,
  Truck,
} from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { GaleriaProducto } from "@/components/catalogo/galeria-producto";
import { SelectorVarianteDeQuienMira } from "@/components/catalogo/selector-variante";
import { preciosDeFicha } from "@/lib/dal/visitante";
import {
  obtenerProductoPublico,
  productosSugeridos,
} from "@/lib/dal/catalog";
import { AvisoGremio } from "@/components/catalogo/aviso-gremio";
import { combinedStockLevel } from "@/lib/stock-level";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { resenasDelProducto, resumenDeResenas } from "@/lib/dal/resenas";
import { ResenasDelProducto } from "@/components/catalogo/resenas";
import {
  metadatosDePagina,
  migasJsonLd,
  precioEnTexto,
  productoJsonLd,
  recortar,
  urlAbsoluta,
} from "@/lib/seo";
import { rutasDelCatalogo } from "@/lib/dal/sitemap";
import { degradar } from "@/lib/degradar";
import { hoyEnCurso } from "@/lib/reloj";

/**
 * Unas pocas fichas se arman en el build; el resto, en la primera visita.
 *
 * Antes devolvía la lista vacía, que era la forma de decirle a Next «esta ruta
 * es prerenderizable» sin pedirle nada a la base al compilar. Con Cache
 * Components eso ya no vale: Next exige **al menos un** parámetro, porque es
 * con esa muestra que verifica en el build que la página no lee nada por
 * pedido fuera de un `<Suspense>`. Si la muestra no existiera, el error
 * aparecería recién con la primera visita.
 *
 * El build ya necesita la base —la portada se arma ahí, y el `Dockerfile` la
 * pide—, así que se toman las primeras fichas del catálogo. Si la base está
 * vacía o no contesta, va un slug que no existe: la ficha da 404 en el build
 * y la verificación se hace igual.
 *
 * **Un costo conocido:** una ficha que no existe responde 200 con la pantalla
 * de «no encontrado» y `noindex`, y no un 404. La parte armada de antemano
 * sale antes de saber si el producto existe, y con ella el código de estado.
 * Para los buscadores alcanza —el `noindex` la saca del índice— y se probó
 * que llamar a `notFound()` desde `generateMetadata` no lo cambia.
 */
const FICHAS_DEL_BUILD = 12;

export async function generateStaticParams() {
  const rutas = await degradar("las fichas del build", rutasDelCatalogo, []);
  const slugs = rutas
    .map((r) => r.ruta.replace(/^\/catalogo\//, ""))
    .filter((s) => s && !s.includes("/"))
    .slice(0, FICHAS_DEL_BUILD);
  return (slugs.length > 0 ? slugs : ["sin-productos"]).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const producto = await obtenerProductoPublico(slug);

  if (!producto) return { title: "Producto no encontrado", robots: { index: false } };

  /*
   * El título y la descripción con lo que decide la compra: qué es, la marca,
   * desde cuánto sale y en cuántas medidas. La descripción cargada en el panel
   * puede venir vacía o ser una línea genérica; los datos de la ficha siempre
   * están y son distintos en cada producto.
   */
  const precios = producto.variantes
    .map((v) => Number(v.precio))
    .filter((n) => Number.isFinite(n) && n > 0);
  const desde = precios.length ? Math.min(...precios) : null;
  const medidas = producto.variantes.length;

  const marca = producto.brand && !producto.name.includes(producto.brand)
    ? ` ${producto.brand}`
    : "";
  const datos = [
    desde
      ? `${medidas > 1 ? "Desde " : ""}${precioEnTexto(desde)} precio final con IVA${medidas > 1 ? `, en ${medidas} medidas` : ""}.`
      : null,
    "Retiro en Casa Central o el Aserradero, o envío en Mar del Plata.",
  ]
    .filter(Boolean)
    .join(" ");

  return metadatosDePagina({
    titulo: `${producto.name}${marca} — ${producto.categoryName} en Mar del Plata`,
    // La primera oración de la descripción cargada, si entra; si no, la
    // descripción recortada. Después, los datos de la ficha.
    descripcion: producto.description
      ? `${primeraOracion(producto.description, 100)} ${datos}`
      : `${producto.name}${marca}. ${datos}`,
    ruta: `/catalogo/${slug}`,
    imagen: {
      url: `/og/producto/${slug}`,
      ancho: 1200,
      alto: 630,
      alt: producto.name,
    },
  });
}

/** La primera oración, con su punto, o el texto recortado si es muy larga. */
function primeraOracion(texto: string, limite: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  const fin = limpio.search(/[.!?](\s|$)/);
  if (fin > 0 && fin < limite) return limpio.slice(0, fin + 1);
  return recortar(limpio, limite);
}

export default async function ProductoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const producto = await obtenerProductoPublico(slug);

  if (!producto) notFound();

  const sugeridos = await productosSugeridos(
    producto.id,
    producto.categorySlug,
    producto.slug,
  );

  const [whatsapp, numeroDelNegocio, resenas, resumenResenas, hoy] =
    await Promise.all([
      // Con el enlace a la ficha: quien atiende ve de qué producto se habla
      // sin preguntar, y WhatsApp lo muestra como tarjeta con la foto.
      enlaceWhatsapp(
        `Hola! Me interesa: ${producto.name}. ¿Podrían darme más información?\n${urlAbsoluta(`/catalogo/${producto.slug}`)}`,
      ),
      numeroWhatsapp(),
      resenasDelProducto(producto.id),
      resumenDeResenas(producto.id),
      hoyEnCurso(),
    ]);

  // Las medidas se arman de las variantes: si ninguna las tiene cargadas, la
  // ficha técnica no se muestra en lugar de quedar con guiones.
  const conMedidas = producto.variantes.filter(
    (v) => v.largoMm || v.anchoMm || v.espesorMm,
  );

  // Lo que ve el buscador: el producto con una oferta por medida y las migas
  // de pan, que es lo que Google muestra en vez de la URL cruda.
  const marcado = [
    productoJsonLd({
      slug: producto.slug,
      name: producto.name,
      description: producto.description,
      brand: producto.brand,
      categoryName: producto.categoryName,
      imagenes: producto.imagenes,
      aPedido: producto.aPedido,
      resenas: resumenResenas,
      variantes: producto.variantes.map((v) => ({
        sku: v.sku,
        label: v.label,
        precio: v.precio,
        disponibilidad: combinedStockLevel([v.stockCentral, v.stockAserradero]),
        color: v.color,
        conMedidas: Boolean(v.largoMm || v.anchoMm || v.espesorMm),
      })),
    }, new Date(`${hoy}T12:00:00Z`)),
    migasJsonLd([
      { nombre: "Inicio", ruta: "/" },
      { nombre: "Catálogo", ruta: "/catalogo" },
      { nombre: producto.categoryName, ruta: `/catalogo?cat=${producto.categorySlug}` },
      ...(producto.subcategorySlug && producto.subcategoryName
        ? [
            {
              nombre: producto.subcategoryName,
              ruta: `/catalogo?cat=${producto.categorySlug}&rubro=${producto.subcategorySlug}`,
            },
          ]
        : []),
      { nombre: producto.name, ruta: `/catalogo/${producto.slug}` },
    ]),
  ];

  return (
    <div className="min-h-screen bg-sitio-alt">
      <DatosEstructurados datos={marcado} />

      {/* Breadcrumb */}
      <div className="border-b border-linea-suave bg-card">
        <div className="contenedor py-3.5">
          <nav
            className="flex flex-wrap items-center gap-2 text-[13.5px] text-texto-3"
            aria-label="Ubicación"
          >
            <Link href="/" className="transition-colors hover:text-acento-texto">
              Inicio
            </Link>
            <ChevronRight className="h-3 w-3" />
            <Link
              href="/catalogo"
              className="transition-colors hover:text-acento-texto"
            >
              Catálogo
            </Link>
            <ChevronRight className="h-3 w-3" />
            <Link
              href={`/catalogo?cat=${producto.categorySlug}`}
              className="transition-colors hover:text-acento-texto"
            >
              {producto.categoryName}
            </Link>
            {producto.subcategorySlug && producto.subcategoryName && (
              <>
                <ChevronRight className="h-3 w-3" />
                <Link
                  href={`/catalogo?cat=${producto.categorySlug}&rubro=${producto.subcategorySlug}`}
                  className="transition-colors hover:text-acento-texto"
                >
                  {producto.subcategoryName}
                </Link>
              </>
            )}
            <ChevronRight className="h-3 w-3" />
            <span className="font-medium text-foreground" aria-current="page">
              {producto.name}
            </span>
          </nav>
        </div>
      </div>

      <div className="contenedor py-8">
        {/* `[&>*]:min-w-0` no es adorno: un hijo de grid arranca con
            `min-width: auto`, así que se planta en el ancho mínimo de su
            contenido y se niega a encoger. Con eso, la columna medía 380 px
            dentro de una pista de 342 y empujaba el ancho del documento entero:
            en el teléfono la página quedaba corrida y se podía arrastrar de
            costado. Medido: 403 px de scroll en una pantalla de 390. */}
        <div className="grid gap-9 lg:grid-cols-2 lg:items-start [&>*]:min-w-0">
          <GaleriaProducto
            imagenes={producto.imagenes}
            nombre={producto.name}
            destacado={producto.featured}
          />

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-acento-texto">
              {producto.subcategory ?? producto.categoryName}
            </p>
            <h1 className="mt-2 text-[34px] font-bold leading-[1.15] tracking-[-0.03em]">
              {producto.name}
            </h1>
            {producto.brand && (
              <p className="mt-2 text-[15px] text-texto-2">
                Marca{" "}
                <span className="font-semibold text-foreground">
                  {producto.brand}
                </span>
              </p>
            )}
            <p className="mt-3.5 max-w-[520px] text-base leading-relaxed text-texto-2">
              {producto.description}
            </p>

            <div className="mt-6">
              <SelectorVarianteDeQuienMira
                // Sin esperar: la ficha sale armada y solo el precio espera.
                precios={preciosDeFicha(producto.variantes.map((v) => v.id))}
                productName={producto.name}
                unit={producto.unit}
                variantes={producto.variantes}
                whatsapp={whatsapp}
                alicuota={Number(producto.alicuotaIva) || 21}
                aPedido={producto.aPedido}
                formaDeVenta={producto.formaDeVenta}
                precioMediaPct={producto.precioMediaPct}
              />
            </div>

            {/* Se retira solo si hay sesión: lo resuelve el servidor en la
                misma respuesta. */}
            <AvisoGremio className="mt-3.5" />

            {/* Cómo lo recibe */}
            <ul className="mt-3.5 grid gap-3 sm:grid-cols-2">
              <li className="rounded-xl border border-linea bg-card px-4 py-3.5">
                <span className="flex items-center gap-2 text-[14.5px] font-semibold">
                  <Store className="h-[18px] w-[18px] shrink-0 text-acento-texto" />
                  Retiro sin cargo
                </span>
                <p className="mt-1.5 text-[13.5px] leading-snug text-texto-2">
                  En Casa Central o en el Aserradero, con el número de pedido.
                </p>
              </li>
              <li className="rounded-xl border border-linea bg-card px-4 py-3.5">
                <span className="flex items-center gap-2 text-[14.5px] font-semibold">
                  <Truck className="h-[18px] w-[18px] shrink-0 text-acento-texto" />
                  Envío a domicilio
                </span>
                <p className="mt-1.5 text-[13.5px] leading-snug text-texto-2">
                  En Mar del Plata y zona. El costo se calcula al finalizar.
                </p>
              </li>
            </ul>

            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex h-[50px] items-center justify-center gap-2.5 rounded-[10px] border border-verde-whatsapp/35 bg-verde-whatsapp/10 text-[15.5px] font-semibold text-verde-whatsapp transition-colors hover:bg-verde-whatsapp/20"
            >
              <MessageCircle className="h-[18px] w-[18px]" />
              Consultar por WhatsApp
            </a>
          </div>
        </div>

        {/* Ficha técnica */}
        {conMedidas.length > 0 && (
          <section className="mt-11">
            <h2 className="mb-3.5 flex items-center gap-2 text-2xl font-bold tracking-[-0.025em]">
              <Ruler className="h-5 w-5 text-acento-texto" />
              Medidas disponibles
            </h2>
            {/* Cinco columnas no entran en un teléfono: la tabla scrollea sola
                en su caja en vez de cortarse contra el borde de la pantalla. El
                fondo sale del token y no de `bg-white`, que en tema oscuro
                dejaba texto claro sobre blanco. Con tabIndex y nombre: sin eso,
                con el teclado no se podía correr la tabla. */}
            <div
              tabIndex={0}
              role="region"
              aria-label="Medidas disponibles"
              className="overflow-x-auto rounded-2xl border border-linea bg-card shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento-texto"
            >
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th className="px-5 py-3 text-sm font-semibold">Medida</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">
                      Largo
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">
                      Ancho
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">
                      Espesor
                    </th>
                    <th className="px-5 py-3 text-sm font-semibold">Material</th>
                  </tr>
                </thead>
                <tbody>
                  {conMedidas.map((v) => (
                    <tr key={v.id} className="border-b last:border-0">
                      <td className="px-5 py-3 text-sm font-medium">
                        {v.label}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-sm text-muted-foreground">
                        {v.largoMm ? `${v.largoMm} mm` : "—"}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-sm text-muted-foreground">
                        {v.anchoMm ? `${v.anchoMm} mm` : "—"}
                      </td>
                      <td className="tabular px-4 py-3 text-right text-sm text-muted-foreground">
                        {v.espesorMm ? `${v.espesorMm} mm` : "—"}
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">
                        {v.material ?? v.color ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <ResenasDelProducto resenas={resenas} resumen={resumenResenas} />

        {/*
          Sugeridos. Los complementarios van primero y solo si alguien los
          cargó: son los que suben el ticket —el sellador del deck, los clavos
          del machimbre— y los que le ahorran a la persona un segundo viaje.
        */}
        {sugeridos.complementarios.length > 0 && (
          <section className="mt-11">
            <div className="mb-5">
              <h2 className="text-xl font-bold">También vas a necesitar</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Lo que se lleva junto con {producto.name}.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {sugeridos.complementarios.map((p) => (
                <ProductCard key={p.id} product={p} whatsapp={numeroDelNegocio} />
              ))}
            </div>
          </section>
        )}

        {sugeridos.similares.length > 0 && (
          <section className="mt-11">
            <div className="mb-5 flex items-baseline justify-between gap-4">
              <h2 className="text-xl font-bold">
                {sugeridos.similaresPorCategoria
                  ? `Otros productos de ${producto.categoryName}`
                  : "Alternativas"}
              </h2>
              <Link
                href={`/catalogo?cat=${producto.categorySlug}`}
                className="text-sm font-medium text-acento-texto hover:underline"
              >
                Ver todos
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {sugeridos.similares.map((p) => (
                <ProductCard key={p.id} product={p} whatsapp={numeroDelNegocio} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
