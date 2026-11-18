import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { GraficoVentas } from "@/components/admin/grafico-ventas";
import { moneda, plural } from "@/components/admin/formato";
import {
  metricasDelResumen,
  numerosDelDueno,
  ventasPorSucursal,
} from "@/lib/dal/admin/resumen";
import type { resolverPeriodo } from "@/lib/periodos";

/**
 * Los números del negocio: lo que el dueño de una maderera pregunta cuando
 * abre el panel.
 *
 * Hasta el 17/11 eran presupuestos abiertos, productos a reponer y cantidad de
 * clientes: números del vendedor y del depósito, que ya tienen su lugar en
 * «Para hoy». El dueño quiere saber cuánto le deben, cuánto debe, qué cheques
 * vencen, cuánta plata hay y cuánto gana; y después, cuánto vendió. Los cinco
 * primeros los arma Go (backend/internal/reportes/dueno.go) con las mismas
 * cuentas que su pantalla, y cada tarjeta lleva a esa pantalla.
 *
 * **Vive aparte del resumen y se carga adentro de un `<Suspense>`**: es el
 * bloque caro y no frena el dibujo de lo demás.
 *
 * **Solo lo ve administración**, y esa es una decisión de negocio.
 */
export async function NumerosDelNegocio({
  periodo,
}: {
  periodo: ReturnType<typeof resolverPeriodo>;
}) {
  const [n, metricas, ventas] = await Promise.all([
    numerosDelDueno(),
    metricasDelResumen(periodo),
    ventasPorSucursal(),
  ]);

  const { meDeben, debo, cheques, plataHoy: plata, ganancia } = n;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tarjeta
          titulo="Me deben"
          valor={meDeben.total}
          href="/admin/clientes"
          alerta={meDeben.vencido > 0}
          renglones={[
            meDeben.vencido > 0
              ? `${moneda.format(meDeben.vencido)} vencido · ${plural(meDeben.clientesConVencido, "cliente")}`
              : "Nada vencido",
            plural(meDeben.clientes, "cliente con deuda", "clientes con deuda"),
          ]}
        />
        <Tarjeta
          titulo="Debo"
          valor={debo.total}
          href="/admin/compras/facturas"
          alerta={debo.vencido > 0}
          renglones={[
            debo.vencido > 0
              ? `${moneda.format(debo.vencido)} vencido · ${plural(debo.facturasVencidas, "factura")}`
              : "Nada vencido",
            debo.estaSemana > 0
              ? `${moneda.format(debo.estaSemana)} vence esta semana`
              : "Nada vence esta semana",
          ]}
        />
        <Tarjeta
          titulo="Cheques de la semana"
          valor={cheques.aCobrar.total - cheques.aCubrir.total}
          href="/admin/cheques"
          alerta={cheques.aCubrir.total > 0}
          renglones={[
            `A cobrar ${moneda.format(cheques.aCobrar.total)} · ${plural(cheques.aCobrar.cantidad, "cheque")}`,
            `A cubrir ${moneda.format(cheques.aCubrir.total)} · ${plural(cheques.aCubrir.cantidad, "cheque")}`,
          ]}
        />
        <Tarjeta
          titulo="Plata hoy"
          valor={plata.total}
          href="/admin/caja"
          renglones={[
            ...(plata.cajas.length > 0
              ? plata.cajas.map(
                  (c) => `Caja ${c.sucursal} ${moneda.format(c.esperado)}`,
                )
              : ["Sin cajas abiertas"]),
            `Banco ${moneda.format(plata.banco)} · Mercado Pago ${moneda.format(plata.mercadoPago)}`,
            ...(plata.tarjetas > 0
              ? [`Tarjetas a acreditar ${moneda.format(plata.tarjetas)}`]
              : []),
            `Cheques en cartera ${moneda.format(plata.cheques.total)}`,
          ]}
        />
        <Tarjeta
          titulo="Ganancia del mes"
          valor={ganancia.actual.resultado}
          href="/admin/cierre"
          variacion={ganancia.variacion}
          alerta={ganancia.actual.resultado < 0}
          renglones={[
            `Ventas ${moneda.format(ganancia.actual.ventasNetas)} − costo ${moneda.format(ganancia.actual.costo)} − gastos ${moneda.format(ganancia.actual.gastos)}`,
            `Mismo día del mes pasado ${moneda.format(ganancia.anterior.resultado)}`,
            // Sin costo cargado el renglón suma venta y no costo: la ganancia
            // sale inflada, y eso hay que verlo junto al número.
            ...(ganancia.actual.lineasSinCosto > 0
              ? [
                  `${plural(ganancia.actual.lineasSinCosto, "renglón vendido", "renglones vendidos")} sin costo`,
                ]
              : []),
          ]}
        />
        <Tarjeta
          titulo={`Vendido · ${periodo.etiqueta.toLowerCase()}`}
          valor={metricas.ventasMes}
          href="/admin/reportes"
          variacion={metricas.variacionVentas}
          renglones={[
            plural(metricas.pedidosSinEntregar, "pedido sin entregar", "pedidos sin entregar"),
          ]}
        />
      </div>

      <section className="tarjeta p-5">
        <h2 className="mb-4 text-lg font-semibold">Ventas por sucursal</h2>
        <GraficoVentas datos={ventas} />
      </section>
    </div>
  );
}

/**
 * Una pregunta del dueño: el número grande y, abajo, el desglose que sigue.
 *
 * La tarjeta entera es el enlace a la pantalla que explica el número. El
 * número negativo se pinta, y con `alerta` el primer renglón (lo vencido, lo
 * que hay que cubrir): es lo que hay que mirar primero.
 */
function Tarjeta({
  titulo,
  valor,
  href,
  renglones,
  variacion,
  alerta = false,
}: {
  titulo: string;
  valor: number;
  href: string;
  renglones: string[];
  variacion?: number | null;
  alerta?: boolean;
}) {
  const Flecha =
    variacion == null || variacion === 0
      ? Minus
      : variacion > 0
        ? ArrowUpRight
        : ArrowDownRight;
  return (
    <Link
      href={href}
      className="tarjeta tarjeta-activa flex flex-col gap-3 p-5"
    >
      <h3 className="text-base font-semibold text-texto-2">{titulo}</h3>
      <p
        className={`tabular text-[34px] font-bold leading-none tracking-[-0.03em] ${
          valor < 0 ? "text-saldo-debe" : "text-foreground"
        }`}
      >
        {moneda.format(valor)}
      </p>
      {variacion != null && (
        <p className="flex items-center gap-1 text-base text-texto-2">
          <Flecha
            className={`h-5 w-5 ${variacion > 0 ? "text-saldo-favor" : variacion < 0 ? "text-saldo-debe" : ""}`}
            aria-hidden="true"
          />
          <span className="tabular">
            {variacion > 0 ? "+" : ""}
            {variacion.toLocaleString("es-AR")}%
          </span>
        </p>
      )}
      <ul className="mt-auto space-y-1 text-base text-texto-2">
        {renglones.map((r, i) => (
          <li
            key={r}
            className={`tabular ${i === 0 && alerta ? "estado-problema font-semibold" : ""}`}
          >
            {r}
          </li>
        ))}
      </ul>
    </Link>
  );
}
