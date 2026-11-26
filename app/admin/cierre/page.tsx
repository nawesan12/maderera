import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { requireStaffRole } from "@/lib/dal/session";
import {
  asientosDelPeriodo,
  asientosDesbalanceados,
  pendientesDelCierre,
  resumenDelMes,
} from "@/lib/dal/admin/cierre-mensual";
import { leerPeriodoMensual } from "@/lib/periodos";
import { fechaCorta, formatearMonto, hoyEnArgentina, plural } from "@/lib/formato";
import { ExportarAsientos } from "./exportar-asientos";
import { SelectorDeMes } from "@/components/admin/selector-de-mes";
import { CerrarMes } from "./cerrar-mes";
import { nombreDelCircuito } from "@/lib/dal/circuito";
import { etiquetasDelCircuito, rotuloDelCircuito } from "@/lib/circuito";

export const metadata: Metadata = { title: "Cierre del mes" };

/**
 * El cierre del mes.
 *
 * Junta en una pantalla lo que estaba repartido en cinco y agrega lo único que
 * el sistema no podía dar: los asientos para que el estudio los importe.
 *
 * **Lo que no hace, dicho de frente:** libro diario, mayor, balance y plan de
 * cuentas. Eso es contabilidad registrada y la lleva el estudio con su sistema;
 * lo que faltaba era que pudiera importar sin volver a tipear.
 */
