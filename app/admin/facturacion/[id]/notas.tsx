"use client";

import { useState, useTransition } from "react";
import { Loader2, MinusCircle, PlusCircle, Undo2 } from "lucide-react";
import { formatearCantidad, leerCantidad } from "@/lib/unidades";
import { formatearMonto, importeDelCampo, importeIlegible } from "@/lib/formato";
import type { DatosDeDevolucion } from "@/lib/dal/admin/facturacion";
import { acreditarParcial, debitar, type EstadoFactura } from "../actions";
import { Confirmar } from "@/components/admin/confirmar";
import { Devolucion } from "./devolucion";

interface Renglon {
  id: string;
  descripcion: string;
  cantidad: number;
  subtotal: number;
}

/**
 * Notas de crédito parciales y notas de débito.
 *
 * Van juntas y plegadas porque son la excepción: lo normal es facturar y
 * cobrar. Desplegadas permanentemente empujarían fuera de pantalla los datos
 * del comprobante, que es lo que se viene a mirar.
 *
 * **Una nota parcial no anula el original.** Para anular está el botón de
 * anular, que es una decisión explícita con consecuencias en el libro IVA.
 *
 * La factura de una venta no lleva nota parcial suelta: lleva Devolución,
 * que además devuelve el stock y la plata (una nota sola bajaba el IVA y
 * dejaba la caja, la cuenta y el depósito como si nada).
 */
