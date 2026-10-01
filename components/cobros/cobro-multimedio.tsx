"use client";

import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { formatearMonto, importeParaEditar, parsearImporte } from "@/lib/formato";
import { NOMBRE_DEL_MEDIO, esCheque, type MedioDeCobro } from "@/lib/cobros/partes";

/**
 * Con qué paga el cliente, renglón por renglón.
 *
 * Es el mismo componente en la ficha del cliente, en el cobro de una factura y
 * en el mostrador. Antes cada pantalla tenía su versión —la factura con un
 * solo medio y un texto libre de «referencia», la ficha con un importe y
 * nada más— y un cliente que pagaba con dos cheques y efectivo no se podía
 * cargar en ningún lado tal como pagó.
 *
 * Cada cheque pide banco, número y fecha de pago: es como se lo encuentra en
 * el banco (nota de la clienta del 30/9/2026) y lo que sale impreso en el
 * recibo. Las partes viajan como JSON en un campo oculto, `nombre`; el
 * servidor las lee con `leerPartes`.
 *
 * Se recorre entero con Enter, por `EnterAvanza` del panel: cada renglón nuevo
 * arranca con lo que falta, que es casi siempre lo que se va a cobrar.
 */

type Renglon = {
  clave: number;
  medio: MedioDeCobro;
  importe: string;
  referencia: string;
  banco: string;
  numero: string;
  fechaPago: string;
  librador: string;
};

const MEDIOS_POR_OMISION: MedioDeCobro[] = [
  "efectivo",
  "transferencia",
  "deposito",
  "cheque",
  "echeq",
  "tarjeta_debito",
  "tarjeta_credito",
];

/** Qué pide cada medio además del importe. */
function pideReferencia(medio: MedioDeCobro): string | null {
  if (medio === "transferencia" || medio === "deposito") return "N° de operación";
  if (medio === "tarjeta_debito" || medio === "tarjeta_credito") return "Lote y cupón";
  if (medio === "mercado_pago") return "N° de operación";
  return null;
}

let siguienteClave = 1;

function renglonNuevo(medio: MedioDeCobro, importe: number): Renglon {
  return {
    clave: siguienteClave++,
    medio,
    importe: importe > 0 ? importeParaEditar(importe) : "",
    referencia: "",
    banco: "",
    numero: "",
    fechaPago: "",
    librador: "",
  };
}

