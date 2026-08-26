import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Clock, MapPin, Users } from "lucide-react";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import { estadoProfesional, eventoPorSlug } from "@/lib/dal/profesionales";
import { cobrosEnVivo } from "@/lib/pagos";
import { fechaLarga, formatearMonto, hora } from "@/lib/formato";
import { Anotarse } from "./anotarse";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const evento = await eventoPorSlug(slug);

  if (!evento) return { title: "Evento" };

  return {
    title: evento.titulo,
    description: evento.resumen ?? undefined,
    alternates: { canonical: `/eventos/${slug}` },
    openGraph: {
      title: evento.titulo,
      description: evento.resumen ?? undefined,
      images: evento.imagenUrl ? [{ url: evento.imagenUrl }] : undefined,
    },
  };
}

/**
 * Ficha de un evento.
 *
 * Lo que decide si alguien se anota está todo arriba: cuándo, dónde, cuánto y
 * cuántos lugares quedan. La descripción larga va después, para quien ya se
 * convenció y quiere el detalle.
 */
export default async function EventoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const evento = await eventoPorSlug(slug);

  if (!evento) notFound();

  const [sesion, cliente, profesional] = await Promise.all([
    getSession(),
    clienteDeLaSesion(),
    estadoProfesional(),
  ]);

  const lugares = evento.cupo > 0 ? evento.cupo - evento.inscriptos : null;
  const agotado = lugares !== null && lugares <= 0;
  const yaPaso = evento.inicia.getTime() < Date.now();

  return (
    <div className="min-h-screen bg-brand-cream/30">
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <Link
          href="/eventos"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Todas las capacitaciones
        </Link>

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_22rem]">
          <div>
            {evento.imagenUrl && (
              <div className="relative mb-6 aspect-[16/9] overflow-hidden rounded-xl bg-muted">
                <Image
                  src={evento.imagenUrl}
                  alt=""
                  fill
                  sizes="(max-width: 1024px) 100vw, 60vw"
                  className="object-cover"
                  priority
                />
              </div>
            )}

            <h1 className="text-3xl font-bold tracking-tight">
              {evento.titulo}
            </h1>

            {evento.resumen && (
              <p className="mt-2 text-lg text-muted-foreground">
                {evento.resumen}
              </p>
            )}

            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <Dato
                icono={CalendarDays}
                etiqueta="Cuándo"
                valor={`${fechaLarga.format(evento.inicia)}, ${hora.format(evento.inicia)}`}
              />
              {evento.termina && (
                <Dato
                  icono={Clock}
                  etiqueta="Hasta"
                  valor={hora.format(evento.termina)}
                />
              )}
              {evento.lugar && (
                <Dato icono={MapPin} etiqueta="Dónde" valor={evento.lugar} />
              )}
              {lugares !== null && (
                <Dato
                  icono={Users}
                  etiqueta="Lugares"
                  valor={
                    agotado
                      ? "Sin lugares disponibles"
                      : `Quedan ${lugares} de ${evento.cupo}`
                  }
                />
              )}
            </dl>

            {evento.descripcion && (
              <div className="mt-8 space-y-4 whitespace-pre-line leading-relaxed">
                {evento.descripcion}
              </div>
            )}
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            {yaPaso ? (
              <div className="rounded-xl border bg-white p-5">
                <p className="font-medium">Este evento ya pasó</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Escribinos si te interesa que lo repitamos.
                </p>
              </div>
            ) : (
              <Anotarse
                eventId={evento.id}
                slug={evento.slug}
                precio={evento.precio}
                agotado={agotado}
                soloProfesionales={evento.soloProfesionales}
                esProfesional={profesional.aprobado}
                yaAnotado={
                  evento.miInscripcion !== null &&
                  evento.miInscripcion.estado !== "cancelada"
                }
                estadoInscripcion={evento.miInscripcion?.estado ?? null}
                nombre={cliente?.nombre ?? sesion?.name}
                email={cliente?.email ?? sesion?.email}
                telefono={cliente?.telefono}
                enVivo={cobrosEnVivo()}
              />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Dato({
  icono: Icono,
  etiqueta,
  valor,
}: {
  icono: React.ComponentType<{ className?: string }>;
  etiqueta: string;
  valor: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icono className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
      <div>
        <dt className="text-sm text-muted-foreground">{etiqueta}</dt>
        <dd className="font-medium">{valor}</dd>
      </div>
    </div>
  );
}
