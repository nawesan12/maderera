import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileCheck2, Wallet } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import {
  listarPagosAProveedores,
  regimenesActivos,
} from "@/lib/dal/admin/pagos-proveedor";
import { listarProveedores } from "@/lib/dal/admin/proveedores";
import { sucursalesParaGasto } from "@/lib/dal/admin/gastos";
import { fechaCorta, formatearMonto, plural } from "@/lib/formato";
import { EtiquetaDeCircuito } from "@/components/admin/circuito";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { Vacio } from "@/components/admin/vacio";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { valorDeRegla } from "@/lib/reglas";
import { FormularioPago } from "./formulario";
import { NOMBRE_DEL_MEDIO } from "./medios";

export const metadata: Metadata = { title: "Pagos a proveedores" };

type Pago = Awaited<ReturnType<typeof listarPagosAProveedores>>[number];

/**
 * Los pagos y las retenciones que los acompañan.
 *
 * **La retención no es un gasto: es parte del pago.** Se le pagan $100 con $95
 * de transferencia y $5 de retención, y la deuda queda saldada en $100. Por eso
 * la tabla muestra las tres columnas juntas: lo que se aplicó, lo que salió del
 * banco y lo retenido. Mostrar solo la transferencia haría que el saldo del
 * proveedor no cuadre contra la suma de los pagos.
 *
 * Cada fila lleva a la ficha del pago, donde están la orden de pago y la
 * anulación (antes, un desplegable metido en la celda de la fecha).
 */