export function CobroMultimedio({
  aCobrar,
  nombre = "partes",
  medios = MEDIOS_POR_OMISION,
  medioInicial = "efectivo",
  circuito = "blanco",
}: {
  /** Lo que se espera cobrar. Es lo que se propone en el primer renglón. */
  aCobrar: number;
  nombre?: string;
  medios?: MedioDeCobro[];
  medioInicial?: MedioDeCobro;
  /** En el circuito B no se ofrece el e-Cheq: queda a nombre de la empresa. */
  circuito?: "blanco" | "negro";
}) {
  const id = useId();
  const [renglones, setRenglones] = useState<Renglon[]>(() => [
    renglonNuevo(medioInicial, aCobrar),
  ]);
  /** El renglón recién agregado recibe el foco: «Otro medio» y se sigue tipeando. */
  const [recienAgregado, setRecienAgregado] = useState<number | null>(null);

  const disponibles = medios.filter((m) => !(m === "echeq" && circuito === "negro"));
  const total = renglones.reduce((s, r) => s + (parsearImporte(r.importe) || 0), 0);
  const diferencia = Math.round((aCobrar - total) * 100) / 100;

  function cambiar(clave: number, campo: keyof Renglon, valor: string) {
    setRenglones((prev) => prev.map((r) => (r.clave === clave ? { ...r, [campo]: valor } : r)));
  }

  function agregar() {
    // El renglón nuevo propone lo que falta y un cheque, que es lo más común
    // cuando se parte un pago.
    const nuevo = renglonNuevo(
      disponibles.includes("cheque") ? "cheque" : disponibles[0]!,
      Math.max(diferencia, 0),
    );
    setRenglones((prev) => [...prev, nuevo]);
    setRecienAgregado(nuevo.clave);
  }

  function quitar(clave: number) {
    setRenglones((prev) => (prev.length > 1 ? prev.filter((r) => r.clave !== clave) : prev));
  }

  // Lo que viaja al servidor: el mismo formato que lee `leerPartes`.
  const serializado = JSON.stringify(
    renglones.map((r) => ({
      medio: r.medio,
      importe: r.importe,
      referencia: r.referencia || null,
      cheque: esCheque(r.medio)
        ? { numero: r.numero, banco: r.banco, librador: r.librador || null, fechaPago: r.fechaPago }
        : null,
    })),
  );

  return (
    <div className="space-y-3">
      <input type="hidden" name={nombre} value={serializado} />

      <ul className="space-y-2.5">
        {renglones.map((r, i) => {
          const referencia = pideReferencia(r.medio);
          return (
            <li key={r.clave} className="tarjeta-hundida space-y-2.5 rounded-xl p-3">
              <div className="flex flex-wrap items-end gap-2.5">
                <label className="min-w-40 flex-1 text-sm text-muted-foreground">
                  {renglones.length > 1 ? `Medio ${i + 1}` : "Con qué paga"}
                  <select
                    autoFocus={r.clave === recienAgregado}
                    value={r.medio}
                    onChange={(e) => cambiar(r.clave, "medio", e.target.value)}
                    className="mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-2.5 text-base text-foreground"
                  >
                    {disponibles.map((m) => (
                      <option key={m} value={m}>
                        {NOMBRE_DEL_MEDIO[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="w-40 text-sm text-muted-foreground">
                  Importe
                  <input
                    value={r.importe}
                    onChange={(e) => cambiar(r.clave, "importe", e.target.value)}
                    inputMode="decimal"
                    required
                    aria-label={`Importe del medio ${i + 1}`}
                    className="tabular mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-right text-base text-foreground"
                  />
                </label>
                {renglones.length > 1 && (
                  <button
                    type="button"
                    onClick={() => quitar(r.clave)}
                    aria-label={`Quitar el medio ${i + 1}`}
                    className="flex h-11 w-11 items-center justify-center rounded-lg border border-linea text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              {esCheque(r.medio) && (
                <div className="grid gap-2.5 sm:grid-cols-[1.3fr_1fr_0.9fr]">
                  <label className="text-sm text-muted-foreground">
                    Banco
                    <input
                      value={r.banco}
                      onChange={(e) => cambiar(r.clave, "banco", e.target.value)}
                      required
                      list={`${id}-bancos`}
                      placeholder="Banco Nación"
                      className="mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
                    />
                  </label>
                  <label className="text-sm text-muted-foreground">
                    N° de cheque
                    <input
                      value={r.numero}
                      onChange={(e) => cambiar(r.clave, "numero", e.target.value)}
                      required
                      inputMode="numeric"
                      placeholder="00012345"
                      className="tabular mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
                    />
                  </label>
                  <label className="text-sm text-muted-foreground">
                    Fecha de pago
                    <input
                      type="date"
                      value={r.fechaPago}
                      onChange={(e) => cambiar(r.clave, "fechaPago", e.target.value)}
                      required
                      className="tabular mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
                    />
                  </label>
                  <label className="text-sm text-muted-foreground sm:col-span-3">
                    Librador <span className="font-normal">(si no es el cliente)</span>
                    <input
                      value={r.librador}
                      onChange={(e) => cambiar(r.clave, "librador", e.target.value)}
                      className="mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
                    />
                  </label>
                </div>
              )}

              {referencia && (
                <label className="block text-sm text-muted-foreground">
                  {referencia} <span className="font-normal">(opcional)</span>
                  <input
                    value={r.referencia}
                    onChange={(e) => cambiar(r.clave, "referencia", e.target.value)}
                    className="tabular mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
                  />
                </label>
              )}
            </li>
          );
        })}
      </ul>

      <datalist id={`${id}-bancos`}>
        {BANCOS_FRECUENTES.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={agregar}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-base font-medium transition-colors hover:bg-hundida"
        >
          <Plus className="h-4 w-4" />
          {disponibles.every(esCheque) ? "Otro cheque" : "Otro medio"}
        </button>
        <p className="tabular text-base" aria-live="polite">
          Suma <strong>{formatearMonto(total)}</strong>
          {aCobrar > 0 && Math.abs(diferencia) >= 0.01 && (
            <span className={diferencia > 0 ? "text-muted-foreground" : "estado-espera"}>
              {" · "}
              {diferencia > 0
                ? `faltan ${formatearMonto(diferencia)}`
                : `${formatearMonto(-diferencia)} más de lo que debe`}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Los bancos que más aparecen en Mar del Plata, como sugerencia.
 *
 * Es una lista para escribir menos, no un catálogo cerrado: el campo acepta
 * cualquier banco. Escribirlos siempre igual es lo que hace que el control de
 * cheques repetidos los reconozca.
 */
const BANCOS_FRECUENTES = [
  "Banco Nación",
  "Banco Provincia",
  "Banco Galicia",
  "Banco Santander",
  "BBVA",
  "Banco Macro",
  "Banco Credicoop",
  "Banco Hipotecario",
  "Banco Patagonia",
  "Banco Supervielle",
  "Banco Ciudad",
  "ICBC",
  "HSBC",
  "Brubank",
];
