import Image from "next/image";
import { enlaceWhatsapp, numeroWhatsapp } from "@/lib/whatsapp/enlace";
import Link from "next/link";
import {
  ArrowRight,
  Calculator,
  ClipboardList,
  Clock,
  MapPin,
  MessageCircle,
  Phone,
  Scissors,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Hero } from "@/components/home/hero";
import { ResenasDelNegocio } from "@/components/home/resenas";
import { resenasDelNegocio, resumenDelNegocio } from "@/lib/google/resenas";
import { ProductCard } from "@/components/product-card";
import { datosDePortada, numerosDeLaEmpresa } from "@/lib/dal/catalog";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { bannersDe } from "@/lib/dal/banners";
import { promosVigentes, type PromoVigente } from "@/lib/dal/contenido";
import { escalasDePagoPublicas } from "@/lib/dal/descuentos-pago";
import { ALCANCE_MOLDAVA } from "@/lib/empresa";
import { SliderDePromos } from "@/components/home/slider-promos";
import { FranjaBeneficios } from "@/components/franja-beneficios";
import { BotonCrearCuenta } from "@/components/boton-crear-cuenta";

/**
 * Los años de la empresa se leen al renderizar y no una vez al cargar el
 * módulo: un servidor que queda levantado de un año al otro seguiría diciendo
 * el número viejo hasta el próximo despliegue.
 */

/**
 * La portada se prerenderiza y se sirve del CDN.
 *
 * No lee la sesión en ningún lado: sale con precio de público —y con el botón
 * de crear cuenta— y el navegador corrige lo que sea propio de quien mira. Esa
 * era la única razón por la que se armaba de nuevo en cada visita.
 *
 * El día de vencimiento es la red de seguridad, no el mecanismo: cuando alguien
 * toca un precio, un producto o el stock, el panel invalida la etiqueta del
 * catálogo y la página se rehace enseguida.
 */
export const revalidate = 2592000;

