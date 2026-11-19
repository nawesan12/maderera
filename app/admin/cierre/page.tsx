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
import { fechaCorta, formatearMonto } from "@/lib/formato";
import { ExportarAsientos } from "./exportar-asientos";
import { SelectorDeMes } from "@/components/admin/selector-de-mes";

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

  const [resumen, pendientes, asientos, asientosB] = await Promise.all([
    resumenDelMes(periodo.clave),
    pendientesDelCierre(periodo.clave),
    asientosDelPeriodo(periodo.clave),
    asientosDelPeriodo(periodo.clave, "negro"),
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

          <ExportarAsientos periodo={periodo.clave} rotos={rotos.length} />
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
        se compara con el mes anterior entero. Con renglones vendidos sin
        costo cargado, el costo está corto y el resultado inflado: se dice al
        lado del número.
      */}
      <section className="grid gap-3 lg:grid-cols-2">
        <article className="tarjeta p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Resultado del mes</h2>
            {resultado.variacion !== null && (
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
          <p
            className={`tabular mt-2 text-[34px] font-bold leading-none tracking-[-0.03em] ${
              resultado.actual.resultado < 0 ? "text-saldo-debe" : ""
            }`}
          >
            {formatearMonto(resultado.actual.resultado)}
          </p>
          <dl className="mt-4 space-y-1.5 text-base">
            <Linea titulo="Vendido sin IVA" valor={resultado.actual.ventasNetas} />
            <Linea titulo="Costo de lo vendido" valor={-resultado.actual.costo} />
            <Linea titulo="Gastos" valor={-resultado.actual.gastos} />
            <Linea
              titulo={`Resultado de ${etiquetaAnterior}`}
              valor={resultado.anterior.resultado}
              apagado
            />
          </dl>
          {resultado.actual.lineasSinCosto > 0 && (
            <p className="estado-problema mt-3 text-base font-medium">
              {resultado.actual.lineasSinCosto === 1
                ? "1 renglón vendido sin costo"
                : `${resultado.actual.lineasSinCosto} renglones vendidos sin costo`}
            </p>
          )}
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
            {resumen.iva.saldoTecnico > 0.005 && (
              <div className="contents">
                <dt>Saldo técnico</dt>
                <dd className="text-right">{formatearMonto(resumen.iva.saldoTecnico)}</dd>
              </div>
            )}
            {resumen.iva.saldoLibre > 0.005 && (
              <div className="contents">
                <dt>Libre disponibilidad</dt>
                <dd className="text-right">{formatearMonto(resumen.iva.saldoLibre)}</dd>
              </div>
            )}
          </dl>
        </article>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Tarjeta
          titulo="Ventas netas"
          valor={resumen.ventas.neto}
          detalle={`${resumen.ventas.cantidad} comprobantes`}
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
            valor={-resumen.retencionesSufridas.total}
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
            <h2 className="text-base font-semibold">Circuito B</h2>
            <p className="tabular text-sm text-muted-foreground">
              {asientosB.length === 1 ? "1 asiento" : `${asientosB.length} asientos`}
            </p>
          </div>
          <a
            href={`/admin/cierre/exportar?periodo=${periodo.clave}&circuito=negro`}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-background"
          >
            <Download className="h-4 w-4" />
            Asientos B
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
}: {
  titulo: string;
  valor: number;
  apagado?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-3 ${apagado ? "text-muted-foreground" : ""}`}>
      <dt>{titulo}</dt>
      <dd className="tabular font-medium">{formatearMonto(valor)}</dd>
    </div>
  );
}