export default async function PagosPage({
  searchParams,
}: {
  /*
   * `proveedor` y `factura` llegan desde una factura impaga o la ficha del
   * proveedor, para que pagar sea un botón y no un recorrido.
   */
  searchParams: Promise<{ proveedor?: string; factura?: string; cheque?: string }>;
}) {
  const usuario = await requireStaff();
  if (!puedeEntrar("/admin/compras/pagos", usuario.staffRole)) notFound();

  const { proveedor: proveedorInicial, factura: facturaInicial, cheque: chequeInicial } =
    await searchParams;

  const [pagos, proveedores, regimenes, sucursales, ajustes] = await Promise.all([
    listarPagosAProveedores(),
    // Todos, no solo los activos: dejar de comprarle a alguien no salda su
    // cuenta. Se ofrecen los activos y los inactivos que deben, así la
    // deuda se puede pagar y el total es el mismo «Debo» del Resumen.
    listarProveedores(),
    regimenesActivos(),
    sucursalesParaGasto(),
    ajustesDelSitio(),
  ]);
  const sicore = valorDeRegla(ajustes, "exportar_sicore") === "si";

  const vigentes = pagos.filter((p) => !p.anuladoAt);
  const anulados = pagos.filter((p) => p.anuladoAt);

  const conDeuda = proveedores.filter((p) => p.saldo > 0.005);
  // Un anticipo no resta la deuda con otro, pero tiene que verse: es plata
  // que ya salió.
  const aFavor = proveedores.filter((p) => p.saldo < -0.005);
  // Los que tienen deuda, primero: son a los que se les paga. Un inactivo
  // sin deuda no se ofrece.
  const ordenados = [
    ...conDeuda,
    ...proveedores.filter((p) => p.saldo <= 0.005 && p.estado === "activo"),
  ];
  const resumen = [
    conDeuda.length > 0
      ? `Se les deben ${formatearMonto(conDeuda.reduce((s, p) => s + p.saldo, 0))} a ${plural(conDeuda.length, "proveedor", "proveedores")}`
      : "Sin deuda con proveedores",
    aFavor.length > 0 &&
      `${formatearMonto(-aFavor.reduce((s, p) => s + p.saldo, 0))} a favor con ${plural(aFavor.length, "proveedor", "proveedores")}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Pagos a proveedores"
        resumen={resumen}
      >
        {/* Es un archivo (una ruta que contesta un CSV), no una página: el
            enlace tiene que ser una descarga. La regla lo confunde con la
            ficha /admin/compras/pagos/[id]. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/admin/compras/pagos/exportar"
          className="tarjeta-hundida inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-base font-medium"
        >
          <Download className="h-4 w-4" />
          Retenciones del mes
        </a>
        {sicore && (
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a
            href="/admin/compras/pagos/exportar?formato=sicore"
            className="tarjeta-hundida inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-base font-medium"
          >
            <Download className="h-4 w-4" />
            SICORE
          </a>
        )}
      </EncabezadoPanel>

      <FormularioPago
        proveedores={ordenados.map((p) => ({
          id: p.id,
          nombre: p.estado === "inactivo" ? `${p.nombre} · inactivo` : p.nombre,
          saldo: p.saldo,
          condicionIva: p.condicionIva,
          condicionGanancias: p.condicionGanancias,
          exentoGananciasHasta: p.exentoGananciasHasta,
        }))}
        regimenes={regimenes.map((r) => ({
          id: r.id,
          codigo: r.codigo,
          nombre: r.nombre,
          impuesto: r.impuesto,
          alicuota: Number(r.alicuota),
          minimoNoImponible: Number(r.minimoNoImponible),
        }))}
        sucursales={sucursales}
        ivaSobreTotal={valorDeRegla(ajustes, "base_retencion_iva") === "total"}
        proveedorInicial={proveedorInicial}
        facturaInicial={facturaInicial}
        chequeInicial={chequeInicial}
      />

      <section className="tarjeta overflow-hidden">
        <h2 className="px-5 pt-5 text-[19px] font-bold tracking-tight">Pagos hechos</h2>
        {pagos.length === 0 ? (
          <Vacio icono={Wallet} titulo="Todavía no se registró ningún pago" />
        ) : (
          <>
            {vigentes.length > 0 && <TablaDePagos pagos={vigentes} />}
            {/* Los anulados, al pie y cerrados: mezclados con los vigentes,
                un «Pagado $1» anulado se leía como plata que salió. */}
            {anulados.length > 0 && (
              <details className="border-t border-linea">
                <summary className="cursor-pointer px-5 py-3.5 text-base text-muted-foreground hover:text-foreground">
                  Anulados ({anulados.length})
                </summary>
                <TablaDePagos pagos={anulados} />
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** Con qué se pagó: cada renglón con su referencia, o el medio de la cabecera. */
function Medios({ p }: { p: Pago }) {
  const partes = p.partes.length > 0 ? p.partes : [{ medio: p.medio, importe: p.neto, referencia: p.referencia }];
  return (
    <span className="flex flex-wrap gap-1.5">
      {partes.map((x, i) => (
        // La referencia es el dato para conciliar: se parte, no se corta
        // (salía «Sim-TRF-9…», mes simulado H338).
        <span key={i} className="tabular inline-flex max-w-full flex-wrap items-baseline gap-x-1 gap-y-0.5 rounded-xl bg-chip px-2.5 py-0.5 text-sm">
          <span className="font-medium">{NOMBRE_DEL_MEDIO[x.medio] ?? x.medio}</span>
          {x.referencia && <span className="codigo min-w-0 break-all text-muted-foreground">{x.referencia}</span>}
          {partes.length > 1 && <span>{formatearMonto(x.importe)}</span>}
        </span>
      ))}
    </span>
  );
}

/** Contra qué se aplicó: las facturas y los cheques rechazados repuestos. */
function Aplicado({ p }: { p: Pago }) {
  if (p.facturas.length === 0) return <span className="text-sm text-muted-foreground">A cuenta, sin aplicar</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
      {p.facturas.map((f) => (
        <Link
          key={f.id}
          href={f.numero.startsWith("Cheque") ? "/admin/cheques" : `/admin/compras/facturas/${f.id}`}
          className="tabular hover:underline"
        >
          {f.numero} · {formatearMonto(f.importe)}
        </Link>
      ))}
    </span>
  );
}

/**
 * Los pagos, vigentes o anulados: el anulado sale apagado y tachado.
 *
 * Donde la tabla no entra, una tarjeta sin columna de rótulos: la fecha y lo
 * pagado arriba, el proveedor entero, y con qué se pagó como chips. Apilada,
 * guardaba media tarjeta para rótulos cortados («Me…», «Aplic…»).
 */
function TablaDePagos({ pagos }: { pagos: Pago[] }) {
  return (
    <div className="@container">
      <table className="hidden w-full text-base @4xl:table" data-tabla="fija">
        <thead>
          <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
            <th className="px-5 py-2.5 font-semibold">Fecha</th>
            <th className="px-5 py-2.5 font-semibold">Proveedor</th>
            <th className="px-5 py-2.5 font-semibold">Con qué</th>
            <th className="px-5 py-2.5 text-right font-semibold">Aplicado</th>
            <th className="px-5 py-2.5 text-right font-semibold">Retenido</th>
            <th className="px-5 py-2.5 text-right font-semibold">Pagado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-linea">
          {pagos.map((p) => (
            <tr key={p.id} className={p.anuladoAt ? "text-muted-foreground" : undefined}>
              <td className="tabular px-5 py-3">
                <Link href={`/admin/compras/pagos/${p.id}`} className="font-medium hover:underline">
                  {fechaCorta.format(p.fecha)}
                </Link>
                {p.anuladoAt && <span className="block text-sm font-medium text-saldo-debe">Anulado</span>}
              </td>
              <td className="px-5 py-3">
                <Link href={`/admin/proveedores/${p.supplierId}`} className="hover:underline">
                  {p.proveedor}
                </Link>
                <Certificados p={p} />
              </td>
              <td className="px-5 py-3">
                <Medios p={p} />
                <span className="mt-0.5 block text-sm text-muted-foreground"><EtiquetaDeCircuito valor={p.circuito} /></span>
              </td>
              <td className={`tabular px-5 py-3 text-right font-semibold ${p.anuladoAt ? "line-through" : ""}`}>
                {formatearMonto(p.total)}
                <span className="mt-0.5 flex justify-end font-normal">
                  <Aplicado p={p} />
                </span>
              </td>
              <td
                className={`tabular px-5 py-3 text-right text-muted-foreground ${p.anuladoAt && p.retenido > 0 ? "line-through" : ""}`}
              >
                {p.retenido > 0 ? formatearMonto(p.retenido) : "—"}
              </td>
              <td className={`tabular px-5 py-3 text-right ${p.anuladoAt ? "line-through" : ""}`}>
                {formatearMonto(p.neto)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-linea @4xl:hidden">
        {pagos.map((p) => (
          <li key={p.id} className={`space-y-1.5 px-4 py-3 ${p.anuladoAt ? "text-muted-foreground" : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <Link href={`/admin/compras/pagos/${p.id}`} className="tabular text-base text-muted-foreground hover:underline">
                {fechaCorta.format(p.fecha)}
                {p.anuladoAt && <span className="font-medium text-saldo-debe"> · Anulado</span>}
              </Link>
              <span className={`tabular text-lg font-semibold ${p.anuladoAt ? "line-through" : ""}`}>
                {formatearMonto(p.total)}
              </span>
            </div>
            <Link href={`/admin/proveedores/${p.supplierId}`} className="block text-base font-semibold hover:underline">
              {p.proveedor}
            </Link>
            <Medios p={p} />
            <Aplicado p={p} />
            {p.retenido > 0 && (
              <p className="tabular text-sm text-muted-foreground">
                Retenido {formatearMonto(p.retenido)} · salió {formatearMonto(p.neto)}
              </p>
            )}
            <Certificados p={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Certificados({ p }: { p: Pago }) {
  if (p.numerosCertificado.length === 0) return null;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
      {p.numerosCertificado.map((numero) => (
        <a
          key={numero}
          href={`/admin/compras/pagos/certificado/${encodeURIComponent(numero)}`}
          className="tabular hover:text-brand-orange hover:underline"
        >
          {numero}
        </a>
      ))}
    </span>
  );
}
