import Link from "next/link";
import { ClipboardList, Plus, Timer } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { Button } from "@/components/ui/button";
import {
  AcentoEstado,
  EtiquetaEstado,
  estiloDeEstado,
} from "@/components/admin/etiqueta-estado";
import { FiltroEstado } from "@/components/admin/filtro-estado";
import { GrupoListado } from "@/components/admin/grupo";
import {
  fechaCorta,
  haceCuanto,
  moneda,
  plural,
} from "@/components/admin/formato";
import {
  listarPresupuestos,
  type PresupuestoListado,
} from "@/lib/dal/admin/ventas";
import { AccionesPresupuesto } from "./acciones";

const ESTADOS = {
  todos: "Todos",
  pendiente: "Pendientes",
  revision: "En revisión",
  enviado: "Enviados",
  aceptado: "Aceptados",
  rechazado: "Rechazados",
};

const ORIGEN: Record<string, string> = {
  sitio: "Pedido desde el sitio",
  calculadora: "Armado con la calculadora",
  mostrador: "Mostrador",
  telefono: "Por teléfono",
  express: "Express de un profesional",
};

export default async function PresupuestosPage({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string; estado?: string }>;
}) {
  const params = await searchParams;
  const presupuestos = await listarPresupuestos({
    busqueda: params.buscar,
    estado: params.estado,
  });

  // Lo que espera una respuesta va arriba y separado: es lo que hay que atender.
  const abiertos = presupuestos.filter((p) => estiloDeEstado(p.estado).abierto);
  const cerrados = presupuestos.filter((p) => !estiloDeEstado(p.estado).abierto);
  const montoAbierto = abiertos.reduce((s, p) => s + p.total, 0);

  return (
    <div>
      <EncabezadoPanel
        titulo="Presupuestos"
        detalle={
          abiertos.length > 0
            ? `${plural(abiertos.length, "presupuesto")} esperando respuesta por ${moneda.format(montoAbierto)}`
            : `${plural(presupuestos.length, "presupuesto")} en total`
        }
      >
        {/* Lo que entra por teléfono se carga acá: hasta ahora un presupuesto
            solo podía nacer del sitio. */}
        <Button render={<Link href="/admin/presupuestos/nuevo" />}>
          <Plus className="h-4 w-4" />
          Nuevo presupuesto
        </Button>
      </EncabezadoPanel>

      <FiltroEstado
        ruta="/admin/presupuestos"
        estados={ESTADOS}
        estadoActual={params.estado ?? "todos"}
        busquedaActual={params.buscar ?? ""}
        placeholder="Buscar por número, cliente o empresa…"
      />

      {presupuestos.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed py-16 text-center">
          <ClipboardList className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">No hay presupuestos que mostrar</p>
          <p className="mt-1 text-base text-muted-foreground">
            Probá con otro filtro o buscá por número.
          </p>
        </div>
      ) : (
        <>
          <GrupoListado
            titulo="Esperando respuesta"
            cantidad={abiertos.length}
            detalle={
              abiertos.length > 0 ? moneda.format(montoAbierto) : undefined
            }
            destacado
          >
            {abiertos.map((p) => (
              <Tarjeta key={p.id} presupuesto={p} />
            ))}
          </GrupoListado>

          <GrupoListado titulo="Cerrados" cantidad={cerrados.length}>
            {cerrados.map((p) => (
              <Tarjeta key={p.id} presupuesto={p} apagado />
            ))}
          </GrupoListado>
        </>
      )}
    </div>
  );
}

function Tarjeta({
  presupuesto: p,
  apagado = false,
}: {
  presupuesto: PresupuestoListado;
  apagado?: boolean;
}) {
  return (
    <article
      className={`tarjeta tarjeta-activa relative overflow-hidden ${
        apagado ? "opacity-75" : ""
      }`}
    >
      <AcentoEstado estado={p.estado} />

      <div className="flex flex-wrap items-start justify-between gap-4 py-5 pl-6 pr-5">
        <div className="min-w-0">
          {/* El cliente es lo que se busca al escanear, no el número. */}
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-lg font-medium">{p.cliente}</h3>
            <EtiquetaEstado estado={p.estado} />
            {p.vencido && (
              <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
                Vencido
              </span>
            )}

            {/* El compromiso de 24 horas hábiles del portal profesional. Va al
                lado del nombre y no en la letra chica: un SLA que hay que
                buscar es un SLA que no se cumple. */}
            {p.plazo && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${
                  p.plazo.vencido
                    ? "estado-problema bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                    : p.plazo.urgente
                      ? "bg-brand-orange/15 text-brand-orange-dark"
                      : "estado-info bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                }`}
              >
                <Timer className="h-4 w-4" />
                {p.plazo.texto}
              </span>
            )}
          </div>

          {p.empresa && (
            <p className="text-base text-muted-foreground">{p.empresa}</p>
          )}

          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-base text-muted-foreground">
            <Link
              href={`/admin/presupuestos/${p.id}`}
              className="tabular font-medium text-foreground hover:text-brand-orange"
            >
              {p.numero}
            </Link>
            <span aria-hidden="true">·</span>
            <span>{plural(p.items, "ítem")}</span>
            <span aria-hidden="true">·</span>
            <span>{ORIGEN[p.origen] ?? p.origen}</span>
            <span aria-hidden="true">·</span>
            <span>{haceCuanto(p.createdAt)}</span>
            {p.validoHasta && !p.vencido && (
              <>
                <span aria-hidden="true">·</span>
                <span>vale hasta {fechaCorta.format(p.validoHasta)}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <p className="tabular text-xl font-semibold">
            {moneda.format(p.total)}
          </p>
          <AccionesPresupuesto id={p.id} estado={p.estado} />
        </div>
      </div>
    </article>
  );
}
