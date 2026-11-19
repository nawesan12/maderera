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
import { fechaHora, moneda, plural } from "@/lib/formato";
import {
  cobranzasDelPeriodo,
  panelDePagos,
  type PagoListado,
} from "@/lib/dal/admin/pagos";
import { leerPagina, Paginador, POR_PAGINA } from "@/components/admin/paginador";
import { AccionesCobro } from "./acciones";
import { DatosBancarios } from "./banco";

export const metadata: Metadata = { title: "Cobros" };

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
      <EncabezadoPanel titulo="Cobros" resumen={periodo.etiqueta}>
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
          <p className="mt-2 text-base text-texto-2">
            {plural(cobranzas.total, "cobro")}
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-base">
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
                    <td className="tabular px-5 py-3 text-muted-foreground">
                      {fechaHora.format(c.fecha)}
                    </td>
                    <td className="px-5 py-3">
                      {c.customerId ? (
                        <Link
                          href={`/admin/clientes/${c.customerId}`}
                          className="hover:text-brand-orange hover:underline"
                        >
                          {c.cliente}
                        </Link>
                      ) : (
                        c.cliente
                      )}
                      <span className="block text-sm text-muted-foreground">
                        {ORIGENES[c.origen] ?? c.origen}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {c.tipo === "recibo" ? (
                        <a
                          href={`/api/recibos/${c.id}/pdf`}
                          target="_blank"
                          rel="noopener"
                          className="tabular font-medium hover:text-brand-orange hover:underline"
                        >
                          Recibo {c.numero}
                        </a>
                      ) : c.orderId ? (
                        <Link
                          href={`/admin/pedidos/${c.orderId}`}
                          className="font-medium hover:text-brand-orange hover:underline"
                        >
                          Pedido en línea
                        </Link>
                      ) : (
                        "En línea"
                      )}
                      {c.anulado && (
                        <span className="estado-problema block text-sm font-medium">
                          Anulado
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="flex flex-wrap gap-1.5">
                        {c.partes.map((p, i) =>
                          p.chequeId ? (
                            <Link
                              key={i}
                              href="/admin/cheques"
                              className="tabular rounded-full bg-chip px-2.5 py-0.5 text-sm hover:text-brand-orange hover:underline"
                            >
                              {MEDIOS[p.medio] ?? p.medio} {moneda.format(p.importe)}
                            </Link>
                          ) : (
                            <span
                              key={i}
                              className="tabular rounded-full bg-chip px-2.5 py-0.5 text-sm"
                            >
                              {MEDIOS[p.medio] ?? p.medio} {moneda.format(p.importe)}
                            </span>
                          ),
                        )}
                      </span>
                    </td>
                    <td className="tabular px-5 py-3 text-right font-semibold">
                      {moneda.format(c.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                {pago.medio ? ` · ${pago.medio}` : ""}
              </p>
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
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
