import type { Metadata } from "next";
import { numeroWhatsapp } from "@/lib/whatsapp/enlace";
import { Suspense } from "react";
import Link from "next/link";
import { Search, Tag, Truck, Store, Headphones } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { ProductCardSkeleton } from "@/components/product-card-skeleton";
import {
  BarraCatalogo,
  PanelCategorias,
} from "@/components/catalogo/filtros";
import {
  listarCategorias,
  productosEnOferta,
  paginaDeProductos,
  type OrdenCatalogo,
} from "@/lib/dal/catalog";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd } from "@/lib/seo";

interface Params {
  cat?: string;
  buscar?: string;
  stock?: string;
  orden?: string;
  ofertas?: string;
  pagina?: string;
}

/**
 * Metadata por filtro.
 *
 * Sin esto, `/catalogo?cat=placas` y `/catalogo?buscar=fenolico` son para
 * Google la misma página que `/catalogo` repetida cien veces, y el sitio
 * compite consigo mismo. Cada categoría es una página propia con su título y
 * su canónica; **la búsqueda y los ordenamientos no se indexan**, porque son
 * combinaciones infinitas de las mismas fichas.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Params>;
}): Promise<Metadata> {
  const params = await searchParams;

  const base: Metadata = {
    keywords: [
      "madera mar del plata",
      "placas melamina",
      "tirantes pino",
      "machimbre",
      "fenolicos",
      "molduras",
      "decks",
      "construccion en seco",
      "maderera",
    ],
  };

  /*
   * Las páginas siguientes no se indexan.
   *
   * Cada una contiene a la anterior —"Ver más" agrega, no reemplaza—, así que
   * indexarlas sería ofrecerle al buscador cinco versiones del mismo catálogo
   * con la primera repetida en todas. La canónica apunta a la página uno, que
   * es la que tiene que aparecer.
   */
  if (
    params.buscar ||
    params.orden ||
    params.ofertas ||
    params.stock ||
    (params.pagina && params.pagina !== "1")
  ) {
    return {
      ...base,
      title: params.buscar ? `Buscar "${params.buscar}"` : "Catálogo de productos",
      robots: { index: false, follow: true },
      alternates: { canonical: "/catalogo" },
    };
  }

  if (params.cat && params.cat !== "todos") {
    const categorias = await listarCategorias();
    const categoria = categorias.find((c) => c.slug === params.cat);

    if (categoria) {
      const descripcion =
        categoria.description ||
        `${categoria.name} en Maderera Juan B. Justo, Mar del Plata. Precios y disponibilidad por sucursal.`;

      return {
        ...base,
        title: `${categoria.name} en Mar del Plata`,
        description: descripcion,
        alternates: { canonical: `/catalogo?cat=${categoria.slug}` },
        openGraph: { title: `${categoria.name} | Maderera Juan B. Justo`, description: descripcion },
      };
    }
  }

  return {
    ...base,
    title: "Catálogo de productos",
    description:
      "Explorá nuestro catálogo completo: techos, placas, pisos, molduras, ferretería, decks, construcción en seco y cubiertas. Stock disponible en Mar del Plata.",
    alternates: { canonical: "/catalogo" },
    openGraph: {
      title: "Catálogo de productos",
      description:
        "Productos para construcción y carpintería, con stock consultable entre sucursales.",
    },
  };
}

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;

  const categoriaActual =
    params.cat && params.cat !== "todos"
      ? (await listarCategorias()).find((c) => c.slug === params.cat)
      : undefined;

  const migas = migasJsonLd([
    { nombre: "Inicio", ruta: "/" },
    { nombre: "Catálogo", ruta: "/catalogo" },
    ...(categoriaActual
      ? [{ nombre: categoriaActual.name, ruta: `/catalogo?cat=${categoriaActual.slug}` }]
      : []),
  ]);

  return (
    <div className="min-h-screen bg-sitio-alt">
      <DatosEstructurados datos={migas} />
      <Encabezado />
      <FranjaConfianza />

      <div className="contenedor py-8">
        <Suspense fallback={<div className="mb-6 h-11" />}>
          <Barra params={params} />
        </Suspense>

        <div className="mt-[22px] lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:items-start lg:gap-[26px]">
          <Suspense fallback={null}>
            <Lateral params={params} />
          </Suspense>

          <Suspense key={JSON.stringify(params)} fallback={<GrillaCargando />}>
            <Resultados params={params} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function Encabezado() {
  return (
    <div className="relative overflow-hidden bg-oscuro-marca pb-11 pt-10 text-white">
      <div
        className="absolute inset-0 bg-[repeating-linear-gradient(-45deg,rgb(240_115_22_/_0.07)_0_12px,transparent_12px_24px)]"
        aria-hidden="true"
      />
      <div className="contenedor relative">
        {/* Las migas de la cabecera acompañan al JSON-LD que ya se emite: lo
            que declara el marcado y lo que ve la persona coinciden. */}
        <nav
          aria-label="Miga de pan"
          className="flex items-center gap-2 text-[13.5px] text-white/60"
        >
          <Link href="/" className="transition-colors hover:text-white">
            Inicio
          </Link>
          <span aria-hidden="true">&rsaquo;</span>
          <span className="text-white">Catálogo</span>
        </nav>
        <h1 className="mt-3.5 text-[42px] font-extrabold tracking-[-0.035em]">
          Catálogo
        </h1>
        <p className="mt-2 max-w-[520px] text-[17px] text-white/70">
          Maderas, placas, molduras y todo lo que necesita tu obra, con precios
          y disponibilidad al día.
        </p>
      </div>
    </div>
  );
}

/** Lo que responde las dudas de siempre, antes de que haya que preguntarlas. */
function FranjaConfianza() {
  const puntos = [
    { icono: Truck, texto: "Envíos en Mar del Plata y zona" },
    { icono: Store, texto: "Retiro sin cargo en sucursal" },
    { icono: Tag, texto: "Precios para profesionales" },
    { icono: Headphones, texto: "Asesoramiento sin cargo" },
  ];

  return (
    <div className="border-b border-linea-suave bg-card">
      <ul className="contenedor grid grid-cols-2 gap-x-6 gap-y-3 py-4 lg:grid-cols-4">
        {puntos.map((p) => (
          <li key={p.texto} className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-naranja-claro text-acento-texto">
              <p.icono className="h-4 w-4" />
            </span>
            <span className="text-sm leading-[1.35] text-texto-2">
              {p.texto}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * El panel de filtros, que va en dos lugares: el cajón del teléfono y la
 * columna del escritorio. Se arma dos veces —son dos árboles distintos— pero
 * sus dos consultas están memoizadas, así que a la base se le pide una vez.
 */
async function armarPanel(params: Params) {
  const [categorias, ofertas] = await Promise.all([
    listarCategorias(),
    productosEnOferta(),
  ]);

  return (
    <PanelCategorias
      categorias={categorias.map((c) => ({
        slug: c.slug,
        name: c.name,
        productCount: c.productCount,
      }))}
      categoriaActual={params.cat ?? "todos"}
      stockActual={params.stock ?? "todos"}
      soloOfertas={params.ofertas === "1"}
      cantidadOfertas={ofertas.length}
      hayBusqueda={Boolean(params.buscar)}
    />
  );
}

async function Barra({ params }: { params: Params }) {
  return (
    <BarraCatalogo
      busquedaActual={params.buscar ?? ""}
      ordenActual={params.orden ?? "relevancia"}
    >
      {await armarPanel(params)}
    </BarraCatalogo>
  );
}

async function Lateral({ params }: { params: Params }) {
  return (
    <aside className="hidden lg:sticky lg:top-[88px] lg:block">
      {await armarPanel(params)}
    </aside>
  );
}

async function Resultados({ params }: { params: Params }) {
  const pagina = Math.max(1, Number(params.pagina) || 1);
  const whatsapp = await numeroWhatsapp();

  const { productos, total, hayMas, topeAlcanzado } = await paginaDeProductos(
    {
      categoria: params.cat,
      busqueda: params.buscar,
      stock: params.stock as never,
      orden: (params.orden as OrdenCatalogo) ?? "relevancia",
      soloOfertas: params.ofertas === "1",
    },
    pagina,
  );

  if (productos.length === 0) {
    return (
      <div className="rounded-[14px] border border-linea bg-card p-16 text-center shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[14px] bg-chip">
          <Search className="h-7 w-7 text-texto-3" />
        </div>
        <h2 className="text-lg font-bold">No encontramos nada así</h2>
        <p className="mt-1.5 text-sm text-texto-2">
          Probá con otra palabra o mirá el catálogo completo.
        </p>
        <Link
          href="/catalogo"
          className="mt-5 inline-block rounded-[10px] bg-accion px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accion-hover"
        >
          Ver todo el catálogo
        </Link>
      </div>
    );
  }

  const enOferta = productos.filter((p) => p.descuento !== null).length;

  return (
    <div>
      <p className="mb-4 text-[15px] text-texto-2">
        <span className="tabular font-semibold text-foreground">{total}</span>{" "}
        {total === 1 ? "producto" : "productos"}
        {enOferta > 0 && (
          <>
            {" · "}
            <span className="tabular text-rojo-oferta">
              {enOferta} en oferta
            </span>
          </>
        )}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {productos.map((producto) => (
          <ProductCard key={producto.id} product={producto} whatsapp={whatsapp} />
        ))}
      </div>

      {(hayMas || topeAlcanzado) && (
        <div className="mt-[26px] rounded-[14px] border border-dashed border-linea bg-card p-7 text-center">
          <p className="text-[15.5px] font-semibold">
            Viste{" "}
            <span className="tabular">{productos.length}</span> de{" "}
            <span className="tabular">{total}</span> productos
          </p>

          {hayMas ? (
            /* Un enlace y no un botón: la página siguiente es una dirección, se
               puede compartir y funciona sin JavaScript. `scroll={false}` para
               no volver arriba de todo después de haber bajado hasta el pie. */
            <Link
              scroll={false}
              href={`?${new URLSearchParams({ ...limpiar(params), pagina: String(pagina + 1) })}`}
              className="mt-3.5 inline-flex h-12 items-center rounded-[10px] border border-linea px-[26px] text-[15px] font-semibold transition-colors hover:bg-sitio-alt"
            >
              Ver más productos
            </Link>
          ) : (
            /* Se llegó al techo de acumulación. Seguir agregando páginas a la
               misma respuesta no ayuda a encontrar nada y sí hace una página
               que en el celular no se puede abrir. */
            <p className="mx-auto mt-2.5 max-w-md text-[15px] leading-relaxed text-texto-2">
              Para ver el resto, elegí un rubro o buscá por nombre, marca o
              medida. Si no lo encontrás, escribinos y lo buscamos nosotros.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Los filtros vigentes, sin los vacíos, para rearmar la URL. */
function limpiar(params: Params): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([clave, valor]) => clave !== "pagina" && Boolean(valor),
    ),
  ) as Record<string, string>;
}

function GrillaCargando() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 9 }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
