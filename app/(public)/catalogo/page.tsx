import type { Metadata } from "next";
import { CargandoSitio } from "@/components/sitio/cargando";
import { AvisoGremio } from "@/components/catalogo/aviso-gremio";
import { bannersDe } from "@/lib/dal/banners";
import { Banner } from "@/components/banner";
import { RailDeCategorias } from "@/components/catalogo/rail-categorias";
import { FranjaBeneficios } from "@/components/franja-beneficios";
import { numeroWhatsapp } from "@/lib/whatsapp/enlace";
import { Suspense } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { ProductCardSkeleton } from "@/components/product-card-skeleton";
import {
  BarraCatalogo,
  PanelCategorias,
} from "@/components/catalogo/filtros";
import {
  listarCategorias,
  listarProductosPublicos,
  marcasDelCatalogo,
  productosEnOferta,
  paginaDeProductosPublica,
  rubrosDeCategoria,
  type OrdenCatalogo,
} from "@/lib/dal/catalog";
import { DatosEstructurados } from "@/components/datos-estructurados";
import {
  listaDeProductosJsonLd,
  metadatosDePagina,
  migasJsonLd,
  precioEnTexto,
  recortar,
} from "@/lib/seo";
import { TEXTOS_DE_CATEGORIA, TEXTOS_DE_RUBRO } from "@/lib/textos-categorias";

interface Params {
  cat?: string;
  /** El rubro dentro de la categoría. Solo tiene sentido junto con `cat`. */
  rubro?: string;
  buscar?: string;
  stock?: string;
  orden?: string;
  ofertas?: string;
  /**
   * La marca. El filtro existía en el DAL desde hace tiempo y la página ni
   * siquiera leía el parámetro, así que no había forma de llegar a él.
   */
  marca?: string;
  pagina?: string;
}

/**
 * Metadata por filtro.
 *
 * Sin esto, `/catalogo?cat=placas` y `/catalogo?buscar=fenolico` son para
 * Google la misma página que `/catalogo` repetida cien veces, y el sitio
 * compite consigo mismo. Cada categoría —y cada rubro adentro de una
 * categoría— es una página propia con su título y su canónica; **la búsqueda,
 * los ordenamientos, las marcas y las páginas siguientes no se indexan**,
 * porque son combinaciones infinitas de las mismas fichas.
 *
 * El título y la descripción se arman con datos reales: cuántos productos
 * hay, desde qué precio y en qué rubros. Es lo que hace que el resultado diga
 * algo distinto de los otros diez de «placas Mar del Plata».
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Params>;
}): Promise<Metadata> {
  const params = await searchParams;
  const resuelto = await resolverFiltro(params);

  /*
   * Lo que no se indexa.
   *
   * Las páginas siguientes contienen a la anterior —"Ver más" agrega, no
   * reemplaza—, así que indexarlas sería ofrecerle al buscador cinco versiones
   * del mismo catálogo con la primera repetida en todas. Una categoría o un
   * rubro que no existe tampoco: es una grilla vacía con el título del
   * catálogo, lo que Google llama un 404 encubierto. La canónica apunta a lo
   * más cercano que sí existe.
   */
  const sinIndexar =
    Boolean(params.buscar) ||
    Boolean(params.orden) ||
    Boolean(params.ofertas) ||
    Boolean(params.stock) ||
    Boolean(params.marca) ||
    (params.pagina !== undefined && params.pagina !== "1") ||
    resuelto.desconocido;

  const canonica = resuelto.categoria
    ? rutaDeFiltro(resuelto.categoria.slug, resuelto.rubro?.slug)
    : "/catalogo";

  if (sinIndexar) {
    return metadatosDePagina({
      titulo: params.buscar
        ? `Buscar «${recortar(params.buscar, 40)}»`
        : resuelto.categoria
          ? `${resuelto.categoria.name} en Mar del Plata`
          : "Catálogo de productos",
      descripcion:
        "Maderas, placas, molduras, pisos y ferretería con precio y stock al día en Maderera Juan B. Justo, Mar del Plata.",
      ruta: canonica,
      indexar: false,
    });
  }

  if (resuelto.categoria) {
    const { categoria, rubro } = resuelto;
    const productos = await listarProductosPublicos({
      categoria: categoria.slug,
      subcategoria: rubro?.slug,
    });
    const precios = productos
      .map((p) => Number(p.precioDesde))
      .filter((n) => Number.isFinite(n) && n > 0);
    const desde = precios.length ? Math.min(...precios) : null;
    const texto = TEXTOS_DE_CATEGORIA[categoria.slug];

    const nombre = rubro ? rubro.name : (texto?.titulo ?? categoria.name);
    const cantidad =
      productos.length === 1 ? "1 producto" : `${productos.length} productos`;
    const descripcion = [
      `${nombre} en Mar del Plata.`,
      productos.length > 0
        ? `${cantidad}${desde ? ` desde ${precioEnTexto(desde)}` : ""}, con precio final y stock al día en Casa Central y el Aserradero.`
        : null,
      rubro ? null : (categoria.description ?? null),
    ]
      .filter(Boolean)
      .join(" ");

    return metadatosDePagina({
      titulo: `${nombre} en Mar del Plata`,
      descripcion,
      ruta: canonica,
      imagen: {
        url: `/og/categoria/${categoria.slug}${rubro ? `?rubro=${rubro.slug}` : ""}`,
        ancho: 1200,
        alto: 630,
        alt: `${nombre} — Maderera Juan B. Justo`,
      },
    });
  }

  return {
    ...metadatosDePagina({
      titulo: "Catálogo de maderas, placas y materiales",
      descripcion:
        "Techos, placas, pisos, molduras, ferretería, decks, construcción en seco y cubiertas, con precio final y stock al día en Mar del Plata.",
      ruta: "/catalogo",
    }),
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
}

