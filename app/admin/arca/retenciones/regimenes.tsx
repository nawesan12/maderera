"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { guardarRegimen, type EstadoRegimen } from "./actions";

const inicial: EstadoRegimen = {};

export interface RegimenEditable {
  id: string;
  codigo: string;
  nombre: string;
  impuesto: string;
  jurisdiccion: string | null;
  alicuota: number;
  alicuotaNoInscripto: number;
  minimoNoImponible: number;
  minimoRetencion: number;
  activo: boolean;
}

const IMPUESTOS: Record<string, string> = {
  ganancias: "Ganancias",
  iva: "IVA",
  suss: "SUSS",
  iibb: "Ingresos Brutos",
};

/**
 * Las alícuotas con las que se retiene, editables.
 *
 * **Por qué hacía falta.** La tabla se sembraba con un script y no se podía
 * tocar desde ninguna pantalla: cambiar una alícuota —que ARCA actualiza por
 * resolución varias veces al año— era entrar a la base. Y el pedido concreto de
 * la clienta fue justamente ése: «ya no les retienen tantos impuestos, solo
 * ingresos brutos, dejar en 0 los demás sin borrarlos».
 *
 * **Cero no es borrar.** Un régimen en cero no retiene nada pero sigue a la
 * vista, con su código y su mínimo, listo para el día que vuelva a
 * corresponder. Borrarlo perdería el código —que va impreso en el certificado—
 * y dejaría los certificados viejos apuntando a nada.
 */
export function Regimenes({ regimenes }: { regimenes: RegimenEditable[] }) {
  return (
    <section className="tarjeta overflow-hidden">
      <header className="border-b border-linea px-5 py-4">
        <h2 className="text-base font-medium">Con qué se retiene</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Las alícuotas y los mínimos de cada régimen. Las actualiza ARCA por
          resolución: acá se cambian sin tocar el sistema. Una alícuota en cero
          deja el régimen cargado pero sin retener.
        </p>
      </header>

      <ul className="divide-y divide-linea">
        {regimenes.map((r) => (
          <Fila key={r.id} regimen={r} />
        ))}
      </ul>
    </section>
  );
}

function Fila({ regimen }: { regimen: RegimenEditable }) {
  const [estado, guardar, guardando] = useActionState(guardarRegimen, inicial);
  const [alicuota, setAlicuota] = useState(String(regimen.alicuota));
  const [noInscripto, setNoInscripto] = useState(
    String(regimen.alicuotaNoInscripto),
  );
  const [activo, setActivo] = useState(regimen.activo);

  const cambio =
    Number(alicuota) !== regimen.alicuota ||
    Number(noInscripto) !== regimen.alicuotaNoInscripto ||
    activo !== regimen.activo;

  return (
    <li className="px-5 py-3.5">
      <form action={guardar} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="id" value={regimen.id} />

        <div className="min-w-[14rem] flex-1">
          <p className="text-base font-medium">
            {regimen.nombre}
            {!regimen.activo && (
              <span className="ml-2 rounded-full bg-chip px-2 py-0.5 text-sm font-normal text-texto-2">
                apagado
              </span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="tabular">{regimen.codigo}</span> ·{" "}
            {IMPUESTOS[regimen.impuesto] ?? regimen.impuesto}
            {regimen.jurisdiccion && ` · ${regimen.jurisdiccion}`}
            {regimen.minimoNoImponible > 0 &&
              ` · mínimo no imponible $${regimen.minimoNoImponible.toLocaleString("es-AR")}`}
          </p>
        </div>

        <label className="block">
          <span className="text-sm text-muted-foreground">Alícuota %</span>
          <input
            name="alicuota"
            type="number"
            min="0"
            max="100"
            step="0.001"
            value={alicuota}
            onChange={(e) => setAlicuota(e.target.value)}
            className="tabular mt-1 h-10 w-24 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm text-muted-foreground">No inscripto %</span>
          <input
            name="alicuotaNoInscripto"
            type="number"
            min="0"
            max="100"
            step="0.001"
            value={noInscripto}
            onChange={(e) => setNoInscripto(e.target.value)}
            className="tabular mt-1 h-10 w-28 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
          />
        </label>

        <label className="flex h-10 items-center gap-2 text-base">
          <input
            type="checkbox"
            name="activo"
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
            className="h-4 w-4 accent-brand-orange"
          />
          En uso
        </label>

        {cambio && (
          <button
            type="submit"
            disabled={guardando}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-orange px-3.5 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        )}

        {(estado.error || estado.ok) && (
          <span
            className={`text-sm ${estado.error ? "text-destructive" : "text-muted-foreground"}`}
          >
            {estado.error ?? estado.ok}
          </span>
        )}
      </form>
    </li>
  );
}
