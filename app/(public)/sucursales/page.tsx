import { tienda } from "@/lib/dal/contenido";
import type { Metadata } from "next";
import Link from "next/link";
import { telefonoParaMarcar } from "@/lib/formato";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import { Clock, MapPin, Navigation, Phone } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { metadatosDePagina, migasJsonLd, sucursalJsonLd } from "@/lib/seo";
import { REDES } from "@/lib/empresa";
import { BotonWhatsapp } from "@/components/whatsapp/boton";

/**
 * Las sucursales, contra la base.
 *
 * Antes era una página de cliente con las dos direcciones escritas a mano y
 * fotos de un aserradero ajeno sacadas de un banco de imágenes. El problema no
 * era el "use client": era que el teléfono del local vivía en tres lugares
 * —esta página, el carrito y el pie— y cambiarlo obligaba a publicar el sitio
 * de nuevo, con lo cual no se cambiaba.
 *
 * Ahora sale todo de `branches`, que es de donde también sale el marcado que
 * Google muestra al costado de la búsqueda. Una sola fuente: si el horario del
 * sábado cambia, cambia en los cuatro lugares a la vez.
 */

/**
 * La metadata también sale de `branches`.
 *
 * Estaba escrita a mano y ya se había desincronizado del cuerpo de la página:
 * decía "Canosa 61" cuando la dirección real es **Diagonal** Canosa 61, y
 * fijaba el horario del sábado en el texto. Google compara el texto de la
 * página con el marcado para decidir si le cree a la ficha del negocio, así
 * que dos direcciones distintas para el mismo local es exactamente lo que no
 * conviene publicar.
 */
export async function generateMetadata(): Promise<Metadata> {
  const sucursales = await listarSucursalesPublicas();
  const detalle = sucursales
    .map((s) => `${s.nombre} en ${s.direccion}`)
    .join(" y ");

  return {
    ...metadatosDePagina({
      titulo: "Sucursales en Mar del Plata: dirección, horario y teléfono",
      descripcion: sucursales.length
        ? `Nuestras sucursales en Mar del Plata: ${detalle}. Horarios, servicios y contacto directo.`
        : "Nuestras sucursales en Mar del Plata. Horarios, servicios y contacto directo.",
      ruta: "/sucursales",
    }),
    keywords: [
      "maderera mar del plata",
      "sucursales maderera",
      "madera mar del plata direccion",
      ...sucursales.map((s) => s.direccion.toLowerCase()),
    ],
  };
}