export default async function HomePage() {
  const [
    portada,
    sucursales,
    numeros,
    avisos,
    promos,
    escalasPago,
    resenas,
    resumenResenas,
  ] = await Promise.all([
    datosDePortada(),
    listarSucursalesPublicas(),
    numerosDeLaEmpresa(),
    bannersDe("portada"),
    promosVigentes(),
    escalasDePagoPublicas(),
    // Lo que dicen los clientes: el brief pedía que quien entra sienta
    // confianza y trayectoria, y eso lo sostenía el año de fundación solo.
    resenasDelNegocio(),
    resumenDelNegocio(),
  ]);

  return (
    <div className="overflow-hidden">
      {/*
        El hero y las promociones, en un solo carrusel a todo el ancho.
        La clienta lo pidió así: "que el hero esté integrado en el slider, que
        sea todo un slider enorme que ocupe todo el ancho, cosa de que sea lo
        primero que se ve".

        Antes eran dos bloques separados —el hero a sangre y, más abajo y
        metido en el contenedor, un carrusel que casi nadie bajaba a ver—.
      */}
      <SliderDePromos
        banners={avisos}
        hero={
          <Hero
            productos={portada.totalProductos}
            sucursales={sucursales.length}
            anios={numeros.anios}
          />
        }
      />

      <FranjaBeneficios />

      {portada.ofertas.length > 0 && <Ofertas productos={portada.ofertas} />}

      <BannerCorte />

      <MediosDePago promos={promos} escalasPago={escalasPago} />

      <Categorias categorias={portada.categorias} />

      <Destacados productos={portada.destacados} />

      <Herramientas />

      <ResenasDelNegocio resenas={resenas} resumen={resumenResenas} />

      <BannerProfesionales sucursales={sucursales} />

      <Historia
        anios={numeros.anios}
        productos={numeros.productos}
        sucursales={numeros.sucursales}
        rubros={numeros.rubros}
      />


      <Sucursales sucursales={sucursales} />


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


async function Ofertas({
  productos,
}: {
  productos: Awaited<ReturnType<typeof datosDePortada>>["ofertas"];
}) {
  const whatsapp = await numeroWhatsapp();

  return (
    <section className="bg-sitio-fondo pt-[48px]">
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
            <ProductCard key={p.id} product={p} whatsapp={whatsapp} />
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
    <section className="bg-sitio-alt py-[48px]">
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
              prefetch={false}
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

async function Destacados({
  productos,
}: {
  productos: Awaited<ReturnType<typeof datosDePortada>>["destacados"];
}) {
  if (productos.length === 0) return null;

  const whatsapp = await numeroWhatsapp();

  return (
    <section className="bg-sitio-fondo py-[48px]">
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
            <ProductCard key={p.id} product={p} whatsapp={whatsapp} />
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
                Cargá el despiece en milímetros, mirá cómo entra en la placa y
                comprá el corte hecho. Si son más de 20 piezas, dejalo y lo
                pasás a buscar.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <Link
                  href="/corte"
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
 * Medios de pago y promociones bancarias.
 *
 * La clienta pidió que el inicio los muestre, y trajo la lista real: cada
 * promoción con su banco, sus condiciones y **su vigencia**. Las filas salen de
 * `bank_promotions` y las vencidas no llegan acá: la consulta las filtra, así
 * que nadie reclama en el mostrador un reintegro que terminó el mes pasado.
 *
 * El descuento de contado va aparte y destacado porque no vence: sale de las
 * mismas escalas que cobra el carrito (`paymentDiscounts`), no de un texto
 * escrito acá. Si las escalas de contado no coinciden entre sí, la franja no se
 * muestra antes que prometer un número que la caja después no aplica.
 */
function MediosDePago({
  promos,
  escalasPago,
}: {
  promos: PromoVigente[];
  escalasPago: Awaited<ReturnType<typeof escalasDePagoPublicas>>;
}) {
  /*
   * El descuento de contado, con los medios que de verdad lo tienen cargado.
   * Si las escalas difieren entre sí no se anuncia un número único: mejor
   * ninguna franja que una que la caja después no aplica.
   */
  const NOMBRES: Record<string, string> = {
    efectivo: "efectivo",
    transferencia: "transferencia",
    debito: "débito",
  };
  const conDescuento = Object.keys(NOMBRES)
    .map((medio) => ({
      medio,
      pct:
        escalasPago
          .filter((e) => e.medio === medio && e.desdeMonto === 0)
          .sort((a, b) => b.porcentaje - a.porcentaje)[0]?.porcentaje ?? 0,
    }))
    .filter((m) => m.pct > 0);
  const contadoPct =
    conDescuento.length > 0 &&
    conDescuento.every((m) => m.pct === conDescuento[0].pct)
      ? conDescuento[0].pct
      : 0;
  // "efectivo o transferencia", "efectivo, transferencia o débito".
  const nombres = conDescuento.map((m) => NOMBRES[m.medio]);
  const mediosDeContado =
    nombres.length > 1
      ? `${nombres.slice(0, -1).join(", ")} o ${nombres[nombres.length - 1]}`
      : (nombres[0] ?? "");

  if (promos.length === 0 && contadoPct === 0) return null;

  return (
    <section className="bg-sitio-fondo pt-11 pb-3">
      <div className="contenedor">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <TituloSeccion>Medios de pago y promociones</TituloSeccion>
        </div>

        {contadoPct > 0 && (
          <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-oscuro-marca px-7 py-5 text-white">
            <span className="tabular text-[30px] font-extrabold tracking-[-0.02em] text-brand-orange-light">
              &minus;{contadoPct}%
            </span>
            <div>
              <p className="text-[17px] font-semibold leading-snug">
                Pagando de contado, todos los días
              </p>
              <p className="text-[14px] text-white/70">
                {mediosDeContado.charAt(0).toUpperCase() +
                  mediosDeContado.slice(1)}
                . Se aplica solo en el carrito y en el mostrador.
              </p>
            </div>
          </div>
        )}

        {promos.length > 0 && (
          <div className="mt-[18px] grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
            {promos.map((p) => (
              <article
                key={p.id}
                className="flex flex-col rounded-2xl border border-linea bg-card px-5 py-[18px]"
              >
                {/* El logo del banco, si lo cargaron. Se reconoce antes que
                    el nombre escrito, que es para lo que la clienta lo pidió.
                    Va a altura fija y `object-contain` porque los logos vienen
                    de cualquier proporción. */}
                {p.imagenUrl ? (
                  <Image
                    src={p.imagenUrl}
                    alt={p.medio}
                    width={160}
                    height={40}
                    className="mb-2 h-10 w-auto max-w-[160px] object-contain object-left"
                  />
                ) : (
                  <span className="text-xs font-bold uppercase tracking-[0.08em] text-acento-texto">
                    {p.medio}
                  </span>
                )}
                <h3 className="mt-1.5 text-[17px] font-bold leading-snug tracking-[-0.01em]">
                  {p.titulo}
                </h3>
                {p.detalle && (
                  <p className="mt-2 text-[13.5px] leading-relaxed text-texto-2">
                    {p.detalle}
                  </p>
                )}
                <p className="mt-auto pt-3 text-[12.5px] font-medium text-texto-2">
                  {p.dias}
                  {p.dias && p.vigenciaHasta && " · "}
                  {p.vigenciaHasta && `Hasta el ${p.vigenciaHasta}`}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Portal de profesionales y las dos sucursales.
 *
 * **Acá había una escala de descuentos por cantidad —3 %, 5 %, 8 % desde 10,
 * 25 y 50 unidades— y la maderera no trabaja así.** Lo que tiene una cuenta
 * profesional es su propia lista de precios y cuenta corriente, que es lo que
 * dice ahora. Anunciar un descuento que después no aparece en el presupuesto
 * es peor que no anunciar nada: quien lo leyó viene a reclamarlo.
 *
 * Si algún día existe de verdad, se anuncia con los números de la base y no
 * con ejemplos escritos acá.
 */
function BannerProfesionales({
  sucursales,
}: {
  sucursales: Awaited<ReturnType<typeof listarSucursalesPublicas>>;
}) {
  /*
   * La foto sale de la ficha de la sucursal si está cargada, y esa es la que
   * vale: es el local de verdad. Mientras no haya ninguna, va madera apilada.
   *
   * Antes el respaldo era una veta dibujada, para no hacer pasar una foto
   * ajena por el local. El encuadre lo resuelve: se ve el material, no una
   * fachada, así que no afirma «este es nuestro depósito» —eso lo dice el
   * texto, y lo que muestra es cierto: hay stock propio—. En cuanto se cargue
   * la foto de Casa Central o del Aserradero, esta desaparece sola.
   */
  const foto =
    sucursales.find((s) => s.imagenUrl)?.imagenUrl ??
    "https://images.unsplash.com/photo-1634672652995-ee7525bce595?w=1200&q=75";

  return (
    <section className="bg-sitio-fondo pb-[48px]">
      <div className="contenedor">
        <div className="grid gap-[18px] lg:grid-cols-2">
          <article className="flex flex-col overflow-hidden rounded-2xl border border-linea bg-sitio-alt">
            {/* La foto arriba: son carpinteros trabajando con la madera que
                vende la casa, que es exactamente a quién le habla el bloque.
                `priority` no: está abajo del hero y cargarla antes le saca
                ancho de banda a lo primero que se ve. */}
            <div className="relative h-[190px] shrink-0">
              <Image
                src="https://images.unsplash.com/photo-1773430272778-28c224216811?w=900&q=75"
                alt=""
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>

            <div className="flex flex-1 flex-col px-8 py-8 sm:px-[34px]">
              <span className="inline-block w-fit rounded-full bg-naranja-claro px-[11px] py-[5px] text-xs font-bold uppercase tracking-[0.08em] text-acento-sobre-claro">
                Portal profesionales
              </span>
              <h3 className="mt-3.5 text-[26px] font-bold tracking-[-0.025em]">
                Tu propia lista de precios
              </h3>
              <p className="mt-2 text-[15.5px] leading-relaxed text-texto-2">
                Carpinteros, arquitectos y constructoras compran con la lista
                que les corresponde y con cuenta corriente. Se solicita una vez
                y queda habilitada.
              </p>

              <Link
                href="/profesionales"
                className="mt-5 flex h-12 w-fit items-center rounded-[10px] bg-accion px-[22px] text-[15.5px] font-semibold text-white transition-colors hover:bg-accion-hover"
              >
                Solicitar cuenta profesional
              </Link>
            </div>
          </article>

          <article className="relative min-h-[340px] overflow-hidden rounded-2xl bg-brand-wood-light">
            <Image
              src={foto}
              alt=""
              fill
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
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
        "Cargá el despiece en milímetros, mirá el plano y comprá el corte hecho.",
      href: "/corte",
      cta: "Armar mi corte",
    },
    {
      icono: ClipboardList,
      titulo: "Presupuesto online",
      texto:
        "Armá tu lista, pedí precio y seguí la respuesta desde tu cuenta.",
      href: "/carrito",
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
    /*
     * La calculadora vuelve a tener puerta de entrada.
     *
     * Salió del menú principal a pedido de la clienta y por arrastre quedó
     * fuera de todo el sitio: existía, calculaba bien y no se llegaba a ella
     * desde ningún lado. Acá no contradice ese pedido —el menú sigue sin
     * tenerla— y deja de ser una herramienta que nadie puede encontrar.
     */
    {
      icono: Calculator,
      titulo: "Calculadora de materiales",
      texto:
        "Cuántas chapas, placas, tablas o metros necesitás, a partir de las medidas.",
      href: "/calculadora",
      cta: "Calcular materiales",
    },
  ];

  return (
    <section className="bg-sitio-alt py-[48px]">
      <div className="contenedor">
        <TituloSeccion>Herramientas</TituloSeccion>

        <div className="mt-7 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
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
    <section className="bg-sitio-fondo py-[48px]">
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

            <Button
              render={<Link href="/nosotros" />}
              variant="outline"
              className="rounded-full"
            >
              Conocé nuestra historia
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
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
            <div className="absolute -bottom-6 -left-6 max-w-[240px] rounded-2xl border bg-card p-6 shadow-2xl">
              <p className="mb-1 text-lg font-bold">Moldava</p>
              {/* Decía "distribución nacional", que venía del prototipo. El
                  alcance real es el que dio la clienta y vive en
                  `lib/empresa.ts`: la Provincia de Buenos Aires. */}
              <p className="text-sm text-muted-foreground">
                Nuestra marca propia de molduras, con entrega en puerta en{" "}
                {ALCANCE_MOLDAVA}.
              </p>
            </div>
          </div>
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
    <section className="bg-sitio-fondo py-[48px]">
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
                  {/* El número sale de la sucursal de la tarjeta: estaba fijo
                      en el de Casa Central, así que "Llamar" en la ficha del
                      Aserradero discaba al otro local. */}
                  {s.telefono && (
                    <Button
                      render={
                        <a href={`tel:${s.telefono.replace(/[^\d+]/g, "")}`} />
                      }
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                    >
                      <Phone className="mr-1.5 h-3.5 w-3.5" />
                      Llamar
                    </Button>
                  )}
                  {s.whatsapp && (
                    <Button
                      render={
                        <a
                          href={`https://wa.me/${s.whatsapp.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                      size="sm"
                      className="rounded-full bg-brand-green text-white hover:bg-brand-green/90"
                    >
                      <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                      WhatsApp
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

async function CierreCta() {
  const whatsapp = await enlaceWhatsapp();
  return (
    <section className="relative overflow-hidden bg-oscuro-marca py-[52px] text-white">
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
          <Button
            render={<Link href="/catalogo" />}
            size="lg"
            className="h-14 rounded-full bg-brand-orange px-8 text-base font-semibold text-white hover:bg-brand-orange-dark"
          >
            Ver el catálogo
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          {/* "Hacer más promoción de hacer una cuenta": en toda la portada no
              había un solo enlace a registrarse, y en la barra de arriba
              aparece recién desde pantallas anchas. */}
          {/* Se muestra solo a quien no entró, y eso lo decide el navegador:
              preguntarlo en el servidor obligaba a rearmar la portada entera en
              cada visita para esconder un botón. */}
          <BotonCrearCuenta />
          <Button
            render={
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" />
            }
            size="lg"
            className="h-14 rounded-full border-2 border-white/30 bg-white/10 px-8 text-base !text-white backdrop-blur-sm hover:bg-white/20"
          >
            <MessageCircle className="mr-2 h-5 w-5" />
            Escribinos por WhatsApp
          </Button>
        </div>
      </div>
    </section>
  );
}
