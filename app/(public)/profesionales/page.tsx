import type { Metadata } from "next";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import Link from "next/link";
import { EncabezadoPublico } from "@/components/encabezado-publico";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  FileText,
  Lock,
  MessageCircle,
  Percent,
  Wallet,
} from "lucide-react";
import { getSession } from "@/lib/dal/session";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import {
  documentosReservados,
  documentosVisibles,
  estadoProfesional,
  eventosProximos,
} from "@/lib/dal/profesionales";
import { fechaLarga, formatearMonto } from "@/lib/formato";
import { FormularioProfesional } from "./formulario";

export const metadata: Metadata = {
  title: "Portal de profesionales",
  description:
    "Precios diferenciados, descuentos por volumen, cuenta corriente, presupuestos express en 24 horas y documentación técnica para arquitectos, constructoras y carpinteros de Mar del Plata.",
  alternates: { canonical: "/profesionales" },
};

const BENEFICIOS = [
  {
    icono: Percent,
    titulo: "Precios diferenciados",
    detalle:
      "Una lista propia, no un descuento parejo: cada producto con el margen que corresponde, y escalas por cantidad que se aplican solas en el carrito.",
  },
  {
    icono: Wallet,
    titulo: "Cuenta corriente",
    detalle:
      "Comprás y abonás después, dentro de un límite acordado. El saldo y cada movimiento los ves en tu cuenta, sin llamar a preguntar.",
  },
  {
    icono: Clock,
    titulo: "Presupuestos express",
    detalle:
      "Mandás la lista de la obra y contestamos en menos de 24 horas hábiles. Con el compromiso a la vista, no como promesa.",
  },
  {
    icono: FileText,
    titulo: "Documentación técnica",
    detalle:
      "Fichas de producto, tablas de carga e instructivos de colocación, todos en un lugar y listos para adjuntar al pliego.",
  },
];

/**
 * Portal de profesionales (cláusula 1.7).
 *
 * Era una maqueta entera del lado del cliente, con un formulario que no mandaba
 * nada y una lista de beneficios que no existían. Ahora es un Server Component
 * que muestra tres cosas distintas según quién esté mirando:
 *
 * - **Aprobado**: el panel con lo que ya tiene habilitado.
 * - **Con solicitud pendiente**: en qué está.
 * - **Todos los demás**: qué se gana y el formulario para pedirlo.
 *
 * La misma página para los tres casos, y no tres rutas, porque la pregunta que
 * trae a alguien acá es siempre la misma: "¿esto para mí qué es?".
 */
