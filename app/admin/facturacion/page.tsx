import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2, Landmark, ReceiptText, Trash2, TriangleAlert } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { FiltroPeriodo } from "@/components/admin/filtro-periodo";
import { FiltroRango } from "@/components/admin/filtro-rango";
import { leerPeriodo, leerRango, resolverPeriodo } from "@/lib/periodos";
import { BuscadorDeComprobantes } from "./buscador";
import { AcentoEstado, EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { fechaCorta, formatearCuit, hoyEnArgentina, moneda, plural } from "@/lib/formato";
import {
  dadosDeBaja,
  estadoArca,
  listarComprobantesPagina,
  resumenFacturacion,
  type ComprobanteListado,
} from "@/lib/dal/admin/facturacion";
import { leerPagina, Paginador, POR_PAGINA } from "@/components/admin/paginador";
import {
  nombreComprobante,
  numeroFormateado,
} from "@/lib/fiscal/comprobantes";

export const metadata: Metadata = { title: "Facturación" };

export default async function FacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{
    periodo?: string;
    desde?: string;
    hasta?: string;
    cobro?: string;
    buscar?: string;
    pagina?: string;
    estado?: string;
  }>;
}) {
  const params = await searchParams;
  const periodo = resolverPeriodo(leerPeriodo(params.periodo));

  /*
   * El rango libre le gana al período.
   *
   * Son dos formas de decir lo mismo y no pueden estar las dos a la vez: si
   * alguien puso fechas, ésas mandan y el período queda de adorno. Se dice en
   * el encabezado para que no haya dudas de qué se está mirando.
   */
  const rango = leerRango(params.desde, params.hasta);

  const cobro: "contado" | "cuenta" | "todos" =
    params.cobro === "contado" || params.cobro === "cuenta"
      ? params.cobro
      : "todos";

  const pagina = leerPagina(params.pagina);
  /*
   * El estado (lo que falta autorizar, lo rechazado, las ventas anuladas con
   * factura viva) es de cualquier fecha: un comprobante sin CAE de septiembre
   * sigue sin poder entregarse en noviembre. Con un estado elegido, el período
   * no corta. Antes esos grupos se repetían enteros arriba del listado, con
   * cien filas cada uno, y cada factura salía dos o tres veces.
   */
  const estado =
    params.estado === "emitida" || params.estado === "rechazada" || params.estado === "anulada-viva"
      ? params.estado
      : "todos";
  const conEstado = estado !== "todos";
  const filtros = {
    ...(conEstado
      ? { estado }
      : rango
        ? { desde: rango.desde, hasta: rango.hasta }
        : periodo.desde
          ? { desde: periodo.desde }
          : {}),
    cobro,
    busqueda: params.buscar,
  };

  const [lista, rechazados, sinAutorizar, resumen, arca, bajas] = await Promise.all([
    listarComprobantesPagina(filtros, pagina, POR_PAGINA),
    listarComprobantesPagina({ estado: "rechazada" }, 1, 1),
    listarComprobantesPagina({ estado: "emitida" }, 1, 1),
    resumenFacturacion(periodo),
    estadoArca(),
    dadosDeBaja(),
  ]);
  // Una baja borra un comprobante de este listado: que se vea cuántas hubo
  // en el mes, al lado de los otros accesos.
  const mes = hoyEnArgentina().slice(0, 7);
  const bajasDelMes = bajas.filter((b) => hoyEnArgentina(b.createdAt).startsWith(mes)).length;

  const queSeMira =
    estado === "emitida"
      ? "sin autorizar"
      : estado === "rechazada"
        ? "rechazados por ARCA"
        : estado === "anulada-viva"
          ? "de ventas anuladas"
          : rango
            ? `del ${fechaCorta.format(rango.desde)} al ${fechaCorta.format(rango.hasta)}`
            : periodo.etiqueta.toLowerCase();

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Facturación"
        resumen={`${queSeMira.charAt(0).toUpperCase()}${queSeMira.slice(1)}${cobro === "contado" ? ", cobrados de contado" : cobro === "cuenta" ? ", en cuenta corriente" : ""} · ${estado === "rechazada" ? plural(lista.total, "comprobante") : `${moneda.format(lista.suma)} en ${plural(lista.cantidad, "comprobante")}`}`}
      >
        {!rango && !conEstado && <FiltroPeriodo actual={periodo.clave} />}
        {bajas.length > 0 && (
          <Link
            href="/admin/facturacion/dados-de-baja"
            className="tarjeta inline-flex h-11 items-center gap-2 px-3.5 text-base font-medium transition-colors hover:text-acento-texto"
          >
            <Trash2 className="h-5 w-5" />
            Dados de baja
            {bajasDelMes > 0 && (
              <span className="tabular rounded-full bg-hundida px-2 text-sm">{bajasDelMes}</span>
            )}
          </Link>
        )}
        <Link
          href="/admin/arca"
          className="tarjeta inline-flex h-11 items-center gap-2 px-3.5 text-base font-medium transition-colors hover:text-acento-texto"
        >
          <Landmark className="h-5 w-5" />
          ARCA
        </Link>
        <Link
          href="/admin/facturacion/nueva"
          className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-3.5 text-base font-medium transition-colors"
        >
          <FilePlus2 className="h-5 w-5" />
          Nueva factura
        </Link>
      </EncabezadoPanel>

      {/* Buscar y cortar por fecha o por forma de cobro. Es lo que convierte
          el listado en una consulta: «las facturas de contado del sábado»,
          «la factura de Gómez». */}
      <section className="tarjeta flex flex-wrap items-center gap-3 p-4">
        <BuscadorDeComprobantes
          busquedaActual={params.buscar ?? ""}
          cobro={cobro}
          estado={estado}
          sinAutorizar={sinAutorizar.total}
          rechazados={rechazados.total}
        />
        {!conEstado && <FiltroRango desde={params.desde} hasta={params.hasta} />}
      </section>

      {!arca.operativo && (
        <section className="tarjeta-atencion flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
          <TriangleAlert className="h-5 w-5 shrink-0 text-brand-orange" />
          <h2 className="min-w-[14rem] flex-1 text-base font-medium">
            Los comprobantes todavía no tienen valor fiscal
          </h2>
          <Link
            href="/admin/arca/configuracion"
            className="tarjeta inline-flex h-11 items-center px-3.5 text-base font-medium"
          >
            Qué falta
          </Link>
        </section>
      )}

      {/* El débito fiscal del período: solo lo autorizado por ARCA, el mismo
          número del libro IVA y del cierre. Lo facturado ya está arriba. */}
      {!conEstado && (
        <Indicador
          titulo={`IVA · ${periodo.etiqueta.toLowerCase()}`}
          valor={moneda.format(resumen.ivaMes)}
          detalle="Débito fiscal"
        />
      )}

      {lista.total === 0 ? (
        <section className="tarjeta px-6 py-16 text-center">
          <ReceiptText className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <h2 className="mt-4 text-lg font-medium">Sin comprobantes {queSeMira}</h2>
        </section>
      ) : (
        <>
          <Grupo
            titulo={
              estado === "emitida"
                ? "Sin autorizar"
                : estado === "rechazada"
                  ? "Rechazados por ARCA"
                  : estado === "anulada-viva"
                    ? "Ventas anuladas con factura viva"
                    : "Comprobantes"
            }
            cantidad={lista.total}
            comprobantes={lista.filas}
            atencion={conEstado}
          />
          <Paginador
            pagina={pagina}
            total={lista.total}
            params={{
              periodo: params.periodo,
              desde: params.desde,
              hasta: params.hasta,
              cobro: params.cobro,
              buscar: params.buscar,
              estado: conEstado ? estado : undefined,
            }}
          />
        </>
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
  cantidad,
  comprobantes,
  atencion = false,
}: {
  titulo: string;
  cantidad: number;
  comprobantes: ComprobanteListado[];
  atencion?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-baseline gap-2.5 text-lg font-medium">
        {titulo}
        <span
          className={`tabular rounded-full px-2.5 py-0.5 text-base font-semibold ${
            atencion ? "bg-brand-orange/15 text-brand-orange-dark" : "bg-chip text-texto-2"
          }`}
        >
          {cantidad}
        </span>
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
                    {/* La franja va dentro de la celda: un <span> suelto en
                        el <tr> es HTML inválido, el navegador lo sacaba de la
                        tabla y React no hidrataba (error #418), y la tabla
                        dibujada en el cliente corría los encabezados una
                        columna. */}
                    <td className="px-5 py-3.5">
                      <AcentoEstado estado={c.estado} />
                      <Link
                        href={`/admin/facturacion/${c.id}`}
                        className="block"
                      >
                        <span className="tabular block text-base font-medium">
                          {numeroFormateado(c.puntoVenta, c.numero)}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {nombreComprobante(c.tipo)}
                          {c.pedido && <span className="codigo"> · {c.pedido}</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="block text-base">{c.receptorNombre}</span>
                      {c.receptorCuit && (
                        <span className="tabular block text-sm text-muted-foreground">
                          {formatearCuit(c.receptorCuit)}
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
                      {c.estado === "anulada" || c.tipo.startsWith("nota_credito")
                        ? "—"
                        : saldo > 0
                          ? moneda.format(saldo)
                          : "Cobrado"}
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