/** `/catalogo?cat=placas` o `/catalogo?cat=placas&rubro=melaminas`. */
function rutaDeFiltro(categoria: string, rubro?: string): string {
  return rubro
    ? `/catalogo?cat=${categoria}&rubro=${rubro}`
    : `/catalogo?cat=${categoria}`;
}

/**
 * La categoría y el rubro pedidos, si existen.
 *
 * `desconocido` es una categoría o un rubro que vino en la URL y no está:
 * un enlace viejo o mal escrito. Esa página no se indexa.
 */
async function resolverFiltro(params: Params) {
  const pideCategoria = Boolean(params.cat && params.cat !== "todos");
  const categoria = pideCategoria
    ? (await listarCategorias()).find((c) => c.slug === params.cat)
    : undefined;

  const pideRubro = Boolean(categoria && params.rubro && params.rubro !== "todos");
  const rubro = pideRubro
    ? (await rubrosDeCategoria(categoria!.slug)).find((r) => r.slug === params.rubro)
    : undefined;

  return {
    categoria,
    rubro,
    desconocido: (pideCategoria && !categoria) || (pideRubro && !rubro),
  };
}

/**
 * El catálogo lee los filtros del pedido, así que se arma detrás de su propio
 * `<Suspense>`. No con un `loading.tsx` en esta carpeta: envolvería también la
 * ficha de cada producto, que vive debajo, y la dejaría respondiendo 200 cuando
 * el producto no existe (ver `components/sitio/cargando.tsx`).
 */
export default function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  return (
    <Suspense fallback={<CargandoSitio />}>
      <Catalogo searchParams={searchParams} />
    </Suspense>
  );
}

