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
import { AvisoSinPin } from "./aviso-sin-pin";

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
      {controles.sinPin && <AvisoSinPin />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
              ? plata.cajas.map((c) => `Caja ${c.sucursal} ${moneda.format(c.esperado)}`)
              : ["Sin cajas abiertas"]),
            [
              plata.banco !== 0 && `Banco ${moneda.format(plata.banco)}`,
              plata.mercadoPago !== 0 && `Mercado Pago ${moneda.format(plata.mercadoPago)}`,
            ]
              .filter(Boolean)
              .join(" · "),
            plata.tarjetas > 0 && `Tarjetas a acreditar ${moneda.format(plata.tarjetas)}`,
            plata.cheques.cantidad > 0 && `Cheques en cartera ${moneda.format(plata.cheques.total)}`,
            // La plata que salió del cajón por anulaciones es la que importa;
            // la de una venta con tarjeta anulada nunca entró.
            anuladas.cantidad > 0 && {
              texto:
                anuladas.devuelto > 0
                  ? `${plural(anuladas.cantidad, "anulada")} en 7 días · ${moneda.format(anuladas.devuelto)} devueltos`
                  : `${plural(anuladas.cantidad, "anulada")} en 7 días`,
              problema: anuladas.devuelto > 0,
              href: "/admin/bitacora?accion=anular&q=mostrador",
            },
            // Lleva a la lista de esas facturas, cada una con su nota de
            // crédito a un clic.
            anuladas.conFacturaViva > 0 && {
              texto: `${plural(anuladas.conFacturaViva, "anulada", "anuladas")} con factura viva`,
              problema: true,
              href: "/admin/facturacion?estado=anulada-viva",
            },
          ]}
        />
        <Tarjeta
          titulo="Ganancia del mes"
          valor={g.resultado}
          href="/admin/cierre"
          variacion={ganancia.variacion}
          renglones={[
            // La fórmula en renglones: en uno solo se cortaba. Con la regla
            // del descuento la venta no es la de Reportes, y se llama
            // distinto.
            `${g.conDescuento ? "Vendido sin IVA ni descuentos" : "Vendido sin IVA"} ${moneda.format(g.ventasNetas)}`,
            // Lo vendido sin costo cargado queda afuera de la ganancia, como
            // del margen de Reportes, y se dice en plata: contado como
            // ganancia entera la inflaba.
            g.ventasSinCosto > 0 && {
              texto: `${moneda.format(g.ventasSinCosto)} sin costo, afuera`,
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
 * retiros tardíos o bajo la base y, de cada admin, cuántas autorizaciones
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
type Renglon = string | { texto: string; problema?: boolean; href?: string } | false | null | undefined;

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
  valor: number;
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
  const visibles = renglones.flatMap((r) => (!r ? [] : typeof r === "string" ? [{ texto: r }] : [r]));
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
          valor === 0 ? "text-[24px] text-texto-3" : valor < 0 ? "text-[34px] text-saldo-debe" : "text-[34px] text-foreground"
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
      {visibles.length > 0 && (
        <ul className="mt-auto space-y-1 text-base text-texto-2 [font-variant-numeric:tabular-nums]">
          {visibles.map((r) => (
            <li key={r.texto} className={r.problema ? "estado-problema font-semibold" : ""}>
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

/** El mes en curso de cada sucursal, en dos cifras. */
function MesPorSucursal({
  mes,
}: {
  mes?: { mes: string; central: number; aserradero: number };
}) {
  const filas = [
    { nombre: "Casa Central", valor: mes?.central ?? 0 },
    { nombre: "Aserradero", valor: mes?.aserradero ?? 0 },
  ];
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
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
