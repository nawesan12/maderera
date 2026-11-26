import type { Metadata } from "next";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  Download,
  FileText,
  MapPin,
  Printer,
  Scissors,
  Store,
  Truck,
} from "lucide-react";
import {
  EtiquetaEstado,
  claseDeFamilia,
} from "@/components/admin/etiqueta-estado";
import { ETAPAS_PEDIDO, ETAPAS_RETIRO, Pasos } from "@/components/admin/pasos";
import { clienteDeLaSesion, miPedido } from "@/lib/dal/cuenta";
import { datosParaTransferir } from "@/lib/dal/pagos";
import { sucursalPublicada } from "@/lib/sucursales";
import {
  fechaCorta,
  fechaHora,
  fechaLarga,
  formatearMonto,
  cantidadConUnidad,
  plural,
} from "@/lib/formato";
import {
  nombreComprobante,
  numeroFormateado,
  type TipoComprobante,
} from "@/lib/fiscal/comprobantes";
import { estadoDelPago, mensajeDeConsulta } from "@/lib/cuenta/portal";
import { VolverAPedir } from "./volver-a-pedir";
import { tienda } from "@/lib/dal/contenido";
import { BotonWhatsapp } from "@/components/whatsapp/boton";
import { InformarTransferencia } from "@/components/cuenta/informar-transferencia";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ numero: string }>;
}): Promise<Metadata> {
  const { numero } = await params;
  return { title: `Pedido ${numero}` };
}

/** Los botones chicos de la página: 44 px para el dedo (H312). */
const BOTON =
  "inline-flex h-11 items-center gap-2 rounded-lg superficie px-3.5 text-sm font-medium transition-colors hover:bg-chip";

const ESTADO_DEL_CORTE: Record<string, string> = {
  "en-cola": "En cola",
  "en-proceso": "En la máquina",
  terminado: "Listo para retirar",
  retirado: "Retirado",
};

