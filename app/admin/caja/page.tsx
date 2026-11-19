import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Store } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { sucursalesConCaja, turnosCerrados } from "@/lib/dal/admin/caja";
import {
  anulacionesPorPersona,
  emitidoPorCaja,
  listarCajasFisicas,
  turnosParaAsignar,
  ventasSinCaja,
} from "@/lib/dal/admin/cajas-fisicas";
import { formatearMonto, haceCuanto, plural } from "@/lib/formato";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { SelectorDeMes } from "@/components/admin/selector-de-mes";
import { Vacio } from "@/components/admin/vacio";
import { leerPagina, Paginador, POR_PAGINA } from "@/components/admin/paginador";
import { leerPeriodoMensual } from "@/lib/periodos";
import { nombreComprobante, type TipoComprobante } from "@/lib/fiscal/comprobantes";
import { CajasFisicas } from "./cajas-fisicas";
import { FondoBase } from "./fondo-base";
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
/**
 * La hora del negocio: Next corre en UTC y una venta de las 22 decía el día
 * siguiente.
 */
const ZONA = "America/Argentina/Buenos_Aires";

/** El día argentino de un instante, para comparar dos. */
const diaArgentino = (d: Date) => d.toLocaleDateString("es-AR", { timeZone: ZONA });

/** Cómo se lee cada medio en el cierre. */
const MEDIOS: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  cuenta_corriente: "Cuenta corriente",
  cheque: "Cheque",
  mercado_pago: "Mercado Pago",
};

