import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  Clock,
  Mail,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { migasJsonLd, sucursalJsonLd } from "@/lib/seo";

/**
 * Las sucursales, contra la base.
 *
 * Antes era una página de cliente con las dos direcciones escritas a mano y
 * fotos de un aserradero ajeno sacadas de un banco de imágenes. El problema no
 * era el "use client": era que el teléfono del local vivía en tres lugares
 * —esta página, el checkout y el pie— y cambiarlo obligaba a publicar el sitio
 * de nuevo, con lo cual no se cambiaba.
 *
 * Ahora sale todo de `branches`, que es de donde también sale el marcado que
 * Google muestra al costado de la búsqueda. Una sola fuente: si el horario del
 * sábado cambia, cambia en los cuatro lugares a la vez.
 */

export const metadata: Metadata = {
  title: "Sucursales en Mar del Plata",
  description:
    "Dos sucursales en Mar del Plata: Casa Central en Av. Juan B. Justo 4153 y Aserradero en Canosa 61. Horarios, servicios y contacto directo.",
  keywords: [
    "maderera mar del plata",
    "sucursales maderera",
    "juan b justo 4153",
    "canosa 61",
    "madera mar del plata direccion",
  ],
  alternates: { canonical: "/sucursales" },
  openGraph: {
    title: "Sucursales | Maderera Juan B. Justo — Mar del Plata",
    description:
      "Casa Central y Aserradero. Lunes a viernes de 8 a 16, sábados de 8 a 12.",
  },
};

/** "a\nb\nc" -> ["a", "b", "c"], sin renglones vacíos. */
function renglones(texto: string): string[] {
  return texto
    .split("\n")
    .map((linea) => linea.trim())
    .filter(Boolean);
}

export default async function SucursalesPage() {
  const sucursales = await listarSucursalesPublicas();

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

      <div className="bg-brand-gray py-12 text-white">
        <div className="contenedor">
          <div className="mb-2 flex items-center gap-3">
            <MapPin className="h-8 w-8 text-brand-orange" />
            <h1 className="text-3xl font-bold">Nuestras sucursales</h1>
          </div>
          <p className="text-white/70">
            {sucursales.length === 1
              ? "Nuestra ubicación en Mar del Plata."
              : `${sucursales.length} ubicaciones en Mar del Plata para brindarte el mejor servicio.`}
          </p>
        </div>
      </div>

      <div className="contenedor space-y-16 py-12">
        {sucursales.map((sucursal) => {
          const servicios = renglones(sucursal.servicios);
          const destacados = renglones(sucursal.destacados);
          const comoLlegar = `https://maps.google.com/?q=${encodeURIComponent(
            sucursal.direccion,
          )}`;

          return (
            <section
              key={sucursal.id}
              id={sucursal.slug}
              className="overflow-hidden rounded-2xl border bg-card shadow-sm"
            >
              <div className="grid lg:grid-cols-2">
                {/* Sin foto real del local se muestra una placa de marca. Una
                    foto de archivo de otro aserradero es peor que ninguna: el
                    visitante llega esperando algo que no va a encontrar. */}
                <div className="relative flex h-56 items-end bg-brand-gray lg:h-auto lg:min-h-[22rem]">
                  {sucursal.imagenUrl ? (
                    <>
                      <Image
                        src={sucursal.imagenUrl}
                        alt={`Sucursal ${sucursal.nombre}`}
                        fill
                        sizes="(min-width: 1024px) 50vw, 100vw"
                        className="object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    </>
                  ) : (
                    <div
                      aria-hidden
                      className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(232,89,12,0.35),transparent_60%)]"
                    />
                  )}

                  <div className="relative p-6 lg:p-8">
                    <p className="text-sm font-medium uppercase tracking-wider text-brand-orange">
                      Maderera Juan B. Justo
                    </p>
                    <p className="text-3xl font-bold text-white">
                      {sucursal.nombre}
                    </p>
                  </div>
                </div>

                <div className="space-y-6 p-6 lg:p-8">
                  {destacados.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {destacados.map((destacado) => (
                        <li
                          key={destacado}
                          className="rounded-full bg-brand-orange/10 px-3 py-1 text-sm font-medium text-brand-orange-dark"
                        >
                          {destacado}
                        </li>
                      ))}
                    </ul>
                  )}

                  <dl className="space-y-3 text-sm">
                    <div className="flex items-start gap-3">
                      <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
                      <div>
                        <dt className="sr-only">Dirección</dt>
                        <dd>{sucursal.direccion}</dd>
                      </div>
                    </div>

                    {sucursal.telefono && (
                      <div className="flex items-center gap-3">
                        <Phone className="h-5 w-5 shrink-0 text-brand-orange" />
                        <div>
                          <dt className="sr-only">Teléfono</dt>
                          <dd>
                            <a
                              href={`tel:${sucursal.telefono.replace(/[^\d+]/g, "")}`}
                              className="hover:text-brand-orange"
                            >
                              {sucursal.telefono}
                            </a>
                          </dd>
                        </div>
                      </div>
                    )}

                    {sucursal.email && (
                      <div className="flex items-center gap-3">
                        <Mail className="h-5 w-5 shrink-0 text-brand-orange" />
                        <div>
                          <dt className="sr-only">Correo</dt>
                          <dd>
                            <a
                              href={`mailto:${sucursal.email}`}
                              className="hover:text-brand-orange"
                            >
                              {sucursal.email}
                            </a>
                          </dd>
                        </div>
                      </div>
                    )}

                    {sucursal.horario && (
                      <div className="flex items-center gap-3">
                        <Clock className="h-5 w-5 shrink-0 text-brand-orange" />
                        <div>
                          <dt className="sr-only">Horario</dt>
                          <dd>{sucursal.horario}</dd>
                        </div>
                      </div>
                    )}
                  </dl>

                  {servicios.length > 0 && (
                    <div className="border-t pt-5">
                      <h2 className="mb-3 font-semibold">Servicios</h2>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {servicios.map((servicio) => (
                          <li
                            key={servicio}
                            className="flex items-start gap-2 text-sm text-muted-foreground"
                          >
                            <span
                              aria-hidden
                              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green"
                            />
                            {servicio}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Anclas con estilo de botón: un <button> adentro de un <a>
                      es HTML inválido, y acá lo que se hace es navegar. */}
                  <div className="flex flex-wrap gap-3">
                    <a
                      href={comoLlegar}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({ variant: "outline" })}
                    >
                      <Navigation className="mr-2 h-4 w-4" />
                      Cómo llegar
                    </a>

                    {sucursal.whatsapp && (
                      <a
                        href={`https://wa.me/${sucursal.whatsapp.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonVariants()}
                      >
                        <MessageCircle className="mr-2 h-4 w-4" />
                        Escribir por WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </section>
          );
        })}

        <p className="text-center text-base text-muted-foreground">
          ¿Buscás algo puntual?{" "}
          <Link href="/stock" className="font-medium text-brand-orange hover:underline">
            Consultá la disponibilidad por sucursal
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