export default async function CierrePage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  await requireStaffRole("admin");

  const { periodo: crudo } = await searchParams;
  const periodo = leerPeriodoMensual(crudo, new Date());

  const [resumen, pendientes, asientos, asientosB, circuito] = await Promise.all([
    resumenDelMes(periodo.clave),
    pendientesDelCierre(periodo.clave),
    asientosDelPeriodo(periodo.clave),
    asientosDelPeriodo(periodo.clave, "negro"),
    nombreDelCircuito(),
  ]);

  const etiqueta = new Date(periodo.anio, periodo.mes - 1, 1).toLocaleDateString(
    "es-AR",
    { month: "long", year: "numeric" },
  );

  const resultado = resumen.resultado;
  const etiquetaAnterior = new Date(periodo.anio, periodo.mes - 2, 1).toLocaleDateString(
    "es-AR",
    { month: "long" },
  );

  // Debería ser siempre cero: un asiento que no cierra hace que el estudio
  // rechace el archivo entero.
  const rotos = asientosDesbalanceados(asientos);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">
            Cierre del mes
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            {etiqueta} · {asientos.length} asientos
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <SelectorDeMes actual={periodo.clave} etiqueta="Mes del cierre" />

          <CerrarMes
            periodo={periodo.clave}
            nombre={new Date(periodo.anio, periodo.mes - 1, 1).toLocaleDateString("es-AR", { month: "long" })}
            cerrado={resumen.cerrado.cerrado}
            cuando={
              resumen.cerrado.at
                ? `${fechaCorta.format(new Date(resumen.cerrado.at))}${resumen.cerrado.por ? ` · ${resumen.cerrado.por}` : ""}`
                : null
            }
            terminado={periodo.clave < hoyEnArgentina().slice(0, 7)}
          />
          <ExportarAsientos
            periodo={periodo.clave}
            rotos={rotos.length}
            secundario={!resumen.cerrado.cerrado && periodo.clave < hoyEnArgentina().slice(0, 7)}
          />
          {/* Lo que pide el contador además de los asientos: quién debe y
              desde cuándo, y a quién se le debe. Son de hoy, no del mes. */}
          <a
            href="/admin/cierre/deudores"
            className="tarjeta-hundida inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-base font-medium"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Deudores
          </a>
          <a
            href="/admin/cierre/cuentas-a-pagar"
            className="tarjeta-hundida inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-base font-medium"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Cuentas a pagar
          </a>
        </div>
      </header>

      {rotos.length > 0 && (
        <section className="tarjeta overflow-hidden border-[var(--estado-borde)]">
          <header className="estado-problema border-b border-linea bg-[var(--estado-fondo)] px-5 py-3.5">
            <h2 className="text-base font-semibold">
              <AlertTriangle className="mr-2 inline h-4 w-4" />
              {rotos.length === 1
                ? "Un asiento no cierra"
                : `${rotos.length} asientos no cierran`}
            </h2>
            <p className="text-sm">
              Si se exporta así, el estudio rechaza el archivo entero.
            </p>
          </header>
          <ul className="divide-y divide-linea">
            {rotos.map((asiento, i) => {
              const debe = asiento.renglones.reduce((t, r) => t + r.debe, 0);
              const haber = asiento.renglones.reduce((t, r) => t + r.haber, 0);
              return (
                <li
                  key={`${asiento.concepto}-${i}`}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3.5"
                >
                  <p className="min-w-0 flex-1 text-base font-medium">
                    {asiento.concepto}
                  </p>
                  <p className="tabular text-sm text-muted-foreground">
                    {fechaCorta.format(asiento.fecha)}
                  </p>
                  <p className="tabular text-sm text-muted-foreground">
                    Debe {formatearMonto(debe)} · Haber {formatearMonto(haber)}
                  </p>
                  <p className="tabular estado-problema text-base font-semibold">
                    Diferencia {formatearMonto(debe - haber)}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {pendientes.length > 0 && (
        <section className="tarjeta overflow-hidden border-[var(--estado-borde)]">
          <header className="estado-espera border-b border-linea bg-[var(--estado-fondo)] px-5 py-3.5">
            <h2 className="text-base font-semibold">
              Antes de cerrar conviene resolver esto
            </h2>
          </header>
          <ul className="divide-y divide-linea">
            {pendientes.map((p) => (
              <li key={p.clave} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold">
                    {p.cantidad} · {p.titulo}
                  </p>
                  <p className="text-sm text-muted-foreground">{p.detalle}</p>
                </div>
                <Link
                  href={p.donde}
                  className="inline-flex h-10 shrink-0 items-center rounded-lg border border-linea px-3.5 text-sm font-medium hover:bg-hundida"
                >
                  Resolver
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        El resultado del mes junto a la posición de IVA: son las dos
        preguntas del dueño al cerrar —cuánto gané y cuánto tengo que pagar—.
        Ventas netas sin IVA y su costo salen de los pedidos (el mismo cálculo
        que Reportes y que el inicio), los gastos de lo anotado en Gastos;
        se compara con el mes anterior entero. Lo vendido sin costo cargado
        queda afuera, en su propio renglón, igual que en el margen de
        Reportes: los renglones suman el resultado.

        Debajo de lo vendido, la misma cifra partida según su factura (con
        factura, ticket interno y sin factura), de la misma base: suma exacto.
        «Facturado neto», más abajo, es lo fiscal del mes: va por la fecha de
        la factura y lleva el envío.
      */}
      <section className="grid gap-3 lg:grid-cols-2">
        <article className="tarjeta p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Resultado del mes</h2>
            {resultado.variacion !== null && !resultado.actual.sinCostosCargados && (
              <span
                className={`tabular text-base font-semibold ${
                  resultado.variacion >= 0 ? "text-saldo-favor" : "text-saldo-debe"
                }`}
              >
                {resultado.variacion > 0 ? "+" : ""}
                {resultado.variacion.toLocaleString("es-AR")}% vs. {etiquetaAnterior}
              </span>
            )}
          </div>
          {/* Con más de la mitad de lo vendido sin costo, la cifra no es el
              resultado del mes: va el motivo en grande y la cifra abajo. */}
          {resultado.actual.sinCostosCargados ? (
            <p className="estado-problema mt-2 text-[24px] font-bold leading-none tracking-[-0.03em]">
              {resultado.actual.costo > 0 ? "Faltan costos" : "Sin costos cargados"}
            </p>
          ) : (
            <p
              className={`tabular mt-2 text-[34px] font-bold leading-none tracking-[-0.03em] ${
                resultado.actual.resultado < 0 ? "text-saldo-debe" : ""
              }`}
            >
              {formatearMonto(resultado.actual.resultado)}
            </p>
          )}
          <dl className="mt-4 space-y-1.5 text-base">
            <Linea
              titulo={resultado.actual.conDescuento ? "Vendido sin IVA ni descuentos" : "Vendido sin IVA"}
              valor={resultado.actual.ventasNetas}
            />
            {resumen.vendido.total !== 0 && (
              <div className="pl-3 text-sm text-muted-foreground">
                <dt className="sr-only">Según su factura</dt>
                <dd className="flex flex-wrap gap-x-3 [font-variant-numeric:tabular-nums]">
                {resumen.vendido.facturado.cantidad > 0 && (
                  <span>con factura {formatearMonto(resumen.vendido.facturado.total)}</span>
                )}
                {resumen.vendido.sinCae.cantidad > 0 && (
                  <span className="estado-espera font-medium">
                    sin CAE {formatearMonto(resumen.vendido.sinCae.total)}
                  </span>
                )}
                {resumen.vendido.interno.cantidad > 0 && (
                  <span>interno {formatearMonto(resumen.vendido.interno.total)}</span>
                )}
                {resumen.vendido.sinFactura.cantidad > 0 && (
                  <span className="estado-problema font-medium">
                    sin factura {formatearMonto(resumen.vendido.sinFactura.total)}
                  </span>
                )}
                </dd>
              </div>
            )}
            {resultado.actual.ventasSinCosto > 0 && (
              <Linea
                titulo={`Sin costo cargado · ${plural(resultado.actual.lineasSinCosto, "renglón", "renglones")}`}
                valor={-resultado.actual.ventasSinCosto}
                href="/admin/reportes?corte=producto#ventas"
                problema
              />
            )}
            <Linea titulo="Costo de lo vendido" valor={-resultado.actual.costo} />
            {resultado.actual.envios > 0 && (
              <Linea titulo="Envíos cobrados sin IVA" valor={resultado.actual.envios} />
            )}
            <Linea titulo="Gastos" valor={-resultado.actual.gastos} />
            {resultado.actual.sinCostosCargados && (
              <Linea titulo="Resultado" valor={resultado.actual.resultado} />
            )}
            <Linea
              titulo={`Resultado de ${etiquetaAnterior}`}
              valor={resultado.anterior.resultado}
              apagado
            />
          </dl>
        </article>

        {/* Lo primero que se mira es cuánto hay que depositar: grande. Si no
            hay nada, el saldo a favor que pasa al mes que viene. Abajo, más
            chico, de dónde sale. */}
        <article className="tarjeta p-5">
          <h2 className="text-lg font-semibold">IVA</h2>
          {/* Sin los saldos de la última DDJJ el número no parte de lo
              presentado: no se muestra uno inventado. */}
          {resumen.iva.sinArranque ? (
            <Link
              href="/admin/arca/configuracion"
              className="mt-2 inline-block text-base font-medium text-acento-texto hover:underline"
            >
              Falta la última DDJJ
            </Link>
          ) : (
            <>
              <p
                className={`tabular mt-2 text-[34px] font-bold leading-none tracking-[-0.03em] ${
                  resumen.iva.aDepositar > 0 ? "text-saldo-debe" : "text-saldo-favor"
                }`}
              >
                {formatearMonto(
                  resumen.iva.aDepositar > 0
                    ? resumen.iva.aDepositar
                    : resumen.iva.saldoTecnico + resumen.iva.saldoLibre,
                )}
              </p>
              <p className="mt-2 text-base text-muted-foreground">
                {resumen.iva.aDepositar > 0 ? "A depositar" : "Saldo a favor"}
              </p>
            </>
          )}
          <dl className="tabular mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {(
              [
                ["Débito", resumen.iva.debito],
                ["Crédito", -resumen.iva.credito],
                ["Saldo técnico anterior", -resumen.iva.saldoTecnicoAnterior],
                ["Percepciones", -resumen.iva.percepciones],
                ["Retenciones", -resumen.iva.retenciones],
                ["Libre disponibilidad anterior", -resumen.iva.saldoLibreAnterior],
              ] as const
            )
              .filter(([, v]) => Math.abs(v) > 0.005)
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt>{k}</dt>
                  <dd className="text-right">{formatearMonto(v)}</dd>
                </div>
              ))}
            {/* Lo que queda a favor va con el mismo signo que el crédito de
                arriba y dice a favor de quién: en positivo se leía como IVA a
                pagar (H239). */}
            {resumen.iva.saldoTecnico > 0.005 && (
              <div className="contents font-medium text-saldo-favor">
                <dt>Saldo técnico a favor</dt>
                <dd className="text-right">{formatearMonto(-resumen.iva.saldoTecnico)}</dd>
              </div>
            )}
            {resumen.iva.saldoLibre > 0.005 && (
              <div className="contents font-medium text-saldo-favor">
                <dt>Libre disponibilidad a favor</dt>
                <dd className="text-right">{formatearMonto(-resumen.iva.saldoLibre)}</dd>
              </div>
            )}
          </dl>
        </article>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {/* Lo facturado, no lo vendido: con el mismo nombre que el
            «Vendido sin IVA» de arriba, «Ventas netas $0» parecía un error.
            Lo vendido sin factura va arriba, partiendo lo vendido: acá se
            sumaba con una cifra de otra base y no cerraba. */}
        <Tarjeta
          titulo="Facturado neto"
          valor={resumen.ventas.neto}
          detalle={plural(resumen.ventas.cantidad, "comprobante")}
          href={`/admin/arca/libro-iva?periodo=${periodo.clave}`}
        />
        <Tarjeta
          titulo="Compras netas"
          valor={resumen.compras.neto}
          detalle={`${resumen.compras.cantidad} comprobantes`}
          href={`/admin/arca/libro-iva-compras?periodo=${periodo.clave}`}
        />
        <Tarjeta
          titulo="Gastos"
          valor={resumen.gastos.total}
          detalle={`${resumen.gastos.cantidad} anotados`}
          href={`/admin/compras/gastos?periodo=${periodo.clave}`}
        />
      </section>

      <section className="tarjeta overflow-hidden">
        <header className="border-b border-linea px-5 py-3.5">
          <h2 className="text-base font-semibold">Impuestos del período</h2>
        </header>
        <dl className="divide-y divide-linea">
          <Renglon
            titulo="IVA débito fiscal"
            detalle={`${resumen.ventas.cantidad} comprobantes`}
            valor={resumen.ventas.iva}
          />
          <Renglon
            titulo="IVA crédito fiscal computable"
            detalle={`${resumen.compras.cantidad} comprobantes`}
            valor={-resumen.compras.iva}
          />
          <Renglon
            titulo="Retenciones practicadas"
            detalle={`${resumen.retencionesPracticadas.cantidad} certificados entregados`}
            valor={resumen.retencionesPracticadas.total}
          />
          <Renglon
            titulo="Retenciones sufridas"
            detalle={`${resumen.retencionesSufridas.cantidad} certificados recibidos`}
            valor={-resumen.retencionesSufridas.total || 0}
          />
          <Renglon
            titulo="Percepciones de IIBB sufridas"
            detalle={plural(resumen.percepcionesIibb.cantidad, "factura de compra", "facturas de compra")}
            valor={-resumen.percepcionesIibb.total || 0}
          />
        </dl>
      </section>

      {/* La exportación trae los asientos de ventas, cobros (los recibos, sus
          anulaciones y las ventas facturadas que se cobraron en el mostrador
          o en línea), compras, pagos a proveedores y gastos, con código y
          nombre de cuenta para que el estudio los remapee al plan que usa. El
          libro diario, el mayor y el balance los lleva el estudio.

          Solo el circuito blanco: lo marcado «en negro» y la parte de los
          recibos que paga ventas sin factura van en otro archivo, abajo de
          todo y lejos del botón del estudio, con la B en el nombre. Que un
          día se mande el equivocado tiene que costar. */}
      {asientosB.length > 0 && (
        <section className="tarjeta-hundida flex flex-wrap items-center justify-between gap-3 rounded-xl px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{rotuloDelCircuito(circuito)}</h2>
            <p className="tabular text-sm text-muted-foreground">
              {asientosB.length === 1 ? "1 asiento" : `${asientosB.length} asientos`}
            </p>
          </div>
          <a
            href={`/admin/cierre/exportar?periodo=${periodo.clave}&circuito=negro`}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-background"
          >
            <Download className="h-4 w-4" />
            Asientos {circuito === "b" ? "B" : etiquetasDelCircuito(circuito).negro.toLowerCase()}
          </a>
        </section>
      )}
    </div>
  );
}

/**
 * Una cifra del cierre.
 *
 * Con `href` lleva a la lista de la que sale. Mirando el cierre la pregunta
 * que siempre viene después de un número es "¿de dónde salió?", y hasta acá
 * había que ir a buscar el libro a mano por el menú.
 */
function Tarjeta({
  titulo,
  valor,
  detalle,
  destacado,
  href,
}: {
  titulo: string;
  valor: number;
  detalle: string;
  destacado?: boolean;
  href?: string;
}) {
  const cuerpo = (
    <>
      <p className="text-sm text-muted-foreground">{titulo}</p>
      <p
        className={`tabular mt-0.5 text-2xl font-bold ${
          destacado
            ? valor >= 0
              ? "text-saldo-debe"
              : "text-saldo-favor"
            : ""
        }`}
      >
        {formatearMonto(valor)}
      </p>
      <p className="text-sm text-muted-foreground">{detalle}</p>
    </>
  );

  if (!href) return <article className="tarjeta p-4">{cuerpo}</article>;

  return (
    <Link
      href={href}
      className="tarjeta block p-4 transition-colors hover:border-brand-orange/40 hover:bg-hundida"
    >
      {cuerpo}
    </Link>
  );
}

function Renglon({
  titulo,
  detalle,
  valor,
}: {
  titulo: string;
  detalle: string;
  valor: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-3 px-5 py-3">
      {/* Un solo nivel adentro del <dl>: el detalle va dentro del <dt>. */}
      <dt className="min-w-0 flex-1">
        <span className="block text-base">{titulo}</span>
        <span className="block text-sm text-muted-foreground">{detalle}</span>
      </dt>
      <dd className="tabular shrink-0 text-base font-semibold">
        {formatearMonto(valor)}
      </dd>
    </div>
  );
}

function Linea({
  titulo,
  valor,
  apagado = false,
  problema = false,
  href,
}: {
  titulo: string;
  valor: number;
  apagado?: boolean;
  problema?: boolean;
  href?: string;
}) {
  return (
    <div
      className={`flex justify-between gap-3 ${apagado ? "text-muted-foreground" : ""} ${problema ? "estado-problema font-medium" : ""}`}
    >
      <dt>
        {href ? (
          <Link href={href} className="underline decoration-current/30 underline-offset-4 hover:decoration-current">
            {titulo}
          </Link>
        ) : (
          titulo
        )}
      </dt>
      <dd className="tabular font-medium">{formatearMonto(valor)}</dd>
    </div>
  );
}
