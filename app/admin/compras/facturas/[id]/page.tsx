import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { esUuid } from "@/lib/uuid";
import { fichaDeFacturaDeCompra } from "@/lib/dal/admin/compras-fiscal";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { facturasConSaldo } from "@/lib/dal/admin/pagos-proveedor";
import { fechaCorta, formatearMonto } from "@/lib/formato";
import {
  daCreditoFiscal,
  nombreComprobanteCompra,
  numeroDeCompra,
} from "@/lib/fiscal/comprobantes-compra";
import { EncabezadoFicha } from "@/components/admin/encabezado-ficha";
import { NOMBRE_DEL_MEDIO } from "../../pagos/medios";
import { AccionesDeFactura, AplicarNota } from "./acciones";

export const metadata: Metadata = { title: "Factura de compra" };

/** El día guardado (medianoche UTC) como aaaa-mm-dd, para los campos de fecha. */
const comoDia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Una factura de compra: lo que dice el papel, la mercadería que cubre y los
 * pagos que la cancelaron.
 *
 * Antes la factura era una fila del listado y nada más: no había dónde ver con
 * qué se pagó, ni cómo corregirla o anularla si se cargó mal (había que pedir
 * un arreglo en la base). La ficha es el lugar de esas tres cosas.
 */
export default async function FacturaDeCompraPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const usuario = await requireStaff();
  if (!puedeEntrar("/admin/compras/facturas", usuario.staffRole)) notFound();

  const { id } = await params;
  if (!esUuid(id)) notFound();
  const [f, proveedores] = await Promise.all([fichaDeFacturaDeCompra(id), proveedoresParaElegir()]);
  if (!f) notFound();

  const saldo = Math.round((f.total - f.pagado) * 100) / 100;
  const esCredito = f.tipo.startsWith("nota_credito");
  // La nota de crédito a favor se aplica desde acá a una factura con saldo.
  const aplicables =
    esCredito && !f.anuladaAt && !f.aplicaA
      ? (await facturasConSaldo(f.supplierId)).filter(
          (x) => !x.tipo.startsWith("nota_credito") && x.tipo !== "cheque_rechazado" && x.saldo - f.total > -0.01,
        )
      : [];
  // Desde la factura con saldo, las notas a favor del mismo proveedor: no
  // había cómo llegar a la nota que la corrige (M4-039).
  const notasAFavor =
    !esCredito && !f.anuladaAt && saldo > 0.01
      ? (await facturasConSaldo(f.supplierId)).filter((x) => x.tipo.startsWith("nota_credito"))
      : [];
  const flete = f.flete ?? 0;
  const diferencia =
    Math.round((f.neto - f.renglones.reduce((s, r) => s + r.cantidad * r.costoUnitario, 0) - flete) * 100) / 100;
  const estado = f.anuladaAt
    ? { texto: "Anulada", clase: "text-saldo-debe" }
    : esCredito
      ? f.aplicaA
        ? { texto: `Aplicada a ${f.aplicaA}`, clase: "text-muted-foreground" }
        : { texto: "A favor", clase: "text-saldo-favor" }
      : saldo <= 0.01
        ? { texto: "Pagada", clase: "text-saldo-favor" }
        : f.pagado > 0
          ? { texto: `Faltan ${formatearMonto(saldo)}`, clase: "text-saldo-debe" }
          : { texto: "Sin pagar", clase: "text-saldo-debe" };

  const importes: [string, number][] = (
    [
      ["Neto gravado", f.neto],
      ["IVA 21%", f.iva21],
      ["IVA 10,5%", f.iva105],
      ["IVA 27%", f.iva27],
      ["Exento o no gravado", f.exento],
      ...(f.percepcionIva + f.percepcionIibb > 0
        ? ([
            ["Percepción de IVA", f.percepcionIva],
            ["Percepción de IIBB", f.percepcionIibb],
          ] as [string, number][])
        : ([["Percepciones", f.percepciones]] as [string, number][])),
    ] as [string, number][]
  ).filter(([, v]) => v !== 0);

  return (
    <div className="space-y-6">
      <EncabezadoFicha
        volverA="/admin/compras/facturas"
        volverTexto="Facturas de compra"
        titulo={`${nombreComprobanteCompra(f.tipo)} ${numeroDeCompra(f.puntoVenta, f.numero)}`}
        estado={<span className={`text-base font-semibold ${estado.clase}`}>{estado.texto}</span>}
        detalle={
          <>
            <Link href={`/admin/proveedores/${f.supplierId}`} className="hover:underline">
              {f.proveedor}
            </Link>
            {` · del ${fechaCorta.format(f.fechaEmision)}`}
            {/* Una nota de crédito no vence: resta (las de antes guardaban la fecha). */}
            {f.fechaVencimiento && !esCredito && ` · vence ${fechaCorta.format(f.fechaVencimiento)}`}
          </>
        }
        acciones={
          aplicables.length > 0 ? (
            <AplicarNota
              nota={f.id}
              supplierId={f.supplierId}
              facturas={aplicables.map((x) => ({ id: x.id, numero: x.numero, saldo: x.saldo }))}
            />
          ) : !f.anuladaAt && !esCredito && saldo > 0.01 ? (
            <>
              {notasAFavor.map((n) => (
                <Link
                  key={n.id}
                  href={`/admin/compras/facturas/${n.id}`}
                  className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
                >
                  <span className="tabular whitespace-nowrap">NC {n.numero}</span>
                  <span className="tabular text-saldo-favor">−{formatearMonto(n.saldo)}</span>
                </Link>
              ))}
              <Link
                href={`/admin/compras/pagos?proveedor=${f.supplierId}&factura=${f.id}`}
                className="boton-accion inline-flex h-11 items-center rounded-xl px-5 text-base font-semibold"
              >
                Pagar {formatearMonto(saldo)}
              </Link>
            </>
          ) : undefined
        }
      />

      {f.anuladaAt && (
        <p className="tarjeta-hundida rounded-xl px-5 py-4 text-base">
          <span className="font-semibold text-saldo-debe">Anulada el {fechaCorta.format(f.anuladaAt)}</span>
          {f.motivoAnulacion && ` · ${f.motivoAnulacion}`}
        </p>
      )}

      <div className={`grid gap-6 ${esCredito && !f.aplicaA ? "" : "lg:grid-cols-[minmax(0,1fr)_22rem]"}`}>
        <section className="tarjeta p-5">
          <dl className="divide-y divide-linea-suave">
            {importes.map(([nombre, valor]) => (
              <div key={nombre} className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted-foreground">{nombre}</dt>
                <dd className="tabular">{formatearMonto(valor)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 pt-3">
              <dt className="text-lg font-semibold">Total</dt>
              <dd className="tabular text-2xl font-bold">{formatearMonto(f.total)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-base text-muted-foreground">
            {/* Anulada, no da crédito fiscal: decía «Da crédito fiscal» debajo
                de «Anulada» (M3S3-025). */}
            {[
              // La nota de crédito A recibida resta crédito fiscal (mes 23).
              f.anuladaAt
                ? null
                : !daCreditoFiscal(f.tipo)
                  ? "Sin crédito fiscal"
                  : esCredito
                    ? "Resta crédito fiscal"
                    : "Da crédito fiscal",
              f.cae ? `CAE ${f.cae}` : null,
              f.numeroRemito ? `Remito ${f.numeroRemito}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {f.observaciones && <p className="mt-2 text-base">{f.observaciones}</p>}
        </section>

        {/* Una nota de crédito no se paga: resta. En vez de «Pagos: Ninguno»,
            a qué factura se aplicó, si se aplicó (mes 23). */}
        {esCredito ? (
          f.aplicaA && (
            <section className="tarjeta p-5">
              <h2 className="text-[19px] font-bold tracking-tight">Aplicada a</h2>
              {f.aplicaAId ? (
                <Link href={`/admin/compras/facturas/${f.aplicaAId}`} className="codigo mt-3 inline-block text-base font-medium hover:underline">
                  {f.aplicaA}
                </Link>
              ) : (
                <p className="codigo mt-3 text-base font-medium">{f.aplicaA}</p>
              )}
            </section>
          )
        ) : (
        <section className="tarjeta p-5">
          <h2 className="text-[19px] font-bold tracking-tight">Pagos</h2>
          {f.pagos.length === 0 && f.creditos.length === 0 ? (
            <p className="mt-3 text-base text-muted-foreground">Ninguno</p>
          ) : (
            // Lo que la canceló: los pagos, con todos sus medios (uno en
            // transferencia y cheque se leía solo como transferencia), y las
            // notas de crédito aplicadas, que también la completan.
            <ul className="mt-3 divide-y divide-linea-suave">
              {f.pagos.map((p) => (
                <li key={p.pagoId}>
                  <Link
                    href={`/admin/compras/pagos/${p.pagoId}`}
                    className="flex items-baseline justify-between gap-3 py-2.5 hover:underline"
                  >
                    <span className="min-w-0">
                      {fechaCorta.format(p.fecha)} ·{" "}
                      {(p.medios.length ? p.medios : [p.medio])
                        .map((m, i) => {
                          const nombre = NOMBRE_DEL_MEDIO[m] ?? m;
                          return i === 0 ? nombre : nombre.toLowerCase();
                        })
                        .join(" y ")}
                    </span>
                    <span className="tabular shrink-0 font-semibold">{formatearMonto(p.aplicado)}</span>
                  </Link>
                </li>
              ))}
              {f.creditos.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/compras/facturas/${c.id}`}
                    className="flex items-baseline justify-between gap-3 py-2.5 hover:underline"
                  >
                    <span className="min-w-0">
                      {fechaCorta.format(c.fecha)} · Nota de crédito <span className="codigo">{c.numero}</span>
                    </span>
                    <span className="tabular shrink-0 font-semibold">{formatearMonto(c.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        )}
      </div>

      {f.renglones.length > 0 && (
        <section className="tarjeta overflow-hidden">
          <h2 className="px-5 pt-5 text-[19px] font-bold tracking-tight">{f.devolucion ? "Devuelto" : "Mercadería"}</h2>
          {/* Sin ancho mínimo: en el teléfono la tabla se apila sola. */}
          <div>
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Producto</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Cantidad</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Costo neto</th>
                  <th className="px-5 py-2.5 text-right font-semibold">IVA</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {f.renglones.map((r, i) => (
                  <tr key={i}>
                    <td className="px-5 py-3">
                      {r.producto ?? "—"}
                      {r.variante && <span className="text-muted-foreground"> · {r.variante}</span>}
                    </td>
                    <td className="tabular px-5 py-3 text-right">{r.cantidad.toLocaleString("es-AR")}</td>
                    <td className="tabular px-5 py-3 text-right">{formatearMonto(r.costoUnitario)}</td>
                    <td className="tabular px-5 py-3 text-right">{r.alicuotaIva.toLocaleString("es-AR")}%</td>
                    <td className="tabular px-5 py-3 text-right">{formatearMonto(r.cantidad * r.costoUnitario)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* El flete y la diferencia facturada, para que la mercadería sume
              el neto de arriba (M2S1-123). */}
          {!f.devolucion && (flete > 0.009 || Math.abs(diferencia) > 0.009) && (
            <dl className="tabular space-y-1 border-t border-linea px-5 py-3 text-base">
              {flete > 0.009 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Flete y gastos</dt>
                  <dd>{formatearMonto(flete)}</dd>
                </div>
              )}
              {Math.abs(diferencia) > 0.009 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Diferencia facturada</dt>
                  <dd>
                    {diferencia > 0 ? "+" : "−"}
                    {formatearMonto(Math.abs(diferencia))}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3 pt-1">
                <dt className="font-semibold">Neto</dt>
                <dd className="font-bold">{formatearMonto(f.neto)}</dd>
              </div>
            </dl>
          )}
        </section>
      )}

      {!f.anuladaAt && (
        <AccionesDeFactura
          factura={{
            id: f.id,
            supplierId: f.supplierId,
            tipo: f.tipo,
            puntoVenta: f.puntoVenta,
            numero: f.numero,
            fechaEmision: comoDia(f.fechaEmision),
            fechaVencimiento: f.fechaVencimiento ? comoDia(f.fechaVencimiento) : null,
            cae: f.cae,
            neto: f.neto,
            iva21: f.iva21,
            iva105: f.iva105,
            iva27: f.iva27,
            exento: f.exento,
            percepciones: f.percepciones,
            percepcionIva: f.percepcionIva,
            percepcionIibb: f.percepcionIibb,
            observaciones: f.observaciones,
          }}
          titulo={`${nombreComprobanteCompra(f.tipo)} ${numeroDeCompra(f.puntoVenta, f.numero)}`}
          total={f.total}
          pagado={f.pagado}
          proveedor={f.proveedor}
          proveedores={proveedores}
        />
      )}
    </div>
  );
}
