import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Clock,
  Mail,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
} from "lucide-react";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { buttonVariants } from "@/components/ui/button";
import { telefonoParaMarcar } from "@/lib/formato";
import { REDES } from "@/lib/empresa";
import { metadatosDePagina, sucursalJsonLd } from "@/lib/seo";
import { SUCURSALES, sucursalPublicada } from "@/lib/sucursales";

/**
 * La ficha de cada sucursal.
 *
 * **Una página por local, y no solo la lista**, porque cada local tiene su
 * Perfil de Empresa en Google, con su dirección, su horario y sus reseñas, y
 * ese perfil necesita una página propia a la que apuntar como «sitio web».
 * Con una sola página para los dos, Google no tiene cómo saber cuál de los
 * dos nodos del marcado es el de cada perfil, y quien busca «maderera
 * Diagonal Canosa» cae en una página que habla primero de Juan B. Justo.
 *
 * **Todo sale de `lib/sucursales.ts`**, la misma constante que usan el pie,
 * el marcado y la página de contacto: el nombre, la dirección y el teléfono
 * (lo que en SEO local se llama NAP) tienen que ser idénticos en todos lados,
 * y en el Perfil de Empresa también. Es lo que Google compara para confiar en
 * la ficha.
 *
 * Es una página fija: no lee la base ni la sesión, se arma en el build.
 */

export function generateStaticParams() {
  return SUCURSALES.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sucursal = sucursalPublicada(slug);
  if (!sucursal) return { title: "Sucursal no encontrada", robots: { index: false } };

  return metadatosDePagina({
    titulo: `${sucursal.nombre}: ${sucursal.direccion}`,
    descripcion: `Maderera Juan B. Justo ${sucursal.nombre}, ${sucursal.direccion}. Horario: ${sucursal.horario}. Teléfono ${sucursal.telefono}. ${renglones(sucursal.destacados).join(", ")}.`,
    ruta: `/sucursales/${slug}`,
    imagen: {
      url: `/og/sucursal/${slug}`,
      ancho: 1200,
      alto: 630,
      alt: `Maderera Juan B. Justo — ${sucursal.nombre}`,
    },
  });
}

/** "a\nb\nc" -> ["a", "b", "c"], sin renglones vacíos. */
function renglones(texto: string): string[] {
  return texto
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);
}

