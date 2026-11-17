import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { listarFacturasDeCompra } from "@/lib/dal/admin/compras-fiscal";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { listarRecepciones } from "@/lib/dal/admin/recepciones";
import { diasHasta, fechaCorta, formatearMonto, plural } from "@/lib/formato";
import {
  nombreComprobanteCompra,
  numeroDeCompra,
} from "@/lib/fiscal/comprobantes-compra";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { Vacio } from "@/components/admin/vacio";
import { CargarFactura } from "./cargar";
import { FiltrosDeFacturas } from "./filtro";

export const metadata: Metadata = { title: "Facturas de compra" };

type Factura = Awaited<ReturnType<typeof listarFacturasDeCompra>>["facturas"][number];

/**
 * Los comprobantes que recibimos.
 *
 * Es la capa fiscal de las compras y va aparte de las recepciones a propósito:
 * la recepción dice qué entró al depósito, la factura dice qué crédito fiscal
 * se puede computar. Llegan por caminos distintos y a veces una factura cubre
 * tres remitos.
 *
 * **Lo que falta pagar va arriba, entero y por vencimiento**, con la deuda en
 * el encabezado. Bug arreglado: la pantalla traía las últimas 60 facturas y
 * sumaba ahí el «sin pagar»; una impaga más vieja no aparecía ni sumaba. Ahora
 * la suma la hace Go sobre todas, y lo pagado va abajo, de a páginas.
 */
