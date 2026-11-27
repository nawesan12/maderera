"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail, MessageCircle, Pencil, Send, Truck } from "lucide-react";
import {
  anularOrdenDeCompra,
  cambiarFechaDeOrden,
  cerrarOrdenConFaltante,
  marcarOrdenEnviada,
  recibirDeLaOrden,
  type EstadoOrden,
} from "../actions";
import { CampoFecha } from "@/components/ui/campo-fecha";
import { hoyEnArgentina } from "@/lib/formato";

/**
 * Lo que se puede hacer con una orden.
 *
 * "Recibir el remito" arma una recepción en borrador **con lo que falta ya
 * cargado**: el camión llega y lo que hay que hacer es confirmar cantidades, no
 * volver a buscar cada producto. Quien recibe corrige lo que vino de menos, y
 * la orden queda parcial sola.
 */
export function AccionesDeOrden({
  id,
  estado,
  falta,
  llegoAlgo = false,
  fechaPrometida = "",
  whatsapp,
  correo,
  borrador,
}: {
  id: string;
  estado: string;
  falta: boolean;
  /** Si ya llegó algo: se cierra con faltante en vez de anular. */
  llegoAlgo?: boolean;
  /** aaaa-mm-dd; se corrige mientras la orden no llegó entera. */
  fechaPrometida?: string;
  /** La recepción en borrador de esta orden: se corrige esa, no se hace otra. */
  borrador: { id: string; numeroRemito: string | null } | null;
  /** La orden armada para mandarle al proveedor, si tiene teléfono o correo. */
  whatsapp: string | null;
  correo: string | null;
}) {
  const router = useRouter();
  const [resultado, setResultado] = useState<EstadoOrden>({});
  const [enCurso, empezar] = useTransition();
  const [remito, setRemito] = useState("");
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState(fechaPrometida);

  // Completa o anulada, no queda nada por hacer: lo recibido se corrige
  // anulando la recepción (M2S1-138).
  if (estado === "anulada" || estado === "completa") return null;

  const recibible = (estado === "enviada" || estado === "parcial") && falta;
  // De la que ya llegó una parte, «Cerrar con faltante» reemplaza a anular.
  const cerrar = estado === "parcial" && llegoAlgo;

  return (
    <section className="tarjeta space-y-3 p-5">
      {(resultado.error || resultado.ok) && (
        <p
          className={`text-base ${resultado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {resultado.error ?? resultado.ok}
        </p>
      )}

      {(whatsapp || correo || estado === "borrador") && (
        <div className="flex flex-wrap gap-2">
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener"
              className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Mandar por WhatsApp
            </a>
          )}
          {correo && (
            <a href={correo} className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium">
              <Mail className="h-4 w-4" aria-hidden="true" />
              Por correo
            </a>
          )}
          {estado === "borrador" && (
            <Link
              href={`/admin/compras/ordenes/${id}/editar`}
              className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Corregir
            </Link>
          )}
        </div>
      )}

      {estado === "borrador" && (
        <button
          type="button"
          onClick={() =>
            empezar(async () => {
              const r = await marcarOrdenEnviada(id);
              setResultado(r);
              if (r.ok) router.refresh();
            })
          }
          disabled={enCurso}
          className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-60 sm:w-auto"
        >
          {enCurso ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Marcar como enviada
        </button>
      )}

      {recibible && borrador && (
        <Link
          href={`/admin/recepciones/${borrador.id}`}
          className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold sm:w-auto"
        >
          <Truck className="h-4 w-4" aria-hidden="true" />
          {borrador.numeroRemito ? (
            <>
              Seguir con el remito <span className="codigo">{borrador.numeroRemito}</span>
            </>
          ) : (
            "Seguir con la recepción"
          )}
        </Link>
      )}

      {recibible && !borrador && (
        <div className="grid gap-2 sm:flex sm:items-end">
          <label className="block min-w-0 sm:flex-1">
            <span className="text-base font-medium">Número de remito</span>
            <input
              value={remito}
              onChange={(e) => setRemito(e.target.value)}
              placeholder="0002-00034512"
              className="tabular mt-1 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
            />
          </label>
          <button
            type="button"
            onClick={() =>
              empezar(async () => {
                const r = await recibirDeLaOrden(id, remito);
                setResultado(r);
                if (r.id) router.push(`/admin/recepciones/${r.id}`);
              })
            }
            disabled={enCurso}
            className="boton-accion inline-flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-60 sm:w-auto"
          >
            {enCurso ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Truck className="h-4 w-4" />
            )}
            Recibir el remito
          </button>
        </div>
      )}

      {/* La fecha prometida se corrige mientras no llegó todo (M3S4-020). */}
      {(estado === "enviada" || estado === "parcial") && (
        <div className="flex flex-wrap items-end gap-2 border-t border-linea pt-3">
          <label className="block">
            <span className="text-base font-medium">Llega el</span>
            <CampoFecha
              value={fecha}
              min={hoyEnArgentina()}
              onChange={(e) => setFecha(e.target.value)}
              className="tabular mt-1 h-11 w-40 rounded-lg border border-linea bg-background px-3 text-base"
            />
          </label>
          <button
            type="button"
            disabled={enCurso || fecha === fechaPrometida}
            onClick={() =>
              empezar(async () => {
                const r = await cambiarFechaDeOrden(id, fecha);
                setResultado(r);
                if (r.ok) router.refresh();
              })
            }
            className="tarjeta-hundida h-11 rounded-lg px-4 text-base font-medium disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      )}

      <details className="border-t border-linea pt-3">
        <summary className="cursor-pointer text-base text-muted-foreground">
          {cerrar ? "Cerrar con faltante" : "Anular esta orden"}
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo"
            className="h-11 min-w-0 flex-1 rounded-lg border border-linea bg-background px-3 text-base"
          />
          <button
            type="button"
            onClick={() =>
              empezar(async () => {
                const r = cerrar ? await cerrarOrdenConFaltante(id, motivo) : await anularOrdenDeCompra(id, motivo);
                setResultado(r);
                if (r.ok) router.refresh();
              })
            }
            disabled={enCurso || (!cerrar && !motivo.trim())}
            className="h-11 shrink-0 rounded-lg border border-linea px-4 text-base font-medium disabled:opacity-50"
          >
            {cerrar ? "Cerrar" : "Anular"}
          </button>
        </div>
      </details>
    </section>
  );
}
