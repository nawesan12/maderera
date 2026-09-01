import Link from "next/link";
import { Package, Truck } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import {
  ColumnaTablero,
  TarjetaTablero,
  Tablero,
} from "@/components/admin/kanban";
import { haceCuanto, moneda, plural } from "@/components/admin/formato";
import { BuscadorPedidos } from "./buscador";
import { listarPedidos, type PedidoListado } from "@/lib/dal/admin/ventas";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { AccionesPedido } from "./acciones";

/** Las etapas por las que pasa un pedido, en orden. */
const COLUMNAS = [
  { estado: "pendiente", titulo: "Sin preparar", vacio: "Nada esperando." },
  { estado: "preparando", titulo: "Preparando", vacio: "Nada en preparación." },
  { estado: "listo", titulo: "Listos", vacio: "Nada listo todavía." },
  { estado: "en-camino", titulo: "En camino", vacio: "Ningún envío en la calle." },
] as const;

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ buscar?: string; sucursal?: string }>;
}) {
  const params = await searchParams;
  const [pedidos, sucursales] = await Promise.all([
    listarPedidos({ busqueda: params.buscar, sucursal: params.sucursal }),
    listarSucursalesPublicas(),
  ]);

  const entregados = pedidos.filter((p) => p.estado === "entregado");
  const activos = pedidos.filter(
    (p) => !["entregado", "cancelado"].includes(p.estado),
  );
  const porCobrar = pedidos
    .filter((p) => p.estadoPago !== "pagado" && p.estado !== "cancelado")
    .reduce((s, p) => s + p.total, 0);

  return (
    <div>
      <EncabezadoPanel
        titulo="Pedidos"
        detalle={
          activos.length > 0
            ? `${plural(activos.length, "pedido")} en curso · ${moneda.format(porCobrar)} por cobrar`
            : `${plural(pedidos.length, "pedido")} en total`
        }
      />

      <BuscadorPedidos
        busquedaActual={params.buscar ?? ""}
        sucursalActual={params.sucursal ?? "todas"}
        sucursales={sucursales.map((s) => ({
          slug: s.slug,
          nombre: s.nombre,
        }))}
      />

      {pedidos.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed py-16 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">No hay pedidos que mostrar</p>
          <p className="mt-1 text-base text-muted-foreground">
            Probá buscando por número, cliente o dirección.
          </p>
        </div>
      ) : (
        <>
          <Tablero>
            {COLUMNAS.map((columna) => {
              const enColumna = pedidos.filter(
                (p) => p.estado === columna.estado,
              );
              const monto = enColumna.reduce((s, p) => s + p.total, 0);

              return (
                <ColumnaTablero
                  key={columna.estado}
                  titulo={columna.titulo}
                  cantidad={enColumna.length}
                  detalle={
                    enColumna.length > 0 ? moneda.format(monto) : undefined
                  }
                  estado={columna.estado}
                  vacio={columna.vacio}
                >
                  {enColumna.map((pedido) => (
                    <TarjetaPedido key={pedido.id} pedido={pedido} />
                  ))}
                </ColumnaTablero>
              );
            })}
          </Tablero>

          {entregados.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2.5 text-base font-semibold text-muted-foreground">
                Entregados hace poco
              </h2>
              <ul className="overflow-hidden rounded-xl border bg-card">
                {entregados.slice(0, 6).map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-3.5 last:border-0"
                  >
                    <Link
                      href={`/admin/pedidos/${p.id}`}
                      className="min-w-0 flex-1 text-base hover:text-brand-orange"
                    >
                      {p.cliente}
                    </Link>
                    <span className="tabular text-base text-muted-foreground">
                      {p.numero}
                    </span>
                    <span className="text-base text-muted-foreground">
                      {haceCuanto(p.createdAt)}
                    </span>
                    <span className="tabular text-base font-medium">
                      {moneda.format(p.total)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TarjetaPedido({ pedido }: { pedido: PedidoListado }) {
  const sinCobrar = pedido.estadoPago !== "pagado";

  return (
    <TarjetaTablero destacada={sinCobrar && pedido.estado === "listo"}>
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/admin/pedidos/${pedido.id}`}
          className="text-base font-medium leading-snug hover:text-brand-orange"
        >
          {pedido.cliente}
        </Link>
        <span className="tabular shrink-0 text-sm text-muted-foreground">
          {pedido.numero}
        </span>
      </div>

      {pedido.empresa && (
        <p className="text-sm text-muted-foreground">{pedido.empresa}</p>
      )}

      <p className="tabular mt-2 text-lg font-semibold">
        {moneda.format(pedido.total)}
      </p>

      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
        <span>{plural(pedido.items, "ítem")}</span>
        <span aria-hidden="true">·</span>
        <span>{haceCuanto(pedido.createdAt)}</span>
      </p>

      {pedido.tipoEntrega === "envio" ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-sm text-muted-foreground">
          <Truck className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="line-clamp-2">
            {pedido.direccionEntrega ?? "Envío a domicilio"}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Retira en {pedido.sucursal}
        </p>
      )}

      {sinCobrar && (
        <p className="estado-espera mt-2 inline-flex self-start rounded-full bg-[var(--estado-fondo)] px-2 py-0.5 text-sm font-medium text-[var(--estado-tinta)]">
          Sin cobrar
        </p>
      )}

      <div className="mt-auto border-t pt-3">
        <AccionesPedido
          id={pedido.id}
          estado={pedido.estado}
          estadoPago={pedido.estadoPago}
          tipoEntrega={pedido.tipoEntrega}
          compacto
        />
      </div>
    </TarjetaTablero>
  );
}