export default async function DetallePedidoPage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero } = await params;
  const [pedido, laTienda, cliente] = await Promise.all([
    miPedido(numero),
    tienda(),
    clienteDeLaSesion(),
  ]);

  // El DAL ya filtró por dueño: si no vuelve nada, o no existe o no es suyo, y
  // las dos cosas se contestan igual. Decir "existe pero no es tuyo" confirma
  // que ese número de pedido existe.
  if (!pedido) notFound();

  const ficha = pedido.sucursalSlug
    ? sucursalPublicada(pedido.sucursalSlug)
    : undefined;
  const etapas =
    pedido.tipoEntrega === "retiro" ? ETAPAS_RETIRO : ETAPAS_PEDIDO;
  const cancelado = pedido.estado === "cancelado";
  const quien = cliente ? { nombre: cliente.nombre, cuit: null } : null;

  // Un solo `?text=`: enlaceWhatsapp ya lo arma (antes la página le sumaba
  // otro y el mensaje llegaba con basura, H081).
  const [consulta, banco] = await Promise.all([
    enlaceWhatsapp(
      mensajeDeConsulta(
        `Hola! Consulto por mi pedido ${pedido.numero}.`,
        quien,
      ),
    ),
    pedido.medioPago === "transferencia"
      ? datosParaTransferir()
      : Promise.resolve(null),
  ]);

  const pago = estadoDelPago({
    estado: pedido.estado,
    estadoPago: pedido.estadoPago,
    medioPago: pedido.medioPago,
    total: Number(pedido.total),
    debeEnCuenta: pedido.debeEnCuenta,
    enRevision: pedido.enRevision,
  });
  const informar =
    !cancelado &&
    pedido.medioPago === "transferencia" &&
    pago.clave === "pendiente";

  // Lo entregado por renglón, para decir «110 de 120» cuando un remito llevó
  // menos de lo pedido (H302).
  const entregadoPor = new Map(pedido.acopio.map((a) => [a.orderItemId, a]));
  const sumaRenglones = pedido.items.reduce(
    (s, i) => s + Number(i.subtotal),
    0,
  );

  const reclamos = await Promise.all(
    pedido.entregas.map((e) =>
      enlaceWhatsapp(
        mensajeDeConsulta(
          `Hola! Quiero hacer un reclamo por el remito ${e.numero} del pedido ${pedido.numero}.`,
          quien,
        ),
      ),
    ),
  );

  // Con la tienda apagada no hay carrito: «Volver a pedir» manda lo mismo
  // por WhatsApp (H307).
  const repetir = laTienda.activa
    ? null
    : await enlaceWhatsapp(
        mensajeDeConsulta(
          `Hola! Quiero volver a pedir lo del pedido ${pedido.numero}: ${pedido.items
            .slice(0, 12)
            .map(
              (i) =>
                `${cantidadConUnidad(Number(i.cantidad), i.unidad, i.descripcion)} ${i.descripcion}`,
            )
            .join("; ")}.`,
          quien,
        ),
      );

  return (
    <div className="space-y-5">
      <Link
        href="/mi-cuenta/pedidos"
        className="-my-2 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Mis pedidos
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="tabular text-2xl font-bold tracking-tight">
              {pedido.numero}
            </h1>
            <EtiquetaEstado estado={pedido.estado} contexto="pedido" />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Hecho el {fechaLarga.format(pedido.createdAt)}
          </p>
        </div>
        <span className="tabular text-3xl font-bold">
          {formatearMonto(pedido.total)}
        </span>
      </header>

      {/* En un acopio, lo que le queda a la obra es lo primero que viene a
          mirar: arriba, con la cantidad grande (H389). */}
      {pedido.enAcopio.length > 0 && (
        <section className="tarjeta-atencion rounded-xl bg-card p-5">
          <h2 className="font-semibold">Te queda en acopio</h2>
          <ul className="mt-3 space-y-3.5">
            {pedido.enAcopio.map((r) => {
              const retirado = Math.max(r.pedido - r.pendiente, 0);
              return (
                <li key={r.orderItemId}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">{r.descripcion}</span>
                    <span className="tabular shrink-0 text-right">
                      <strong className="text-xl">
                        {cantidadConUnidad(r.pendiente, null)}
                      </strong>
                      <span className="text-sm text-muted-foreground">
                        {" "}
                        de {cantidadConUnidad(r.pedido, r.unidad, r.descripcion)}
                      </span>
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hundida"
                    role="img"
                    aria-label={`Retiraste ${retirado} de ${r.pedido}`}
                  >
                    <div
                      className="h-full rounded-full bg-brand-orange/50"
                      style={{
                        width: `${r.pedido > 0 ? Math.min((retirado / r.pedido) * 100, 100) : 0}%`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!cancelado && (
        <section className="rounded-xl bg-card p-5 tarjeta">
          <Pasos etapas={etapas} actual={pedido.estado} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {/* Cortes del taller atados al pedido (H210). */}
          {pedido.cortes.length > 0 && (
            <section className="tarjeta overflow-hidden rounded-xl bg-card">
              <h2 className="flex items-center gap-2 px-5 pt-4 pb-2 font-medium">
                <Scissors className="h-4 w-4 text-muted-foreground" />
                {plural(pedido.cortes.length, "corte")}
              </h2>
              <ul className="divide-y divide-linea">
                {pedido.cortes.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3"
                  >
                    <span className="min-w-0">
                      <span className="tabular font-medium">{c.numero}</span>
                      <span className="block text-sm text-muted-foreground">
                        {[c.material, plural(c.placas, "placa")]
                          .filter(Boolean)
                          .join(" · ")}
                        {c.retiraEl &&
                          c.estado !== "retirado" &&
                          ` · retirás el ${fechaCorta.format(new Date(c.retiraEl))}`}
                      </span>
                    </span>
                    <span
                      className={`${claseDeFamilia(c.estado)} rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium text-[var(--estado-tinta)]`}
                    >
                      {ESTADO_DEL_CORTE[c.estado] ?? c.estado}
                    </span>
                    {/* El despiece, plegado: se abre para controlar al retirar. */}
                    {c.piezas.length > 0 && (
                      <details className="w-full">
                        <summary className="-my-2 inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-acento-texto">
                          {plural(
                            c.piezas.reduce((t, p) => t + p.cantidad, 0),
                            "pieza",
                          )}
                        </summary>
                        <ul className="tabular mt-1 space-y-0.5 text-sm text-muted-foreground">
                          {c.piezas.map((p, i) => (
                            <li key={i}>
                              {p.cantidad} × {p.largoMm} × {p.anchoMm} mm
                              {p.etiqueta ? ` · ${p.etiqueta}` : ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Retiros: cada remito con su papel y su reclamo; el anulado,
              apagado (H306, H312, H389). */}
          {pedido.entregas.length > 0 && (
            <section className="tarjeta overflow-hidden rounded-xl bg-card">
              <h2 className="px-5 pt-4 pb-2 font-medium">
                {plural(
                  pedido.entregas.filter((e) => e.estado !== "anulada").length,
                  "retiro",
                )}
              </h2>
              <ul className="divide-y divide-linea">
                {pedido.entregas.map((entrega, i) => {
                  const anulado = entrega.estado === "anulada";
                  return (
                    <li
                      key={entrega.id}
                      className={`px-5 py-3 ${anulado ? "opacity-60" : ""}`}
                    >
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span
                          className={`tabular font-medium ${anulado ? "line-through" : ""}`}
                        >
                          {entrega.numero}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {fechaCorta.format(entrega.createdAt)}
                          {entrega.receptorNombre
                            ? ` · retiró ${entrega.receptorNombre}`
                            : ""}
                          {anulado ? " · anulado" : ""}
                        </span>
                      </p>
                      {!anulado && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Link
                            href={`/remito/${entrega.id}`}
                            target="_blank"
                            className={BOTON}
                          >
                            <Printer className="h-4 w-4" />
                            Ver
                          </Link>
                          <a
                            href={`/api/remitos/${entrega.id}/pdf`}
                            className={BOTON}
                          >
                            <Download className="h-4 w-4" />
                            PDF
                          </a>
                          <BotonWhatsapp
                            enlace={reclamos[i]!}
                            variante="secundario"
                            className="h-11 px-3.5 text-sm"
                          >
                            Reclamar
                          </BotonWhatsapp>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Lo comprado: los renglones suman el subtotal; el descuento ya
              viene repartido en los precios y se dice aparte (H209). */}
          <section className="tarjeta overflow-hidden rounded-xl bg-card">
            <h2 className="px-5 pt-4 pb-2 font-medium">
              Qué pediste
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {plural(pedido.items.length, "producto")}
              </span>
            </h2>

            <ul className="divide-y divide-linea">
              {pedido.items.map((item) => {
                const r = entregadoPor.get(item.id);
                const corto =
                  pedido.estado === "entregado" &&
                  r &&
                  r.entregado < r.pedido - 0.001;
                return (
                  <li
                    key={item.id}
                    className="flex items-baseline justify-between gap-4 px-5 py-3.5"
                  >
                    <div className="min-w-0">
                      <p>{item.descripcion}</p>
                      <p className="tabular mt-0.5 text-sm text-muted-foreground">
                        {cantidadConUnidad(Number(item.cantidad), item.unidad, item.descripcion)} ×{" "}
                        {formatearMonto(item.precioUnitario)}
                      </p>
                      {corto && (
                        <p className="tabular mt-0.5 text-sm text-brand-orange-dark">
                          Entregado: {cantidadConUnidad(r.entregado, null)} de{" "}
                          {cantidadConUnidad(r.pedido, r.unidad, r.descripcion)}
                        </p>
                      )}
                    </div>
                    <span className="tabular shrink-0 font-medium">
                      {formatearMonto(item.subtotal)}
                    </span>
                  </li>
                );
              })}
            </ul>

            <dl className="space-y-2 bg-hundida px-5 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular">{formatearMonto(sumaRenglones)}</dd>
              </div>
              {Number(pedido.costoEnvio) > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">
                    Envío{pedido.zonaEnvio ? ` · ${pedido.zonaEnvio}` : ""}
                  </dt>
                  <dd className="tabular">
                    {formatearMonto(pedido.costoEnvio)}
                  </dd>
                </div>
              )}
              <div className="flex items-baseline justify-between pt-1.5">
                <dt className="font-semibold">Total</dt>
                <dd className="tabular text-xl font-bold">
                  {formatearMonto(pedido.total)}
                </dd>
              </div>
              {pedido.descuento > 0.005 && (
                <div className="flex justify-between text-saldo-favor">
                  <dt>Ahorraste</dt>
                  <dd className="tabular">
                    {formatearMonto(pedido.descuento)}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        </div>

        <div className="min-w-0 space-y-4 lg:row-start-1 lg:col-start-2">
          {/* Pago: la etiqueta no se contradice con lo que dice abajo
              (H088, H208, H214, H310, H393), y por transferencia se informa
              desde acá (H387). */}
          <section className="tarjeta rounded-xl bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Pago
              </h2>
              <span
                className={`${claseDeFamilia(pago.clave)} rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium text-[var(--estado-tinta)]`}
              >
                {pago.etiqueta}
              </span>
            </div>
            {pago.falta !== null && (
              <p className="mt-2 flex items-baseline justify-between gap-3">
                <span className="text-sm text-muted-foreground">Falta</span>
                <span className="tabular text-lg font-semibold text-saldo-debe">
                  {formatearMonto(pago.falta)}
                </span>
              </p>
            )}
            {pago.sigue && (
              <p className="mt-2 text-sm text-muted-foreground">{pago.sigue}</p>
            )}
            {pago.clave === "cuenta" || pago.clave === "parcial" ? (
              <Link
                href="/mi-cuenta/cuenta-corriente"
                className={`${BOTON} mt-3`}
              >
                Pagar tu cuenta
              </Link>
            ) : null}
            {informar && (
              <InformarTransferencia numero={pedido.numero} banco={banco} />
            )}
          </section>

          {/* Facturas y recibos del pedido, para bajarlos sin pedirlos (H305). */}
          {(pedido.facturas.length > 0 ||
            pedido.recibos.length > 0 ||
            pedido.ajustes.length > 0) && (
            <section className="tarjeta rounded-xl bg-card p-5">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Comprobantes
              </h2>
              <ul className="divide-y divide-linea">
                {pedido.facturas.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">
                        {nombreComprobante(f.tipo as TipoComprobante)}
                      </span>
                      <span className="tabular block text-muted-foreground">
                        {numeroFormateado(f.puntoVenta, f.numero)}
                      </span>
                    </span>
                    {f.estado === "anulada" ? (
                      <EtiquetaEstado estado="anulada" />
                    ) : (
                      <a
                        href={`/api/comprobantes/${f.id}/pdf`}
                        className={BOTON}
                      >
                        <Download className="h-4 w-4" />
                        PDF
                      </a>
                    )}
                  </li>
                ))}
                {pedido.recibos.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">Recibo</span>
                      <span className="tabular block text-muted-foreground">
                        {r.numero}
                      </span>
                    </span>
                    {r.estado === "anulado" ? (
                      <EtiquetaEstado estado="anulado" />
                    ) : (
                      <a
                        href={`/api/recibos/${r.id}/pdf`}
                        target="_blank"
                        rel="noopener"
                        className={BOTON}
                      >
                        <FileText className="h-4 w-4" />
                        PDF
                      </a>
                    )}
                  </li>
                ))}
                {pedido.ajustes.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-baseline justify-between gap-3 py-2.5"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">
                        {a.tipo === "nota_credito"
                          ? "Nota de crédito"
                          : a.tipo === "nota_debito"
                            ? "Nota de débito"
                            : "Ajuste"}
                      </span>
                      {a.detalle && (
                        <span className="block text-muted-foreground [overflow-wrap:anywhere]">
                          {a.detalle}
                        </span>
                      )}
                    </span>
                    <span
                      className={`tabular shrink-0 font-medium ${a.monto < 0 ? "text-saldo-favor" : ""}`}
                    >
                      {a.monto < 0 ? "−" : "+"}
                      {formatearMonto(Math.abs(a.monto))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Entrega: de un pedido cancelado ya no hay nada que retirar (H310). */}
          {!cancelado && (
            <section className="tarjeta rounded-xl bg-card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {pedido.tipoEntrega === "retiro" ? (
                  <Store className="h-4 w-4" />
                ) : (
                  <Truck className="h-4 w-4" />
                )}
                {pedido.tipoEntrega === "retiro"
                  ? "Lo retirás en"
                  : "Te lo llevamos a"}
              </h2>

              {pedido.tipoEntrega === "retiro" ? (
                <>
                  <p className="font-medium">{pedido.sucursal ?? "Sucursal"}</p>
                  {ficha?.direccion && (
                    <p className="mt-0.5 flex items-start gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {ficha.direccion}
                    </p>
                  )}
                  {ficha?.horario && (
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {ficha.horario}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="font-medium">{pedido.direccionEntrega}</p>
                  {pedido.zonaEnvio && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Zona {pedido.zonaEnvio}
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          {/* Solo lo que escribió el cliente al comprar en la tienda: las
              notas del vendedor no salen de la casa (H084). */}
          {pedido.notas && (
            <section className="rounded-xl bg-hundida p-5">
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Tu nota
              </h2>
              <p className="text-sm">{pedido.notas}</p>
            </section>
          )}
        </div>
      </div>

      {/* Historial real: los estados y cuándo; las notas son de la casa. */}
      {pedido.historial.length > 0 && (
        <section className="tarjeta rounded-xl bg-card p-5">
          <h2 className="mb-4 font-medium">Qué fue pasando</h2>
          <ol>
            {pedido.historial.map((paso, i) => (
              <li key={paso.id} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${i === 0 ? "bg-brand-orange" : "bg-border"}`}
                  />
                  {i < pedido.historial.length - 1 && (
                    <span className="w-px flex-1 bg-border" />
                  )}
                </div>
                <p
                  className={`flex flex-wrap items-center gap-2 ${i < pedido.historial.length - 1 ? "pb-4" : ""}`}
                >
                  <EtiquetaEstado estado={paso.estado} contexto="pedido" />
                  <span className="tabular text-sm text-muted-foreground">
                    {fechaHora.format(paso.createdAt)}
                  </span>
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        {/* Volver a pedir carga el carrito; sin tienda, lo manda por WhatsApp. */}
        {laTienda.activa ? (
          <VolverAPedir numero={pedido.numero} />
        ) : (
          repetir && (
            <BotonWhatsapp enlace={repetir} variante="secundario">
              Volver a pedir
            </BotonWhatsapp>
          )
        )}
        <BotonWhatsapp enlace={consulta}>
          Consultar por este pedido
        </BotonWhatsapp>
      </div>
    </div>
  );
}
