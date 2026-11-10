import type { Metadata } from "next";
import { metadatosDePagina } from "@/lib/seo";
import { tienda } from "@/lib/dal/contenido";
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
  Download,
  Package,
  Percent,
  Scissors,
  ScrollText,
  Wallet,
} from "lucide-react";
import { getSession } from "@/lib/dal/session";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { clienteDeLaSesion } from "@/lib/dal/cuenta";
import {
  documentosReservados,
  documentosVisibles,
  estadoProfesional,
  eventosProximos,
} from "@/lib/dal/profesionales";
import { fechaLarga, formatearMonto, telefonoParaMarcar } from "@/lib/formato";
import { FormularioProfesional } from "./formulario";

export const metadata: Metadata = {
  ...metadatosDePagina({
    titulo: "Portal de profesionales: precios de gremio y cuenta corriente",
    descripcion:
      "Lista de precios propia, cuenta corriente, presupuestos express en 24 horas y documentación técnica para arquitectos, constructoras y carpinteros de Mar del Plata.",
    ruta: "/profesionales",
  }),
};

const BENEFICIOS = [
  { icono: Percent, titulo: "Lista propia", detalle: "Precios de gremio en todo el catálogo." },
  { icono: Wallet, titulo: "Cuenta corriente", detalle: "Comprás ahora y pagás después." },
  { icono: Clock, titulo: "Presupuesto en 24 h", detalle: "Mandás la lista de la obra y te contestamos." },
  { icono: FileText, titulo: "Documentación técnica", detalle: "Fichas y tablas de carga para el pliego." },
];

const PASOS = [
  { titulo: "Pedís la cuenta", detalle: "Tres pasos, dos minutos." },
  { titulo: "La revisamos", detalle: "Te contestamos en 24 horas hábiles." },
  { titulo: "Entrás", detalle: "Te llega un link para activar la cuenta." },
];

