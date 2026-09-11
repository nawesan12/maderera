import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Store } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import {
  cierresDeTurnos,
  sucursalesConCaja,
  turnosCerrados,
} from "@/lib/mostrador/caja";
import {
  emitidoPorCaja,
  listarCajasFisicas,
  turnosParaAsignar,
  ventasSinCaja,
} from "@/lib/dal/admin/cajas-fisicas";
import { formatearMonto, haceCuanto } from "@/lib/formato";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { SelectorDeMes } from "@/components/admin/selector-de-mes";
import { Vacio } from "@/components/admin/vacio";
import { leerPeriodoMensual } from "@/lib/periodos";
import { nombreComprobante } from "@/lib/fiscal/comprobantes";
import { CajasFisicas } from "./cajas-fisicas";
import { VentasSueltas } from "./ventas-sueltas";

export const metadata: Metadata = { title: "Caja" };

/**
 * Los cierres de caja del mostrador.
 *
 * Existe porque el arqueo sin historial no sirve de nada: la diferencia de un
 * día es un número; la de veinte días seguidos, siempre para el mismo lado y
 * con la misma persona, es otra cosa. Esto es lo que permite mirar la segunda.
 *
 * No se puede editar nada desde acá, a propósito. Un cierre es lo que se contó
 * ese día; corregirlo después con la calculadora en la mano es exactamente
 * cómo un descuadre deja de verse.
 */
