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
import type { components } from "@/lib/api/tipos/compras";
import {
  nombreComprobanteCompra,
  numeroDeCompra,
} from "@/lib/fiscal/comprobantes-compra";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { Vacio } from "@/components/admin/vacio";
import { CargarFactura } from "./cargar";
import { FiltrosDeFacturas } from "./filtro";
import { IrALaNueva } from "./ir-a-la-nueva";

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
    nueva?: string;
  }>;
}) {
  const usuario = await requireStaff();
  if (!puedeEntrar("/admin/compras/facturas", usuario.staffRole)) notFound();

  /*
   * Sin filtro se ve lo que falta pagar y, abajo, lo pagado; «Sin pagar»
   * deja lo primero, «Pagadas» lo segundo y «Todas» suma las anuladas. Antes
   * arrancaba con «Pagadas» marcada mostrando las dos cosas.
   */
  const { pago = "", proveedor, desde, hasta, pagina, nueva } = await searchParams;
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

  const verPorPagar = pago !== "pagadas";
  const porPagar = pendientes.facturas.map((f) => ({
    id: f.id,
    supplierId: f.supplierId,
    numero: numeroDeCompra(f.puntoVenta, f.numero),
    saldo: Math.round((Number(f.total) - Number(f.pagado)) * 100) / 100,
  }));
  const cheques = pendientes.chequesAReponer.filter((c) => !proveedor || c.supplierId === proveedor);

  const enlacePagina = (n: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ pago, proveedor, desde, hasta })) {
      if (v) p.set(k, v);
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

      <CargarFactura proveedores={proveedores} recepciones={sinFactura} porPagar={porPagar} />

      <FiltrosDeFacturas
        proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
        proveedor={proveedor ?? ""}
        estado={pago}
        desde={desde}
        hasta={hasta}
      />

      {verPorPagar && (
        <section className="tarjeta overflow-hidden">
          <h2 className="flex items-baseline gap-2 px-5 pt-5 text-[19px] font-bold tracking-tight">
            Por pagar
            <span className="tabular text-base font-medium text-muted-foreground">
              {pendientes.facturas.length + cheques.length}
            </span>
          </h2>
          {pendientes.facturas.length + cheques.length === 0 ? (
            <Vacio icono={FileText} titulo="No queda ninguna factura sin pagar" />
          ) : (
            <ListaDeFacturas facturas={pendientes.facturas} cheques={cheques} porPagar nueva={nueva} />
          )}
        </section>
      )}

      {nueva && <IrALaNueva />}

      {historial && pago !== "pendiente" && (
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
            <ListaDeFacturas facturas={historial.facturas} nueva={nueva} />
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

type ChequeAReponer = components["schemas"]["FacturaConSaldo"];

/** Cómo se dice el vencimiento de lo que falta pagar. */
function Vence({ fecha }: { fecha: Date | null }) {
  if (!fecha) return <span className="text-muted-foreground">—</span>;
  const dias = diasHasta(fecha);
  if (dias === 0) return <span className="font-semibold text-brand-orange-dark">Vence hoy</span>;
  return (
    <span className={dias !== null && dias < 0 ? "font-semibold text-saldo-debe" : undefined}>
      {fechaCorta.format(fecha)}
      {dias !== null && dias < 0 && <span className="font-normal"> · hace {plural(-dias, "día")}</span>}
    </span>
  );
}

/** Lo que dice la columna del pago: el saldo, «Pagada», o de una nota de crédito, a qué se aplicó. */
function EstadoDePago({ f, porPagar }: { f: Factura; porPagar?: boolean }) {
  const total = Number(f.total);
  const pagado = Number(f.pagado);
  const saldo = Math.round((total - pagado) * 100) / 100;
  if (f.anuladaAt) return <span className="font-medium text-saldo-debe">Anulada</span>;
  if (f.tipo.startsWith("nota_credito")) {
    return f.aplicaA ? (
      <span className="text-muted-foreground">Aplicada a {f.aplicaA}</span>
    ) : (
      <span className="font-medium text-saldo-favor">A favor</span>
    );
  }
  if (porPagar) return <span className="tabular font-semibold">{formatearMonto(saldo)}</span>;
  if (saldo <= 0.01) return <span className="font-medium text-saldo-favor">Pagada</span>;
  return (
    <span className="tabular text-muted-foreground">
      {formatearMonto(pagado)} de {formatearMonto(total)}
    </span>
  );
}

/** El importe: una nota de crédito resta. */
function Importe({ f }: { f: Factura }) {
  const credito = f.tipo.startsWith("nota_credito");
  return (
    <span className="tabular">
      {credito ? "−" : ""}
      {formatearMonto(Number(f.total))}
    </span>
  );
}

function BotonPagar({ href }: { href: string }) {
  return (
    <Link href={href} className="boton-accion inline-flex h-10 shrink-0 items-center rounded-xl px-4 text-base font-semibold">
      Pagar
    </Link>
  );
}

/**
 * Las facturas, en tabla donde entra entera (el ancho del bloque, no el de
 * la pantalla) y si no en tarjetas de tres renglones: el número de arriba
 * como título, el proveedor, y la fecha con lo que falta y «Pagar» a mano.
 * Apilada, cada factura medía 450 px con «Comprob…» cortado y una fila
 * entera para «Acciones».
 */
function ListaDeFacturas({
  facturas,
  cheques = [],
  porPagar,
  nueva,
}: {
  facturas: Factura[];
  cheques?: ChequeAReponer[];
  porPagar?: boolean;
  nueva?: string;
}) {
  const pagar = (f: Factura) => `/admin/compras/pagos?proveedor=${f.supplierId}&factura=${f.id}`;
  const reponer = (c: ChequeAReponer) => `/admin/compras/pagos?proveedor=${c.supplierId}&cheque=${c.id}`;
  const resaltada = (id: string) => (id === nueva ? "bg-hundida" : "");
  return (
    <div className="@container">
      <table className="hidden w-full text-base @3xl:table" data-tabla="fija">
        <thead>
          <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
            <th className="px-5 py-2.5 font-semibold">{porPagar ? "Vence" : "Fecha"}</th>
            <th className="px-5 py-2.5 font-semibold">Comprobante</th>
            <th className="px-5 py-2.5 font-semibold">Proveedor</th>
            <th className="px-5 py-2.5 text-right font-semibold">Total</th>
            <th className="px-5 py-2.5 text-right font-semibold">{porPagar ? "Falta pagar" : "Pago"}</th>
            {porPagar && (
              <th className="px-5 py-2.5">
                <span className="sr-only">Pagar</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-linea">
          {facturas.map((f) => (
            <tr
              key={f.id}
              data-nueva={f.id === nueva || undefined}
              className={`${f.anuladaAt ? "text-muted-foreground" : ""} ${resaltada(f.id)} scroll-mt-24`}
            >
              <td className="tabular px-5 py-3">
                {porPagar ? <Vence fecha={f.fechaVencimiento} /> : fechaCorta.format(f.fechaEmision)}
              </td>
              <td className="px-5 py-3">
                <Link
                  href={`/admin/compras/facturas/${f.id}`}
                  className={`codigo block font-medium hover:underline ${f.anuladaAt ? "line-through" : ""}`}
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
              <td className="px-5 py-3 text-right">
                <Importe f={f} />
              </td>
              <td className="px-5 py-3 text-right">
                <EstadoDePago f={f} porPagar={porPagar} />
              </td>
              {porPagar && (
                <td className="px-5 py-3 text-right">
                  <BotonPagar href={pagar(f)} />
                </td>
              )}
            </tr>
          ))}
          {cheques.map((c) => (
            <tr key={c.id}>
              <td className="tabular px-5 py-3 font-semibold text-saldo-debe">Rechazado</td>
              <td className="px-5 py-3">
                <span className="codigo block font-medium">{c.numero}</span>
              </td>
              <td className="px-5 py-3">
                <Link href={`/admin/proveedores/${c.supplierId}`} className="hover:underline">
                  {c.proveedor}
                </Link>
              </td>
              <td className="tabular px-5 py-3 text-right">{formatearMonto(c.total)}</td>
              <td className="tabular px-5 py-3 text-right font-semibold">{formatearMonto(c.saldo)}</td>
              <td className="px-5 py-3 text-right">
                <BotonPagar href={reponer(c)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-linea @3xl:hidden">
        {facturas.map((f) => (
          <li
            key={f.id}
            data-nueva={f.id === nueva || undefined}
            className={`space-y-1 px-4 py-3 ${f.anuladaAt ? "text-muted-foreground" : ""} ${resaltada(f.id)} scroll-mt-24`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <Link
                href={`/admin/compras/facturas/${f.id}`}
                className={`codigo min-w-0 truncate text-[17px] font-semibold hover:underline ${f.anuladaAt ? "line-through" : ""}`}
              >
                {numeroDeCompra(f.puntoVenta, f.numero)}
              </Link>
              <span className="shrink-0 text-base">
                <Importe f={f} />
              </span>
            </div>
            <p className="truncate text-base text-muted-foreground">
              {nombreComprobanteCompra(f.tipo)} · {f.proveedor}
            </p>
            <div className="flex min-h-10 items-center justify-between gap-3 text-base">
              <span className="tabular min-w-0">
                {porPagar ? <Vence fecha={f.fechaVencimiento} /> : fechaCorta.format(f.fechaEmision)}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <EstadoDePago f={f} porPagar={porPagar} />
                {porPagar && <BotonPagar href={pagar(f)} />}
              </span>
            </div>
          </li>
        ))}
        {cheques.map((c) => (
          <li key={c.id} className="space-y-1 px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="codigo min-w-0 truncate text-[17px] font-semibold">{c.numero}</span>
              <span className="tabular shrink-0 text-base">{formatearMonto(c.total)}</span>
            </div>
            <p className="truncate text-base text-muted-foreground">{c.proveedor}</p>
            <div className="flex min-h-10 items-center justify-between gap-3 text-base">
              <span className="font-semibold text-saldo-debe">Rechazado</span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="tabular font-semibold">{formatearMonto(c.saldo)}</span>
                <BotonPagar href={reponer(c)} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
