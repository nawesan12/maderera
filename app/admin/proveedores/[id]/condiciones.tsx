"use client";

import { useActionState, useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  borrarCondicion,
  guardarCondicion,
  guardarConvenios,
  type EstadoCondicion,
} from "./condiciones-actions";

const inicial: EstadoCondicion = {};

const MODALIDADES: Record<string, string> = {
  transferencia: "Transferencia",
  cheque: "Cheque",
  echeq: "e-Cheq",
  efectivo: "Efectivo",
  otro: "Otra",
};

export interface CondicionUI {
  id: string;
  modalidad: string;
  plazoDias: number;
  bonificacionPct: string;
  detalle: string | null;
}

/**
 * Las condiciones comerciales del proveedor, por escrito.
 *
 * Cada renglón es una forma de pagarle y qué da a cambio: "transferencia a
 * 30 días, 5 % de bonificación". El texto de convenios queda para lo pactado
 * que no entra en una fila.
 */
export function CondicionesDelProveedor({
  supplierId,
  condiciones,
  convenios,
}: {
  supplierId: string;
  condiciones: CondicionUI[];
  convenios: string | null;
}) {
  const [borrando, empezarBorrado] = useTransition();

  return (
    <section className="tarjeta space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold">Condiciones comerciales</h2>
        <p className="text-sm text-muted-foreground">
          Cómo acepta cobrar y qué bonifica por cada forma. Queda por escrito y
          el formulario de pago lo muestra.
        </p>
      </div>

      {condiciones.length > 0 && (
        <ul className="divide-y divide-linea-tenue">
          {condiciones.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 text-base">
                <strong>{MODALIDADES[c.modalidad] ?? c.modalidad}</strong>
                {" · "}
                {c.plazoDias === 0 ? "contado" : `a ${c.plazoDias} días`}
                {Number(c.bonificacionPct) > 0 && (
                  <span className="font-medium text-saldo-favor">
                    {" "}
                    · {Number(c.bonificacionPct)}% de bonificación
                  </span>
                )}
                {c.detalle && (
                  <span className="block text-sm text-muted-foreground">
                    {c.detalle}
                  </span>
                )}
              </span>
              <button
                type="button"
                disabled={borrando}
                onClick={() =>
                  empezarBorrado(async () => {
                    await borrarCondicion(c.id, supplierId);
                  })
                }
                aria-label="Borrar esta condición"
                className="h-9 w-9 rounded-lg border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <Trash2 className="mx-auto h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <AltaDeCondicion supplierId={supplierId} />

      <EditorDeConvenios supplierId={supplierId} inicial={convenios ?? ""} />
    </section>
  );
}

function AltaDeCondicion({ supplierId }: { supplierId: string }) {
  const [estado, guardar, guardando] = useActionState(guardarCondicion, inicial);

  return (
    <form
      action={guardar}
      className="flex flex-wrap items-end gap-2 border-t border-linea-tenue pt-4"
    >
      <input type="hidden" name="supplierId" value={supplierId} />

      <label className="block">
        <span className="text-sm font-medium">Modalidad</span>
        <select
          name="modalidad"
          className="mt-1 h-10 rounded-lg border bg-background px-2 text-base"
        >
          {Object.entries(MODALIDADES).map(([valor, texto]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium">Plazo (días)</span>
        <input
          name="plazoDias"
          type="number"
          min="0"
          max="365"
          defaultValue="0"
          className="tabular mt-1 h-10 w-24 rounded-lg border bg-background px-2.5 text-right text-base"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Bonifica %</span>
        <input
          name="bonificacionPct"
          inputMode="decimal"
          placeholder="0"
          className="tabular mt-1 h-10 w-24 rounded-lg border bg-background px-2.5 text-right text-base"
        />
      </label>

      <label className="block min-w-44 flex-1">
        <span className="text-sm font-medium">Detalle</span>
        <input
          name="detalle"
          placeholder="Topes, desde qué monto, qué banco"
          className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
        />
      </label>

      <button
        type="submit"
        disabled={guardando}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
      >
        {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
        Agregar
      </button>

      {estado.error && (
        <p className="w-full text-base text-destructive">{estado.error}</p>
      )}
    </form>
  );
}

function EditorDeConvenios({
  supplierId,
  inicial: valorInicial,
}: {
  supplierId: string;
  inicial: string;
}) {
  const [texto, setTexto] = useState(valorInicial);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, empezar] = useTransition();

  return (
    <div className="border-t border-linea-tenue pt-4">
      <label className="block">
        <span className="text-base font-medium">Convenios</span>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={3}
          placeholder="Lo pactado que no entra en una fila: precios sostenidos, flete, exclusividades."
          className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-base"
        />
      </label>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={guardando || texto === valorInicial}
          onClick={() =>
            empezar(async () => {
              const r = await guardarConvenios(supplierId, texto);
              setAviso(r.error ?? r.ok ?? null);
            })
          }
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar convenios
        </button>
        {aviso && <p className="text-sm text-muted-foreground">{aviso}</p>}
      </div>
    </div>
  );
}