/** Cómo se lee cada medio en el cierre. */
const MEDIOS: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  cuenta_corriente: "Cuenta corriente",
  mercado_pago: "Mercado Pago",
};

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  await requireStaff();

  const { periodo: crudo } = await searchParams;
  const periodo = leerPeriodoMensual(crudo, new Date());

  const [sucursales, cerrados, cajas, sueltas, emitido] = await Promise.all([
    sucursalesConCaja(),
    turnosCerrados(),
    listarCajasFisicas(),
    ventasSinCaja(),
    emitidoPorCaja(periodo.desde, periodo.hasta),
  ]);

  /*
   * Los turnos a los que se puede mandar una venta suelta. Se piden solo para
   * las sucursales que efectivamente tienen alguna colgada: sin ventas sueltas
   * —que es lo normal— esto no consulta nada.
   */
  const conSueltas = [...new Set(sueltas.map((v) => v.branchId))];
  const turnos = (
    await Promise.all(conSueltas.map((id) => turnosParaAsignar(id)))
  ).flatMap((lista, i) =>
    lista.map((t) => ({
      id: t.id,
      branchId: conSueltas[i],
      etiqueta:
        new Date(t.abiertaAt).toLocaleDateString("es-AR", {
          day: "2-digit",
          month: "2-digit",
        }) +
        " " +
        new Date(t.abiertaAt).toLocaleTimeString("es-AR", {
          hour: "2-digit",
          minute: "2-digit",
        }) +
        (t.estado === "abierta" ? " (abierto)" : ""),
    })),
  );

  // Cuánto entró por cada medio en cada turno. El arqueo cuenta efectivo
  // —es lo único que puede faltar del cajón—, pero lo primero que se pregunta
  // al cerrar el día es cuánto se cobró con tarjeta y cuánto quedó a cuenta.
  const cierres = await cierresDeTurnos(cerrados.map((t) => t.id));

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Caja"
        detalle="Los turnos del mostrador, lo que debería haber y lo que se contó."
      >
        <SelectorDeMes actual={periodo.clave} />
      </EncabezadoPanel>

      <section className="grid gap-3 sm:grid-cols-2">
        {sucursales.map((s) => (
          <article key={s.id} className="tarjeta flex items-center gap-3.5 p-4">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                s.turnoId
                  ? "estado-ok bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                  : "bg-hundida text-muted-foreground"
              }`}
            >
              <Banknote className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">{s.nombre}</p>
              <p className="text-sm text-muted-foreground">
                {s.turnoId && s.abiertaAt
                  ? `Abierta ${haceCuanto(new Date(s.abiertaAt))}`
                  : "Sin turno abierto"}
              </p>
            </div>
            <Link
              href="/mostrador"
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-sm font-medium transition-colors hover:bg-hundida"
            >
              <Store className="h-4 w-4" />
              Ir al mostrador
            </Link>
          </article>
        ))}
      </section>

      <VentasSueltas ventas={sueltas} turnos={turnos} />

      <CajasFisicas
        cajas={cajas}
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
      />

      <section className="tarjeta overflow-hidden">
        <header className="border-b border-linea px-5 py-3.5">
          <h2 className="text-base font-semibold">Turnos cerrados</h2>
        </header>

        {cerrados.length === 0 ? (
          <p className="px-5 py-10 text-center text-base text-muted-foreground">
            Todavía no se cerró ningún turno.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Sucursal</th>
                  <th className="px-5 py-2.5 font-semibold">Quién</th>
                  <th className="px-5 py-2.5 font-semibold">Cerrado</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Esperado</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Contado</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {cerrados.map((t) => {
                  const esperado = Number(t.esperado);
                  const cierre = cierres.get(t.id) ?? [];
                  const contado = t.contado === null ? null : Number(t.contado);
                  const diferencia = contado === null ? null : contado - esperado;
                  const cuadra = diferencia !== null && Math.abs(diferencia) < 0.01;

                  return [
                    (
                    <tr key={t.id}>
                      <td className="px-5 py-3">{t.sucursal}</td>
                      <td className="px-5 py-3 text-muted-foreground">{t.abiertaPor}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {t.cerradaAt ? haceCuanto(new Date(t.cerradaAt)) : "—"}
                      </td>
                      <td className="tabular px-5 py-3 text-right">
                        {formatearMonto(esperado)}
                      </td>
                      <td className="tabular px-5 py-3 text-right">
                        {formatearMonto(contado)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {/* Los mismos tokens de signo que usa la cuenta
                            corriente y el cierre del mostrador: falta en rojo,
                            sobra en verde, cuadra en gris. Que un descuadre se
                            vea igual en las dos pantallas es lo que hace que el
                            color signifique algo. */}
                        <span
                          className={`tabular font-semibold ${
                            diferencia === null
                              ? "text-muted-foreground"
                              : cuadra
                                ? "text-saldo-cero"
                                : diferencia < 0
                                  ? "text-saldo-debe"
                                  : "text-saldo-favor"
                          }`}
                        >
                          {diferencia === null ? "—" : formatearMonto(diferencia)}
                        </span>
                        {/* El esperado cambió después del arqueo: entró una
                            venta hecha sin conexión que pertenecía a este
                            turno. La diferencia de esa noche se calculó contra
                            otro número, y eso hay que poder verlo. */}
                        {t.tardios > 0 && (
                          <span
                            className="mt-0.5 block text-sm text-muted-foreground"
                            title="Entraron movimientos después del cierre, de ventas hechas sin conexión."
                          >
                            +{t.tardios} después del cierre
                          </span>
                        )}
                      </td>
                    </tr>
                  ),
                  cierre.length > 0 && (
                    <tr key={`${t.id}-cierre`} className="border-0">
                      <td colSpan={6} className="px-5 pb-3 pt-0">
                        <div className="flex flex-wrap gap-2">
                          {cierre.map((r) => (
                            <span
                              key={r.medioPago}
                              className="inline-flex items-baseline gap-1.5 rounded-full bg-muted px-3 py-1 text-sm"
                            >
                              <span className="text-muted-foreground">
                                {MEDIOS[r.medioPago] ?? r.medioPago}
                              </span>
                              <span className="tabular font-semibold">
                                {formatearMonto(r.total)}
                              </span>
                              <span className="text-muted-foreground">
                                ({r.cantidad})
                              </span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ),
                ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/*
        Lo que emitió cada caja.

        El pedido de la clienta: "que en cada equipo los comprobantes, remitos,
        lo que se emita la operadora de la caja, pueda levantarlos sin
        problema". Reimprimir ya se podía, pero **había que saber el id**, y
        para eso había que encontrar la venta en el listado general de pedidos,
        que no dice de qué caja salió ni quién la cobró.

        El número provisorio va al lado del definitivo porque es el que trae el
        cliente escrito en el ticket cuando la venta se cobró sin internet.
      */}
      <section className="tarjeta overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-linea px-5 py-4">
          <h2 className="text-base font-semibold">
            Emitido en el mostrador
          </h2>
          <p className="text-base text-muted-foreground">
            Para reimprimir desde cualquier equipo
          </p>
        </div>

        {emitido.length === 0 ? (
          <Vacio
            icono={Store}
            titulo="No se emitió nada en el mes elegido"
            detalle="Cambiá el mes de arriba para ver otro."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Cuándo</th>
                  <th className="px-5 py-2.5 font-semibold">Venta</th>
                  <th className="px-5 py-2.5 font-semibold">Quién cobró</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    Papeles
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {emitido.map((v) => (
                  <tr key={v.orderId}>
                    <td className="tabular px-5 py-3 text-muted-foreground">
                      {v.createdAt.toLocaleDateString("es-AR")}
                      <span className="block text-sm">
                        {v.createdAt.toLocaleTimeString("es-AR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/pedidos/${v.orderId}`}
                        className="tabular font-medium hover:text-brand-orange hover:underline"
                      >
                        {v.numero}
                      </Link>
                      <span className="block text-sm text-muted-foreground">
                        {v.cliente}
                        {v.numeroProvisorio && (
                          <span className="tabular"> · ticket {v.numeroProvisorio}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {v.operadora ?? "—"}
                      <span className="block text-sm">{v.sucursal ?? ""}</span>
                    </td>
                    <td className="tabular px-5 py-3 text-right font-semibold">
                      {formatearMonto(Number(v.total))}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-sm">
                        <a
                          href={`/ticket/${v.orderId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-brand-orange hover:underline"
                        >
                          Ticket
                        </a>
                        {v.invoiceId && (
                          <Link
                            href={`/admin/facturacion/${v.invoiceId}`}
                            className="hover:text-brand-orange hover:underline"
                          >
                            {nombreComprobante(v.invoiceTipo!)}{" "}
                            <span className="tabular">
                              {String(v.invoicePuntoVenta).padStart(4, "0")}-
                              {String(v.invoiceNumero).padStart(8, "0")}
                            </span>
                          </Link>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
