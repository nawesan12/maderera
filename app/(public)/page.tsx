import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  ClipboardList,
  Clock,
  Headphones,
  MapPin,
  MessageCircle,
  Phone,
  Star,
  Tag,
  Truck,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Hero } from "@/components/home/hero";
import { ProductCard } from "@/components/product-card";
import { datosDePortada } from "@/lib/dal/catalog";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { testimonials, blogPosts } from "@/lib/products";

const ANIOS = new Date().getFullYear() - 1981;

export default async function HomePage() {
  const [portada, sucursales] = await Promise.all([
    datosDePortada(),
    listarSucursalesPublicas(),
  ]);

  return (
    <div className="overflow-hidden">
      <Hero
        productos={portada.totalProductos}
        sucursales={sucursales.length}
        anios={ANIOS}
      />

      <FranjaBeneficios />

      {portada.ofertas.length > 0 && <Ofertas productos={portada.ofertas} />}

      <Categorias categorias={portada.categorias} />

      <Destacados productos={portada.destacados} />

      <Herramientas />

      <Historia productos={portada.totalProductos} sucursales={sucursales.length} />

      <Testimonios />

      <Sucursales sucursales={sucursales} />

      <Blog />

      <CierreCta />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function FranjaBeneficios() {
  const beneficios = [
    { icono: Truck, texto: "Envíos en Mar del Plata y zona" },
    { icono: Headphones, texto: "Asesoramiento sin cargo" },
    { icono: Tag, texto: "Precios para profesionales" },
    { icono: Clock, texto: "Más de 40 años en el rubro" },
  ];

  return (
    <section className="border-t border-white/5 bg-brand-gray py-4 text-white">
      <ul className="container mx-auto flex flex-wrap items-center justify-center gap-x-10 gap-y-3 px-4">
        {beneficios.map((b) => (
          <li key={b.texto} className="flex items-center gap-2.5 text-sm">
            <b.icono className="h-4 w-4 shrink-0 text-brand-orange" />
            <span className="text-white/80">{b.texto}</span>
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
    <section className="bg-brand-cream/50 py-16">
      <div className="container mx-auto px-4">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-brand-red">
              <Tag className="h-4 w-4" />
              Ofertas
            </p>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Precios que bajaron esta semana
            </h2>
          </div>
          <Link
            href="/catalogo?ofertas=1"
            className="text-sm font-medium text-brand-orange hover:underline"
          >
            Ver todas las ofertas
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-brand-orange">
              Catálogo
            </p>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Todo para tu obra
            </h2>
          </div>
          <Link href="/catalogo">
            <Button variant="outline" className="rounded-full">
              Ver el catálogo completo
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>

        {/* Grilla pareja: con ocho categorías, hacer dos más grandes dejaba un
            hueco al final de la última fila. */}
        <div className="grid auto-rows-[180px] grid-cols-2 gap-4 lg:grid-cols-4">
          {categorias.map((cat) => (
            <Link
              key={cat.slug}
              href={`/catalogo?cat=${cat.slug}`}
              className="group relative overflow-hidden rounded-2xl"
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
              <div className="absolute inset-0 bg-gradient-to-t from-brand-gray via-brand-gray/40 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <h3 className="text-lg font-bold text-white">{cat.name}</h3>
                <p className="text-sm text-white/70">
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
    <section className="bg-white py-16">
      <div className="container mx-auto px-4">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-brand-orange">
              Lo más pedido
            </p>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Los que más salen
            </h2>
          </div>
          <Link
            href="/catalogo"
            className="text-sm font-medium text-brand-orange hover:underline"
          >
            Ver todo
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {productos.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Herramientas() {
  const herramientas = [
    {
      icono: Calculator,
      titulo: "Calculadora de materiales",
      texto:
        "Poné las medidas de tu obra y te decimos cuánto material necesitás, sin tener que estimarlo a ojo.",
      href: "/calculadora",
      cta: "Calcular",
    },
    {
      icono: ClipboardList,
      titulo: "Presupuesto online",
      texto:
        "Armá tu lista y mandanosla cuando quieras. Te respondemos con el precio final y la disponibilidad.",
      href: "/presupuesto",
      cta: "Armar presupuesto",
    },
    {
      icono: Warehouse,
      titulo: "Consulta de stock",
      texto:
        "Fijate si está disponible antes de venir. Se actualiza con lo que hay en las dos sucursales.",
      href: "/stock",
      cta: "Consultar stock",
    },
  ];

  return (
    <section className="bg-brand-cream/50 py-20">
      <div className="container mx-auto px-4">
        <div className="mb-10 max-w-2xl">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-brand-orange">
            Herramientas
          </p>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Resolvé tu obra desde el celular
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            Tres herramientas para que no tengas que llamar ni acercarte para
            saber cuánto necesitás, cuánto cuesta y si está disponible.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {herramientas.map((h) => (
            <Card
              key={h.titulo}
              className="group relative overflow-hidden border-0 bg-white shadow-sm transition-shadow duration-300 hover:shadow-xl"
            >
              <span className="absolute inset-x-0 top-0 h-1 bg-brand-orange" />
              <CardContent className="p-7">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-orange/10">
                  <h.icono className="h-6 w-6 text-brand-orange" />
                </div>
                <h3 className="mb-2 text-lg font-bold">{h.titulo}</h3>
                <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
                  {h.texto}
                </p>
                <Link href={h.href}>
                  <Button variant="outline" size="sm" className="rounded-full">
                    {h.cta}
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function Historia({
  productos,
  sucursales,
}: {
  productos: number;
  sucursales: number;
}) {
  const stats = [
    { valor: `${ANIOS}+`, label: "Años" },
    { valor: String(sucursales), label: "Sucursales" },
    { valor: `${productos}+`, label: "Productos" },
    { valor: "1000+", label: "Clientes" },
  ];

  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-orange">
              Nuestra historia
            </p>
            <h2 className="mb-5 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              Más de <span className="text-brand-orange">40 años</span>{" "}
              construyendo confianza
            </h2>
            <div className="wood-divider mb-6 w-20" />
            <p className="mb-8 text-lg leading-relaxed text-muted-foreground">
              Desde 1981, Maderera Juan B. Justo es sinónimo de calidad en Mar
              del Plata. Con dos sucursales, marca propia Moldava y un equipo
              apasionado por la madera, acompañamos cada proyecto de principio a
              fin.
            </p>

            <dl className="mb-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label}>
                  <dd className="tabular text-3xl font-bold text-brand-orange">
                    {s.valor}
                  </dd>
                  <dt className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
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

function Testimonios() {
  return (
    <section className="bg-brand-cream py-20">
      <div className="container mx-auto px-4">
        <div className="mb-10">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-brand-orange">
            Testimonios
          </p>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Lo que dicen nuestros clientes
          </h2>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {testimonials.map((t) => (
            <Card
              key={t.name}
              className="h-full border-0 bg-white shadow-sm transition-shadow duration-300 hover:shadow-xl"
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
                  &ldquo;{t.text}&rdquo;
                </p>
                <div className="flex items-center gap-3 border-t border-border/50 pt-4">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-gray text-sm font-bold text-white">
                    {t.avatar}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">{t.role}</p>
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
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="mb-10 text-center">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-brand-orange">
            Ubicaciones
          </p>
          <h2 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Nuestras sucursales
          </h2>
          <p className="mx-auto max-w-xl text-lg text-muted-foreground">
            Dos puntos en Mar del Plata para retirar o pedir asesoramiento.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {sucursales.map((s) => (
            <Card key={s.id} className="overflow-hidden border-0 shadow-sm">
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

function Blog() {
  const notas = blogPosts.slice(0, 3);

  return (
    <section className="bg-brand-cream/50 py-20">
      <div className="container mx-auto px-4">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-brand-orange">
              Consejos
            </p>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Para que te salga bien
            </h2>
          </div>
          <Link
            href="/blog"
            className="text-sm font-medium text-brand-orange hover:underline"
          >
            Ver todas las notas
          </Link>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {notas.map((nota) => (
            <Link key={nota.slug} href={`/blog/${nota.slug}`} className="group">
              <Card className="h-full overflow-hidden border-0 bg-white shadow-sm transition-shadow duration-300 hover:shadow-xl">
                <div className="relative aspect-[16/10] overflow-hidden">
                  <Image
                    src={nota.image}
                    alt=""
                    fill
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                </div>
                <CardContent className="p-5">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-orange">
                    {nota.category} · {nota.readTime}
                  </p>
                  <h3 className="mb-2 line-clamp-2 font-bold leading-snug transition-colors group-hover:text-brand-orange">
                    {nota.title}
                  </h3>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {nota.excerpt}
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
    <section className="relative overflow-hidden bg-brand-gray py-20 text-white">
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, #fff 0 1px, transparent 1px 16px)",
        }}
        aria-hidden="true"
      />
      <div className="container relative mx-auto px-4 text-center">
        <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-5xl">
          ¿Arrancamos tu proyecto?
        </h2>
        <p className="mx-auto mb-9 max-w-xl text-lg text-white/70">
          Contanos qué necesitás y te pasamos el presupuesto sin cargo. Si no
          sabés cuánto material lleva, lo calculamos juntos.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
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
