import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { ArrowLeft } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { obtenerRecepcion } from "@/lib/dal/admin/recepciones";
import { fechaCorta, formatearMonto } from "@/lib/formato";
import { AnularRecepcion, BorradorDeRecepcion } from "./acciones";

export const metadata: Metadata = { title: "Recepción" };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "estado-espera" },
  confirmada: { texto: "Confirmada", clase: "estado-ok" },
  anulada: { texto: "Anulada", clase: "estado-problema" },
};

const cantidad = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 4 });

/**
 * El detalle de una recepción.
 *
 * En borrador se corrige: lo que vino de cada renglón, su costo y el flete
 * (mes simulado, H059: no tenía ningún campo y la salida era anularla y
 * cargar otra suelta, que dejaba la mercadería contada dos veces).
 *
 * Confirmada, cada renglón muestra los cuatro números que explican la
 * mezcla: cuánto había y a cuánto, cuánto costó lo que entró con el flete
 * adentro, y con qué costo quedó. Es lo que permite auditarla dentro de ocho
 * meses, porque el promedio ponderado no se puede revertir. Cada número con
 * su nombre: en el teléfono quedaban tres montos sueltos.
 *
 * El depósito la recibe sin ver precios (H097).
 */
export default async function RecepcionPage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await requireStaff();
  if (!puedeEntrar("/admin/recepciones", usuario.staffRole)) notFound();
  const veCostos = puedeEntrar("/admin/recepciones/nueva", usuario.staffRole);

  const { id } = await params;
  if (!esUuid(id)) notFound();
  const recepcion = await obtenerRecepcion(id);
  if (!recepcion) notFound();

  const estado = ESTADOS[recepcion.estado] ?? ESTADOS.borrador;
  const neto = recepcion.items.reduce((t, i) => t + Number(i.cantidad) * Number(i.costoUnitario), 0);
  const gastos = Number(recepcion.gastos || 0);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/recepciones"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Recepciones
        </Link>

        <header className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold tracking-tight">{recepcion.proveedor}</h1>
            <p className="mt-1 text-base text-muted-foreground">
              {[
                recepcion.numeroRemito ? `Remito ${recepcion.numeroRemito}` : "Sin remito",
                recepcion.sucursal,
                fechaCorta.format(recepcion.fecha),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span
            className={`${estado.clase} inline-flex items-center rounded-lg bg-[var(--estado-fondo)] px-3 py-1.5 text-base font-semibold`}
          >
            {estado.texto}
          </span>
        </header>
      </div>

      {recepcion.estado === "borrador" ? (
        <BorradorDeRecepcion
          id={recepcion.id}
          veCostos={veCostos}
          gastos={gastos}
          items={recepcion.items.map((i) => ({
            id: i.id,
            descripcion: [i.producto, i.variante].filter(Boolean).join(" "),
            sku: i.sku,
            cantidad: Number(i.cantidad),
            costoUnitario: Number(i.costoUnitario || 0),
          }))}
        />
      ) : (
        <section className="tarjeta @container overflow-hidden">
          <ul className="divide-y divide-linea">
            {recepcion.items.map((i) => (
              <li key={i.id} className="space-y-1.5 px-4 py-3 @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_auto] @3xl:items-baseline @3xl:gap-6 @3xl:space-y-0">
                <div className="min-w-0">
                  <p className="text-base font-medium">
                    {i.producto} {i.variante}
                  </p>
                  <p className="tabular text-base text-muted-foreground">
                    {cantidad(Number(i.cantidad))}
                    {veCostos && ` × ${formatearMonto(Number(i.costoUnitario))} · IVA ${Number(i.alicuotaIva)}%`}
                    {i.sku && <span className="codigo"> · {i.sku}</span>}
                  </p>
                </div>
                {veCostos && recepcion.estado === "confirmada" && (
                  <dl className="tabular grid grid-cols-3 gap-3 text-right @3xl:w-[26rem]">
                    <Dato nombre="Con flete" valor={i.costoConGastos} />
                    <Dato nombre="Venía a" valor={i.costoAnterior} apagado />
                    <Dato nombre="Quedó en" valor={i.costoResultante} fuerte />
                  </dl>
                )}
              </li>
            ))}
          </ul>
          {veCostos && (
            <dl className="tabular space-y-1 border-t border-linea px-4 py-3 text-base">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Mercadería</dt>
                <dd>{formatearMonto(neto)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Flete y gastos</dt>
                <dd>{formatearMonto(gastos)}</dd>
              </div>
              <div className="flex justify-between gap-3 pt-1">
                <dt className="font-semibold">Neto total</dt>
                <dd className="text-lg font-bold">{formatearMonto(neto + gastos)}</dd>
              </div>
            </dl>
          )}
        </section>
      )}

      {recepcion.notas && <p className="text-base text-muted-foreground">{recepcion.notas}</p>}

      {veCostos && recepcion.estado !== "anulada" && <AnularRecepcion id={recepcion.id} />}
    </div>
  );
}

function Dato({ nombre, valor, apagado, fuerte }: { nombre: string; valor: string | null; apagado?: boolean; fuerte?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{nombre}</dt>
      <dd className={`${fuerte ? "font-semibold" : ""} ${apagado ? "text-muted-foreground" : ""}`}>
        {valor ? formatearMonto(Number(valor)) : "—"}
      </dd>
    </div>
  );
}