export default async function SucursalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sucursal = sucursalPublicada(slug);
  if (!sucursal) notFound();

  const otras = SUCURSALES.filter((s) => s.slug !== slug);
  const servicios = renglones(sucursal.servicios);
  const destacados = renglones(sucursal.destacados);
  const comoLlegar =
    sucursal.mapUrl ??
    `https://maps.google.com/?q=${encodeURIComponent(sucursal.direccion)}`;
  const mapaInsertado = `https://maps.google.com/maps?q=${encodeURIComponent(
    `Maderera Juan B. Justo, ${sucursal.direccion}`,
  )}&z=16&output=embed`;

  return (
    <div className="min-h-screen bg-sitio-alt">
      <DatosEstructurados
        datos={sucursalJsonLd({
          slug: sucursal.slug,
          name: sucursal.nombre,
          address: sucursal.direccion,
          phone: sucursal.telefono,
          email: sucursal.email,
          hours: sucursal.horario,
          whatsapp: sucursal.whatsapp,
          geo: sucursal.geo,
          mapa: sucursal.mapUrl,
          foto: sucursal.foto?.ruta ?? null,
          redes: [REDES.facebook, REDES.instagram],
        })}
      />

      <EncabezadoPublico
        titulo={`Sucursal ${sucursal.nombre}`}
        bajada={`${sucursal.direccion}. ${destacados.join(" · ")}.`}
        migas={[{ nombre: "Sucursales", ruta: "/sucursales" }]}
        ruta={`/sucursales/${slug}`}
      />

      <div className="contenedor grid gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="como-encontrarnos"
          className="tarjeta space-y-6 rounded-2xl border bg-card p-6 shadow-sm lg:p-8"
        >
          <h2 id="como-encontrarnos" className="text-2xl font-bold tracking-[-0.025em]">
            Cómo encontrarnos
          </h2>

          {/* El NAP —nombre, dirección, teléfono— con el mismo texto que el
              marcado, el pie y el Perfil de Empresa. */}
          <address className="not-italic">
            <dl className="space-y-3.5 text-[16px]">
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
                <div>
                  <dt className="sr-only">Dirección</dt>
                  <dd>{sucursal.direccion}</dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
                <div>
                  <dt className="sr-only">Horario</dt>
                  <dd>{sucursal.horario}</dd>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
                <div>
                  <dt className="sr-only">Teléfono</dt>
                  <dd>
                    <a
                      href={`tel:${telefonoParaMarcar(sucursal.telefono)}`}
                      className="tabular hover:text-acento-texto"
                    >
                      {sucursal.telefono}
                    </a>
                  </dd>
                </div>
              </div>
              {sucursal.email && (
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
                  <div>
                    <dt className="sr-only">Correo</dt>
                    <dd>
                      <a href={`mailto:${sucursal.email}`} className="hover:text-acento-texto">
                        {sucursal.email}
                      </a>
                    </dd>
                  </div>
                </div>
              )}
            </dl>
          </address>

          <div className="flex flex-wrap gap-3">
            <a
              href={`tel:${telefonoParaMarcar(sucursal.telefono)}`}
              className={buttonVariants({
                className:
                  "h-[46px] rounded-[9px] bg-accion px-[18px] text-[15px] font-semibold text-white hover:bg-accion-hover",
              })}
            >
              <Phone className="mr-2 h-4 w-4" />
              Llamar
            </a>
            <a
              href={comoLlegar}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", className: "h-[46px]" })}
            >
              <Navigation className="mr-2 h-4 w-4" />
              Cómo llegar
            </a>
            <a
              href={`https://wa.me/${sucursal.whatsapp.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ className: "h-[46px]" })}
            >
              <MessageCircle className="mr-2 h-4 w-4" />
              WhatsApp
            </a>
          </div>

          {sucursal.foto && (
            <figure>
              {/* A su tamaño real: es la foto que publicaba el sitio viejo, y
                  estirarla la deja borrosa. */}
              <Image
                src={sucursal.foto.ruta}
                alt={`Frente de la sucursal ${sucursal.nombre}, ${sucursal.direccion}`}
                width={sucursal.foto.ancho}
                height={sucursal.foto.alto}
                className="rounded-xl"
              />
            </figure>
          )}
        </section>

        <div className="space-y-8">
          <section
            aria-labelledby="servicios"
            className="rounded-2xl border bg-card p-6 shadow-sm lg:p-8"
          >
            <h2 id="servicios" className="text-2xl font-bold tracking-[-0.025em]">
              Qué vas a encontrar
            </h2>
            <ul className="mt-4 grid gap-2.5 text-[15.5px]">
              {servicios.map((servicio) => (
                <li key={servicio} className="flex items-start gap-2.5">
                  <span
                    aria-hidden
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green"
                  />
                  {servicio}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[15px] text-texto-2">
              Antes de venir,{" "}
              <Link href="/stock" className="font-medium text-acento-texto hover:underline">
                fijate si hay stock
              </Link>{" "}
              o mirá el{" "}
              <Link href="/catalogo" className="font-medium text-acento-texto hover:underline">
                catálogo con precios
              </Link>
              .
            </p>
          </section>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            {/* Diferido: el mapa pesa y está abajo de todo en el teléfono. */}
            <iframe
              title={`Mapa de la sucursal ${sucursal.nombre}`}
              src={mapaInsertado}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="block h-[320px] w-full border-0"
            />
          </div>

          {otras.length > 0 && (
            <p className="text-[15px] text-texto-2">
              También estamos en{" "}
              {otras.map((o, i) => (
                <span key={o.slug}>
                  {i > 0 && " y "}
                  <Link
                    href={`/sucursales/${o.slug}`}
                    className="font-medium text-acento-texto hover:underline"
                  >
                    {o.nombre} ({o.direccion})
                  </Link>
                </span>
              ))}
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
