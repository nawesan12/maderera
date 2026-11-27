import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { fechaLarga, hora, moneda } from "@/lib/formato";
import { asistentesDe, listarEventos } from "@/lib/dal/admin/eventos";
import { CrearEvento } from "./crear";
import { AccionesEvento, RecordarEvento, Recordatorios } from "./acciones";
import { Asistentes } from "./asistentes";

export const metadata: Metadata = { title: "Eventos" };

/** Los eventos pasados que muestran sus anotados para tomar asistencia. */
const PASADOS_CON_ASISTENTES = 10;

/**
 * Capacitaciones y eventos (cláusula 1.7).
 *
 * Los próximos van arriba con sus asistentes desplegables: durante la semana
 * previa a una capacitación, la pregunta que se hace todos los días es
 * "¿cuántos se anotaron?", y tenerla a un clic es lo que hace que la pantalla
 * se use.
 */
export default async function EventosAdminPage() {
  const eventos = await listarEventos();

  // El más cercano arriba: el de mañana quedaba último (M2S2-092).
  const proximos = eventos
    .filter((e) => e.proximo)
    .sort((a, b) => a.inicia.getTime() - b.inicia.getTime());
  const pasados = eventos.filter((e) => !e.proximo);
  // Los que ya pasaron conservan sus anotados y «Editar»: es cuando se toma
  // asistencia, y una fecha mal cargada se tiene que poder corregir
  // (M3S2-010). Los más recientes, para no pedir todos.
  const recientes = pasados.slice(0, PASADOS_CON_ASISTENTES);

  const asistentes = await Promise.all(
    [...proximos, ...recientes].map(async (e) => [e.id, await asistentesDe(e.id)] as const),
  );
  const porEvento = new Map(asistentes);
  const porRecordarManana = proximos.filter((e) => e.manana).reduce((n, e) => n + e.porRecordar, 0);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Eventos y capacitaciones"
      >
        <Recordatorios porRecordar={porRecordarManana} />
      </EncabezadoPanel>

      <CrearEvento />

      {eventos.length === 0 ? (
        <section className="tarjeta px-6 py-16 text-center">
          <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <h2 className="mt-4 text-lg font-medium">
            Todavía no hay eventos cargados
          </h2>
        </section>
      ) : (
        <>
          {proximos.map((evento) => (
            <section key={evento.id} className="tarjeta">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-4">
                <div className="min-w-[16rem] flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-lg font-medium">{evento.titulo}</h2>
                    <EtiquetaEstado estado={evento.estado} />
                    {evento.soloProfesionales && (
                      <span className="rounded-full bg-brand-orange/15 px-2.5 py-1 text-sm font-medium text-brand-orange-dark">
                        Solo profesionales
                      </span>
                    )}
                  </div>

                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4" />
                      {fechaLarga.format(evento.inicia)} ·{" "}
                      {hora.format(evento.inicia)}
                    </span>
                    {evento.lugar && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-4 w-4" />
                        {evento.lugar}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5">
                      <Users className="h-4 w-4" />
                      {evento.cupo > 0
                        ? `${evento.inscriptos} de ${evento.cupo}`
                        : `${evento.inscriptos} anotados`}
                    </span>
                    {evento.precio > 0 && (
                      <span>
                        {moneda.format(evento.precio)} ·{" "}
                        {moneda.format(evento.recaudado)} cobrado
                      </span>
                    )}
                  </p>

                  {evento.reservados > 0 && (
                    <p className="mt-1 text-base text-brand-orange-dark">
                      {evento.reservados} con el lugar reservado sin pagar
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2">
                  <AccionesEvento id={evento.id} titulo={evento.titulo} estado={evento.estado} anotados={evento.inscriptos} />
                  <div className="flex flex-wrap justify-end gap-2">
                    {evento.estado === "publicado" && (
                      <RecordarEvento id={evento.id} titulo={evento.titulo} porRecordar={evento.porRecordar} />
                    )}
                    <CrearEvento evento={evento} />
                  </div>
                  {evento.estado === "publicado" && (
                    <Link
                      href={`/eventos/${evento.slug}`}
                      target="_blank"
                      className="text-base font-medium text-brand-orange-dark hover:underline"
                    >
                      Ver en el sitio
                    </Link>
                  )}
                </div>
              </div>

              <Asistentes asistentes={porEvento.get(evento.id) ?? []} empezo={evento.empezo} />
            </section>
          ))}

          {pasados.length > 0 && (
            <section className="tarjeta">
              <div className="border-b px-5 py-4">
                <h2 className="text-base font-medium">Ya pasaron</h2>
              </div>
              <ul className="divide-y">
                {pasados.map((evento) => {
                  const lista = porEvento.get(evento.id);
                  return (
                  <li key={evento.id}>
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
                      <span className="min-w-[14rem] flex-1 text-base">
                        {evento.titulo}
                        <span className="block text-muted-foreground">
                          {fechaLarga.format(evento.inicia)}
                        </span>
                      </span>
                      <span className="text-base text-muted-foreground">
                        {evento.confirmados === 1 ? "1 asistente" : `${evento.confirmados} asistentes`}
                      </span>
                      {evento.precio > 0 && (
                        <span className="tabular text-base">
                          {moneda.format(evento.recaudado)}
                        </span>
                      )}
                      <CrearEvento evento={evento} />
                    </div>
                    {lista && <Asistentes asistentes={lista} empezo />}
                  </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
