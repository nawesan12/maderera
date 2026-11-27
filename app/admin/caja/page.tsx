import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, ChevronDown, Store } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { sucursalesConCaja, turnosCerrados } from "@/lib/dal/admin/caja";
import {
  anulacionesPorPersona,
  cajasFuertes,
  efectivoFueraDeCaja,
  emitidoPorCaja,
  listarCajasFisicas,
  turnosParaAsignar,
  ventasSinCaja,
} from "@/lib/dal/admin/cajas-fisicas";
import { fechaHora, formatearImporte, formatearMonto, haceCuanto, hora, plural } from "@/lib/formato";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { SelectorDeMes } from "@/components/admin/selector-de-mes";
import { Vacio } from "@/components/admin/vacio";
import { leerPagina, Paginador, POR_PAGINA } from "@/components/admin/paginador";
import { leerPeriodoMensual } from "@/lib/periodos";
import { nombreComprobante, type TipoComprobante } from "@/lib/fiscal/comprobantes";
import { TOLERANCIA_ARQUEO } from "@/lib/mostrador/arqueo";
import { CajaFuerte } from "./caja-fuerte";
import { CajasFisicas } from "./cajas-fisicas";
import { FondoBase } from "./fondo-base";
import { FueraDeCaja } from "./fuera-de-caja";
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