export default async function ProfesionalesPage() {
  const whatsapp = await enlaceWhatsapp();
  const [estado, sesion, cliente, eventos, documentos, reservados] =
    await Promise.all([
      estadoProfesional(),
      getSession(),
      clienteDeLaSesion(),
      eventosProximos(),
      documentosVisibles(),
      documentosReservados(),
    ]);

  return (
    <div className="min-h-screen">
      <EncabezadoPublico
        titulo="Portal Profesionales"
        bajada={
          estado.aprobado
            ? `Hola ${(estado.nombre ?? "").split(" ")[0]}, tu acceso está activo. Los precios del catálogo ya son los tuyos.`
            : "Precios por volumen, cuenta corriente y documentación reservada."
        }
      />

      <div className="contenedor py-12">
        {estado.aprobado ? (
          <PanelDelProfesional
            nombreLista={estado.nombreLista}
            limiteCredito={estado.limiteCredito}
            documentos={documentos.length}
          />
        ) : (
          <div className="grid gap-10 lg:grid-cols-[1fr_26rem]">
            <div>
              <div className="grid gap-5 sm:grid-cols-2">
                {BENEFICIOS.map((b) => (
                  <article
                    key={b.titulo}
                    className="rounded-xl border bg-card p-5"
                  >
                    <b.icono className="h-6 w-6 text-brand-orange" />
                    <h2 className="mt-3 font-semibold">{b.titulo}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {b.detalle}
                    </p>
                  </article>
                ))}
              </div>

              {reservados > 0 && (
                <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4 shrink-0" />
                  Hay {reservados} documento{reservados === 1 ? "" : "s"} técnico
                  {reservados === 1 ? "" : "s"} reservado
                  {reservados === 1 ? "" : "s"} para profesionales aprobados.
                </p>
              )}
            </div>

            <aside>
              {estado.solicitud?.estado === "pendiente" ? (
                <EstadoDeSolicitud fecha={estado.solicitud.createdAt} />
              ) : estado.solicitud?.estado === "rechazada" ? (
                <SolicitudRechazada motivo={estado.solicitud.motivoRechazo} />
              ) : (
                <div className="rounded-xl border bg-card p-6">
                  <h2 className="text-xl font-semibold">Pedí tu acceso</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Lo revisa un asesor y te contestamos en menos de 24 horas
                    hábiles.
                  </p>
                  <div className="mt-5">
                    <FormularioProfesional
                      emailSugerido={cliente?.email ?? sesion?.email}
                      nombreSugerido={cliente?.nombre ?? sesion?.name}
                    />
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}

        {eventos.length > 0 && (
          <section className="mt-14">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-2xl font-bold tracking-tight">
                Próximas capacitaciones
              </h2>
              <Link
                href="/eventos"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-orange-dark hover:underline"
              >
                Ver todas
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {eventos.slice(0, 3).map((evento) => {
                const lugares =
                  evento.cupo > 0 ? evento.cupo - evento.inscriptos : null;

                return (
                  <Link
                    key={evento.id}
                    href={`/eventos/${evento.slug}`}
                    prefetch={false}
                    className="rounded-xl border bg-card p-5 transition-shadow hover:shadow-md"
                  >
                    <p className="flex items-center gap-2 text-sm text-brand-orange-dark">
                      <CalendarDays className="h-4 w-4" />
                      {fechaLarga.format(evento.inicia)}
                    </p>
                    <h3 className="mt-2 font-semibold leading-snug">
                      {evento.titulo}
                    </h3>
                    {evento.resumen && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {evento.resumen}
                      </p>
                    )}
                    <p className="mt-3 text-sm">
                      {evento.precio > 0
                        ? formatearMonto(evento.precio)
                        : "Sin cargo"}
                      {lugares !== null && (
                        <span className="text-muted-foreground">
                          {" · "}
                          {lugares > 0
                            ? `${lugares} lugar${lugares === 1 ? "" : "es"}`
                            : "Sin cupo"}
                        </span>
                      )}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <section className="mt-14 rounded-xl border border-brand-orange/20 bg-brand-orange/5 p-8 text-center">
          <h2 className="text-2xl font-bold">¿Preferís hablar con alguien?</h2>
          <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
            Contanos qué obra tenés entre manos y te asignamos un asesor.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-green px-5 font-medium text-white transition-colors hover:bg-brand-green/90"
            >
              <MessageCircle className="h-4 w-4" />
              Escribir por WhatsApp
            </a>
            <a
              href="tel:02234743328"
              className="inline-flex h-11 items-center rounded-lg border bg-card px-5 font-medium transition-colors hover:bg-muted"
            >
              (0223) 474-3328
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function PanelDelProfesional({
  nombreLista,
  limiteCredito,
  documentos,
}: {
  nombreLista: string | null;
  limiteCredito: number;
  documentos: number;
}) {
  const accesos = [
    {
      href: "/catalogo",
      icono: Percent,
      titulo: "Tus precios en el catálogo",
      detalle: nombreLista
        ? `Estás viendo la lista ${nombreLista}.`
        : "Los precios que ves ya son los tuyos.",
    },
    {
      href: "/mi-cuenta/cuenta-corriente",
      icono: Wallet,
      titulo: "Cuenta corriente",
      detalle:
        limiteCredito > 0
          ? `Tu límite es de ${formatearMonto(limiteCredito)}.`
          : "Consultanos para habilitarla.",
    },
    {
      href: "/presupuesto",
      icono: Clock,
      titulo: "Presupuesto express",
      detalle: "Mandá la lista de la obra y contestamos en 24 horas hábiles.",
    },
    {
      href: "/documentacion",
      icono: FileText,
      titulo: "Documentación técnica",
      detalle: `${documentos} documento${documentos === 1 ? "" : "s"} disponible${documentos === 1 ? "" : "s"}.`,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {accesos.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="flex items-start gap-4 rounded-xl border bg-card p-5 transition-shadow hover:shadow-md"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-orange/10">
            <a.icono className="h-5 w-5 text-brand-orange" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{a.titulo}</span>
            <span className="block text-sm text-muted-foreground">
              {a.detalle}
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      ))}
    </div>
  );
}

function EstadoDeSolicitud({ fecha }: { fecha: Date }) {
  return (
    <div className="rounded-xl border bg-card p-6">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-orange/10">
        <Clock className="h-5 w-5 text-brand-orange" />
      </span>
      <h2 className="mt-4 text-xl font-semibold">Estamos revisando tu pedido</h2>
      <p className="mt-1 text-muted-foreground">
        La recibimos el {fechaLarga.format(fecha)}. Un asesor la está mirando y
        te contestamos dentro de las 24 horas hábiles.
      </p>
      <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
        Mientras tanto podés comprar normalmente: al habilitarte, los precios
        cambian solos.
      </p>
    </div>
  );
}

async function SolicitudRechazada({ motivo }: { motivo: string | null }) {
  const whatsapp = await enlaceWhatsapp();
  return (
    <div className="rounded-xl border bg-card p-6">
      <h2 className="text-xl font-semibold">Sobre tu solicitud</h2>
      <p className="mt-1 text-muted-foreground">
        Por ahora no pudimos habilitarte el acceso.
        {motivo ? ` ${motivo}` : ""}
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Si creés que hay un error, escribinos: la mayoría de los casos se
        resuelven hablando.
      </p>
      <a
        href={whatsapp}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-brand-green px-5 font-medium text-white transition-colors hover:bg-brand-green/90"
      >
        <MessageCircle className="h-4 w-4" />
        Hablar con un asesor
      </a>
    </div>
  );
}