export function NotasSobreElComprobante({
  invoiceId,
  items,
  total,
  acreditado,
  revierteConDebito = false,
  devolucion = null,
  soloDevolucion = false,
}: {
  invoiceId: string;
  items: Renglon[];
  total: number;
  acreditado: number;
  /** Es una nota de crédito: se revierte con una nota de débito. */
  revierteConDebito?: boolean;
  /** La factura es de una venta: en vez de la nota parcial, la devolución. */
  devolucion?: DatosDeDevolucion | null;
  /** La factura espera el CAE: solo la devolución (la nota de débito, después). */
  soloDevolucion?: boolean;
}) {
  const reverso = revierteConDebito ? "Nota de débito parcial (revierte la nota de crédito)" : "Nota de crédito parcial";
  const [modo, setModo] = useState<"credito" | "debito" | null>(null);
  const [estado, setEstado] = useState<EstadoFactura>({});
  const [enCurso, empezar] = useTransition();

  const [motivo, setMotivo] = useState("");
  const [cantidades, setCantidades] = useState<Record<string, string>>({});

  const [concepto, setConcepto] = useState("");
  const [importe, setImporte] = useState("");
  const [alicuota, setAlicuota] = useState("21");

  const disponible = total - acreditado;
  // Las cantidades se leen como cantidades y no como importes: «0.125» m³ es
  // un octavo, no 125 (con importeDelCampo, «x.yyy» son miles).
  const cantidadDe = (id: string) => {
    const n = leerCantidad(cantidades[id]);
    return Number.isFinite(n) ? n : 0;
  };
  const cantidadMala = (i: { id: string; cantidad: number }) => {
    const t = cantidades[i.id];
    if (!t || !t.trim()) return false;
    const n = leerCantidad(t);
    return !Number.isFinite(n) || n < 0 || n > i.cantidad + 1e-9;
  };
  const algunaMala = modo === "credito" && items.some(cantidadMala);
  const [confirmando, setConfirmando] = useState(false);
  // Lo que va a salir, para decirlo antes de emitir: es un comprobante fiscal.
  const importeDeLaNota =
    modo === "credito"
      ? items.reduce((s, i) => s + (i.cantidad > 0 ? (cantidadDe(i.id) / i.cantidad) * i.subtotal : 0), 0)
      : importeDelCampo(importe);

  if (modo === null) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {disponible > 0.005 && (
            <button
              type="button"
              onClick={() => setModo("credito")}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-base font-medium hover:bg-hundida"
            >
              {devolucion ? <Undo2 className="h-4 w-4" /> : <MinusCircle className="h-4 w-4" />}
              {devolucion ? "Devolución" : reverso}
            </button>
          )}
          {!soloDevolucion && (
            <button
              type="button"
              onClick={() => setModo("debito")}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-base font-medium hover:bg-hundida"
            >
              <PlusCircle className="h-4 w-4" />
              Nota de débito
            </button>
          )}
        </div>
      </div>
    );
  }

  if (modo === "credito" && devolucion) {
    return <Devolucion invoiceId={invoiceId} datos={devolucion} alCancelar={() => setModo(null)} />;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">
        {modo === "credito"
          ? reverso
          : "Nota de débito"}
      </h3>

      {modo === "credito" ? (
        <>
          <p className="text-sm text-muted-foreground">
            {/* El precio unitario sale de la factura original. */}
            Poné cuánto se acredita de cada renglón.{" "}
            <strong>El comprobante no queda anulado.</strong>
          </p>

          <ul className="divide-y divide-linea rounded-lg border border-linea">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-base">{i.descripcion}</span>
                  <span className="tabular block text-sm text-muted-foreground">
                    {formatearCantidad(i.cantidad)} × {formatearMonto(i.subtotal / i.cantidad)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Cuánto se acredita de ${i.descripcion}`}
                    value={cantidades[i.id] ?? ""}
                    onChange={(e) =>
                      setCantidades((prev) => ({ ...prev, [i.id]: e.target.value }))
                    }
                    aria-invalid={cantidadMala(i) || undefined}
                    aria-describedby={`maximo-${i.id}`}
                    placeholder="0"
                    className="tabular h-10 w-24 rounded-lg border border-linea bg-background px-2 text-right text-base"
                  />
                  <span
                    id={`maximo-${i.id}`}
                    className={`tabular mt-0.5 block text-xs ${cantidadMala(i) ? "text-saldo-debe" : "text-muted-foreground"}`}
                  >
                    Máximo {formatearCantidad(i.cantidad)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium">Concepto</span>
            <input
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Intereses por mora"
              className="mt-1 h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Importe final</span>
            <input
              type="text"
              inputMode="decimal"
              value={importe}
              aria-invalid={importeIlegible(importe) || undefined}
              onChange={(e) => setImporte(e.target.value)}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-background px-3 text-right text-base"
            />
            <span className="text-sm text-muted-foreground">
              Con IVA adentro, como en el catálogo.
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Alícuota</span>
            <select
              value={alicuota}
              onChange={(e) => setAlicuota(e.target.value)}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
            >
              {["0", "10.5", "21", "27"].map((a) => (
                <option key={a} value={a}>
                  {a}%
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="block">
        <span className="text-sm font-medium">Motivo</span>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Devolución de dos placas falladas"
          className="mt-1 h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
        />
      </label>

      {estado.error && <p className="text-base text-saldo-debe">{estado.error}</p>}

      <div className="flex flex-wrap gap-2">
        <Confirmar
          abierto={confirmando}
          alCerrar={() => setConfirmando(false)}
          titulo={`${modo === "credito" ? reverso : "Nota de débito"} por ${formatearMonto(importeDeLaNota)}`}
          detalle="Va a ARCA y no se borra. Para revertirla hay que emitir la nota contraria."
          confirmar="Emitir"
          alConfirmar={() => {
            setConfirmando(false);
            empezar(async () => {
              const r =
                modo === "credito"
                  ? await acreditarParcial(
                      invoiceId,
                      motivo,
                      items.map((i) => ({
                        itemId: i.id,
                        cantidad: cantidadDe(i.id),
                      })),
                    )
                  : await debitar(
                      invoiceId,
                      motivo,
                      concepto,
                      importeDelCampo(importe),
                      Number(alicuota),
                    );
              // Si sale bien, la acción redirige a la nota emitida.
              setEstado(r ?? {});
            });
          }}
        />
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          disabled={
            enCurso ||
            motivo.trim().length < 4 ||
            (modo === "debito" && importeIlegible(importe)) ||
            algunaMala ||
            importeDeLaNota <= 0
          }
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-4 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          Emitir
        </button>
        <button
          type="button"
          onClick={() => {
            setModo(null);
            setEstado({});
          }}
          className="h-11 rounded-lg border border-linea px-4 text-base"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