/** Lo emitido se trae de a tantas ventas (M3S2-040: cortaba en 200 sin decirlo). */
const EMITIDOS_POR_PAGINA = 100;

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
  searchParams: Promise<{ periodo?: string; pagina?: string; emitidos?: string }>;
}) {
  await requireStaff();

  const { periodo: crudo, pagina: paginaCruda, emitidos: emitidosCruda } = await searchParams;
  const periodo = leerPeriodoMensual(crudo, new Date());
  const pagina = leerPagina(paginaCruda);
  const paginaEmitidos = leerPagina(emitidosCruda);

  // Las anulaciones del mes por quien las hizo, la que más anuló primero.
  // Las cuenta Go por la fecha de la anulación: sumarlas acá sobre lo
  // emitido, que llega cortado en 200 y por la fecha de la venta, perdía las
  // de la primera quincena.
  const [sucursales, turnosDelMes, cajas, sueltas, emitidoDelMes, anulaciones, fueraDeCaja, fuertes] = await Promise.all([
    sucursalesConCaja(),
    turnosCerrados(periodo.clave, pagina, POR_PAGINA),
    listarCajasFisicas(),
    ventasSinCaja(),
    emitidoPorCaja(periodo.clave, paginaEmitidos, EMITIDOS_POR_PAGINA),
    anulacionesPorPersona(periodo.clave),
    efectivoFueraDeCaja(periodo.clave),
    cajasFuertes(),
  ]);
  const emitido = emitidoDelMes.filas;
  const resumenEmitido = emitidoDelMes.resumen;
  const saldoFuerte = new Map(fuertes.map((f) => [f.branchId, f.saldo]));

  /*
   * Los turnos a los que se puede mandar una venta suelta. Se piden solo para
   * las sucursales que efectivamente tienen alguna colgada: sin ventas sueltas
   * —que es lo normal— esto no consulta nada.
   */
  const cerrados = turnosDelMes.filas;
  // Las sucursales con algo que mandar a un turno: ventas sueltas y recibos
  // cobrados en efectivo sin caja (M3S1-013).
  const conSueltas = [
    ...new Set([
      ...sueltas.map((v) => v.branchId),
      ...fueraDeCaja.flatMap((f) => (f.tipo === "recibo" && f.branchId ? [f.branchId] : [])),
    ]),
  ];
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
        <SelectorDeMes actual={periodo.clave} desde={turnosDelMes.primerMes} />
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
                  {formatearImporte(s.esperado)}
                  <span className="ml-2 text-base font-medium text-muted-foreground">
                    en efectivo
                  </span>
                </p>
              )}
              {/* El cambio que no se retira nunca. Ver `FondoBase`. */}
              <FondoBase branchId={s.id} valor={Number(s.fondoBase)} />
              <CajaFuerte branchId={s.id} saldo={saldoFuerte.get(s.id) ?? 0} />
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

      <FueraDeCaja renglones={fueraDeCaja} turnos={turnos} />

      <CajasFisicas
        cajas={cajas.map((c) => ({
          ...c,
          // Desvincular borra el latido: sin el último turno, una caja usada
          // decía «nunca se vinculó» (H243).
          cuando: c.ultimaVezAt
            ? `se conectó ${haceCuanto(new Date(c.ultimaVezAt))}`
            : c.ultimoTurnoAt
              ? `último turno ${haceCuanto(new Date(c.ultimoTurnoAt))}`
              : "sin vincular",
        }))}
        sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.nombre }))}
      />

      <section className="tarjeta overflow-hidden">
        <header className="tarjeta-cabecera grid grid-cols-[1fr_auto] items-baseline gap-x-4 px-5 py-3.5 sm:grid-cols-[1fr_repeat(3,8.5rem)_1.25rem]">
          <h2 className="text-base font-semibold">
            Turnos cerrados <span className="tabular ml-1 text-muted-foreground">{turnosDelMes.total}</span>
          </h2>
          {/* Sin turnos, el estado vacío y no los títulos de columnas que
              no tienen nada abajo (M2S1-118). */}
          {cerrados.length > 0 && (
            <>
              <span className="hidden text-right text-sm uppercase tracking-wide text-muted-foreground sm:block">Tendría que haber</span>
              <span className="hidden text-right text-sm uppercase tracking-wide text-muted-foreground sm:block">Contado</span>
              <span className="text-right text-sm uppercase tracking-wide text-muted-foreground">Diferencia</span>
            </>
          )}
        </header>

        {cerrados.length === 0 ? (
          <Vacio icono={Banknote} titulo="Ningún turno cerrado en el mes" />
        ) : (
          /*
           * Un renglón por turno, plegado: la sucursal y el puesto, quién y
           * cuándo, y los tres números del arqueo. Desplegado, la cuenta del
           * efectivo (fondo + ventas + otros − retiros − gastos = tendría que
           * haber) y el cierre Z. En el teléfono la tabla de antes se corría
           * de costado y, con cada cierre abierto, la página medía 14.000 px
           * (mes simulado, H238 y H242).
           */
          <ul className="divide-y divide-linea">
            {cerrados.map((t) => {
              const esperado = Number(t.esperado);
              // Lo contado, o lo corregido al abrir el turno siguiente («conté
              // mal», M2S3-002); lo de entonces queda a la vista abajo.
              const contado = t.contado === null ? null : Number(t.contadoCorregido ?? t.contado);
              const diferencia = contado === null ? null : contado - esperado;
              // Hasta un peso es «cierra», con los centavos al lado, como en el
              // mostrador: uno decía «sin diferencia» y el otro «−$ 0,60» del
              // mismo turno (M2S3-097).
              const cuadra = diferencia !== null && Math.abs(diferencia) <= TOLERANCIA_ARQUEO;
              const deOtros = t.movimientos.filter((m) => m.otroPuesto && m.monto > 0);
              const cuenta: [string, number][] = (
                [
                  ["Fondo", t.fondo],
                  ["Ventas en efectivo", t.ventas],
                  ["Otros ingresos", t.otrosIngresos],
                  ["Retiros", t.retiros],
                  ["Devoluciones", t.devoluciones],
                  ["Gastos", t.gastos],
                ] as [string, number][]
              ).filter(([titulo, v]) => v !== 0 || titulo === "Fondo");
              return (
                <li key={t.id}>
                  <details className="group">
                    <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 px-5 py-3 hover:bg-hundida/40 sm:grid-cols-[1fr_repeat(3,8.5rem)_1.25rem] [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0">
                        <span className="block truncate text-base font-medium">
                          {t.sucursal}
                          {t.puesto && <span className="codigo ml-1.5 text-sm text-muted-foreground">{t.puesto}</span>}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {t.abiertaPor} · {t.cerradaAt ? fechaHora.format(t.cerradaAt) : "—"}
                        </span>
                      </span>
                      <span className="tabular hidden text-right text-base sm:block">{formatearImporte(esperado)}</span>
                      <span className="tabular hidden text-right text-base sm:block">{formatearImporte(contado)}</span>
                      {/* Los mismos tokens de signo que usa la cuenta corriente
                          y el cierre del mostrador: falta en rojo, sobra en
                          verde, cuadra en gris. Con los centavos, si los hay:
                          redondeada, una diferencia de 40 centavos se leía
                          «-$ 0» (H164, H263, H363). */}
                      <span
                        className={`tabular text-right text-base font-semibold ${
                          diferencia === null
                            ? "text-muted-foreground"
                            : cuadra
                              ? "text-saldo-cero"
                              : diferencia < 0
                                ? "text-saldo-debe"
                                : "text-saldo-favor"
                        }`}
                      >
                        {diferencia === null
                          ? "—"
                          : Math.abs(diferencia) < 0.005
                            ? "cierra"
                            : cuadra
                              ? `cierra · ${formatearImporte(diferencia)}`
                              : formatearImporte(diferencia)}
                      </span>
                      <ChevronDown className="hidden h-4 w-4 self-center text-muted-foreground transition-transform group-open:rotate-180 sm:block" aria-hidden="true" />
                      {/* Lo que llegó de la cola después del arqueo y las
                          ventas sin conexión que pasaron lo libre o el límite
                          sin PIN: se ven sin desplegar. */}
                      {(t.tardios > 0 || t.bajoLista > 0 || t.creditoSinAutorizar > 0 || deOtros.length > 0) && (
                        <span className="col-span-full flex flex-wrap gap-x-4 text-sm">
                          {/* Lo que cobró otra persona y entró a este cajón: la
                              diferencia se explica sin preguntar (M2S2-041). */}
                          {deOtros.map((m) => (
                            <span key={m.id} className="tabular text-muted-foreground">
                              {m.motivo?.replace(/ — .*$/, "") ?? "Ingreso"} · {m.quien} · {formatearImporte(m.monto)}
                            </span>
                          ))}
                          {t.tardios > 0 && (
                            <span className={`tabular ${t.tardiosMonto < 0 ? "text-saldo-debe" : "text-muted-foreground"}`}>
                              {t.tardios} tarde · {formatearImporte(t.tardiosMonto)}
                            </span>
                          )}
                          {t.bajoLista > 0 && (
                            <span className="tabular font-semibold text-saldo-debe">
                              {t.bajoLista} sin conexión bajo la lista · {formatearImporte(t.bajoListaMonto)}
                            </span>
                          )}
                          {t.creditoSinAutorizar > 0 && (
                            <span className="tabular font-semibold text-saldo-debe">
                              {t.creditoSinAutorizar} sin conexión a cuenta pasado el límite · {formatearImporte(t.creditoSinAutorizarMonto)}
                            </span>
                          )}
                        </span>
                      )}
                    </summary>
                    <div className="tarjeta-hundida mx-5 mb-4 grid gap-4 rounded-xl p-4 sm:grid-cols-2">
                      <dl className="space-y-1 text-base">
                        {cuenta.map(([titulo, v]) => (
                          <div key={titulo} className="flex items-baseline justify-between gap-3">
                            <dt className="text-muted-foreground">{titulo}</dt>
                            <dd className="tabular">{formatearImporte(v)}</dd>
                          </div>
                        ))}
                        <div className="flex items-baseline justify-between gap-3 border-t border-linea pt-1 font-semibold">
                          <dt>Tendría que haber</dt>
                          <dd className="tabular">{formatearImporte(esperado)}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-muted-foreground">Contado</dt>
                          <dd className="tabular">{formatearImporte(t.contado === null ? null : Number(t.contado))}</dd>
                        </div>
                        {t.contadoCorregido != null && (
                          <div className="flex items-baseline justify-between gap-3">
                            <dt className="min-w-0 text-muted-foreground">
                              Corregido{t.corregidoPor && ` · ${t.corregidoPor}`}
                              {t.correccionMotivo && <span className="block text-sm">{t.correccionMotivo}</span>}
                            </dt>
                            <dd className="tabular">{formatearImporte(Number(t.contadoCorregido))}</dd>
                          </div>
                        )}
                        {t.notas && <p className="pt-1 text-sm text-muted-foreground">{t.notas}</p>}
                        {/* Cada ingreso, retiro y gasto, con quién lo cargó si no
                            fue quien abrió: «Otros ingresos $ 164.200» no se
                            podía rehacer desde acá (M2S3-044). */}
                        {t.movimientos.length > 0 && (
                          <ul className="mt-2 space-y-1 border-t border-linea pt-2 text-sm">
                            {t.movimientos.map((m) => (
                              <li
                                key={m.id}
                                className={`flex items-baseline justify-between gap-3 ${m.anulado ? "text-muted-foreground line-through" : ""}`}
                              >
                                <span className="min-w-0 truncate text-muted-foreground">
                                  {m.motivo ?? m.tipo}
                                  {m.otroPuesto && m.quien && ` · ${m.quien}`}
                                </span>
                                <span className="tabular shrink-0">{formatearImporte(m.monto)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </dl>
                      {t.cierre.length > 0 && (
                        <dl className="space-y-1 text-base">
                          {t.cierre.map((r) => (
                            <div
                              key={`${r.devolucion ? "dev-" : r.cobranza ? (r.dePedido ? "ped-" : "cob-") : ""}${r.medioPago}-${r.quien ?? ""}`}
                              className="flex items-baseline justify-between gap-3"
                            >
                              <dt className="min-w-0 text-muted-foreground">
                                {r.devolucion
                                  ? "Devolución · "
                                  : r.cobranza
                                    ? r.dePedido
                                      ? "Cobro de pedido · "
                                      : "Cobro de cuenta · "
                                    : r.medioPago === "cuenta_corriente"
                                      ? "A cuenta · "
                                      : ""}
                                {MEDIOS[r.medioPago] ?? r.medioPago}
                                {r.pedidos && ` · ${r.pedidos}`}
                                {r.quien && ` · ${r.quien}`} ({r.cantidad})
                              </dt>
                              <dd className="tabular shrink-0">{formatearImporte(r.total)}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
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
      {/* Plegado: son hasta 200 ventas, y abierto era lo que más alargaba la
          página en el teléfono (H242). Las anulaciones por persona se ven
          sin desplegar. */}
      <details className="tarjeta group @container overflow-hidden">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-3 border-b border-linea px-5 py-4 [&::-webkit-details-marker]:hidden">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold">
            Emitido en el mostrador
            {/* Las vendidas, sin las anuladas: «27 · $ 0» eran 27 anuladas
                (mes 23). La cantidad con las anuladas es la del paginador. */}
            <span className="tabular font-normal text-muted-foreground">{resumenEmitido.cantidad - resumenEmitido.anuladas}</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
          </h2>
          {/* Lo vendido en el mes, sin las anuladas, a la derecha; las
              anuladas en gris abajo: «68 · $ 1.250.422,60» parecía lo vendido
              y era lo anulado (M2S2-096). */}
          <span className={`tabular text-base font-semibold ${resumenEmitido.importe === 0 ? "text-muted-foreground" : ""}`}>
            {formatearImporte(resumenEmitido.importe)}
          </span>
          {/* Quién anuló y cuánto, sin contar a ojo: cinco anulaciones por
              semana de la misma persona se ven acá antes que en la bitácora. */}
          {anulaciones.length > 0 && (
            <ul className="flex basis-full flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground [font-variant-numeric:tabular-nums]">
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
        </summary>

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
                        {/* En 24 h, como todo el panel (lib/formato): el
                            `toLocaleTimeString` de antes decía «12:16 a. m.». */}
                        {hora.format(v.createdAt)}
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
                        {formatearImporte(Number(v.total))}
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
                                ? hora.format(v.anuladaAt)
                                : fechaHora.format(v.anuladaAt)),
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
                    {formatearImporte(Number(v.total))}
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
                      {hora.format(v.createdAt)}
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
          <div className="px-4">
            <Paginador
              pagina={paginaEmitidos}
              total={resumenEmitido.cantidad}
              porPagina={EMITIDOS_POR_PAGINA}
              nombre="emitidos"
              params={{ periodo: crudo, pagina: paginaCruda }}
            />
          </div>
          </>
        )}
      </details>
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
