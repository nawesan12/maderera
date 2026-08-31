import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ClipboardList,
  Clock,
  Headphones,
  MapPin,
  MessageCircle,
  Phone,
  Scissors,
  Star,
  Tag,
  Truck,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Hero } from "@/components/home/hero";
import { ProductCard } from "@/components/product-card";
import { datosDePortada, numerosDeLaEmpresa } from "@/lib/dal/catalog";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { listarArticulos, listarTestimonios } from "@/lib/dal/contenido";
import { escalasDeVolumenPublicas } from "@/lib/dal/profesionales";

/**
 * Los años de la empresa se leen al renderizar y no una vez al cargar el
 * módulo: un servidor que queda levantado de un año al otro seguiría diciendo
 * el número viejo hasta el próximo despliegue.
 */

export default async function HomePage() {
  const [portada, sucursales, testimonios, notas, numeros, escalas] =
    await Promise.all([
      datosDePortada(),
      listarSucursalesPublicas(),
      listarTestimonios(),
      listarArticulos({ limite: 3 }),
      numerosDeLaEmpresa(),
      escalasDeVolumenPublicas(),
    ]);

  return (
    <div className="overflow-hidden">
      <Hero
        productos={portada.totalProductos}
        sucursales={sucursales.length}
        anios={numeros.anios}
      />

      <FranjaBeneficios />

      {portada.ofertas.length > 0 && <Ofertas productos={portada.ofertas} />}

      <BannerCorte />

      <Categorias categorias={portada.categorias} />

      <Destacados productos={portada.destacados} />

      <Herramientas />

      <BannerProfesionales escalas={escalas} sucursales={sucursales} />

      <Historia
        anios={numeros.anios}
        productos={numeros.productos}
        sucursales={numeros.sucursales}
        rubros={numeros.rubros}
      />

      {testimonios.length > 0 && <Testimonios testimonios={testimonios} />}

      <Sucursales sucursales={sucursales} />

      {notas.length > 0 && <Blog notas={notas} />}

      <CierreCta />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Encabezado de sección: título grande y una veta debajo.
 *
 * La barra repite el degradado de `.wood-divider` en chico. Se repite en cinco
 * secciones, así que vive acá y no copiada en cada una.
 */
function TituloSeccion({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <h2 className="text-[34px] font-bold leading-tight tracking-[-0.03em]">
        {children}
      </h2>
      <span
        className="mt-3 block h-1 w-16 rounded-sm bg-[linear-gradient(90deg,var(--color-brand-orange),var(--color-brand-wood),var(--color-brand-orange))]"
        aria-hidden="true"
      />
    </div>
  );
}

function FranjaBeneficios() {
  const beneficios = [
    { icono: Truck, texto: "Envíos en Mar del Plata y zona" },
    { icono: Headphones, texto: "Asesoramiento sin cargo" },
    { icono: Tag, texto: "Precios para profesionales" },
    { icono: Clock, texto: "Más de 40 años en el rubro" },
  ];

  return (
    <section className="bg-[#3a352f] text-white">
      <ul className="contenedor grid grid-cols-2 gap-x-6 gap-y-4 py-5 lg:grid-cols-4">
        {beneficios.map((b) => (
          <li key={b.texto} className="flex items-center gap-[11px]">
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-brand-orange/15 text-brand-orange-light">
              <b.icono className="h-[17px] w-[17px]" />
            </span>
            <span className="text-[14.5px] leading-[1.35] text-white/85">
              {b.texto}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Ofertas({
  productos,
}: {
  productos: Awaited<ReturnType<typeof datosDePortada>>["ofertas"];
}) {
  return (
    <section className="bg-sitio-fondo pt-[66px]">
      <div className="contenedor">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <TituloSeccion>Ofertas</TituloSeccion>
          <Link
            href="/catalogo?ofertas=1"
            className="text-[15px] font-semibold text-acento-texto hover:underline"
          >
            Ver todas las ofertas &rarr;
          </Link>
        </div>

        <div className="mt-7 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
          {productos.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Categorias({
  categorias,
}: {
  categorias: Awaited<ReturnType<typeof datosDePortada>>["categorias"];
}) {
  return (
    <section className="bg-sitio-alt py-[66px]">
      <div className="contenedor">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <TituloSeccion>Categorías</TituloSeccion>
          <Link
            href="/catalogo"
            className="text-[15px] font-semibold text-acento-texto hover:underline"
          >
            Ver el catálogo completo &rarr;
          </Link>
        </div>

        {/* Grilla pareja: con ocho categorías, hacer dos más grandes dejaba un
            hueco al final de la última fila. */}
        <div className="mt-7 grid auto-rows-[184px] grid-cols-2 gap-4 lg:grid-cols-4">
          {categorias.map((cat) => (
            <Link
              key={cat.slug}
              href={`/catalogo?cat=${cat.slug}`}
              className="group relative overflow-hidden rounded-[14px]"
            >
              {cat.image && (
                <Image
                  src={cat.image}
                  alt=""
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 1024px) 50vw, 25vw"
                />
              )}
              <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(28_25_22_/_0.88)_0%,rgb(28_25_22_/_0.28)_52%,transparent_100%)]" />
              <div className="absolute inset-x-4 bottom-3.5">
                <h3 className="text-[18px] font-bold tracking-[-0.02em] text-white">
                  {cat.name}
                </h3>
                <p className="tabular mt-0.5 text-[12.5px] text-white/70">
                  {cat.productCount === 1
                    ? "1 producto"
                    : `${cat.productCount} productos`}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function Destacados({
  productos,
}: {
  productos: Awaited<ReturnType<typeof datosDePortada>>["destacados"];
}) {
  if (productos.length === 0) return null;

  return (
    <section className="bg-sitio-fondo py-[66px]">
      <div className="contenedor">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <TituloSeccion>Los que más salen</TituloSeccion>
          <Link
            href="/catalogo"
            className="text-[15px] font-semibold text-acento-texto hover:underline"
          >
            Ver todo el catálogo &rarr;
          </Link>
        </div>

        <div className="mt-7 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
          {productos.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Banner del corte a medida.
 *
 * El servicio del aserradero es lo que diferencia a la maderera de una
 * ferretería, y hasta ahora solo aparecía como una tarjeta más entre las
 * herramientas.
 *
 * El panel de la derecha es una veta dibujada, no una foto con leyenda de
 * relleno: no hay imagen para este bloque en la base, y un recuadro que dice
 * "foto acá" en producción se lee como algo que falló.
 */
function BannerCorte() {
  return (
    <section className="bg-sitio-fondo pt-11">
      <div className="contenedor">
        <div className="relative overflow-hidden rounded-2xl bg-oscuro-marca text-white">
          <div
            className="absolute inset-0 bg-[repeating-linear-gradient(-45deg,rgb(240_115_22_/_0.08)_0_11px,transparent_11px_22px)]"
            aria-hidden="true"
          />
          <div className="relative grid items-stretch md:grid-cols-[1.35fr_1fr]">
            <div className="px-8 pb-10 pt-9 sm:px-10">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-orange/20 px-3 py-[5px] text-[12.5px] font-semibold uppercase tracking-[0.06em] text-brand-orange-light">
                <Scissors className="h-3.5 w-3.5" />
                Servicio del aserradero
              </span>
              <h2 className="mt-4 text-[34px] font-bold leading-[1.1] tracking-[-0.03em]">
                Corte a medida
                <br />
                mientras esperás
              </h2>
              <p className="mt-3 max-w-[420px] text-base leading-relaxed text-white/70">
                Traé el despiece en milímetros y te lo cortamos en el día. Si
                son más de 20 piezas, dejalo y lo pasás a buscar.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <Link
                  href="/presupuesto"
                  className="flex h-12 items-center rounded-[10px] bg-brand-orange px-[22px] text-[15.5px] font-semibold text-white transition-colors hover:bg-accion-hover"
                >
                  Pedir un corte
                </Link>
                <Link
                  href="/contacto"
                  className="flex h-12 items-center rounded-[10px] border border-white/25 px-[22px] text-[15.5px] font-semibold text-white transition-colors hover:bg-white/10"
                >
                  Cómo mandar el despiece
                </Link>
              </div>
            </div>
            <div
              className="relative hidden min-h-[230px] bg-[repeating-linear-gradient(-45deg,#3a352f_0_10px,#332f29_10px_20px)] md:block"
              aria-hidden="true"
            >
              <Scissors className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 text-white/10" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Portal de profesionales y las dos sucursales.
 *
 * Las escalas salen de la base (`escalasDeVolumenPublicas`) y el umbral es por
 * **cantidad**, no por importe: el diseño las dibujaba como "5% desde
 * $500.000" y el modelo no tiene ese dato. Si no hay ninguna cargada, el
 * bloque va sin la lista en vez de mostrar números de ejemplo — es una
 * política comercial y publicarla mal es una promesa que hay que cumplir.
 */
function BannerProfesionales({
  escalas,
  sucursales,
}: {
  escalas: Awaited<ReturnType<typeof escalasDeVolumenPublicas>>;
  sucursales: Awaited<ReturnType<typeof listarSucursalesPublicas>>;
}) {
  // La foto sale de la ficha de la sucursal si está cargada. Mientras no lo
  // esté, va una veta dibujada: un recuadro vacío o una foto de stock que no es
  // el local se leen peor que una superficie que no pretende ser una foto.
  const foto = sucursales.find((s) => s.imagenUrl)?.imagenUrl ?? null;

  return (
    <section className="bg-sitio-fondo pb-[66px]">
      <div className="contenedor">
        <div className="grid gap-[18px] lg:grid-cols-2">
          <article className="overflow-hidden rounded-2xl border border-linea bg-sitio-alt px-8 py-8 sm:px-[34px]">
            <span className="inline-block rounded-full bg-naranja-claro px-[11px] py-[5px] text-xs font-bold uppercase tracking-[0.08em] text-acento-texto">
              Portal profesionales
            </span>
            <h3 className="mt-3.5 text-[26px] font-bold tracking-[-0.025em]">
              Precios por volumen
            </h3>
            <p className="mt-2 text-[15.5px] leading-relaxed text-texto-2">
              Carpinteros, arquitectos y constructoras tienen escala de
              descuento y cuenta corriente. Se solicita una vez y queda
              habilitada.
            </p>

            {escalas.length > 0 && (
              <ul className="mt-[18px] flex flex-col gap-[7px]">
                {escalas.map((e) => (
                  <li
                    key={e.desdeCantidad}
                    className="flex items-center gap-3 rounded-[9px] border border-linea-suave bg-card px-3 py-2.5"
                  >
                    <span className="tabular flex-1 text-[13.5px] text-texto-2">
                      Desde {e.desdeCantidad} unidades
                    </span>
                    <span className="tabular text-[15px] font-semibold text-acento-texto">
                      &minus;{e.porcentaje}%
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <Link
              href="/profesionales"
              className="mt-5 flex h-12 w-fit items-center rounded-[10px] bg-accion px-[22px] text-[15.5px] font-semibold text-white transition-colors hover:bg-accion-hover"
            >
              Solicitar cuenta profesional
            </Link>
          </article>

          <article className="relative min-h-[340px] overflow-hidden rounded-2xl bg-brand-wood-light">
            {foto ? (
              <Image
                src={foto}
                alt=""
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            ) : (
              <div
                className="absolute inset-0 bg-[repeating-linear-gradient(-45deg,#e7dccd_0_9px,#ded1bf_9px_18px)]"
                aria-hidden="true"
              />
            )}
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(28_25_22_/_0.9),rgb(28_25_22_/_0.15)_60%,transparent)]" />
            <div className="absolute inset-x-8 bottom-7 text-white">
              <h3 className="text-[26px] font-bold tracking-[-0.025em]">
                Dos sucursales en la ciudad
              </h3>
              <p className="mt-2 text-[15.5px] leading-snug text-white/80">
                Casa Central sobre Juan B. Justo y el Aserradero, con corte y
                stock propio.
              </p>
              <div className="mt-[18px] flex flex-wrap gap-2.5">
                <Link
                  href="/sucursales"
                  className="flex h-[46px] items-center rounded-[10px] bg-white px-5 text-[15px] font-semibold text-oscuro-marca transition-colors hover:bg-white/90"
                >
                  Ver sucursales
                </Link>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function Herramientas() {
  const herramientas = [
    {
      icono: Scissors,
      titulo: "Corte a medida",
      texto:
        "Mandanos el despiece en milímetros y te lo cortamos en el aserradero.",
      href: "/presupuesto",
      cta: "Pedir un corte",
    },
    {
      icono: ClipboardList,
      titulo: "Presupuesto online",
      texto:
        "Armá tu lista, pedí precio y seguí la respuesta desde tu cuenta.",
      href: "/presupuesto",
      cta: "Armar presupuesto",
    },
    {
      icono: Warehouse,
      titulo: "Consulta de stock",
      texto:
        "Mirá qué hay en Casa Central y en el Aserradero antes de venir.",
      href: "/stock",
      cta: "Ver stock",
    },
  ];

  return (
    <section className="bg-sitio-alt py-[66px]">
      <div className="contenedor">
        <TituloSeccion>Herramientas</TituloSeccion>

        <div className="mt-7 grid gap-[18px] md:grid-cols-3">
          {herramientas.map((h) => (
            <article
              key={h.titulo}
              className="overflow-hidden rounded-[14px] border border-linea bg-card shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]"
            >
              <span className="block h-1 bg-brand-orange" aria-hidden="true" />
              <div className="px-[22px] pb-6 pt-[22px]">
                <span className="flex h-[42px] w-[42px] items-center justify-center rounded-[11px] bg-naranja-claro text-acento-texto">
                  <h.icono className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-xl font-bold tracking-[-0.02em]">
                  {h.titulo}
                </h3>
                <p className="mt-[7px] text-[15px] leading-normal text-texto-2">
                  {h.texto}
                </p>
                <Link
                  href={h.href}
                  className="mt-3.5 inline-block text-[15px] font-semibold text-acento-texto hover:underline"
                >
                  {h.cta} &rarr;
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Historia({
  anios,
  productos,
  sucursales,
  rubros,
}: {
  anios: number;
  productos: number;
  sucursales: number;
  rubros: number;
}) {
  // Los cuatro números son verificables. El que decía "1000+ Clientes" no lo
  // era: nadie lo contó nunca, y es el tipo de cifra que un cliente grande
  // pregunta de dónde sale.
  const stats = [
    { valor: String(anios), label: "Años" },
    { valor: String(sucursales), label: "Sucursales" },
    { valor: String(productos), label: "Productos" },
    { valor: String(rubros), label: "Rubros" },
  ];

  return (
    <section className="bg-sitio-fondo py-[66px]">
      <div className="contenedor">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <TituloSeccion className="mb-6">
              Más de{" "}
              <span className="text-acento-texto">{anios} años</span>{" "}
              construyendo confianza
            </TituloSeccion>
            <p className="mb-8 text-lg leading-relaxed text-texto-2">
              Desde 1981, Maderera Juan B. Justo es sinónimo de calidad en Mar
              del Plata. Con dos sucursales, marca propia Moldava y un equipo
              apasionado por la madera, acompañamos cada proyecto de principio a
              fin.
            </p>

            <dl className="mb-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label}>
                  <dd className="tabular text-[30px] font-bold tracking-[-0.03em] text-acento-texto">
                    {s.valor}
                  </dd>
                  <dt className="mt-1 text-xs uppercase tracking-[0.07em] text-texto-3">
                    {s.label}
                  </dt>
                </div>
              ))}
            </dl>

            <Link href="/nosotros">
              <Button variant="outline" className="rounded-full">
                Conocé nuestra historia
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>

          <div className="relative">
            <div className="relative h-[460px] overflow-hidden rounded-3xl">
              <Image
                src="https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&q=80"
                alt="Nuestro depósito"
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
            <div className="absolute -bottom-6 -left-6 max-w-[240px] rounded-2xl border bg-white p-6 shadow-2xl">
              <p className="mb-1 text-lg font-bold">Moldava</p>
              <p className="text-sm text-muted-foreground">
                Nuestra marca propia de molduras, con distribución nacional.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Testimonios({
  testimonios,
}: {
  testimonios: Awaited<ReturnType<typeof listarTestimonios>>;
}) {
  return (
    <section className="bg-sitio-alt py-[66px]">
      <div className="contenedor">
        <TituloSeccion className="mb-7">
          Lo que dicen nuestros clientes
        </TituloSeccion>

        <div className="grid gap-[18px] md:grid-cols-2 lg:grid-cols-4">
          {testimonios.map((t) => (
            <Card
              key={t.id}
              className="h-full rounded-[14px] border border-linea bg-card shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]"
            >
              <CardContent className="p-6">
                <div
                  className="mb-4 flex gap-0.5"
                  role="img"
                  aria-label="5 de 5 estrellas"
                >
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star
                      key={j}
                      className="h-4 w-4 fill-brand-orange text-brand-orange"
                    />
                  ))}
                </div>
                <p className="mb-6 text-sm leading-relaxed text-foreground/80">
                  &ldquo;{t.texto}&rdquo;
                </p>
                <div className="flex items-center gap-3 border-t border-border/50 pt-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-gray text-sm font-bold text-white">
                    {t.iniciales ?? t.nombre.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{t.nombre}</p>
                    <p className="text-xs text-muted-foreground">{t.rol}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function Sucursales({
  sucursales,
}: {
  sucursales: Awaited<ReturnType<typeof listarSucursalesPublicas>>;
}) {
  return (
    <section className="bg-sitio-fondo py-[66px]">
      <div className="contenedor">
        <TituloSeccion>Nuestras sucursales</TituloSeccion>
        <p className="mb-7 mt-3 text-lg text-texto-2">
          Dos puntos en Mar del Plata para retirar o pedir asesoramiento.
        </p>

        <div className="grid gap-[18px] md:grid-cols-2">
          {sucursales.map((s) => (
            <Card
              key={s.id}
              className="overflow-hidden rounded-[14px] border border-linea shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]"
            >
              <CardContent className="p-7">
                <h3 className="mb-3 text-xl font-bold">{s.nombre}</h3>
                <ul className="space-y-2.5 text-sm">
                  <li className="flex items-start gap-2.5">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-orange" />
                    <span>{s.direccion}</span>
                  </li>
                  {s.horario && (
                    <li className="flex items-start gap-2.5">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-orange" />
                      <span className="text-muted-foreground">{s.horario}</span>
                    </li>
                  )}
                </ul>

                <div className="mt-5 flex flex-wrap gap-2.5">
                  <a href="tel:+542234743328">
                    <Button variant="outline" size="sm" className="rounded-full">
                      <Phone className="mr-1.5 h-3.5 w-3.5" />
                      Llamar
                    </Button>
                  </a>
                  <a
                    href="https://wa.me/542235903118"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      size="sm"
                      className="rounded-full bg-brand-green text-white hover:bg-brand-green/90"
                    >
                      <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                      WhatsApp
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function Blog({
  notas,
}: {
  notas: Awaited<ReturnType<typeof listarArticulos>>;
}) {
  return (
    <section className="bg-sitio-alt py-[66px]">
      <div className="contenedor">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <TituloSeccion>Para que te salga bien</TituloSeccion>
          <Link
            href="/blog"
            className="text-[15px] font-semibold text-acento-texto hover:underline"
          >
            Ver todas las notas &rarr;
          </Link>
        </div>

        <div className="mt-7 grid gap-[18px] md:grid-cols-3">
          {notas.map((nota) => (
            <Link key={nota.slug} href={`/blog/${nota.slug}`} className="group">
              <Card className="h-full overflow-hidden rounded-[14px] border border-linea bg-card shadow-[0_1px_2px_rgb(60_50_40_/_0.05)] transition-[box-shadow,transform] duration-200 group-hover:-translate-y-[3px] group-hover:shadow-[0_14px_30px_-16px_rgb(60_50_40_/_0.34)]">
                {nota.imagenUrl && (
                  <div className="relative aspect-[16/10] overflow-hidden">
                    <Image
                      src={nota.imagenUrl}
                      alt=""
                      fill
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                      sizes="(max-width: 768px) 100vw, 33vw"
                    />
                  </div>
                )}
                <CardContent className="p-5">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-orange">
                    {nota.categoria} · {nota.minutosLectura} min
                  </p>
                  <h3 className="mb-2 line-clamp-2 font-bold leading-snug transition-colors group-hover:text-brand-orange">
                    {nota.titulo}
                  </h3>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {nota.resumen}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function CierreCta() {
  return (
    <section className="relative overflow-hidden bg-oscuro-marca py-16 text-white">
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, #fff 0 1px, transparent 1px 16px)",
        }}
        aria-hidden="true"
      />
      <div className="contenedor relative flex flex-wrap items-center justify-between gap-8">
        <div>
          <h2 className="text-4xl font-bold tracking-[-0.03em]">
            ¿Arrancamos tu proyecto?
          </h2>
          <p className="mt-2.5 text-[17px] text-white/70">
            Armá tu presupuesto online o escribinos y lo hacemos juntos.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/catalogo">
            <Button
              size="lg"
              className="h-14 rounded-full bg-brand-orange px-8 text-base font-semibold text-white hover:bg-brand-orange-dark"
            >
              Ver el catálogo
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
          <a
            href="https://wa.me/542235903118"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              size="lg"
              className="h-14 rounded-full border-2 border-white/30 bg-white/10 px-8 text-base !text-white backdrop-blur-sm hover:bg-white/20"
            >
              <MessageCircle className="mr-2 h-5 w-5" />
              Escribinos por WhatsApp
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}
