"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  PenLine,
  Printer,
  Truck,
  TriangleAlert,
} from "lucide-react";
import {
  anularRemito,
  prepararRemito,
  type EstadoEntrega,
} from "../entregas-actions";
import { fechaHora } from "@/components/admin/formato";
import type { RenglonPendiente } from "@/lib/entregas";
import type { RemitoListado } from "@/lib/dal/admin/entregas";

const inicial: EstadoEntrega = {};

/**
 * Acopio: lo que el cliente compró y todavía no se llevó.
 *
 * En una maderera esto es la mitad del mostrador. Se compra la obra entera, se
 * paga, y el material sale de a poco durante semanas. La pregunta que aparece
 * todo el tiempo —"¿cuánto me queda por retirar?"— tiene que responderse sin
 * revisar papeles.
 *
 * Las cantidades vienen precargadas con todo lo pendiente porque el caso más
 * común es llevarse el resto; quien retira una parte corrige el número.
 */
export function Entregas({
  orderId,
  tipoEntrega,
  pendientes,
  remitos,
}: {
  orderId: string;
  tipoEntrega: string;
  pendientes: RenglonPendiente[];
  remitos: RemitoListado[];
}) {
  const [estado, preparar, preparando] = useActionState(
    prepararRemito,
    inicial,
  );
  const [abierto, setAbierto] = useState(false);

  const conSaldo = pendientes.filter((p) => p.pendiente > 0.01);
  const hayAcopio = conSaldo.length > 0;
  const entregadoAlgo = pendientes.some((p) => p.entregado > 0);

  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4">
        <h2 className="text-base font-medium">Entregas y acopio</h2>
        {hayAcopio ? (
          <p className="text-base text-muted-foreground">
            Quedan {conSaldo.length} de {pendientes.length} renglones por
            retirar
          </p>
        ) : (
          <p className="text-base text-muted-foreground">
            No queda nada pendiente
          </p>
        )}
      </div>

      {entregadoAlgo && (
        <table className="w-full border-t">
          <thead>
            <tr className="border-b text-left">
              <th className="px-5 py-2.5 text-sm font-medium text-muted-foreground">
                Producto
              </th>
              <th className="px-4 py-2.5 text-right text-sm font-medium text-muted-foreground">
                Pedido
              </th>
              <th className="px-4 py-2.5 text-right text-sm font-medium text-muted-foreground">
                Entregado
              </th>
              <th className="px-5 py-2.5 text-right text-sm font-medium text-muted-foreground">
                En acopio
              </th>
            </tr>
          </thead>
          <tbody>
            {pendientes.map((p) => (
              <tr key={p.orderItemId} className="border-b last:border-0">
                <td className="px-5 py-3 text-base">{p.descripcion}</td>
                <td className="tabular px-4 py-3 text-right text-base text-muted-foreground">
                  {p.pedido}
                </td>
                <td className="tabular px-4 py-3 text-right text-base text-muted-foreground">
                  {p.entregado}
                </td>
                <td
                  className={`tabular px-5 py-3 text-right text-base font-medium ${
                    p.pendiente > 0 ? "text-brand-orange-dark" : ""
                  }`}
                >
                  {p.pendiente}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {remitos.length > 0 && (
        <ul className="divide-y border-t">
          {remitos.map((remito) => (
            <FilaRemito key={remito.id} remito={remito} orderId={orderId} />
          ))}
        </ul>
      )}

      {estado.ok && (
        <div className="border-t bg-brand-green/5 px-5 py-4">
          <p className="flex items-start gap-2 text-base">
            <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-green" />
            {estado.ok}
          </p>
          {estado.linkFirma && <LinkDeFirma ruta={estado.linkFirma} />}
        </div>
      )}

      {hayAcopio && (
        <div className="border-t">
          {!abierto ? (
            <div className="px-5 py-4">
              <button
                type="button"
                onClick={() => setAbierto(true)}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark"
              >
                <FileText className="h-5 w-5" />
                Preparar remito
              </button>
            </div>
          ) : (
            <form action={preparar} className="space-y-4 px-5 py-4">
              <input type="hidden" name="orderId" value={orderId} />
              <input type="hidden" name="tipo" value={tipoEntrega} />

              <div className="space-y-2">
                {conSaldo.map((p) => (
                  <div
                    key={p.orderItemId}
                    className="flex flex-wrap items-center gap-3"
                  >
                    <label
                      htmlFor={`cantidad-${p.orderItemId}`}
                      className="min-w-[12rem] flex-1 text-base"
                    >
                      {p.descripcion}
                      <span className="block text-muted-foreground">
                        Quedan {p.pendiente} {p.unidad.replace("_", " ")}
                      </span>
                    </label>
                    <input
                      id={`cantidad-${p.orderItemId}`}
                      name={`cantidad-${p.orderItemId}`}
                      inputMode="decimal"
                      defaultValue={p.pendiente}
                      className="tabular h-10 w-28 rounded-lg border bg-background px-3 text-right text-base"
                    />
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  nombre="receptorNombre"
                  etiqueta="Quién retira"
                  ayuda="Puede no ser el titular: el flete, un oficial."
                />
                <Campo nombre="receptorDocumento" etiqueta="Documento" />

                {tipoEntrega === "envio" && (
                  <>
                    <Campo
                      nombre="transportista"
                      etiqueta="Transportista"
                      ayuda="Andreani, CDI, flete propio…"
                    />
                    <Campo
                      nombre="numeroSeguimiento"
                      etiqueta="Número de seguimiento"
                    />
                  </>
                )}
              </div>

              {estado.error && (
                <p className="flex items-start gap-2 text-base text-destructive">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {estado.error}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={preparando}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
                >
                  {preparando && <Loader2 className="h-4 w-4 animate-spin" />}
                  Generar remito
                </button>
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
                  className="inline-flex h-10 items-center rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted"
                >
                  Cancelar
                </button>
                <p className="w-full text-base text-muted-foreground">
                  Al generarlo, la mercadería sale del stock.
                </p>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

function FilaRemito({
  remito,
  orderId,
}: {
  remito: RemitoListado;
  orderId: string;
}) {
  const [estado, anular, anulando] = useActionState(anularRemito, inicial);

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <span className="tabular min-w-[6rem] font-medium">{remito.numero}</span>

      <span className="min-w-[12rem] flex-1 text-base text-muted-foreground">
        {remito.tipo === "envio" ? (
          <span className="inline-flex items-center gap-1.5">
            <Truck className="h-4 w-4" />
            {remito.transportista ?? "Envío"}
            {remito.numeroSeguimiento && ` · ${remito.numeroSeguimiento}`}
          </span>
        ) : (
          `Retiro${remito.receptorNombre ? ` · ${remito.receptorNombre}` : ""}`
        )}
        <span className="block">{fechaHora.format(remito.createdAt)}</span>
      </span>

      {remito.estado === "anulada" ? (
        <span className="text-base text-muted-foreground line-through">
          Anulado
        </span>
      ) : remito.firmadoAt ? (
        <span className="inline-flex items-center gap-1.5 text-base text-brand-green">
          <PenLine className="h-4 w-4" />
          Firmado
        </span>
      ) : (
        <span className="text-base text-amber-700">Sin firmar</span>
      )}

      <div className="flex items-center gap-2">
        <Link
          href={`/remito/${remito.id}`}
          target="_blank"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <Printer className="h-4 w-4" />
          Imprimir
        </Link>

        <a
          href={`/api/remitos/${remito.id}/pdf`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
        >
          <Download className="h-4 w-4" />
          PDF
        </a>

        {remito.firmaToken && (
          <LinkDeFirma ruta={`/firmar/${remito.firmaToken}`} compacto />
        )}

        {remito.estado !== "anulada" && (
          <form action={anular}>
            <input type="hidden" name="deliveryId" value={remito.id} />
            <input type="hidden" name="orderId" value={orderId} />
            <button
              type="submit"
              disabled={anulando}
              className="inline-flex h-9 items-center rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
            >
              {anulando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Anular"
              )}
            </button>
          </form>
        )}
      </div>

      {estado.error && (
        <p className="w-full text-base text-destructive">{estado.error}</p>
      )}
      {estado.ok && (
        <p className="w-full text-base text-muted-foreground">{estado.ok}</p>
      )}
    </li>
  );
}

/**
 * El link para firmar.
 *
 * Se copia y se manda por WhatsApp, o se abre acá mismo para que el cliente
 * firme en la tablet del mostrador. Las dos formas de usarlo son reales, así
 * que están las dos.
 */
function LinkDeFirma({
  ruta,
  compacto = false,
}: {
  ruta: string;
  compacto?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${ruta}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin portapapeles, queda el botón de abrir.
    }
  }

  return (
    <span className={compacto ? "flex items-center gap-2" : "mt-3 flex flex-wrap items-center gap-2"}>
      <Link
        href={ruta}
        target="_blank"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
      >
        <PenLine className="h-4 w-4" />
        Firmar
      </Link>
      <button
        type="button"
        onClick={copiar}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
      >
        {copiado ? (
          <Check className="h-4 w-4 text-brand-green" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
        {copiado ? "Copiado" : "Copiar link"}
      </button>
    </span>
  );
}

function Campo({
  nombre,
  etiqueta,
  ayuda,
}: {
  nombre: string;
  etiqueta: string;
  ayuda?: string;
}) {
  return (
    <div>
      <label htmlFor={nombre} className="block text-base font-medium">
        {etiqueta}
      </label>
      <input
        id={nombre}
        name={nombre}
        className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
      />
      {ayuda && <p className="mt-1 text-base text-muted-foreground">{ayuda}</p>}
    </div>
  );
}