export default async function SucursalesPage() {
  const [sucursales, laTienda] = await Promise.all([listarSucursalesPublicas(), tienda()]);

  const marcado = [
    ...sucursales.map((s) =>
      sucursalJsonLd({
        slug: s.slug,
        name: s.nombre,
        address: s.direccion,
        phone: s.telefono,
        email: s.email,
        hours: s.horario,
        whatsapp: s.whatsapp,
        geo: s.geo,
        mapa: s.mapUrl,
        foto: s.foto?.ruta ?? null,
        redes: [REDES.facebook, REDES.instagram],
      }),
    ),
    migasJsonLd([
      { nombre: "Inicio", ruta: "/" },
      { nombre: "Sucursales", ruta: "/sucursales" },
    ]),
  ];

  return (
    <div className="min-h-screen">
      <DatosEstructurados datos={marcado} />

      <EncabezadoPublico
        foto="/sucursales/casa-central.jpg"
        titulo="Sucursales"
        bajada={
          sucursales.length === 1
            ? "Nuestra ubicación en Mar del Plata."
            : `${sucursales.length} locales en Mar del Plata.`
        }
      />

      {/* Una lista y no una tarjeta grande por local (hallazgo 35): lo que se
          viene a buscar es la dirección, el horario y cómo comunicarse, y
          con más sucursales la página no se vuelve un scroll de fotos. Las
          filas salen de `branches`: una sucursal activa nueva aparece sola. */}
      {/* Abajo, lugar para el botón flotante de WhatsApp: tapaba «Cómo llegar»
          de la última sucursal en el teléfono. */}
      <div className="contenedor space-y-10 pt-10 pb-24 md:py-14">
        <ul className="superficie divide-y divide-linea-suave overflow-hidden rounded-2xl">
          {sucursales.map((sucursal) => {
            const comoLlegar =
              sucursal.mapUrl ??
              `https://maps.google.com/?q=${encodeURIComponent(sucursal.direccion)}`;
            const boton = "h-11 w-full rounded-[10px] px-4 text-[15px] md:w-auto";
            // Si falta el teléfono o el WhatsApp, el que queda va a lo ancho.
            const unoSolo = !sucursal.telefono || !sucursal.whatsapp;

            return (
              <li
                key={sucursal.id}
                id={sucursal.slug}
                className="grid scroll-mt-24 gap-4 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-8 md:px-7 md:py-6"
              >
                <div className="min-w-0 space-y-1.5">
                  <h2 className="text-xl font-bold tracking-[-0.01em]">
                    <Link href={`/sucursales/${sucursal.slug}`} className="hover:text-acento-texto">
                      {sucursal.nombre}
                    </Link>
                  </h2>
                  {sucursal.direccion && (
                    <p className="flex items-start gap-2 text-[15px] text-texto-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-orange" aria-hidden="true" />
                      <span className="sr-only">Dirección: </span>
                      {sucursal.direccion}
                    </p>
                  )}
                  {sucursal.horario && (
                    <p className="flex items-start gap-2 text-[15px] text-texto-2">
                      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-orange" aria-hidden="true" />
                      <span className="sr-only">Horario: </span>
                      {/* «8:00‑12:00» no se parte en el guion. */}
                      {sucursal.horario.replace(/(\d)-(\d)/g, "$1\u2011$2")}
                    </p>
                  )}
                </div>

                {/* Anclas con estilo de botón: un <button> adentro de un <a>
                    es HTML inválido, y acá lo que se hace es navegar. En el
                    teléfono, «Cómo llegar» —lo que más se busca ahí— arriba
                    y a lo ancho, y Llamar y WhatsApp abajo, de a dos: en tres
                    columnas quedaba «Có…». */}
                <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:justify-end">
                  {sucursal.telefono && (
                    <a
                      href={`tel:${telefonoParaMarcar(sucursal.telefono)}`}
                      aria-label={`Llamar a ${sucursal.nombre}`}
                      className={buttonVariants({
                        className: `${boton} bg-accion font-semibold text-white hover:bg-accion-hover ${unoSolo ? "col-span-2" : ""}`,
                      })}
                    >
                      <Phone className="h-4 w-4" aria-hidden="true" />
                      Llamar
                    </a>
                  )}
                  {sucursal.whatsapp && (
                    <BotonWhatsapp
                      enlace={`https://wa.me/${sucursal.whatsapp.replace(/\D/g, "")}`}
                      variante="secundario"
                      className={`w-full border-verde-whatsapp/40 px-4 md:w-auto ${unoSolo ? "col-span-2" : ""}`}
                      aria-label={`WhatsApp de ${sucursal.nombre}`}
                    >
                      WhatsApp
                    </BotonWhatsapp>
                  )}
                  <a
                    href={comoLlegar}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Cómo llegar a ${sucursal.nombre}`}
                    className={buttonVariants({
                      variant: "outline",
                      className: `${boton} order-first col-span-2 md:order-none`,
                    })}
                  >
                    <Navigation className="h-4 w-4" aria-hidden="true" />
                    Cómo llegar
                  </a>
                </div>
              </li>
            );
          })}
        </ul>

        {laTienda.stockVisible && (
        <p className="text-center text-base text-muted-foreground">
          ¿Buscás algo puntual?{" "}
          <Link href="/stock" className="font-medium text-acento-texto hover:underline">
            Consultá la disponibilidad por sucursal
          </Link>
          .
        </p>
        )}
      </div>
    </div>
  );
}
