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

  const [resumen, pendientes, asientos] = await Promise.all([
    resumenDelMes(periodo.desde, periodo.hasta),
    pendientesDelCierre(periodo.desde, periodo.hasta),
    asientosDelPeriodo(periodo.desde, periodo.hasta),
  ]);

  const etiqueta = new Date(periodo.anio, periodo.mes - 1, 1).toLocaleDateString(
    "es-AR",
    { month: "long", year: "numeric" },
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
          <form className="flex gap-2">
            <input
              type="month"
              name="periodo"
              defaultValue={periodo.clave}
              className="tabular h-11 rounded-lg border border-linea bg-card px-3 text-base"
            />
            <button className="h-11 rounded-lg border border-linea px-4 text-base font-medium">
              Ver
            </button>
          </form>

          <ExportarAsientos periodo={periodo.clave} rotos={rotos.length} />
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
              El debe y el haber tienen que dar igual. Si se exporta así, el
              sistema del estudio rechaza el archivo entero.
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
            <p className="text-sm">
              No bloquea nada. Son las cosas que, si quedan así, el estudio va a
              preguntar.
            </p>
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

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <Tarjeta
          titulo="Posición de IVA"
          valor={resumen.posicionIva}
          detalle={
            resumen.posicionIva >= 0
              ? "a depositar"
              : "saldo a favor para el mes que viene"
          }
          destacado
        />
      </section>

      <section className="tarjeta overflow-hidden">
        <header className="border-b border-linea px-5 py-3.5">
          <h2 className="text-base font-semibold">Impuestos del período</h2>
        </header>
        <dl className="divide-y divide-linea">
          <Renglon
            titulo="IVA débito fiscal"
            detalle="Lo que se le cobró a los clientes"
            valor={resumen.ventas.iva}
          />
          <Renglon
            titulo="IVA crédito fiscal computable"
            detalle="Solo los comprobantes que discriminan IVA: la B y la C no dan crédito"
            valor={-resumen.compras.iva}
          />
          <Renglon
            titulo="Retenciones practicadas"
            detalle={`${resumen.retencionesPracticadas.cantidad} certificados entregados · se depositan aparte`}
            valor={resumen.retencionesPracticadas.total}
          />
          <Renglon
            titulo="Retenciones sufridas"
            detalle={`${resumen.retencionesSufridas.cantidad} certificados recibidos · se descuentan del impuesto`}
            valor={-resumen.retencionesSufridas.total}
          />
        </dl>
      </section>

      <p className="text-base text-muted-foreground">
        La exportación trae los asientos de ventas, compras, pagos a proveedores
        y gastos, con código y nombre de cuenta para que el estudio los remapee
        al plan que usa. El libro diario, el mayor y el balance los lleva el
        estudio: acá se construye lo que necesita para importar.
      </p>
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
      <div className="min-w-0 flex-1">
        <dt className="text-base">{titulo}</dt>
        <dd className="text-sm text-muted-foreground">{detalle}</dd>
      </div>
      <dd className="tabular shrink-0 text-base font-semibold">
        {formatearMonto(valor)}
      </dd>
    </div>
  );
}