export default async function FacturasDeCompraPage({
  searchParams,
}: {
  searchParams: Promise<{
    pago?: string;
    proveedor?: string;
    desde?: string;
    hasta?: string;
    pagina?: string;
  }>;
}) {
  const usuario = await requireStaff();
  if (!puedeEntrar("/admin/compras/facturas", usuario.staffRole)) notFound();

  const { pago = "pagadas", proveedor, desde, hasta, pagina } = await searchParams;
  /*
   * Las fechas de emisión se guardan como día (medianoche UTC), así que el
   * rango va de la medianoche UTC del primero al último instante del otro.
   */
  const filtro = {
    proveedor,
    desde: desde ? new Date(`${desde}T00:00:00.000Z`) : undefined,
    hasta: hasta ? new Date(`${hasta}T23:59:59.999Z`) : undefined,
  };
  const numeroPagina = Math.max(1, Number(pagina) || 1);

  const [pendientes, historial, proveedores, recepciones] = await Promise.all([
    listarFacturasDeCompra({ ...filtro, estado: "pendiente" }),
    // «pendiente» viene del aviso de vencimientos del inicio: solo lo que falta pagar.
    pago === "pendiente"
      ? null
      : listarFacturasDeCompra({
          ...filtro,
          estado: pago === "todas" ? "todas" : "pagadas",
          pagina: numeroPagina,
        }),
    proveedoresParaElegir(),
    listarRecepciones(200),
  ]);
  // Las que todavía esperan su factura: a esas se puede vincular la nueva.
  const sinFactura = recepciones.filter(
    (r) => r.estado === "confirmada" && !r.facturada,
  );

  const resumen =
    pendientes.impagas === 0
      ? "Todo pagado"
      : [
          `${formatearMonto(pendientes.impago)} sin pagar`,
          plural(pendientes.impagas, "factura"),
          pendientes.vencidas > 0
            ? `${formatearMonto(pendientes.impagoVencido)} vencido`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");

  const enlacePagina = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ pago, proveedor, desde, hasta })) {
      if (v && !(k === "pago" && v === "pagadas")) p.set(k, v);
    }
    if (n > 1) p.set("pagina", String(n));
    return `/admin/compras/facturas${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <EncabezadoPanel titulo="Facturas de compra" resumen={resumen}>
        <Link
          href="/admin/arca/libro-iva-compras"
          className="tarjeta-hundida inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-base font-medium"
        >
          Libro IVA compras
        </Link>
      </EncabezadoPanel>

      <CargarFactura proveedores={proveedores} recepciones={sinFactura} />

      <FiltrosDeFacturas
        proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
        proveedor={proveedor ?? ""}
        estado={pago}
        desde={desde}
        hasta={hasta}
      />

      <section className="tarjeta overflow-hidden">
        <h2 className="flex items-baseline gap-2 px-5 pt-5 text-[19px] font-bold tracking-tight">
          Por pagar
          <span className="tabular text-base font-medium text-muted-foreground">
            {pendientes.facturas.length}
          </span>
        </h2>
        {pendientes.facturas.length === 0 ? (
          <Vacio icono={FileText} titulo="No queda ninguna factura sin pagar" />
        ) : (
          <TablaDeFacturas facturas={pendientes.facturas} porPagar />
        )}
      </section>

      {historial && (
        <section className="tarjeta overflow-hidden">
          <h2 className="px-5 pt-5 text-[19px] font-bold tracking-tight">
            {pago === "todas" ? "Todas" : "Pagadas"}
          </h2>
          {historial.facturas.length === 0 ? (
            <Vacio
              icono={FileText}
              titulo={
                pago === "todas"
                  ? "Todavía no se cargó ninguna factura de compra"
                  : "Todavía no hay ninguna factura pagada del todo"
              }
            />
          ) : (
            <TablaDeFacturas facturas={historial.facturas} />
          )}
          {(numeroPagina > 1 || historial.hayMas) && (
            <nav className="flex items-center justify-between gap-3 px-5 py-4" aria-label="Páginas">
              {numeroPagina > 1 ? (
                <Link
                  href={enlacePagina(numeroPagina - 1)}
                  scroll={false}
                  className="tarjeta-hundida inline-flex h-11 items-center rounded-xl px-4 text-base font-medium"
                >
                  Más nuevas
                </Link>
              ) : (
                <span />
              )}
              <span className="tabular text-base text-muted-foreground">Página {numeroPagina}</span>
              {historial.hayMas ? (
                <Link
                  href={enlacePagina(numeroPagina + 1)}
                  scroll={false}
                  className="tarjeta-hundida inline-flex h-11 items-center rounded-xl px-4 text-base font-medium"
                >
                  Más viejas
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

function TablaDeFacturas({
  facturas,
  porPagar,
}: {
  facturas: Factura[];
  porPagar?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-base">
        <thead>
          <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
            <th className="px-5 py-2.5 font-semibold">{porPagar ? "Vence" : "Fecha"}</th>
            <th className="px-5 py-2.5 font-semibold">Comprobante</th>
            <th className="px-5 py-2.5 font-semibold">Proveedor</th>
            <th className="px-5 py-2.5 text-right font-semibold">Total</th>
            <th className="px-5 py-2.5 text-right font-semibold">
              {porPagar ? "Falta pagar" : "Pago"}
            </th>
            <th className="px-5 py-2.5">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-linea">
          {facturas.map((f) => {
            const total = Number(f.total);
            const pagado = Number(f.pagado);
            const saldo = Math.round((total - pagado) * 100) / 100;
            const dias = diasHasta(f.fechaVencimiento);
            return (
              <tr key={f.id} className={f.anuladaAt ? "text-muted-foreground" : undefined}>
                <td className="tabular px-5 py-3">
                  {porPagar ? (
                    f.fechaVencimiento ? (
                      <>
                        <span className={dias !== null && dias < 0 ? "font-semibold text-saldo-debe" : undefined}>
                          {fechaCorta.format(f.fechaVencimiento)}
                        </span>
                        {dias !== null && dias < 0 && (
                          <span className="block text-sm text-saldo-debe">
                            hace {plural(-dias, "día")}
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )
                  ) : (
                    fechaCorta.format(f.fechaEmision)
                  )}
                </td>
                <td className="px-5 py-3">
                  <Link
                    href={`/admin/compras/facturas/${f.id}`}
                    className={`tabular block font-medium hover:underline ${f.anuladaAt ? "line-through" : ""}`}
                  >
                    {numeroDeCompra(f.puntoVenta, f.numero)}
                  </Link>
                  <span className="block text-sm text-muted-foreground">
                    {nombreComprobanteCompra(f.tipo)}
                    {porPagar && ` · del ${fechaCorta.format(f.fechaEmision)}`}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <Link href={`/admin/proveedores/${f.supplierId}`} className="hover:underline">
                    {f.proveedor}
                  </Link>
                </td>
                <td className="tabular px-5 py-3 text-right">{formatearMonto(total)}</td>
                {/* Si está paga, a medias o sin tocar: sale de lo aplicado en
                    los pagos, no de un estado que alguien marque. */}
                <td className="tabular px-5 py-3 text-right">
                  {f.anuladaAt ? (
                    <span className="font-medium text-saldo-debe">Anulada</span>
                  ) : porPagar ? (
                    <span className="font-semibold">{formatearMonto(saldo)}</span>
                  ) : saldo <= 0.01 ? (
                    <span className="font-medium text-saldo-favor">Pagada</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {formatearMonto(pagado)} de {formatearMonto(total)}
                    </span>
                  )}
                </td>
                {/*
                  La acción que la fila estaba pidiendo: el pago llega con el
                  proveedor puesto y esta factura tildada por su saldo.
                */}
                <td className="px-5 py-3 text-right">
                  {porPagar && (
                    <Link
                      href={`/admin/compras/pagos?proveedor=${f.supplierId}&factura=${f.id}`}
                      className="boton-accion inline-flex h-10 items-center rounded-xl px-4 text-base font-semibold"
                    >
                      Pagar
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
