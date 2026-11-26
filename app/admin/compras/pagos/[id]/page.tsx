import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileCheck2, FileText } from "lucide-react";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { esUuid } from "@/lib/uuid";
import { fichaDePagoAProveedor } from "@/lib/dal/admin/compras-fiscal";
import { fechaCorta, formatearMonto } from "@/lib/formato";
import { etiquetaDeCircuito, etiquetasDelCircuito } from "@/lib/circuito";
import { nombreDelCircuito } from "@/lib/dal/circuito";
import { EncabezadoFicha } from "@/components/admin/encabezado-ficha";
import { NOMBRE_DEL_MEDIO } from "../medios";
import { AnularPago } from "./anular";

export const metadata: Metadata = { title: "Pago a proveedor" };

/**
 * Un pago a proveedor: qué facturas canceló, qué se retuvo, con qué salió la
 * plata y de qué caja. Acá están la orden de pago para imprimir y la
 * anulación, que antes vivía en un desplegable dentro de la celda de la fecha
 * del listado.
 */
export default async function PagoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const usuario = await requireStaff();
  if (!puedeEntrar("/admin/compras/pagos", usuario.staffRole)) notFound();

  const { id } = await params;
  if (!esUuid(id)) notFound();
  const [p, circuito] = await Promise.all([fichaDePagoAProveedor(id), nombreDelCircuito()]);
  if (!p) notFound();

  const retenido = Math.round((p.total - p.neto) * 100) / 100;
  const aplicado = p.facturas.reduce((s, f) => s + f.aplicado, 0);
  const aCuenta = Math.round((p.total - aplicado) * 100) / 100;

  return (
    <div className="space-y-6">
      <EncabezadoFicha
        volverA="/admin/compras/pagos"
        volverTexto="Pagos a proveedores"
        titulo={`Pago a ${p.proveedor}`}
        estado={
          p.anuladoAt ? <span className="text-base font-semibold text-saldo-debe">Anulado</span> : undefined
        }
        detalle={[
          fechaCorta.format(p.fecha),
          NOMBRE_DEL_MEDIO[p.medio] ?? p.medio,
          p.referencia,
          etiquetaDeCircuito(p.circuito, etiquetasDelCircuito(circuito)),
        ]
          .filter(Boolean)
          .join(" · ")}
        acciones={
          <>
            <a
              href={`/admin/compras/pagos/${p.id}/orden`}
              target="_blank"
              className="tarjeta-hundida inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-base font-medium"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Orden de pago
            </a>
            {!p.anuladoAt && (
              <AnularPago
                id={p.id}
                supplierId={p.supplierId}
                titulo={`Anular el pago de ${formatearMonto(p.total)} a ${p.proveedor}`}
                detalle={[
                  `La deuda con ${p.proveedor} vuelve a su cuenta y las facturas quedan otra vez por pagar.`,
                  p.retenciones.length > 0 ? "Los certificados de retención quedan anulados." : "",
                  p.partes.some((x) => x.chequeNumero)
                    ? "Los cheques endosados vuelven a la cartera y los propios se anulan."
                    : "",
                  p.efectivoEnCaja > 0
                    ? `Los ${formatearMonto(p.efectivoEnCaja)} en efectivo vuelven a la caja de ${p.caja}.`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            )}
          </>
        }
      />

      {p.anuladoAt && (
        <p className="tarjeta-hundida rounded-xl px-5 py-4 text-base">
          <span className="font-semibold text-saldo-debe">Anulado el {fechaCorta.format(p.anuladoAt)}</span>
          {p.motivoAnulacion && ` · ${p.motivoAnulacion}`}
        </p>
      )}

      <section className="tarjeta grid gap-5 p-5 sm:grid-cols-3">
        <Cifra titulo="Baja la deuda" valor={p.total} grande />
        <Cifra titulo="Retenido" valor={retenido} />
        <Cifra titulo="Salió" valor={p.neto} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="tarjeta p-5">
          <h2 className="text-[19px] font-bold tracking-tight">Facturas</h2>
          <ul className="mt-3 divide-y divide-linea-suave">
            {p.facturas.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/admin/compras/facturas/${f.id}`}
                  className="flex items-baseline justify-between gap-3 py-2.5 hover:underline"
                >
                  <span>
                    <span className="tabular font-medium">{f.numero}</span>
                    <span className="text-muted-foreground"> · del {fechaCorta.format(f.fechaEmision)}</span>
                  </span>
                  <span className="tabular font-semibold">{formatearMonto(f.aplicado)}</span>
                </Link>
              </li>
            ))}
            {aCuenta > 0.009 && (
              <li className="flex items-baseline justify-between gap-3 py-2.5">
                <span className="text-muted-foreground">A cuenta, sin aplicar</span>
                <span className="tabular font-semibold">{formatearMonto(aCuenta)}</span>
              </li>
            )}
          </ul>
        </section>

        <section className="tarjeta p-5">
          <h2 className="text-[19px] font-bold tracking-tight">Con qué salió</h2>
          <ul className="mt-3 divide-y divide-linea-suave">
            {(p.partes.length > 0
              ? p.partes
              : [{ medio: p.medio, importe: p.neto, referencia: p.referencia, chequeNumero: null, chequeBanco: null, chequeFechaPago: null }]
            ).map((x, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 py-2.5">
                <span>
                  {NOMBRE_DEL_MEDIO[x.medio] ?? x.medio}
                  <span className="text-muted-foreground">
                    {x.chequeNumero
                      ? ` · N.º ${x.chequeNumero}${x.chequeBanco ? ` · ${x.chequeBanco}` : ""}${
                          x.chequeFechaPago ? ` · al ${fechaCorta.format(x.chequeFechaPago)}` : ""
                        }`
                      : x.referencia
                        ? ` · ${x.referencia}`
                        : ""}
                  </span>
                </span>
                <span className="tabular font-semibold">{formatearMonto(x.importe)}</span>
              </li>
            ))}
            {p.efectivoEnCaja > 0 && (
              <li className="py-2.5 text-base text-muted-foreground">
                {formatearMonto(p.efectivoEnCaja)} salieron de la caja de {p.caja}
              </li>
            )}
          </ul>
        </section>
      </div>

      {p.retenciones.length > 0 && (
        <section className="tarjeta p-5">
          <h2 className="text-[19px] font-bold tracking-tight">Retenciones</h2>
          <ul className="mt-3 divide-y divide-linea-suave">
            {p.retenciones.map((r) => (
              <li key={r.numero} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5">
                <a
                  href={`/admin/compras/pagos/certificado/${encodeURIComponent(r.numero)}`}
                  target="_blank"
                  className={`inline-flex items-center gap-1.5 hover:underline ${r.anuladaAt ? "line-through" : ""}`}
                >
                  <FileCheck2 className="h-4 w-4" aria-hidden="true" />
                  <span className="tabular">{r.numero}</span>
                  <span className="text-muted-foreground">· {r.nombreRegimen ?? r.codigoRegimen}</span>
                </a>
                <span className="tabular">
                  <span className="text-muted-foreground">sobre {formatearMonto(r.base)} · </span>
                  <span className="font-semibold">{formatearMonto(r.importe)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.notas && <p className="tarjeta-hundida rounded-xl px-5 py-4 text-base">{p.notas}</p>}
    </div>
  );
}

function Cifra({ titulo, valor, grande }: { titulo: string; valor: number; grande?: boolean }) {
  return (
    <div>
      <p className="text-base text-muted-foreground">{titulo}</p>
      <p className={`tabular font-bold ${grande ? "text-3xl" : "text-2xl"}`}>{formatearMonto(valor)}</p>
    </div>
  );
}
