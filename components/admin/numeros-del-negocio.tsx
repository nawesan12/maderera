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
import { MESES_PARA_EL_GRAFICO, mesesConVentas } from "@/lib/inicio";

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

  const { meDeben, debo, cheques, plataHoy: plata, ganancia, anuladas, controles, devoluciones } = n;
  const sinCobrar = meDeben.pedidosSinCobrar;
  const g = ganancia.actual;

  return (
    <div className="space-y-4">
      {/* items-start: cada tarjeta mide lo suyo. Estiradas a la altura de
          «Plata hoy», el detalle de las cortas quedaba lejos de su número. */}
      <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Tarjeta
          titulo="Me deben"
          valor={meDeben.total}
          href="/admin/clientes"
          renglones={[
            // Partido en dos, para que la cuenta corriente sea la misma cifra
            // que el encabezado de Clientes, a donde lleva la tarjeta.
            sinCobrar.cantidad > 0 && `Cuenta corriente ${moneda.format(meDeben.total - sinCobrar.total)}`,
            meDeben.vencido > 0 && {
              texto: `${moneda.format(meDeben.vencido)} vencido · ${plural(meDeben.clientesConVencido, "cliente")}`,
              problema: true,
            },
            // Mercadería entregada sin cobrar: es deuda desde que salió, y el
            // renglón lleva a la lista para reclamarla, del más viejo al más
            // nuevo.
            sinCobrar.cantidad > 0 && {
              texto: `${moneda.format(sinCobrar.total)} en ${plural(sinCobrar.cantidad, "pedido sin cobrar", "pedidos sin cobrar")}`,
              problema: true,
              href: "/admin/pedidos?ver=historial&estado=sin-cobrar&periodo=todo",
            },
            meDeben.vencido === 0 && sinCobrar.cantidad === 0 && "Nada vencido",
            meDeben.clientes > 0 && plural(meDeben.clientes, "cliente con deuda", "clientes con deuda"),
          ]}
        />
        <Tarjeta
          titulo="Debo"
          valor={debo.total}
          // El total es el libro de cada proveedor, el mismo de Pagos: la
          // tarjeta lleva ahí para que las dos cifras se vean iguales.
          href="/admin/compras/pagos"
          renglones={[
            debo.vencido > 0
              ? {
                  texto: `${moneda.format(debo.vencido)} vencido · ${plural(debo.facturasVencidas, "factura")}`,
                  problema: true,
                }
              : "Nada vencido",
            // Lo de la semana es la cifra con que el dueño decide los pagos:
            // va siempre. Lo que se debe sin factura (el saldo de ISIS, un
            // remito) explica por qué el total pasa a las facturas, pero
            // después de la migración casi todos los proveedores lo tienen:
            // si reemplazaba a la semana, la semana no se veía nunca más.
            debo.estaSemana > 0
              ? `${moneda.format(debo.estaSemana)} vence esta semana`
              : "Nada vence esta semana",
            ...(debo.sinFactura > 0 ? [`${moneda.format(debo.sinFactura)} sin factura`] : []),
          ]}
        />
        <Tarjeta
          titulo="Cheques de la semana"
          valor={cheques.aCobrar.total - cheques.aCubrir.total}
          href="/admin/cheques"
          renglones={[
            cheques.aCubrir.cantidad > 0 && {
              texto: `A cubrir ${moneda.format(cheques.aCubrir.total)} · ${plural(cheques.aCubrir.cantidad, "cheque")}`,
              problema: true,
            },
            cheques.aCobrar.cantidad > 0 &&
              `A cobrar ${moneda.format(cheques.aCobrar.total)} · ${plural(cheques.aCobrar.cantidad, "cheque")}`,
            cheques.aCobrar.cantidad === 0 && cheques.aCubrir.cantidad === 0 && "Nada esta semana",
          ]}
        />
        <Tarjeta
          titulo="Plata hoy"
          valor={plata.total}
          href="/admin/caja"
          renglones={[
            ...(plata.cajas.length > 0
              ? plata.cajas.map((c) =>
                  `Caja ${c.sucursal}${c.cerrada ? " · cerrada" : ""} ${moneda.format(c.esperado)}`,
                )
              : ["Sin cajas abiertas"]),
            plata.cajaFuerte !== 0 && `Caja fuerte ${moneda.format(plata.cajaFuerte)}`,
            // El banco es lo que se movió hoy, con su signo: lo que entró
            // menos lo que se pagó (Go, PlataHoy). Sumaba solo lo cobrado.
            (plata.bancoEntro !== 0 || plata.bancoSalio !== 0) &&
              `Banco hoy ${conSigno(plata.banco)}`,
            plata.bancoEntro !== 0 &&
              plata.bancoSalio !== 0 &&
              `Entró ${moneda.format(plata.bancoEntro)} · salió ${moneda.format(plata.bancoSalio)}`,
            plata.mercadoPago !== 0 && `Mercado Pago hoy ${moneda.format(plata.mercadoPago)}`,
            plata.cheques.cantidad > 0 && `Cheques en cartera ${moneda.format(plata.cheques.total)}`,
            plata.chequesDepositados.cantidad > 0 &&
              `Cheques depositados ${moneda.format(plata.chequesDepositados.total)}`,
            // De acá para abajo no suma al total: va separado, para que la
            // cuenta de arriba cierre a la vista.
            plata.tarjetas > 0 && {
              texto: `Tarjetas a acreditar ${moneda.format(plata.tarjetas)}`,
              aparte: true,
            },
            // La plata que salió del cajón por anulaciones es la que importa;
            // la de una venta con tarjeta anulada nunca entró.
            anuladas.cantidad > 0 && {
              texto:
                anuladas.devuelto > 0
                  ? `${plural(anuladas.cantidad, "anulada")} en 7 días · ${moneda.format(anuladas.devuelto)} devueltos`
                  : `${plural(anuladas.cantidad, "anulada")} en 7 días`,
              problema: anuladas.devuelto > 0,
              href: "/admin/bitacora?accion=anular&q=mostrador",
              aparte: true,
            },
            // Lleva a la lista de esas facturas, cada una con su nota de
            // crédito a un clic.
            anuladas.conFacturaViva > 0 && {
              texto: `${plural(anuladas.conFacturaViva, "anulada", "anuladas")} con factura viva`,
              problema: true,
              href: "/admin/facturacion?estado=anulada-viva",
              aparte: true,
            },
          ]}
        />
        <Tarjeta
          titulo="Ganancia del mes"
          // Con más de la mitad de lo vendido sin costo, la cifra no es la
          // ganancia: un «$ 0» en grande se leía como un mes perdido. Va
          // el motivo en grande y la cifra queda de dato.
          valor={g.sinCostosCargados ? "Sin costos cargados" : g.resultado}
          href="/admin/cierre"
          variacion={g.sinCostosCargados ? null : ganancia.variacion}
          renglones={[
            g.sinCostosCargados && `Resultado ${moneda.format(g.resultado)}`,
            // La fórmula en renglones: en uno solo se cortaba. Con la regla
            // del descuento la venta no es la de Reportes, y se llama
            // distinto.
            `${g.conDescuento ? "Vendido sin IVA ni descuentos" : "Vendido sin IVA"} ${moneda.format(g.ventasNetas)}`,
            // Lo vendido sin costo cargado queda afuera de la ganancia, como
            // del margen de Reportes, y se dice en plata: contado como
            // ganancia entera la inflaba.
            g.ventasSinCosto > 0 && {
              texto: `${moneda.format(g.ventasSinCosto)} vendidos sin costo, fuera de la ganancia`,
              problema: true,
              href: "/admin/reportes?corte=producto#ventas",
            },
            `Costo ${moneda.format(g.costo)} · gastos ${moneda.format(g.gastos)}`,
            ganancia.anterior.resultado !== 0 &&
              `Mismo día del mes pasado ${moneda.format(ganancia.anterior.resultado)}`,
          ]}
        />
        <Tarjeta
          // Con IVA, a diferencia del «Vendido sin IVA» de la Ganancia: con
          // el mismo nombre, las dos cifras parecían no cerrar.
          titulo={`Vendido con IVA · ${periodo.etiqueta.toLowerCase()}`}
          valor={metricas.ventasMes}
          href="/admin/reportes"
          variacion={metricas.variacionVentas}
          renglones={[
            metricas.pedidosSinEntregar > 0 &&
              plural(metricas.pedidosSinEntregar, "pedido sin entregar", "pedidos sin entregar"),
            // Las devoluciones del mes van a la vista: la plata que sale de
            // la caja por una devolución se controla mirándola.
            devoluciones.cantidad > 0 &&
              `Devoluciones del mes ${moneda.format(devoluciones.total)} · ${plural(devoluciones.cantidad, "devolución", "devoluciones")}`,
          ]}
        />
      </div>

      {controles.personas.length > 0 && <ElPersonal personas={controles.personas} />}

      <section className="tarjeta p-5">
        <h2 className="mb-4 text-lg font-semibold">Ventas por sucursal</h2>
        {/* Con menos de tres meses vendidos el gráfico son barras vacías:
            se muestra el mes en curso de cada sucursal, que es la cifra que
            se mira. */}
        {mesesConVentas(ventas) >= MESES_PARA_EL_GRAFICO ? (
          <GraficoVentas datos={ventas} />
        ) : (
          <MesPorSucursal mes={ventas[ventas.length - 1]} />
        )}
      </section>
    </div>
  );
}

