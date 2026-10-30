import type { Metadata } from "next";
import { numeroWhatsapp } from "@/lib/whatsapp/enlace";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Clock, MapPin, Users } from "lucide-react";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import {
  estadoProfesional,
  eventoPorSlug,
  eventoVisible,
  slugsDeEventosVisibles,
} from "@/lib/dal/profesionales";
import { Suspense } from "react";
import { CargandoSitio } from "@/components/sitio/cargando";
import { degradar } from "@/lib/degradar";
import { cobrosEnVivo } from "@/lib/dal/pagos";
import { fechaLarga, hora } from "@/lib/formato";
import { Anotarse } from "./anotarse";
import { DatosEstructurados } from "@/components/datos-estructurados";
import { eventoJsonLd, metadatosDePagina, migasJsonLd } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const evento = await eventoPorSlug(slug);

  if (!evento) return { title: "Evento no encontrado" };

  return metadatosDePagina({
    titulo: evento.titulo,
    descripcion:
      evento.resumen ??
      `${evento.titulo}: capacitación de Maderera Juan B. Justo en Mar del Plata. Inscripción online.`,
    ruta: `/eventos/${slug}`,
    imagen: evento.imagenUrl ?? undefined,
    // Un evento que ya pasó sigue en línea para quien tenga el enlace, pero
    // no tiene que aparecer en una búsqueda: ya no se puede ir.
    indexar: !evento.yaPaso,
  });
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

  // El 404 se decide acá, con la caché, antes de que salga el esqueleto: lo
  // que se resuelve detrás del `<Suspense>` ya no puede cambiar el código.
  if (!(await eventoVisible(slug))) notFound();

  return (
    <Suspense fallback={<CargandoSitio />}>
      <FichaDelEvento slug={slug} />
    </Suspense>
  );
}

/**
 * Unos pocos eventos se arman en el build. Con Cache Components, leer el
 * parámetro de una ruta sin esta lista es un dato por pedido, y obligaría a
 * resolver el 404 detrás de un `<Suspense>`. Sin eventos, un slug que no
 * existe: da 404 en el build y la verificación se hace igual.
 */
export async function generateStaticParams() {
  const slugs = await degradar("los eventos del build", () => slugsDeEventosVisibles(6), []);
  return (slugs.length > 0 ? slugs : ["sin-eventos"]).map((slug) => ({ slug }));
}

async function FichaDelEvento({ slug }: { slug: string }) {
  const evento = await eventoPorSlug(slug);

  // Se pudo haber pasado a borrador entre la caché y esta consulta.
  if (!evento) notFound();

  const [sesion, cliente, profesional, whatsapp] = await Promise.all([
    getSession(),
    clienteDeLaSesion(),
    estadoProfesional(),
    numeroWhatsapp(),
  ]);

  const lugares = evento.cupo > 0 ? evento.cupo - evento.inscriptos : null;
  const agotado = lugares !== null && lugares <= 0;
  const { yaPaso } = evento;

  return (
    <div className="min-h-screen bg-sitio-alt">
      <DatosEstructurados
        datos={[
          eventoJsonLd(evento),
          migasJsonLd([
            { nombre: "Inicio", ruta: "/" },
            { nombre: "Capacitaciones y eventos", ruta: "/eventos" },
            { nombre: evento.titulo, ruta: `/eventos/${evento.slug}` },
          ]),
        ]}
      />
      <div className="mx-auto px-6 max-w-5xl py-8">
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
                  alt={evento.titulo}
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
              <div className="rounded-xl border bg-card p-5">
                <p className="font-medium">Este evento ya pasó</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Escribinos si te interesa que lo repitamos.
                </p>
              </div>
            ) : (
              <Anotarse
                whatsapp={whatsapp}
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
                enVivo={await cobrosEnVivo()}
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
