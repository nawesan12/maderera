import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { ArrowLeft } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { obtenerRecepcion } from "@/lib/dal/admin/recepciones";
import { cantidadConUnidad, fechaCorta, formatearMonto } from "@/lib/formato";
import { Tags } from "lucide-react";
import { escribirPedidoDeEtiquetas } from "@/lib/etiquetas-de-medidas";
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
  // El depósito no entra a las órdenes: el número va sin enlace (mes 23).
  const veOrdenes = puedeEntrar("/admin/compras/ordenes", usuario.staffRole);

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
            {/* La orden de la que salió, para reclamar desde ahí (M3S3-026). */}
            {recepcion.purchaseOrderId &&
              recepcion.ordenNumero &&
              (veOrdenes ? (
                <Link
                  href={`/admin/compras/ordenes/${recepcion.purchaseOrderId}`}
                  className="codigo mt-1 inline-block text-base font-medium hover:underline"
                >
                  {recepcion.ordenNumero}
                </Link>
              ) : (
                <p className="codigo mt-1 text-base font-medium">{recepcion.ordenNumero}</p>
              ))}
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
            // Lo que faltaba de la orden: «Vino [20] de 30» (M2S1-077).
            pendiente: i.pedido != null ? Number(i.pedido) - Number(i.yaRecibido ?? 0) : null,
            unidad: i.unidad ?? null,
          }))}
        />
      ) : (
        <section className="tarjeta @container overflow-hidden">
          <ul className="divide-y divide-linea">
            {recepcion.items.map((i) => {
              const descripcion = [i.producto, i.variante].filter(Boolean).join(" ");
              const vino = Number(i.cantidad);
              // Contra lo que faltaba cuando llegó, como en el borrador: «1 de
              // 2 · falta 1» y no «1 de 6», ni «12 de 72» en la que completa
              // la orden (M4-042, M4-082).
              const pendiente = i.pedido != null ? Number(i.pedido) - Number(i.yaRecibido ?? 0) : null;
              const faltan = pendiente !== null ? pendiente - vino : 0;
              // Los tres costos, solo los que dicen algo: con el mismo
              // $ 7.560 en los tres renglones no se leía nada (M3S3-026).
              // Tampoco si es lo mismo que «Quedó en»: sin costo de antes el
              // costo con flete es el que queda (mes 23).
              const conFlete =
                i.costoConGastos &&
                Number(i.costoConGastos) !== Number(i.costoUnitario) &&
                Number(i.costoConGastos) !== Number(i.costoResultante)
                  ? i.costoConGastos
                  : null;
              // Sin costo de antes no «venía a $ 0»: no tenía (mes 23).
              const venia =
                Number(i.costoAnterior) > 0 && Number(i.costoAnterior) !== Number(i.costoResultante) ? i.costoAnterior : null;
              return (
                <li key={i.id} className="space-y-1.5 px-4 py-3 @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_auto] @3xl:items-baseline @3xl:gap-6 @3xl:space-y-0">
                  <div className="min-w-0">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="text-base font-medium">{descripcion}</span>
                      {/* La cantidad con su unidad y a la derecha, como en el
                          remito y el stock: decía «20 ·» (M3S4-037). */}
                      {/* «faltan N» va con la cantidad, que ven todos: en el
                          renglón del precio se perdía para el depósito (mes 23). */}
                      <span className="tabular shrink-0 text-right text-base font-semibold">
                        {cantidadConUnidad(vino, i.unidad ?? null, descripcion)}
                        {pendiente !== null && pendiente !== vino && (
                          <span className="font-normal text-muted-foreground"> de {cantidad(pendiente)}</span>
                        )}
                        {recepcion.estado === "confirmada" && faltan > 0 && (
                          <span className="block text-saldo-debe">
                            {faltan === 1 ? "falta" : "faltan"} {cantidad(faltan)}
                          </span>
                        )}
                      </span>
                    </p>
                    {(i.sku || veCostos) && (
                      <p className="text-base text-muted-foreground">
                        {i.sku && <span className="codigo text-sm">{i.sku}</span>}
                        {veCostos && (
                          <span className="tabular">
                            {i.sku ? " · " : ""}
                            {formatearMonto(Number(i.costoUnitario))}
                            {/* Sin IVA (el que no lo discrimina), no se dice (M4-003). */}
                            {Number(i.alicuotaIva) > 0 && ` · IVA ${Number(i.alicuotaIva)}%`}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  {veCostos && recepcion.estado === "confirmada" && (
                    // En el teléfono, un dato por renglón con su rótulo al
                    // lado: en tres columnas de 104 px los importes quedaban a
                    // 3 px uno del otro (mes simulado, H063).
                    <dl className="tabular space-y-0.5 @md:grid @md:grid-cols-3 @md:gap-3 @md:space-y-0 @md:text-right @3xl:w-[26rem]">
                      {conFlete ? <Dato nombre="Con flete" valor={conFlete} /> : <span className="hidden @md:block" />}
                      {venia ? <Dato nombre="Venía a" valor={venia} apagado /> : <span className="hidden @md:block" />}
                      <Dato nombre="Quedó en" valor={i.costoResultante} fuerte />
                    </dl>
                  )}
                </li>
              );
            })}
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

      {/* Lo que bajó del camión, con sus cantidades, listo para etiquetar
          (M2S3-041): había que buscar cada código en Stock › Etiquetas. */}
      {recepcion.estado === "confirmada" && (
        <Link
          href={`/admin/stock/etiquetas?m=${escribirPedidoDeEtiquetas(
            recepcion.items.map((i) => ({ id: i.variantId, cantidad: Math.max(1, Math.round(Number(i.cantidad))) })),
          )}`}
          className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
        >
          <Tags className="h-4 w-4" aria-hidden="true" />
          Etiquetas
        </Link>
      )}

      {veCostos && recepcion.estado !== "anulada" && <AnularRecepcion id={recepcion.id} />}
    </div>
  );
}

function Dato({ nombre, valor, apagado, fuerte }: { nombre: string; valor: string | null; apagado?: boolean; fuerte?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 @md:block">
      <dt className="text-sm text-muted-foreground">{nombre}</dt>
      <dd className={`${fuerte ? "font-semibold" : ""} ${apagado ? "text-muted-foreground" : ""}`}>
        {valor ? formatearMonto(Number(valor)) : "—"}
      </dd>
    </div>
  );
}
