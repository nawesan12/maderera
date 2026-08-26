import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2, Landmark, ReceiptText, TriangleAlert } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { AcentoEstado, EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { fechaCorta, moneda, plural } from "@/lib/formato";
import {
  estadoArca,
  listarComprobantes,
  resumenFacturacion,
} from "@/lib/dal/admin/facturacion";
import {
  nombreComprobante,
  numeroFormateado,
} from "@/lib/fiscal/comprobantes";

export const metadata: Metadata = { title: "Facturación" };

export default async function FacturacionPage() {
  const [comprobantes, resumen, arca] = await Promise.all([
    listarComprobantes(),
    resumenFacturacion(),
    estadoArca(),
  ]);

  // Lo que necesita una decisión va arriba: rechazados por ARCA primero, que
  // son los que no se pueden entregar al cliente, y después los que todavía no
  // se mandaron a autorizar.
  const rechazados = comprobantes.filter((c) => c.estado === "rechazada");
  const sinAutorizar = comprobantes.filter((c) => c.estado === "emitida");
  const resto = comprobantes.filter(
    (c) => c.estado !== "rechazada" && c.estado !== "emitida",
  );

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Facturación"
        detalle="Comprobantes emitidos, su estado en ARCA y lo cobrado."
      >
        <Link
          href="/admin/arca"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Landmark className="h-5 w-5" />
          ARCA
        </Link>
        <Link
          href="/admin/facturacion/nueva"
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-3.5 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark"
        >
          <FilePlus2 className="h-5 w-5" />
          Nueva factura
        </Link>
      </EncabezadoPanel>

      {!arca.operativo && (
        <section className="tarjeta-atencion flex flex-wrap items-start gap-x-4 gap-y-2 p-5">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          <div className="min-w-[18rem] flex-1">
            <h2 className="text-base font-medium">
              Los comprobantes todavía no tienen valor fiscal
            </h2>
            <p className="mt-1 text-base text-muted-foreground">
              {arca.detalle ??
                "Falta conectar con ARCA para que los comprobantes reciban CAE."}
            </p>
          </div>
          <Link
            href="/admin/arca"
            className="inline-flex h-10 items-center rounded-lg border bg-card px-3.5 text-base font-medium transition-colors hover:bg-muted"
          >
            Qué falta
          </Link>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador
          titulo="Facturado este mes"
          valor={moneda.format(resumen.totalMes)}
          detalle={plural(resumen.cantidadMes, "comprobante")}
        />
        <Indicador
          titulo="IVA del mes"
          valor={moneda.format(resumen.ivaMes)}
          detalle="Débito fiscal a declarar"
        />
        <Indicador
          titulo="Sin autorizar"
          valor={String(resumen.pendientesDeAutorizar)}
          detalle={
            resumen.pendientesDeAutorizar > 0
              ? "Esperan CAE de ARCA"
              : "Todo al día"
          }
          atencion={resumen.pendientesDeAutorizar > 0}
        />
      </div>

      {comprobantes.length === 0 ? (
        <section className="tarjeta px-6 py-16 text-center">
          <ReceiptText className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <h2 className="mt-4 text-lg font-medium">Todavía no hay comprobantes</h2>
          <p className="mx-auto mt-1 max-w-md text-base text-muted-foreground">
            Se factura desde un pedido entregado, o a mano con el botón de
            arriba para la venta de mostrador.
          </p>
        </section>
      ) : (
        <div className="space-y-6">
          {rechazados.length > 0 && (
            <Grupo
              titulo="Rechazados por ARCA"
              detalle="Hay que corregir y reenviar"
              comprobantes={rechazados}
              atencion
            />
          )}
          {sinAutorizar.length > 0 && (
            <Grupo
              titulo="Sin autorizar"
              detalle={plural(sinAutorizar.length, "comprobante")}
              comprobantes={sinAutorizar}
            />
          )}
          {resto.length > 0 && (
            <Grupo titulo="Emitidos" comprobantes={resto} />
          )}
        </div>
      )}
    </div>
  );
}

function Indicador({
  titulo,
  valor,
  detalle,
  atencion = false,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  atencion?: boolean;
}) {
  return (
    <section className={atencion ? "tarjeta-atencion p-5" : "tarjeta p-5"}>
      <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {titulo}
      </p>
      <p
        className={`tabular mt-1 text-3xl font-semibold ${
          atencion ? "text-brand-orange-dark" : ""
        }`}
      >
        {valor}
      </p>
      <p className="mt-0.5 text-base text-muted-foreground">{detalle}</p>
    </section>
  );
}

/**
 * Los comprobantes van en tabla, no en tarjetas.
 *
 * Es el caso en que la tabla es la forma correcta: son cifras que se comparan
 * columna contra columna —total, cobrado, saldo— y una lista de tarjetas
 * obligaría a leer cada una para sumar de cabeza.
 */
function Grupo({
  titulo,
  detalle,
  comprobantes,
  atencion = false,
}: {
  titulo: string;
  detalle?: string;
  comprobantes: Awaited<ReturnType<typeof listarComprobantes>>;
  atencion?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-baseline gap-2.5 text-lg font-medium">
        {titulo}
        {detalle && (
          <span
            className={`text-base font-normal ${
              atencion ? "text-brand-orange-dark" : "text-muted-foreground"
            }`}
          >
            {detalle}
          </span>
        )}
      </h2>

      <div className="tarjeta overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left">
            <thead>
              <tr className="border-b text-sm uppercase tracking-[0.06em] text-muted-foreground">
                <th scope="col" className="px-5 py-3 font-semibold">Comprobante</th>
                <th scope="col" className="px-3 py-3 font-semibold">Cliente</th>
                <th scope="col" className="px-3 py-3 font-semibold">Fecha</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Total</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Saldo</th>
                <th scope="col" className="px-5 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {comprobantes.map((c) => {
                const saldo = c.total - c.cobrado;

                return (
                  <tr key={c.id} className="relative hover:bg-muted/50">
                    <AcentoEstado estado={c.estado} />
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/admin/facturacion/${c.id}`}
                        className="block"
                      >
                        <span className="tabular block text-base font-medium">
                          {numeroFormateado(c.puntoVenta, c.numero)}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {nombreComprobante(c.tipo)}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="block text-base">{c.receptorNombre}</span>
                      {c.receptorCuit && (
                        <span className="tabular block text-sm text-muted-foreground">
                          {c.receptorCuit}
                        </span>
                      )}
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-3.5 text-base text-muted-foreground">
                      {fechaCorta.format(c.fechaEmision)}
                    </td>
                    <td className="tabular whitespace-nowrap px-3 py-3.5 text-right text-base font-medium">
                      {moneda.format(c.total)}
                    </td>
                    <td
                      className={`tabular whitespace-nowrap px-3 py-3.5 text-right text-base ${
                        saldo > 0 ? "text-brand-orange-dark" : "text-muted-foreground"
                      }`}
                    >
                      {saldo > 0 ? moneda.format(saldo) : "Cobrado"}
                    </td>
                    <td className="px-5 py-3.5">
                      <EtiquetaEstado estado={c.estado} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