const PREGUNTAS = [
  {
    pregunta: "¿Quién puede pedirla?",
    respuesta: "Arquitectos, constructoras, carpinteros, diseñadores, instaladores y quien compre seguido para obra o taller.",
  },
  { pregunta: "¿Necesito CUIT?", respuesta: "No. Con DNI entrás igual; con CUIT además te facturamos A." },
  {
    pregunta: "¿Cómo pago con cuenta corriente?",
    respuesta: "El límite se acuerda al aprobar la cuenta. Ves el saldo y cada movimiento desde tu cuenta.",
  },
  { pregunta: "¿Tiene costo?", respuesta: "No. La cuenta profesional es sin cargo." },
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
  /* El teléfono estaba escrito a mano —"(0223) 474-3328"— y no era el de
     ninguna de las dos sucursales. Sale de `branches` como el resto del sitio. */
  const [casaCentral] = await listarSucursalesPublicas();
  const [estado, sesion, cliente, eventos, documentos, reservados, laTienda] =
    await Promise.all([
      estadoProfesional(),
      getSession(),
      clienteDeLaSesion(),
      eventosProximos(),
      documentosVisibles(),
      documentosReservados(),
      tienda(),
    ]);

  return (
    <div className="min-h-screen">
      <EncabezadoPublico
        ruta="/profesionales"
        titulo="Cuenta profesional"
        bajada={
          estado.aprobado
            ? `Hola ${(estado.nombre ?? "").split(" ")[0]}, tu cuenta está activa.`
            : "Precios de gremio, cuenta corriente y documentación técnica."
        }
      />

      <div className="contenedor py-12">
        {estado.aprobado ? (
          <PanelDelProfesional
            nombreLista={estado.nombreLista}
            limiteCredito={estado.limiteCredito}
            documentos={documentos.length}
            tiendaActiva={laTienda.activa}
          />
        ) : (
          <div className="grid items-start gap-12 lg:grid-cols-[1fr_27rem]">
            <div className="space-y-14">
              <div className="grid gap-4 sm:grid-cols-2">
                {BENEFICIOS.map((b) => (
                  <article key={b.titulo} className="rounded-2xl superficie p-6">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-naranja-claro text-acento-texto">
                      <b.icono className="h-6 w-6" />
                    </span>
                    <h2 className="mt-4 text-[22px] font-bold tracking-[-0.02em]">{b.titulo}</h2>
                    <p className="mt-1 text-base text-texto-2">{b.detalle}</p>
                  </article>
                ))}
              </div>

              <section>
                <h2 className="text-[28px] font-bold tracking-[-0.03em]">Cómo funciona</h2>
                <ol className="mt-6 grid gap-6 sm:grid-cols-3">
                  {PASOS.map((p, i) => (
                    <li key={p.titulo}>
                      <span className="tabular flex h-10 w-10 items-center justify-center rounded-full bg-oscuro-marca text-base font-bold text-white">
                        {i + 1}
                      </span>
                      <h3 className="mt-3 text-lg font-bold">{p.titulo}</h3>
                      <p className="mt-0.5 text-base text-texto-2">{p.detalle}</p>
                    </li>
                  ))}
                </ol>
              </section>

              {reservados > 0 && (
                <p className="flex items-center gap-2 text-base text-texto-2">
                  <Lock className="h-4 w-4 shrink-0" />
                  {reservados === 1
                    ? "1 documento técnico reservado para profesionales"
                    : `${reservados} documentos técnicos reservados para profesionales`}
                </p>
              )}

              <section>
                <h2 className="text-[28px] font-bold tracking-[-0.03em]">Preguntas frecuentes</h2>
                <div className="mt-5 divide-y divide-linea rounded-2xl superficie">
                  {PREGUNTAS.map((p) => (
                    <details key={p.pregunta} className="group px-5 py-4">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold">
                        {p.pregunta}
                        <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
                      </summary>
                      <p className="mt-2 text-base text-texto-2">{p.respuesta}</p>
                    </details>
                  ))}
                </div>
              </section>
            </div>

            <aside id="pedir" className="lg:sticky lg:top-[96px]">
              {estado.solicitud?.estado === "pendiente" ? (
                <EstadoDeSolicitud fecha={estado.solicitud.createdAt} />
              ) : estado.solicitud?.estado === "rechazada" ? (
                <SolicitudRechazada motivo={estado.solicitud.motivoRechazo} />
              ) : (
                <div className="rounded-2xl superficie p-7 shadow-[0_18px_40px_-28px_rgb(60_50_40_/_0.45)]">
                  <h2 className="text-2xl font-bold tracking-[-0.025em]">Pedí tu cuenta</h2>
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
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-verde-whatsapp px-5 font-medium text-white transition-colors hover:bg-brand-green/90"
            >
              <MessageCircle className="h-4 w-4" />
              Escribir por WhatsApp
            </a>
            {casaCentral?.telefono && (
              <a
                href={`tel:${telefonoParaMarcar(casaCentral.telefono)}`}
                className="inline-flex h-11 items-center rounded-lg border bg-card px-5 font-medium transition-colors hover:bg-muted"
              >
                {casaCentral.telefono}
              </a>
            )}
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
  tiendaActiva,
}: {
  nombreLista: string | null;
  limiteCredito: number;
  documentos: number;
  /** Apagada, la lista propia, el presupuesto y el PDF de precios esperan. */
  tiendaActiva: boolean;
}) {
  const todos = [
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
      href: "/carrito",
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
    { href: "/corte", icono: Scissors, titulo: "Corte a medida", detalle: "Armá el despiece y mandalo al aserradero." },
    { href: "/mi-cuenta/pedidos", icono: Package, titulo: "Tus pedidos", detalle: "En qué está cada uno." },
    { href: "/mi-cuenta/presupuestos", icono: ScrollText, titulo: "Tus presupuestos", detalle: "Los que pediste y los que te pasamos." },
    { href: "/eventos", icono: CalendarDays, titulo: "Capacitaciones", detalle: "Las próximas fechas." },
    {
      // Sale del servidor con la lista de quien pide: nunca hay forma de
      // bajarse una lista que no es la propia.
      href: "/mi-lista-de-precios",
      icono: Download,
      titulo: "Tu lista de precios en PDF",
      detalle: "Con tus precios y la fecha de vigencia, para cotizar la obra.",
    },
  ];

  const conPrecios = new Set(["/catalogo", "/carrito", "/mi-lista-de-precios"]);
  const accesos = tiendaActiva ? todos : todos.filter((a) => !conPrecios.has(a.href));

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {accesos.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="group flex flex-col rounded-2xl superficie p-6 transition-colors hover:border-accion/50"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-naranja-claro text-acento-texto">
            <a.icono className="h-6 w-6" />
          </span>
          <span className="mt-4 flex items-center gap-2 text-[20px] font-bold tracking-[-0.02em]">
            {a.titulo}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </span>
          <span className="mt-1 text-base text-texto-2">{a.detalle}</span>
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
        className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-verde-whatsapp px-5 font-medium text-white transition-colors hover:bg-brand-green/90"
      >
        <MessageCircle className="h-4 w-4" />
        Hablar con un asesor
      </a>
    </div>
  );
}