async function Catalogo({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const { categoria: categoriaActual, rubro: rubroActual } =
    await resolverFiltro(params);

  // Las migas dicen dónde está la persona, hasta el rubro. Son las mismas en
  // la cabecera y en el marcado.
  const tramos = [
    { nombre: "Inicio", ruta: "/" },
    { nombre: "Catálogo", ruta: "/catalogo" },
    ...(categoriaActual
      ? [{ nombre: categoriaActual.name, ruta: rutaDeFiltro(categoriaActual.slug) }]
      : []),
    ...(categoriaActual && rubroActual
      ? [{ nombre: rubroActual.name, ruta: rutaDeFiltro(categoriaActual.slug, rubroActual.slug) }]
      : []),
  ];

  const texto = categoriaActual ? TEXTOS_DE_CATEGORIA[categoriaActual.slug] : undefined;
  const titulo = rubroActual
    ? rubroActual.name
    : categoriaActual
      ? (texto?.titulo ?? categoriaActual.name)
      : "Catálogo";
  const bajada = rubroActual
    ? (TEXTOS_DE_RUBRO[rubroActual.slug] ?? categoriaActual?.description ?? null)
    : (categoriaActual?.description ??
      "Maderas, placas, molduras y todo lo que necesita tu obra, con precios y disponibilidad al día.");

  return (
    <div className="min-h-screen bg-sitio-alt">
      <DatosEstructurados datos={migasJsonLd(tramos)} />
      <Encabezado titulo={titulo} bajada={bajada} tramos={tramos} />
      <FranjaBeneficios tono="claro" />

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

        {categoriaActual && texto && !params.buscar && (
          <SobreLaCategoria
            slug={categoriaActual.slug}
            nombre={categoriaActual.name}
            texto={texto}
          />
        )}
      </div>
    </div>
  );
}

/**
 * La cabecera del listado, con el nombre de lo que se está mirando.
 *
 * Decía «Catálogo» en todas las categorías: la página de placas no tenía
 * ningún encabezado que dijera «placas», que es lo primero que mira el
 * buscador para saber de qué trata.
 */
function Encabezado({
  titulo,
  bajada,
  tramos,
}: {
  titulo: string;
  bajada: string | null;
  tramos: { nombre: string; ruta: string }[];
}) {
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
          aria-label="Dónde estás"
          className="flex flex-wrap items-center gap-2 text-[13.5px] text-white/60"
        >
          {tramos.slice(0, -1).map((t) => (
            <span key={t.ruta} className="flex items-center gap-2">
              <Link href={t.ruta} className="transition-colors hover:text-white">
                {t.nombre}
              </Link>
              <span aria-hidden="true">&rsaquo;</span>
            </span>
          ))}
          <span className="text-white" aria-current="page">
            {tramos[tramos.length - 1].nombre}
          </span>
        </nav>
        <h1 className="mt-3.5 text-[34px] font-extrabold leading-[1.1] tracking-[-0.035em] sm:text-[42px]">
          {titulo}
        </h1>
        {bajada && (
          <p className="mt-2 max-w-[620px] text-[17px] text-white/70">{bajada}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Qué es la categoría y qué se consigue, debajo de la grilla.
 *
 * Abajo y no arriba a propósito: quien llega a comprar ve los productos
 * primero, y quien todavía no sabe qué necesita —o el buscador— encuentra la
 * explicación al final. Los enlaces a las herramientas son los que esa
 * persona va a necesitar después: el armador de cortes para las placas, la
 * calculadora para el techo.
 */
async function SobreLaCategoria({
  slug,
  nombre,
  texto,
}: {
  slug: string;
  nombre: string;
  texto: (typeof TEXTOS_DE_CATEGORIA)[string];
}) {
  const [rubros, categorias] = await Promise.all([
    rubrosDeCategoria(slug),
    listarCategorias(),
  ]);
  const otras = categorias.filter((c) => c.slug !== slug && c.productCount > 0);

  const herramientas: { ruta: string; texto: string }[] = [
    ...(slug === "placas" ? [{ ruta: "/corte", texto: "Armar un corte a medida" }] : []),
    ...(slug === "molduras" ? [{ ruta: "/moldava", texto: "Conocer la línea Moldava" }] : []),
    ...(["techos", "placas", "pisos", "decks-y-escaleras"].includes(slug)
      ? [{ ruta: "/calculadora", texto: "Calcular cuánto material necesito" }]
      : []),
    { ruta: "/sucursales", texto: "Dónde retirar: nuestras sucursales" },
  ];

  return (
    <section
      aria-labelledby="sobre-la-categoria"
      className="mt-12 grid gap-8 rounded-[14px] border border-linea bg-card p-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
    >
      <div>
        <h2 id="sobre-la-categoria" className="text-2xl font-bold tracking-[-0.025em]">
          {texto.titulo} en Mar del Plata
        </h2>
        {texto.parrafos.map((p) => (
          <p key={p.slice(0, 24)} className="mt-3 text-[15.5px] leading-relaxed text-texto-2">
            {p}
          </p>
        ))}

        <ul className="mt-4 grid gap-x-6 gap-y-1.5 text-[15px] sm:grid-cols-2">
          {texto.incluye.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-orange" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-6">
        {rubros.length > 0 && (
          <nav aria-label={`Rubros de ${nombre}`}>
            <h3 className="text-[15px] font-semibold">Rubros de {nombre}</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {rubros.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={rutaDeFiltro(slug, r.slug)}
                    className="inline-flex h-9 items-center rounded-full bg-chip px-3.5 text-sm font-medium text-texto-2 hover:text-texto-1"
                  >
                    {r.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <nav aria-label="Herramientas">
          <h3 className="text-[15px] font-semibold">También te puede servir</h3>
          <ul className="mt-2 space-y-1.5 text-[15px]">
            {herramientas.map((h) => (
              <li key={h.ruta}>
                <Link href={h.ruta} className="font-medium text-acento-texto hover:underline">
                  {h.texto}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {otras.length > 0 && (
          <nav aria-label="Otras categorías">
            <h3 className="text-[15px] font-semibold">Otras categorías</h3>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[15px]">
              {otras.map((c) => (
                <li key={c.slug}>
                  <Link href={rutaDeFiltro(c.slug)} className="text-texto-2 hover:text-texto-1 hover:underline">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </section>
  );
}

/**
 * El panel de filtros, que va en dos lugares: el cajón del teléfono y la
 * columna del escritorio. Se arma dos veces —son dos árboles distintos— pero
 * sus dos consultas están memoizadas, así que a la base se le pide una vez.
 */
async function armarPanel(params: Params) {
  const [categorias, ofertas, rubros] = await Promise.all([
    listarCategorias(),
    productosEnOferta(),
    // Los rubros son de adentro de una categoría: sin una elegida no hay qué
    // listar, y mostrar los de todas mezclados no ayuda a nadie.
    params.cat && params.cat !== "todos"
      ? rubrosDeCategoria(params.cat)
      : Promise.resolve([]),
  ]);

  return (
    <PanelCategorias
      categorias={categorias.map((c) => ({
        slug: c.slug,
        name: c.name,
        productCount: c.productCount,
      }))}
      rubros={rubros}
      rubroActual={params.rubro ?? "todos"}
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

/**
 * La grilla.
 *
 * **Acá no se lee la sesión, y eso es lo que hace que el catálogo sea barato.**
 * Leía dos cosas: con qué vista de IVA mostrar el precio y si poner el aviso al
 * gremio. Ninguna de las dos cambia lo que se vende —son presentación— y las
 * dos se resuelven aparte: el precio y la vista de quien mira llegan detrás
 * del `<Suspense>` de cada tarjeta (`components/product-card.tsx`), y el aviso
 * se retira para quien entró. La grilla en sí es **una sola para todo el
 * mundo**, con las consultas cacheadas por etiqueta.
 *
 * Lo que no se toca: la lista de precios sigue viajando dentro de la clave del
 * caché (`lib/dal/catalog.ts`). Que el precio del profesional llegue aparte no
 * significa que un precio de gremio pueda salir de un caché compartido;
 * significa que no sale de ahí en absoluto.
 */
async function Resultados({ params }: { params: Params }) {
  const pagina = Math.max(1, Number(params.pagina) || 1);

  /*
   * Todo junto y no de a uno.
   *
   * Eran siete `await` en fila, cada uno esperando a que terminara el anterior
   * sin necesitarlo: ninguna de estas consultas depende del resultado de otra.
   * En serie, el tiempo de la pantalla es la suma; en paralelo, el de la más
   * lenta. Y el tiempo de una función también se paga.
   */
  const [
    whatsapp,
    avisos,
    categorias,
    /*
     * Las marcas de lo que se está mirando: con una categoría elegida, las de
     * esa categoría; sin ninguna, las del catálogo entero. Mostrar las marcas de
     * ferretería mientras alguien mira placas no ayuda a nadie.
     */
    marcas,
    { productos, total, hayMas, topeAlcanzado },
  ] = await Promise.all([
    numeroWhatsapp(),
    bannersDe("catalogo"),
    listarCategorias(),
    marcasDelCatalogo(
      params.cat && params.cat !== "todos" ? params.cat : undefined,
    ),
    paginaDeProductosPublica(
      {
        categoria: params.cat,
        subcategoria: params.rubro,
        busqueda: params.buscar,
        stock: params.stock as never,
        orden: (params.orden as OrdenCatalogo) ?? "relevancia",
        soloOfertas: params.ofertas === "1",
        marca: params.marca,
      },
      pagina,
    ),
  ]);

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

  // En la página de una categoría, la lista de fichas en el orden en que se
  // ven. Solo ahí: una búsqueda o un orden distinto no se indexan.
  const esPaginaIndexable =
    params.cat && !params.buscar && !params.orden && !params.ofertas && !params.stock && !params.marca;

  return (
    <div>
      {esPaginaIndexable && (
        <DatosEstructurados
          datos={listaDeProductosJsonLd(
            productos[0]?.categoryName ?? "Catálogo",
            productos.map((p) => p.slug),
          )}
        />
      )}
      {/* Al gremio hay que decirle que su precio existe y está detrás del
          ingreso. A quien ya entró no: vería un cartel que no es cierto. */}
      {/* La misma navegación de la portada, en la forma que corresponde acá.
          Sin esto el catálogo se sentía otro sitio: la lista de categorías
          quedaba escondida detrás de un botón en el teléfono. */}
      <RailDeCategorias
        categorias={categorias.map((c) => ({
          slug: c.slug,
          name: c.name,
          productCount: c.productCount,
        }))}
        activa={params.cat ?? "todos"}
      />

      {/*
        Las marcas que trabajan.

        La clienta pidió darles lugar y mandó la plancha de logos del sitio
        anterior. Van por nombre hasta que lleguen los logos sueltos: una
        imagen con todos juntos no se puede cortar en enlaces, y un logo que no
        lleva a ningún lado es una figurita.
      */}
      {marcas.length > 1 && (
        <nav aria-label="Marcas" className="mb-4 flex flex-wrap gap-2">
          {marcas.map((m) => {
            const activa = params.marca === m.nombre;
            return (
              <Link
                key={m.nombre}
                href={
                  activa
                    ? `/catalogo?${new URLSearchParams(limpiar({ ...params, marca: undefined }))}`
                    : `/catalogo?${new URLSearchParams(limpiar({ ...params, marca: m.nombre }))}`
                }
                aria-current={activa ? "true" : undefined}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors ${
                  activa
                    ? "bg-accion text-white"
                    : "bg-chip text-texto-2 hover:text-texto-1"
                }`}
              >
                {m.nombre}
                <span className="tabular text-xs font-normal opacity-70">
                  {m.productCount}
                </span>
              </Link>
            );
          })}
        </nav>
      )}

      {avisos.length > 0 && (
        <div className="mb-4 space-y-3">
          {avisos.map((aviso) => (
            <Banner key={aviso.id} banner={aviso} />
          ))}
        </div>
      )}

      {/* Se retira solo si hay sesión: lo decide el navegador. */}
      <AvisoGremio className="mb-4" />

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
          <ProductCard
            key={producto.id}
            product={producto}
            whatsapp={whatsapp}
          />
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