type Persona = Awaited<ReturnType<typeof numerosDelDueno>>["controles"]["personas"][number];

/**
 * La plata del personal en los últimos siete días (T3): lo que cada uno dejó
 * de cobrar —y cuánto de eso firmó un admin—, sus ventas sin conexión bajo la
 * lista o a cuenta pasado el límite, lo que anuló (y cuánto sin PIN), sus
 * retiros tardíos o bajo la base, los recibos que anuló (en rojo si tenían
 * efectivo) y, de cada admin, cuántas autorizaciones
 * lleva firmadas: un PIN aprendido firma a su nombre, y así se ve. Estaba
 * solo en la bitácora, que el dueño no lee. En rojo lo que no firmó nadie;
 * cada nombre lleva a su bitácora.
 */
function ElPersonal({ personas }: { personas: Persona[] }) {
  return (
    <section className="tarjeta p-5">
      <h2 className="mb-3 text-lg font-semibold">El personal · 7 días</h2>
      <ul className="divide-y divide-linea-suave">
        {personas.map((p) => {
          const renglones: Renglon[] = [
            p.dejadoDeCobrar > 0 &&
              (p.autorizado > 0
                ? `Dejó de cobrar ${moneda.format(p.dejadoDeCobrar)} · ${moneda.format(p.autorizado)} con PIN`
                : `Dejó de cobrar ${moneda.format(p.dejadoDeCobrar)}`),
            p.sinConexion.cantidad > 0 && {
              texto: `${plural(p.sinConexion.cantidad, "venta sin conexión", "ventas sin conexión")} bajo la lista · ${moneda.format(p.sinConexion.total)}`,
              problema: true,
            },
            p.creditoSinAutorizar.cantidad > 0 && {
              texto: `${plural(p.creditoSinAutorizar.cantidad, "venta sin conexión", "ventas sin conexión")} a cuenta pasado el límite · ${moneda.format(p.creditoSinAutorizar.total)}`,
              problema: true,
            },
            p.anuladas.cantidad > 0 && {
              texto:
                `Anuló ${plural(p.anuladas.cantidad, "venta")} · ${moneda.format(p.anuladas.total)}` +
                (p.anuladasSinFirma.cantidad > 0 && p.anuladasSinFirma.cantidad < p.anuladas.cantidad
                  ? ` · ${p.anuladasSinFirma.cantidad} sin PIN`
                  : p.anuladasSinFirma.cantidad > 0
                    ? " · sin PIN"
                    : "") +
                (p.sinDevolver > 0 ? ` · ${p.sinDevolver} sin devolver la mercadería` : ""),
              problema: p.sinDevolver > 0,
            },
            // Lo cargado a mano no tiene lista contra la cual medirse
            // (comité final, M12): se ve, sin PIN por ahora.
            p.aMano.cantidad > 0 &&
              `${plural(p.aMano.cantidad, "renglón a mano", "renglones a mano")} · ${moneda.format(p.aMano.total)}`,
            p.firmo.cantidad > 0 &&
              `Firmó ${plural(p.firmo.cantidad, "autorización", "autorizaciones")} · ${moneda.format(p.firmo.total)}`,
            p.retiros.cantidad > 0 && {
              texto: `${plural(p.retiros.cantidad, "retiro")} tarde o bajo la base · ${moneda.format(p.retiros.total)}`,
              problema: true,
            },
            // El efectivo de un recibo anulado sigue en el cajón: anularlo
            // puede tapar un faltante. Esos van en rojo.
            p.recibosAnulados.cantidad > 0 && {
              texto:
                `Anuló ${plural(p.recibosAnulados.cantidad, "recibo")} · ${moneda.format(p.recibosAnulados.total)}` +
                (p.recibosAnuladosConEfectivo > 0
                  ? p.recibosAnuladosConEfectivo === p.recibosAnulados.cantidad
                    ? " · con efectivo"
                    : ` · ${p.recibosAnuladosConEfectivo} con efectivo`
                  : ""),
              problema: p.recibosAnuladosConEfectivo > 0,
            },
          ];
          const visibles = renglones.flatMap((r) => (!r ? [] : typeof r === "string" ? [{ texto: r }] : [r]));
          return (
            <li key={p.nombre} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-6">
              <Link
                href={`/admin/bitacora?q=${encodeURIComponent(p.nombre)}`}
                className="w-40 shrink-0 text-base font-semibold hover:underline"
              >
                {p.nombre}
              </Link>
              <ul className="flex flex-wrap gap-x-5 gap-y-1 text-base text-texto-2 [font-variant-numeric:tabular-nums]">
                {visibles.map((r) => (
                  <li key={r.texto} className={r.problema ? "estado-problema font-semibold" : ""}>
                    {r.texto}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Un renglón de la tarjeta: una frase, o una frase en el color de problema
 * y, si hay dónde arreglarlo, con su propio enlace. `false`, `null` o `""` no
 * se dibujan: un cero no se muestra, en ninguna tarjeta.
 */
type Renglon =
  | string
  // aparte: no forma parte de la cifra grande; va debajo de una raya.
  | { texto: string; problema?: boolean; href?: string; aparte?: boolean }
  | false
  | null
  | undefined;

/** Un monto con su signo adelante: «+$ 1.000», «−$ 400». */
function conSigno(n: number): string {
  if (n === 0) return moneda.format(0);
  return `${n > 0 ? "+" : "−"}${moneda.format(Math.abs(n))}`;
}

/**
 * Una pregunta del dueño: el número grande y, abajo, el desglose que sigue.
 *
 * La tarjeta entera lleva a la pantalla que explica el número: el enlace es
 * el título y se estira sobre la tarjeta (un `<a>` dentro de otro no es
 * HTML válido, y un renglón puede llevar a otro lado, como los pedidos sin
 * cobrar). El número negativo se pinta.
 *
 * **Mono solo en las cifras.** El número grande va en la letra de las
 * cifras; los renglones son frases y van en la letra del texto, con los
 * dígitos de ancho fijo (`tabular-nums`) para que se alineen igual.
 */
function Tarjeta({
  titulo,
  valor,
  href,
  renglones,
  variacion,
}: {
  titulo: string;
  // Un texto en vez de un monto: lo que falta para que haya cifra.
  valor: number | string;
  href: string;
  renglones: Renglon[];
  variacion?: number | null;
}) {
  const Flecha =
    variacion == null || variacion === 0
      ? Minus
      : variacion > 0
        ? ArrowUpRight
        : ArrowDownRight;
  const visibles: { texto: string; problema?: boolean; href?: string; aparte?: boolean }[] =
    renglones.flatMap((r) => (!r ? [] : typeof r === "string" ? [{ texto: r }] : [r]));
  const primeroAparte = visibles.findIndex((r) => r.aparte);
  return (
    <div className="tarjeta tarjeta-activa relative flex flex-col gap-3 p-5 has-[>h3>a:focus-visible]:ring-2 has-[>h3>a:focus-visible]:ring-ring">
      <h3 className="text-base font-semibold text-texto-2">
        <Link href={href} className="after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none">
          {titulo}
        </Link>
      </h3>
      <p
        // Un cero se apaga: el ojo tiene que caer en lo que se movió, no en
        // «$ 0» al mismo tamaño que «$ 484.000».
        className={`tabular font-bold leading-none tracking-[-0.03em] ${
          typeof valor === "string"
            ? "estado-problema text-[24px]"
            : valor === 0
              ? "text-[24px] text-texto-3"
              : valor < 0
                ? "text-[34px] text-saldo-debe"
                : "text-[34px] text-foreground"
        }`}
      >
        {typeof valor === "string" ? valor : moneda.format(valor)}
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
      {visibles.length > 0 && (
        <ul className="space-y-1 text-base text-texto-2 [font-variant-numeric:tabular-nums]">
          {visibles.map((r, i) => (
            <li
              key={r.texto}
              className={`${r.problema ? "estado-problema font-semibold" : ""} ${
                i === primeroAparte && i > 0 ? "!mt-3 border-t border-dashed border-linea pt-3" : ""
              }`}
            >
              {r.href ? (
                <Link
                  href={r.href}
                  className="relative z-10 underline decoration-current/30 underline-offset-4 hover:decoration-current"
                >
                  {r.texto}
                </Link>
              ) : (
                r.texto
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** El mes en curso de cada sucursal activa, una cifra por sucursal. */
function MesPorSucursal({
  mes,
}: {
  mes?: { mes: string; sucursales: { sucursal: string; nombre: string; total: number }[] };
}) {
  const filas = (mes?.sucursales ?? []).map((s) => ({ nombre: s.nombre, valor: s.total }));
  return (
    <dl className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
      {filas.map((f) => (
        <div key={f.nombre} className="flex flex-col gap-1.5">
          <dt className="text-base font-semibold text-texto-2">
            {f.nombre}
            {mes && <span className="font-normal"> · {mes.mes}</span>}
          </dt>
          <dd
            className={`tabular font-bold leading-none tracking-[-0.03em] ${
              f.valor === 0 ? "text-[24px] text-texto-3" : "text-[34px]"
            }`}
          >
            {moneda.format(f.valor)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
