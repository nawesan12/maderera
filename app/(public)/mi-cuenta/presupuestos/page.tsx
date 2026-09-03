import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ScrollText } from "lucide-react";
import {
  AcentoEstado,
  EtiquetaEstado,
} from "@/components/admin/etiqueta-estado";
import { misPresupuestos, type PresupuestoPropio } from "@/lib/dal/cuenta";
import { diasHasta, fechaCorta, formatearMonto, plural } from "@/lib/formato";
import { RespuestaPresupuesto } from "./respuesta";

export const metadata: Metadata = { title: "Presupuestos" };

export default async function MisPresupuestosPage() {
  const presupuestos = await misPresupuestos();

  const aResponder = presupuestos.filter((p) => p.estado === "enviado");
  const enCurso = presupuestos.filter(
    (p) => p.estado === "pendiente" || p.estado === "revision",
  );
  const cerrados = presupuestos.filter(
    (p) =>
      p.estado === "aceptado" ||
      p.estado === "rechazado" ||
      p.estado === "vencido",
  );

  if (presupuestos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/60 px-6 py-16 text-center">
        <ScrollText className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <h1 className="mt-4 text-xl font-semibold">
          Todavía no hay presupuestos
        </h1>
        <p className="mx-auto mt-1.5 max-w-sm text-muted-foreground">
          Armá uno desde el catálogo y te pasamos el precio cerrado.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link
            href="/catalogo"
            className="inline-flex h-11 items-center rounded-lg border bg-card px-5 font-medium transition-colors hover:bg-muted"
          >
            Ver el catálogo
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight">Mis presupuestos</h1>

      {aResponder.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-baseline gap-2.5 text-lg font-semibold">
            Esperan tu respuesta
            <span className="text-sm font-normal text-brand-orange-dark">
              {plural(aResponder.length, "presupuesto")}
            </span>
          </h2>
          <div className="space-y-3">
            {aResponder.map((p) => (
              <article
                key={p.id}
                className="rounded-xl border-2 border-brand-orange/35 bg-card p-5"
              >
                <Cabecera presupuesto={p} />
                <div className="mt-4">
                  <RespuestaPresupuesto numero={p.numero} />
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {enCurso.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-baseline gap-2.5 text-lg font-semibold">
            Los estamos preparando
            <span className="text-sm font-normal text-muted-foreground">
              {plural(enCurso.length, "presupuesto")}
            </span>
          </h2>
          <div className="space-y-3">
            {enCurso.map((p) => (
              <Fila key={p.id} presupuesto={p} />
            ))}
          </div>
        </section>
      )}

      {cerrados.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Anteriores</h2>
          <div className="space-y-3">
            {cerrados.map((p) => (
              <Fila key={p.id} presupuesto={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Cabecera({ presupuesto }: { presupuesto: PresupuestoPropio }) {
  const dias = diasHasta(presupuesto.validoHasta);

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <Link
          href={`/mi-cuenta/presupuestos/${presupuesto.numero}`}
          className="tabular inline-flex items-center gap-1.5 font-semibold hover:text-brand-orange"
        >
          {presupuesto.numero}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {plural(presupuesto.items, "producto")} ·{" "}
          {fechaCorta.format(presupuesto.createdAt)}
          {dias !== null && presupuesto.estado === "enviado" && (
            <>
              {" · "}
              <span className={dias <= 3 ? "text-brand-orange-dark" : undefined}>
                {dias > 0 ? `vale ${plural(dias, "día")} más` : "vencido"}
              </span>
            </>
          )}
        </p>
      </div>
      <span className="tabular text-xl font-semibold">
        {formatearMonto(presupuesto.total)}
      </span>
    </div>
  );
}

function Fila({ presupuesto }: { presupuesto: PresupuestoPropio }) {
  return (
    <Link
      href={`/mi-cuenta/presupuestos/${presupuesto.numero}`}
      className="relative block overflow-hidden rounded-xl border bg-card p-5 pl-6 transition-shadow hover:shadow-md"
    >
      <AcentoEstado estado={presupuesto.estado} />
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="tabular font-semibold">{presupuesto.numero}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {plural(presupuesto.items, "producto")} ·{" "}
            {fechaCorta.format(presupuesto.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular text-lg font-semibold">
            {formatearMonto(presupuesto.total)}
          </span>
          <EtiquetaEstado estado={presupuesto.estado} />
        </div>
      </div>
    </Link>
  );
}
