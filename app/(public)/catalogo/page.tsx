import type { Metadata } from "next";
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
  listarProductos,
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

  if (params.buscar || params.orden || params.ofertas || params.stock) {
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
    <div className="min-h-screen bg-brand-cream/40">
      <DatosEstructurados datos={migas} />
      <Encabezado />
      <FranjaConfianza />

      <div className="contenedor py-8">
        <Suspense fallback={<div className="mb-6 h-11" />}>
          <Barra params={params} />
        </Suspense>

        <div className="mt-6 lg:grid lg:grid-cols-[240px_1fr] lg:gap-8">
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
    <div className="relative overflow-hidden bg-brand-gray py-14 text-white">
      {/* Trama diagonal apenas visible, para que el bloque no sea un plano liso. */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, #fff 0 1px, transparent 1px 14px)",
        }}
        aria-hidden="true"
      />
      <div className="contenedor relative">
        <h1 className="text-4xl font-bold tracking-tight">Catálogo</h1>
        <p className="mt-2 max-w-xl text-white/70">
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
    <div className="border-b bg-white">
      <ul className="contenedor flex flex-wrap justify-center gap-x-8 gap-y-2 py-3">
        {puntos.map((p) => (
          <li
            key={p.texto}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <p.icono className="h-4 w-4 shrink-0 text-brand-orange" />
            {p.texto}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** El panel se arma una vez y se reusa en la barra móvil y en la columna. */
async function armarPanel(params: Params) {
  const [categorias, ofertas] = await Promise.all([
    listarCategorias(),
    listarProductos({ soloOfertas: true }),
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
  return <aside className="hidden lg:block">{await armarPanel(params)}</aside>;
}

async function Resultados({ params }: { params: Params }) {
  const productos = await listarProductos({
    categoria: params.cat,
    busqueda: params.buscar,
    stock: params.stock as never,
    orden: (params.orden as OrdenCatalogo) ?? "relevancia",
    soloOfertas: params.ofertas === "1",
  });

  if (productos.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-16 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <Search className="h-7 w-7 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-bold">No encontramos nada así</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Probá con otra palabra o mirá el catálogo completo.
        </p>
        <Link
          href="/catalogo"
          className="mt-5 inline-block rounded-lg bg-brand-orange px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange-dark"
        >
          Ver todo el catálogo
        </Link>
      </div>
    );
  }

  const enOferta = productos.filter((p) => p.descuento !== null).length;

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        {productos.length === 1
          ? "1 producto"
          : `${productos.length} productos`}
        {enOferta > 0 && (
          <span className="ml-2 font-medium text-brand-red">
            · {enOferta} en oferta
          </span>
        )}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {productos.map((producto) => (
          <ProductCard key={producto.id} product={producto} />
        ))}
      </div>
    </div>
  );
}

function GrillaCargando() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
