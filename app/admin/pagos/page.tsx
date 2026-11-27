import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, Landmark, Wallet } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { FiltroPeriodo } from "@/components/admin/filtro-periodo";
import { leerPeriodo, resolverPeriodo } from "@/lib/periodos";
import {
  AcentoEstado,
  EtiquetaEstado,
} from "@/components/admin/etiqueta-estado";
import { fechaHora, formatearMonto, moneda, plural } from "@/lib/formato";
import {
  cobranzasDelPeriodo,
  panelDePagos,
  type PagoListado,
} from "@/lib/dal/admin/pagos";
import { leerPagina, Paginador, POR_PAGINA } from "@/components/admin/paginador";
import { AccionesCobro } from "./acciones";
import { DatosBancarios } from "./banco";
import { RefrescarEnVivo } from "@/components/vivo/refrescar-en-vivo";

export const metadata: Metadata = { title: "Cobranzas" };

const PROVEEDORES: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  transferencia: "Transferencia",
  demo: "Simulado",
};

const TIPOS: Record<string, string> = {
  pedido: "Pedido",
  deuda: "Cuenta corriente",
  inscripcion: "Inscripción",
};

/** Cómo se lee cada medio de cobro. */
const MEDIOS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  deposito: "Depósito",
  cheque: "Cheque",
  echeq: "e-Cheq",
  tarjeta_debito: "Débito",
  tarjeta_credito: "Crédito",
  mercado_pago: "Mercado Pago",
  retencion: "Retención",
};

const ORIGENES: Record<string, string> = {
  panel: "Cuenta corriente",
  mostrador: "Mostrador",
  portal: "Mi cuenta",
  mercado_pago: "En línea",
  factura: "Factura",
  transferencia: "En línea",
};

/**
 * Las cobranzas: toda la plata que entró de clientes en el período.
 *
 * Se llamaba «Cobros» y mostraba solo los cobros en línea: lo cobrado en el
 * mostrador, desde la ficha de un cliente o con un cheque no aparecía, y el
 * «acreditado este mes» no era el de nadie. Ahora el listado son todos los
 * recibos del período, de cualquier origen y medio, más los pedidos pagados
 * en el sitio (que no emiten recibo), con el total por medio sumado en el
 * servidor (backend/internal/reportes/cobranzas.go).
 *
 * Arriba, lo que espera una decisión: las transferencias a verificar contra
 * el extracto. Después los rechazos del período, que son clientes que
 * quisieron pagar y no pudieron. Los datos bancarios se tocan una vez:
 * están detrás de un botón del encabezado.
 *
 * Fuera quedaron la variable de entorno de Mercado Pago y los avisos crudos
 * del webhook: son cosas de quien mantiene el sistema, no de quien cobra.
 */
