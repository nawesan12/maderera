import type { Metadata } from "next";
import Link from "next/link";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import Image from "next/image";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { eventosProximos } from "@/lib/dal/profesionales";
import { fechaLarga, formatearMonto, hora } from "@/lib/formato";

export const metadata: Metadata = {
  title: "Capacitaciones y eventos",
  description:
    "Capacitaciones, charlas técnicas y jornadas de Maderera Juan B. Justo en Mar del Plata. Inscripción online.",
  alternates: { canonical: "/eventos" },
};

/**
 * Agenda de capacitaciones (cláusula 1.7).
 *
 * El cupo restante va a la vista de entrada: es el dato que hace que alguien se
 * anote hoy en vez de dejarlo para después, y el que evita que llegue a
 * anotarse cuando ya no hay lugar.
 */
export default async function EventosPage() {
  const eventos = await eventosProximos();

  return (
    <div className="min-h-screen bg-sitio-alt">
      <EncabezadoPublico
        titulo="Capacitaciones y eventos"
        bajada="Jornadas en la sucursal, con cupo limitado."
      />

      <div className="contenedor py-10">
        {eventos.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-white/60 px-6 py-16 text-center">
            <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <h2 className="mt-4 text-xl font-semibold">
              No hay eventos programados
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-muted-foreground">
              Publicamos las capacitaciones acá apenas se confirman. Si te
              interesa alguna en particular, escribinos.
            </p>
          </div>
        ) : (
          <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {eventos.map((evento) => {
              const lugares =
                evento.cupo > 0 ? evento.cupo - evento.inscriptos : null;
              const agotado = lugares !== null && lugares <= 0;

              return (
                <li key={evento.id}>
                  <Link
                    href={`/eventos/${evento.slug}`}
                    prefetch={false}
                    className="flex h-full flex-col overflow-hidden rounded-xl border bg-white transition-shadow hover:shadow-md"
                  >
                    {evento.imagenUrl && (
                      <div className="relative aspect-[16/9] bg-muted">
                        <Image
                          src={evento.imagenUrl}
                          alt=""
                          fill
                          sizes="(max-width: 768px) 100vw, 33vw"
                          className="object-cover"
                        />
                      </div>
                    )}

                    <div className="flex flex-1 flex-col p-5">
                      <p className="flex items-center gap-2 text-sm font-medium text-brand-orange-dark">
                        <CalendarDays className="h-4 w-4" />
                        {fechaLarga.format(evento.inicia)} ·{" "}
                        {hora.format(evento.inicia)}
                      </p>

                      <h2 className="mt-2 text-lg font-semibold leading-snug">
                        {evento.titulo}
                      </h2>

                      {evento.resumen && (
                        <p className="mt-1 flex-1 text-sm text-muted-foreground">
                          {evento.resumen}
                        </p>
                      )}

                      {evento.lugar && (
                        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4 shrink-0" />
                          {evento.lugar}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-sm">
                        <span className="font-medium">
                          {evento.precio > 0
                            ? formatearMonto(evento.precio)
                            : "Sin cargo"}
                        </span>

                        {lugares !== null && (
                          <span
                            className={`flex items-center gap-1.5 ${
                              agotado
                                ? "text-muted-foreground"
                                : lugares <= 5
                                  ? "text-brand-orange-dark"
                                  : "text-muted-foreground"
                            }`}
                          >
                            <Users className="h-4 w-4" />
                            {agotado
                              ? "Sin lugares"
                              : `${lugares} lugar${lugares === 1 ? "" : "es"}`}
                          </span>
                        )}

                        {evento.soloProfesionales && (
                          <span className="rounded-full bg-brand-orange/10 px-2 py-0.5 text-brand-orange-dark">
                            Profesionales
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
