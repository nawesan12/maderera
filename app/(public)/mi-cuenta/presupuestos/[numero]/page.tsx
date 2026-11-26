import type { Metadata } from "next";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarClock, Check, Download, Store } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { ETAPAS_PRESUPUESTO, Pasos } from "@/components/admin/pasos";
import { clienteDeLaSesion, miPresupuesto } from "@/lib/dal/cuenta";
import { mensajeDeConsulta } from "@/lib/cuenta/portal";
import {
  diasHasta,
  fechaLarga,
  formatearMonto,
  cantidadConUnidad,
  plural,
} from "@/lib/formato";
import { RespuestaPresupuesto } from "../respuesta";
import { BotonWhatsapp } from "@/components/whatsapp/boton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ numero: string }>;
}): Promise<Metadata> {
  const { numero } = await params;
  return { title: `Presupuesto ${numero}` };
}

export default async function DetallePresupuestoPage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero } = await params;
  const [presupuesto, cliente] = await Promise.all([miPresupuesto(numero), clienteDeLaSesion()]);

  if (!presupuesto) notFound();

  // Un solo `?text=` (H081): enlaceWhatsapp ya lo arma.
  const whatsapp = await enlaceWhatsapp(
    mensajeDeConsulta(`Hola! Consulto por el presupuesto ${presupuesto.numero}.`, cliente ? { nombre: cliente.nombre } : null),
  );

  const dias = diasHasta(presupuesto.validoHasta);
  const vencido =
    presupuesto.estado === "vencido" || (dias !== null && dias < 0);
  const esperaRespuesta = presupuesto.estado === "enviado" && !vencido;

  return (
    <div className="space-y-6">
      <Link
        href="/mi-cuenta/presupuestos"
        className="-my-2 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Mis presupuestos
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="tabular text-2xl font-bold tracking-tight">
              {presupuesto.numero}
            </h1>
            <EtiquetaEstado estado={presupuesto.estado} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span>Del {fechaLarga.format(presupuesto.createdAt)}</span>
            {presupuesto.sucursal && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Store className="h-3.5 w-3.5" />
                  {presupuesto.sucursal}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="tabular text-3xl font-bold">
            {formatearMonto(presupuesto.total)}
          </span>
          {/* El papel para guardar o reenviar: mismo PDF que imprime la casa. */}
          <a
            href={`/api/presupuestos/${presupuesto.id}/pdf`}
            className="inline-flex h-11 items-center gap-2 rounded-lg superficie px-4 text-sm font-medium transition-colors hover:bg-chip"
          >
            <Download className="h-4 w-4" />
            PDF
          </a>
        </div>
      </header>

      {/* La respuesta va pegada al total: era lo principal de la pantalla y
          quedaba 1.900 px más abajo en el teléfono (H308). */}
      {esperaRespuesta && (
        <section className="tarjeta-atencion rounded-xl bg-card p-5">
          <RespuestaPresupuesto numero={presupuesto.numero} />
        </section>
      )}

      {/* Aceptado: queda a la vista qué sigue, y el pedido si ya se hizo
          (H215). Antes el aviso se borraba al volver a dibujar la página. */}
      {presupuesto.estado === "aceptado" && (
        <section className="estado-ok flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--estado-fondo)] p-4">
          <p className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
            {presupuesto.pedido
              ? `Lo pasamos a pedido: ${presupuesto.pedido}.`
              : `Le avisamos a ${presupuesto.asesor ?? "tu vendedor"}: te escribimos para coordinar el retiro y el pago.`}
          </p>
          {presupuesto.pedido && (
            <Link
              href={`/mi-cuenta/pedidos/${presupuesto.pedido}`}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-card px-4 text-sm font-medium text-foreground"
            >
              Ver el pedido
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </section>
      )}

      {presupuesto.estado !== "rechazado" && (
        <section className="rounded-xl border bg-card p-5">
          <Pasos
            etapas={ETAPAS_PRESUPUESTO}
            actual={presupuesto.estado}
            cancelado={false}
          />
        </section>
      )}

      {/* Hasta cuándo vale: un presupuesto es una oferta con fecha, y esa fecha
          es la información que decide si conviene aceptarlo ahora. */}
      {presupuesto.validoHasta && (
        <p
          className={`flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
            vencido
              ? "border-border bg-muted text-muted-foreground"
              : dias !== null && dias <= 3
                ? "border-brand-orange/35 bg-brand-orange/[0.07]"
                : "bg-card"
          }`}
        >
          <CalendarClock className="h-4 w-4 shrink-0" />
          {vencido ? (
            <>
              Venció el {fechaLarga.format(presupuesto.validoHasta)}. Escribinos
              y lo actualizamos con los precios de hoy.
            </>
          ) : (
            <>
              Los precios valen hasta el{" "}
              <span className="font-medium">
                {fechaLarga.format(presupuesto.validoHasta)}
              </span>
              {dias !== null && dias <= 7 && (
                <span className="text-brand-orange-dark">
                  · {dias === 0 ? "vence hoy" : `quedan ${plural(dias, "día")}`}
                </span>
              )}
            </>
          )}
        </p>
      )}

      <section className="overflow-hidden rounded-xl border bg-card">
        <h2 className="border-b px-5 py-3.5 font-medium">
          Detalle
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {plural(presupuesto.items.length, "producto")}
          </span>
        </h2>

        <ul className="divide-y">
          {presupuesto.items.map((item) => (
            <li key={item.id} className="px-5 py-3.5">
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <p>{item.descripcion}</p>
                  <p className="tabular mt-0.5 text-sm text-muted-foreground">
                    {cantidadConUnidad(Number(item.cantidad), item.unidad)} ×{" "}
                    {formatearMonto(item.precioUnitario)}
                  </p>
                </div>
                <span className="tabular shrink-0 font-medium">
                  {formatearMonto(item.subtotal)}
                </span>
              </div>
              {item.notas && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.notas}
                </p>
              )}
            </li>
          ))}
        </ul>

        <div className="flex items-baseline justify-between border-t bg-sitio-alt px-5 py-4">
          <span className="font-semibold">Total</span>
          <span className="tabular text-2xl font-bold">
            {formatearMonto(presupuesto.total)}
          </span>
        </div>
      </section>

      {presupuesto.notas && (
        <section className="rounded-xl border border-dashed p-5">
          <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Observaciones
          </h2>
          <p className="text-sm">{presupuesto.notas}</p>
        </section>
      )}

      <BotonWhatsapp enlace={whatsapp} variante={esperaRespuesta ? "secundario" : "lleno"}>
        Consultar por este presupuesto
      </BotonWhatsapp>

      {presupuesto.asesor && (
        <p className="text-sm text-muted-foreground">
          Te atiende {presupuesto.asesor}.
        </p>
      )}
    </div>
  );
}