export default async function CajaPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; pagina?: string }>;
}) {
  await requireStaff();

  const { periodo: crudo, pagina: paginaCruda } = await searchParams;
  const periodo = leerPeriodoMensual(crudo, new Date());
  const pagina = leerPagina(paginaCruda);

  // Las anulaciones del mes por quien las hizo, la que más anuló primero.
  // Las cuenta Go por la fecha de la anulación: sumarlas acá sobre lo
  // emitido, que llega cortado en 200 y por la fecha de la venta, perdía las
  // de la primera quincena.
  const [sucursales, turnosDelMes, cajas, sueltas, emitido, anulaciones] = await Promise.all([
    sucursalesConCaja(),
    turnosCerrados(periodo.clave, pagina, POR_PAGINA),
    listarCajasFisicas(),
    ventasSinCaja(),
    emitidoPorCaja(periodo.clave),
    anulacionesPorPersona(periodo.clave),
  ]);

  /*
   * Los turnos a los que se puede mandar una venta suelta. Se piden solo para
   * las sucursales que efectivamente tienen alguna colgada: sin ventas sueltas
   * —que es lo normal— esto no consulta nada.
   */
  const cerrados = turnosDelMes.filas;
  const conSueltas = [...new Set(sueltas.map((v) => v.branchId))];
  const turnos = (
    await Promise.all(conSueltas.map((id) => turnosParaAsignar(id)))
  ).flatMap((lista, i) =>
    lista.map((t) => ({
      id: t.id,
      branchId: conSueltas[i],
      // La etiqueta la escribe Go en hora argentina («5/3 09:00 a. m.»).
      etiqueta: t.etiqueta,
    })),
  );

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Caja"
      >
        <SelectorDeMes actual={periodo.clave} />
      </EncabezadoPanel>

      <section className="grid gap-3 sm:grid-cols-2">
        {sucursales.map((s) => (
          // En el teléfono el botón baja a su propio renglón: al lado, el
          // nombre, el turno y el cambio fijo quedaban partidos en tres.
          <article key={s.id} className="tarjeta flex flex-wrap items-center gap-3.5 p-4 lg:flex-nowrap">
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
              {/* Lo que tendría que haber ahora en el cajón: la suma de los
                  movimientos del turno, el mismo número que va a pedir el
                  arqueo. Es la pregunta del dueño cuando pasa por la caja. */}
              {s.esperado != null && (
                <p className="tabular mt-1 text-2xl font-bold leading-tight">
                  {formatearMonto(s.esperado)}
                  <span className="ml-2 text-base font-medium text-muted-foreground">
                    en efectivo
                  </span>
                </p>
              )}
              {/* El cambio que no se retira nunca. Ver `FondoBase`. */}
              <FondoBase branchId={s.id} valor={Number(s.fondoBase)} />
            </div>
            <Link
              href="/mostrador"
              className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-linea px-3.5 text-sm font-medium transition-colors hover:bg-hundida lg:w-auto"
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
        <header className="tarjeta-cabecera flex items-baseline justify-between gap-3 px-5 py-3.5">
          <h2 className="text-base font-semibold">Turnos cerrados</h2>
          <span className="tabular text-base text-muted-foreground">
            {turnosDelMes.total}
          </span>
        </header>

        {cerrados.length === 0 ? (
          <p className="px-5 py-10 text-center text-base text-muted-foreground">
            Ningún turno cerrado en el mes elegido.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Sucursal</th>
                  <th className="px-5 py-2.5 font-semibold">Quién</th>
                  <th className="px-5 py-2.5 font-semibold">Cerrado</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Tendría que haber</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Contado</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Diferencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {cerrados.map((t) => {
                  const esperado = Number(t.esperado);
                  const cierre = t.cierre;
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
                        {/* Lo que llegó de la cola después del arqueo —una
                            venta o un retiro sin conexión de este turno— va
                            aparte y no cambia la diferencia de esa noche. Un
                            retiro tardío se lee en rojo: es plata que salió
                            de una caja ya contada. */}
                        {t.tardios > 0 && (
                          <span
                            className={`tabular mt-0.5 block text-sm ${t.tardiosMonto < 0 ? "text-saldo-debe" : "text-muted-foreground"}`}
                          >
                            {t.tardios} tarde · {formatearMonto(t.tardiosMonto)}
                          </span>
                        )}
                        {/* Las ventas sin conexión del turno que pasaron lo
                            libre o el límite de cuenta corriente sin PIN: ya
                            pasaron, se ven en rojo. */}
                        {t.bajoLista > 0 && (
                          <span className="tabular mt-0.5 block text-sm font-semibold text-saldo-debe">
                            {t.bajoLista} sin conexión bajo la lista · {formatearMonto(t.bajoListaMonto)}
                          </span>
                        )}
                        {t.creditoSinAutorizar > 0 && (
                          <span className="tabular mt-0.5 block text-sm font-semibold text-saldo-debe">
                            {t.creditoSinAutorizar} sin conexión a cuenta pasado el límite · {formatearMonto(t.creditoSinAutorizarMonto)}
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
                              key={`${r.devolucion ? "dev-" : ""}${r.medioPago}-${r.quien ?? ""}`}
                              className="inline-flex items-baseline gap-1.5 rounded-full bg-muted px-3 py-1 text-sm"
                            >
                              <span className="text-muted-foreground">
                                {r.devolucion && "Devolución · "}
                                {MEDIOS[r.medioPago] ?? r.medioPago}
                                {r.quien && ` · ${r.quien}`}
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
        <div className="px-4">
          <Paginador
            pagina={pagina}
            total={turnosDelMes.total}
            params={{ periodo: crudo }}
          />
        </div>
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
      <section className="tarjeta @container overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-linea px-5 py-4">
          <h2 className="text-base font-semibold">
            Emitido en el mostrador
          </h2>
          {/* Quién anuló y cuánto, sin contar a ojo: cinco anulaciones por
              semana de la misma persona se ven acá antes que en la bitácora. */}
          {anulaciones.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-base text-muted-foreground [font-variant-numeric:tabular-nums]">
              {anulaciones.map((a) => (
                <li key={a.quien}>
                  {a.quien} · {plural(a.cantidad, "anulada")} · {formatearMonto(a.total)}
                  {a.devuelto > 0 && (
                    <span className="estado-problema font-medium"> · {formatearMonto(a.devuelto)} del cajón</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {emitido.length === 0 ? (
          <Vacio
            icono={Store}
            titulo="No se emitió nada en el mes elegido"
          />
        ) : (
          <>
          {/* La tabla, donde entra entera (el ancho de la sección, no el de
              la pantalla: el menú lateral se come 244 px); si no, dos
              renglones por venta. Apilada era «Cuándo:», «Venta:», «Total:»
              uno abajo del otro, y con un ancho mínimo se corría de costado
              en una tablet, que no pasa en ningún ancho. */}
          <div className="hidden @4xl:block">
            <table className="w-full text-base">
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
                  // La anulada se apaga y se tacha, y no se confunde con una
                  // venta válida; el rojo queda para la palabra «Anulada» y la
                  // factura que sigue viva.
                  <tr key={v.orderId} className={v.anulada ? "bg-hundida/60 text-muted-foreground" : ""}>
                    <td className="tabular px-5 py-3 text-muted-foreground">
                      {v.createdAt.toLocaleDateString("es-AR", { timeZone: ZONA })}
                      <span className="block text-sm">
                        {v.createdAt.toLocaleTimeString("es-AR", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: ZONA,
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
                    <td className="px-5 py-3 text-right">
                      <span className={`tabular font-semibold ${v.anulada ? "line-through decoration-2" : ""}`}>
                        {formatearMonto(Number(v.total))}
                      </span>
                      {v.medioPago && !v.anulada && (
                        <span className="block text-sm text-muted-foreground">
                          {MEDIOS[v.medioPago] ?? v.medioPago}
                        </span>
                      )}
                      {v.anulada && (
                        <span className="block text-sm">
                          <span className="estado-problema font-semibold">Anulada</span>
                          {[
                            v.anuladaPor,
                            // Con fecha si no es del día de la venta: una del
                            // lunes anulada el sábado parecía anulada en el acto.
                            v.anuladaAt &&
                              (diaArgentino(v.anuladaAt) === diaArgentino(v.createdAt)
                                ? v.anuladaAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: ZONA })
                                : v.anuladaAt.toLocaleString("es-AR", {
                                    day: "numeric",
                                    month: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: ZONA,
                                  })),
                            v.motivo,
                          ]
                            .filter(Boolean)
                            .map((t) => ` · ${t}`)
                            .join("")}
                          {v.facturaViva && (
                            <span className="estado-problema block font-semibold">factura sin nota de crédito</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Papeles venta={v} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-linea @4xl:hidden">
            {emitido.map((v) => (
              <li key={v.orderId} className="px-4 py-3">
                <p className="flex items-baseline gap-3">
                  <Link
                    href={`/admin/pedidos/${v.orderId}`}
                    className="tabular whitespace-nowrap font-medium hover:text-brand-orange hover:underline"
                  >
                    {v.numero}
                  </Link>
                  {/* El número que trae escrito el cliente cuando la venta
                      se cobró sin internet: es lo que se busca con cola. */}
                  {v.numeroProvisorio && (
                    <span className="tabular min-w-0 truncate text-sm text-muted-foreground">
                      ticket {v.numeroProvisorio}
                    </span>
                  )}
                  <span className="tabular ml-auto whitespace-nowrap font-semibold">
                    {formatearMonto(Number(v.total))}
                  </span>
                </p>
                {/* Con qué pagó va a la vista: efectivo o transferencia es
                    lo primero que se mira para que no falte plata. */}
                <p className="mt-0.5 flex items-baseline gap-3 text-sm text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">
                    {/* Con el día: la lista es del mes entero, y la hora sola
                        no ubica una venta del 3 frente a una del 17. */}
                    <span className="tabular">
                      {v.createdAt.toLocaleDateString("es-AR", {
                        day: "2-digit",
                        month: "2-digit",
                        timeZone: ZONA,
                      })}{" "}
                      {v.createdAt.toLocaleTimeString("es-AR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: ZONA,
                      })}
                    </span>
                    {" · "}
                    {v.cliente}
                    {v.operadora && ` · ${v.operadora}`}
                    {v.sucursal && ` · ${v.sucursal}`}
                  </span>
                  {v.medioPago && (
                    <span className="shrink-0 whitespace-nowrap">
                      {MEDIOS[v.medioPago] ?? v.medioPago}
                    </span>
                  )}
                </p>
                <div className="mt-1">
                  <Papeles venta={v} />
                </div>
              </li>
            ))}
          </ul>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * El ticket y la factura de una venta: la usan la tabla y la lista del
 * teléfono, para que no se desfasen.
 */
function Papeles({
  venta: v,
}: {
  venta: {
    orderId: string;
    invoiceId: string | null;
    invoiceTipo: string | null;
    invoicePuntoVenta: number | null;
    invoiceNumero: number | null;
  };
}) {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm md:justify-end md:gap-x-3">
      <a
        href={`/ticket/${v.orderId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center hover:text-brand-orange hover:underline md:min-h-0"
      >
        Ticket
      </a>
      {v.invoiceId && (
        <Link
          href={`/admin/facturacion/${v.invoiceId}`}
          className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap hover:text-brand-orange hover:underline md:min-h-0"
        >
          {nombreComprobante(v.invoiceTipo as TipoComprobante)}{" "}
          <span className="tabular">
            {String(v.invoicePuntoVenta).padStart(4, "0")}-
            {String(v.invoiceNumero).padStart(8, "0")}
          </span>
        </Link>
      )}
    </span>
  );
}
