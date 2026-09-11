import Link from "next/link";
import {
  ArrowRight,
  ClipboardList,
  Package,
  TrendingUp,
  Truck,
  Users,
} from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { GraficoVentas } from "@/components/admin/grafico-ventas";
import { TarjetaIndicador } from "@/components/admin/tarjeta-indicador";
import { FiltroPeriodo } from "@/components/admin/filtro-periodo";
import { leerPeriodo, resolverPeriodo } from "@/lib/periodos";
import { haceCuanto, moneda, plural } from "@/components/admin/formato";
import {
  actividadReciente,
  metricasDelResumen,
  stockParaReponer,
  ventasPorSucursal,
} from "@/lib/dal/admin/resumen";
import { trabajoPendiente } from "@/lib/dal/admin/pendientes";

export default async function ResumenPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const periodo = resolverPeriodo(leerPeriodo((await searchParams).periodo));

  const [metricas, ventas, reponer, actividad, pendientes] = await Promise.all([
    metricasDelResumen(periodo),
    ventasPorSucursal(),
    stockParaReponer(5),
    actividadReciente(),
    trabajoPendiente(),
  ]);

  const totalPorMes = ventas.map((m) => m.central + m.aserradero);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resumen</h1>
          <p className="text-base text-texto-2">
            Cómo viene el negocio · {periodo.etiqueta.toLowerCase()}
          </p>
        </div>
        <FiltroPeriodo actual={periodo.clave} />
      </div>

      {pendientes.length > 0 && (
        <section className="tarjeta-atencion overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pb-3 pt-4">
            <h2 className="text-lg font-medium">Para hoy</h2>
            <p className="text-base text-muted-foreground">
              Lo que está esperando que alguien lo toque
            </p>
          </div>
          <ul className="grid border-t border-linea-suave sm:grid-cols-2 xl:grid-cols-3">
            {pendientes.map((p) => (
              <li key={p.clave} className="border-b border-r border-linea-suave">
                <Link
                  href={p.href}
                  className="flex h-full items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <span
                    className={`tabular shrink-0 text-[26px] font-semibold leading-none ${
                      p.urgente ? "text-brand-orange" : "text-texto-2"
                    }`}
                  >
                    {p.cantidad}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base">{p.texto}</span>
                    {p.detalle && (
                      <span className="block text-sm text-muted-foreground">
                        {p.detalle}
                      </span>
                    )}
                  </span>
                  <ArrowRight
                    className="h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaIndicador
          etiqueta={`Ventas · ${periodo.etiqueta.toLowerCase()}`}
          valor={moneda.format(metricas.ventasMes)}
          valorNumerico={metricas.ventasMes}
          formatoValor="moneda"
          variacion={
            metricas.variacionVentas !== null
              ? `${metricas.variacionVentas > 0 ? "+" : ""}${metricas.variacionVentas}%`
              : undefined
          }
          comparadoCon="el período anterior"
          icono={TrendingUp}
          serie={totalPorMes}
          pie="Casa Central y Aserradero sumadas"
          href="/admin/reportes"
          destacado
        />
        <TarjetaIndicador
          etiqueta="Presupuestos abiertos"
          valor={String(metricas.presupuestosPendientes)}
          valorNumerico={metricas.presupuestosPendientes}
          icono={ClipboardList}
          segmentos={[
            {
              titulo: "esperando respuesta",
              valor:
                metricas.presupuestosPendientes - metricas.presupuestosRevision,
              color: "#e0a020",
            },
            {
              titulo: "en revisión",
              valor: metricas.presupuestosRevision,
              color: "#3f6fd8",
            },
          ]}
          pie={
            metricas.presupuestosRevision > 0
              ? `${metricas.presupuestosRevision} en revisión ahora mismo`
              : "Ninguno en revisión"
          }
          href="/admin/presupuestos?estado=abiertos"
        />
        <TarjetaIndicador
          etiqueta="Productos a reponer"
          valor={String(metricas.reponer)}
          valorNumerico={metricas.reponer}
          icono={Package}
          segmentos={[
            {
              titulo: "Casa Central",
              valor: metricas.reponerCentral,
              color: "var(--sucursal-central)",
            },
            {
              titulo: "Aserradero",
              valor: metricas.reponerAserradero,
              color: "var(--sucursal-aserradero)",
            },
          ]}
          pie={`${metricas.reponerCentral} en Casa Central · ${metricas.reponerAserradero} en Aserradero`}
          href="/admin/stock"
        />
        <TarjetaIndicador
          etiqueta="Clientes"
          valor={String(metricas.clientesActivos)}
          valorNumerico={metricas.clientesActivos}
          icono={Users}
          segmentos={[
            {
              titulo: "con pedido en curso",
              valor: metricas.clientesConPedido,
              color: "var(--sucursal-central)",
            },
            {
              titulo: "al día",
              valor: Math.max(
                0,
                metricas.clientesActivos - metricas.clientesConPedido,
              ),
              color: "#c3bfb8",
            },
          ]}
          pie={
            metricas.pedidosSinEntregar > 0
              ? `${plural(metricas.pedidosSinEntregar, "pedido")} sin entregar`
              : "Todos los pedidos entregados"
          }
          href="/admin/clientes"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section className="tarjeta p-5">
          <div className="mb-4">
            <h2 className="text-lg font-medium">Ventas por sucursal</h2>
            <p className="text-base text-muted-foreground">Últimos seis meses</p>
          </div>
          <GraficoVentas datos={ventas} />
        </section>

        <section className="tarjeta-hundida flex flex-col p-5">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">Hay que reponer</h2>
              <p className="text-base text-muted-foreground">
                Por debajo del mínimo
              </p>
            </div>
            <Link
              href="/admin/stock"
              className="text-base text-brand-orange hover:underline"
            >
              Ver stock
            </Link>
          </div>

          {reponer.length === 0 ? (
            <p className="rounded-lg bg-muted/50 px-3 py-6 text-center text-base text-muted-foreground">
              Todo por encima del mínimo.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {reponer.map((r) => (
                <li key={`${r.variantId}-${r.sucursal}`}>
                  <Link
                    href={`/admin/productos/${r.productId}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
                  >
                    <span className="min-w-0">
                      <span className="block text-base">{r.producto}</span>
                      <span className="block text-sm text-muted-foreground">
                        {r.medida}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {r.sucursal}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-base font-medium text-brand-orange">
                      {r.qty}
                      <span className="text-muted-foreground">/{r.minQty}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Listado
          titulo="Últimos presupuestos"
          href="/admin/presupuestos"
          vacio="Todavía no hay presupuestos."
          filas={actividad.presupuestos.map((p) => ({
            id: p.id,
            titulo: p.cliente,
            detalle: `${p.numero} · ${haceCuanto(p.createdAt)}`,
            valor: moneda.format(Number(p.total)),
            estado: p.estado,
            href: `/admin/presupuestos/${p.id}`,
          }))}
        />
        <Listado
          titulo="Pedidos en curso"
          href="/admin/pedidos"
          vacio="No hay pedidos pendientes."
          filas={actividad.pedidos.map((p) => ({
            id: p.id,
            titulo: p.cliente,
            detalle: `${p.numero} · ${p.tipoEntrega === "envio" ? "Envío" : "Retiro"} · ${haceCuanto(p.createdAt)}`,
            valor: moneda.format(Number(p.total)),
            estado: p.estado,
            href: `/admin/pedidos/${p.id}`,
            icono: p.tipoEntrega === "envio",
          }))}
        />
      </div>
    </div>
  );
}

interface FilaResumen {
  id: string;
  titulo: string;
  detalle: string;
  valor: string;
  estado: string;
  href?: string;
  icono?: boolean;
}

function Listado({
  titulo,
  href,
  vacio,
  filas,
}: {
  titulo: string;
  href: string;
  vacio: string;
  filas: FilaResumen[];
}) {
  return (
    <section className="tarjeta overflow-hidden">
      <div className="tarjeta-cabecera flex items-baseline justify-between gap-3 px-5 py-4">
        <h2 className="text-lg font-medium">{titulo}</h2>
        <Link
          href={href}
          className="flex items-center gap-1 text-base text-brand-orange hover:underline"
        >
          Ver todos
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {filas.length === 0 ? (
        <p className="border-t px-5 py-8 text-center text-base text-muted-foreground">
          {vacio}
        </p>
      ) : (
        <ul className="divide-y border-t">
          {filas.map((fila) => (
            <li
              key={fila.id}
              className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                {fila.href ? (
                  <Link
                    href={fila.href}
                    className="truncate text-base hover:text-brand-orange"
                  >
                    {fila.titulo}
                  </Link>
                ) : (
                  <p className="truncate text-base">{fila.titulo}</p>
                )}
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {fila.icono && <Truck className="h-4 w-4" />}
                  {fila.detalle}
                </p>
              </div>
              <p className="tabular text-base font-medium">{fila.valor}</p>
              <EtiquetaEstado estado={fila.estado} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