export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  const periodo = resolverPeriodo(leerPeriodo(params.periodo));
  const pagina = leerPagina(params.pagina);

  const [{ pagos, resumen, datosBancarios: banco, mercadoPago }, cobranzas] = await Promise.all([
    panelDePagos(periodo.clave),
    cobranzasDelPeriodo(periodo.clave, pagina, POR_PAGINA),
  ]);

  const aVerificar = pagos.filter((p) => p.estado === "en_revision");
  const rechazados = pagos.filter((p) => p.estado === "rechazado");
  const sinConfirmar = pagos.filter(
    (p) =>
      p.proveedor === "mercado_pago" &&
      (p.estado === "iniciado" || p.estado === "pendiente"),
  );

  return (
    <div className="space-y-6">
      {/* Se factura, se cobra o se cancela en otra pantalla: esta se
          refresca sola (canal «ventas», M2S2-099 y M3S1-034). */}
      <RefrescarEnVivo canales={["ventas"]} />
      {/* El mismo nombre que el menú (mes simulado, H137). */}
      <EncabezadoPanel titulo="Cobranzas" resumen={periodo.etiqueta}>
        <FiltroPeriodo actual={periodo.clave} />
        {/* Sin token, o con token y sin el secreto del webhook (los avisos se
            descartarían): el checkout no se ofrece. */}
        {(mercadoPago === "apagado" || mercadoPago === "sin_secreto") && (
          <span className="estado-problema inline-flex h-11 items-center rounded-full bg-[var(--estado-fondo)] px-4 text-base font-medium text-[var(--estado-tinta)]">
            Mercado Pago apagado
          </span>
        )}
        <DatosBancarios datos={banco} />
        <Link
          href="/admin/facturacion"
          className="tarjeta inline-flex h-11 items-center gap-2 px-3.5 text-base font-medium transition-colors hover:text-acento-texto"
        >
          <Landmark className="h-5 w-5" />
          Facturación
        </Link>
      </EncabezadoPanel>

      {mercadoPago === "demo" && !resumen.enVivo && (
        <section className="tarjeta-atencion flex items-center gap-3 p-4">
          <FlaskConical className="h-5 w-5 shrink-0 text-brand-orange" />
          <h2 className="text-base font-medium">
            Mercado Pago en modo de prueba
          </h2>
        </section>
      )}

      {aVerificar.length > 0 && (
        <Grupo titulo="A verificar" pagos={aVerificar} atencion />
      )}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="tarjeta p-5">
          <p className="text-base font-semibold text-texto-2">Cobrado</p>
          <p className="tabular mt-1 text-[34px] font-bold leading-none tracking-[-0.03em]">
            {moneda.format(cobranzas.cobrado)}
          </p>
          {/* Lo cobrado de verdad: los recibos, lo cobrado en línea y el
              mostrador, sin los cheques que rebotaron (H137/H349). */}
          <p className="mt-2 text-base text-texto-2">
            {[
              cobranzas.total > 0 ? plural(cobranzas.total, "cobro") : null,
              cobranzas.ventas > 0 ? plural(cobranzas.ventas, "venta del mostrador", "ventas del mostrador") : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Sin cobros"}
          </p>
        </div>
        <div className="tarjeta-hundida grid grid-cols-2 gap-x-6 gap-y-3 p-5 sm:grid-cols-3">
          {cobranzas.porMedio.length === 0 ? (
            <p className="text-base text-texto-2">Sin cobros en el período.</p>
          ) : (
            cobranzas.porMedio.map((m) => (
              <div key={m.medio}>
                <p className="text-base text-texto-2">
                  {MEDIOS[m.medio] ?? m.medio}
                </p>
                <p className="tabular text-xl font-semibold">
                  {moneda.format(m.total)}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {rechazados.length > 0 && (
        <Grupo titulo="Rechazados" pagos={rechazados} />
      )}
      {sinConfirmar.length > 0 && (
        <Grupo titulo="En línea sin confirmar" pagos={sinConfirmar} />
      )}

      <section className="tarjeta overflow-hidden">
        <header className="tarjeta-cabecera flex items-baseline justify-between gap-3 px-5 py-3.5">
          <h2 className="text-base font-semibold">Recibos y cobros</h2>
          <span className="tabular text-base text-muted-foreground">
            {cobranzas.total}
          </span>
        </header>
        {cobranzas.filas.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Wallet className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <p className="mt-3 text-base text-muted-foreground">
              Sin cobros en el período.
            </p>
          </div>
        ) : (
          <div className="@container">
            <table className="hidden w-full text-base @4xl:table" data-tabla="fija">
              <thead>
                <tr className="text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Cuándo</th>
                  <th className="px-5 py-2.5 font-semibold">De quién</th>
                  <th className="px-5 py-2.5 font-semibold">Comprobante</th>
                  <th className="px-5 py-2.5 font-semibold">Medios</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea-suave">
                {cobranzas.filas.map((c) => (
                  <tr key={c.id} className={c.anulado ? "opacity-60" : ""}>
                    <td className="tabular px-5 py-3 text-muted-foreground">{fechaHora.format(c.fecha)}</td>
                    <td className="px-5 py-3">
                      <Quien c={c} />
                      <span className="block text-sm text-muted-foreground">
                        <Origen c={c} />
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Comprobante c={c} />
                    </td>
                    <td className="px-5 py-3">
                      <Medios c={c} />
                    </td>
                    <td className="tabular px-5 py-3 text-right font-semibold">{formatearMonto(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* En el teléfono, sin columna de rótulos (se cortaban en «De q…»,
                «Me…»): la fecha con el origen y el total arriba, quién a todo
                el ancho, y el comprobante con los medios como chips. */}
            <ul className="divide-y divide-linea-suave @4xl:hidden">
              {cobranzas.filas.map((c) => (
                <li key={c.id} className={`space-y-1.5 px-4 py-3 ${c.anulado ? "opacity-60" : ""}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="tabular whitespace-nowrap text-sm text-muted-foreground">{fechaHora.format(c.fecha)}</span>
                    <span className="tabular shrink-0 text-lg font-semibold">{formatearMonto(c.total)}</span>
                  </div>
                  <p className="break-words text-base font-semibold">
                    <Quien c={c} />
                  </p>
                  {/* El origen baja con el comprobante: arriba, al lado de la
                      fecha, se cortaba en «Pedido P…» (mes simulado, H338). */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="whitespace-nowrap text-sm text-muted-foreground">
                      <Origen c={c} />
                    </span>
                    <Comprobante c={c} />
                    <Medios c={c} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="px-4">
          <Paginador
            pagina={pagina}
            total={cobranzas.total}
            params={{ periodo: params.periodo }}
          />
        </div>
      </section>
    </div>
  );
}

type Cobranza = Awaited<ReturnType<typeof cobranzasDelPeriodo>>["filas"][number];

function Quien({ c }: { c: Cobranza }) {
  return c.customerId ? (
    <Link href={`/admin/clientes/${c.customerId}`} className="hover:text-brand-orange hover:underline">
      {c.cliente}
    </Link>
  ) : (
    <>{c.cliente}</>
  );
}

/** De dónde vino: un recibo de un pedido puntual no es «Cuenta corriente» (H268). */
function Origen({ c }: { c: Cobranza }) {
  if (c.tipo === "recibo" && c.pedido) return <>Pedido {c.pedido}</>;
  return <>{ORIGENES[c.origen] ?? c.origen}</>;
}

function Comprobante({ c }: { c: Cobranza }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      {c.tipo === "recibo" ? (
        <a
          href={`/api/recibos/${c.id}/pdf`}
          target="_blank"
          rel="noopener"
          className="codigo whitespace-nowrap font-medium hover:text-brand-orange hover:underline"
        >
          Recibo {c.numero}
        </a>
      ) : c.orderId ? (
        <Link href={`/admin/pedidos/${c.orderId}`} className="whitespace-nowrap font-medium hover:text-brand-orange hover:underline">
          Pedido en línea
        </Link>
      ) : (
        "En línea"
      )}
      {c.anulado && <span className="estado-problema text-sm font-medium">Anulado</span>}
    </span>
  );
}

function Medios({ c }: { c: Cobranza }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {c.partes.map((p, i) =>
        p.chequeId ? (
          <Link
            key={i}
            href="/admin/cheques"
            className="tabular rounded-full bg-chip px-2.5 py-0.5 text-sm hover:text-brand-orange hover:underline"
          >
            {MEDIOS[p.medio] ?? p.medio} {formatearMonto(p.importe)}
          </Link>
        ) : (
          <span key={i} className="tabular rounded-full bg-chip px-2.5 py-0.5 text-sm">
            {MEDIOS[p.medio] ?? p.medio} {formatearMonto(p.importe)}
          </span>
        ),
      )}
    </span>
  );
}

function Grupo({
  titulo,
  pagos,
  atencion = false,
}: {
  titulo: string;
  pagos: PagoListado[];
  atencion?: boolean;
}) {
  return (
    <section className={atencion ? "tarjeta-atencion" : "tarjeta"}>
      <div className="tarjeta-cabecera flex flex-wrap items-baseline justify-between gap-2 px-5 py-4">
        <h2 className="text-base font-medium">{titulo}</h2>
        <span className="tabular text-base text-muted-foreground">
          {pagos.length}
        </span>
      </div>

      <ul className="divide-y">
        {pagos.map((pago) => (
          <li
            key={pago.id}
            className="relative flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden px-5 py-4"
          >
            <AcentoEstado estado={pago.estado} />

            <div className="min-w-[14rem] flex-1 pl-2">
              <p className="text-base font-medium">
                {pago.numeroPedido ? (
                  <Link
                    href={`/admin/pedidos/${pago.orderId}`}
                    className="hover:text-brand-orange-dark hover:underline"
                  >
                    Pedido {pago.numeroPedido}
                  </Link>
                ) : (
                  (TIPOS[pago.tipo] ?? pago.tipo)
                )}
              </p>
              <p className="text-base text-muted-foreground">
                {pago.cliente ?? "Sin ficha de cliente"} ·{" "}
                {PROVEEDORES[pago.proveedor] ?? pago.proveedor}
                {/* «Transferencia · transferencia» decía dos veces lo mismo. */}
                {pago.medio && pago.medio !== pago.proveedor ? ` · ${MEDIOS[pago.medio] ?? pago.medio}` : ""}
              </p>
              {/* Lo que hace falta para decidir sin abrir la ficha (H375):
                  cuánto debe hoy y si es el mismo aviso que otro. */}
              {pago.estado === "en_revision" && (pago.saldoCliente !== null || pago.duplicado) && (
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {pago.duplicado && (
                    <span className="estado-problema rounded-full bg-[var(--estado-fondo)] px-2.5 py-0.5 text-sm font-semibold">
                      Repetido
                    </span>
                  )}
                  {pago.saldoCliente !== null && (
                    <span
                      className={`tabular rounded-full px-2.5 py-0.5 text-sm font-medium ${
                        pago.saldoCliente <= 0.005 ? "estado-problema bg-[var(--estado-fondo)]" : "bg-chip"
                      }`}
                    >
                      {pago.saldoCliente <= 0.005 ? "Sin deuda" : `Debe ${formatearMonto(pago.saldoCliente)}`}
                    </span>
                  )}
                </p>
              )}
              {pago.motivoRechazo && (
                <p className="mt-0.5 text-base text-brand-orange-dark">
                  {pago.motivoRechazo}
                </p>
              )}
            </div>

            <span className="tabular text-lg font-semibold">
              {moneda.format(pago.monto)}
            </span>

            <EtiquetaEstado estado={pago.estado} />

            <span className="tabular w-36 text-right text-base text-muted-foreground">
              {fechaHora.format(pago.acreditadoAt ?? pago.createdAt)}
            </span>

            <AccionesCobro
              pagoId={pago.id}
              estado={pago.estado}
              proveedor={pago.proveedor}
              comprobanteUrl={pago.comprobanteUrl}
              cliente={pago.cliente}
              monto={moneda.format(pago.monto)}
              revisar={
                pago.estado === "en_revision" && (pago.duplicado || (pago.saldoCliente !== null && pago.saldoCliente <= 0.005))
                  ? pago.duplicado
                    ? "Es el mismo importe que otro aviso del mismo cliente, de minutos antes."
                    : `${pago.cliente ?? "El cliente"} no tiene deuda: acreditarlo le deja saldo a favor.`
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
