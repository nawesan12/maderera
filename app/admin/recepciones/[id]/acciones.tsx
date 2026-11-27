"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { formatearMonto, importeDelCampo, importeIlegible, importeParaElCampo } from "@/lib/formato";
import { CampoImporte } from "@/components/admin/campo-importe";
import { anularRecepcion, confirmarRecepcion, editarRecepcion, type EstadoRecepcion } from "../actions";

interface Renglon {
  id: string;
  descripcion: string;
  sku: string | null;
  cantidad: number;
  costoUnitario: number;
}

const texto = (n: number) => (n ? String(n).replace(".", ",") : "0");
const leerCantidad = (t: string) => {
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * El borrador: lo que vino de cada renglón, su costo y el flete, y la
 * confirmación.
 *
 * Quien recibe corrige lo que vino de menos (o en cero, si no vino) y la
 * orden queda parcial sola. Confirmar pide un segundo toque porque mueve el
 * costo promedio y eso no se puede deshacer; el aviso va a todo el ancho y
 * los botones debajo (en el teléfono se leía una palabra por renglón, con el
 * botón encima del texto). Si hay cambios sin guardar, confirmar los guarda
 * primero.
 *
 * Los renglones a $0 se marcan: un cero deja el costo promedio en cero.
 */
export function BorradorDeRecepcion({
  id,
  items,
  gastos,
  veCostos,
}: {
  id: string;
  items: Renglon[];
  gastos: number;
  veCostos: boolean;
}) {
  const router = useRouter();
  const [resultado, setResultado] = useState<EstadoRecepcion>({});
  const [enCurso, empezar] = useTransition();
  const [seguro, setSeguro] = useState(false);
  const [cantidades, setCantidades] = useState(() => Object.fromEntries(items.map((i) => [i.id, texto(i.cantidad)])));
  const [costos, setCostos] = useState(() => Object.fromEntries(items.map((i) => [i.id, importeParaElCampo(i.costoUnitario)])));
  const [flete, setFlete] = useState(gastos ? importeParaElCampo(gastos) : "");

  const cant = (r: Renglon) => leerCantidad(cantidades[r.id] ?? "");
  const costo = (r: Renglon) => importeDelCampo(costos[r.id] ?? "");
  const cambiado =
    items.some((r) => cant(r) !== r.cantidad || (veCostos && costo(r) !== r.costoUnitario)) ||
    (veCostos && importeDelCampo(flete) !== gastos);
  const ilegible =
    items.some((r) => !(cant(r) >= 0)) ||
    (veCostos && (items.some((r) => importeIlegible(costos[r.id] ?? "")) || importeIlegible(flete)));
  const vienen = items.filter((r) => cant(r) > 0);
  const enCero = veCostos ? vienen.filter((r) => costo(r) === 0).length : 0;
  const mercaderia = items.reduce((t, r) => t + (cant(r) > 0 ? cant(r) * costo(r) : 0), 0);

  const datos = () => ({
    ...(veCostos ? { gastos: importeDelCampo(flete) } : {}),
    lineas: items.map((r) => ({ id: r.id, cantidad: cant(r), ...(veCostos ? { costoUnitario: costo(r) } : {}) })),
  });

  function guardar(): Promise<boolean> {
    return editarRecepcion(id, datos()).then((r) => {
      setResultado(r);
      return Boolean(r.ok);
    });
  }

  return (
    <>
      <section className="tarjeta overflow-hidden">
        <ul className="divide-y divide-linea">
          {items.map((r) => {
            const sale = cant(r) === 0;
            return (
              <li key={r.id} className={`grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${sale ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <p className="text-base font-medium">{r.descripcion}</p>
                  {r.sku && <p className="codigo text-sm text-muted-foreground">{r.sku}</p>}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block">
                    <span className="text-sm text-muted-foreground">Vino</span>
                    <input
                      inputMode="decimal"
                      value={cantidades[r.id]}
                      aria-invalid={!(cant(r) >= 0) || undefined}
                      onChange={(e) => setCantidades((p) => ({ ...p, [r.id]: e.target.value }))}
                      className="tabular mt-0.5 h-11 w-24 rounded-lg border border-linea bg-background px-2 text-right text-base"
                    />
                  </label>
                  {veCostos && (
                    <label className="block">
                      <span className="text-sm text-muted-foreground">Costo neto</span>
                      <CampoImporte
                        valor={costos[r.id]}
                        alCambiar={(v) => setCostos((p) => ({ ...p, [r.id]: v }))}
                        aria-label={`Costo de ${r.descripcion}`}
                        className={`tabular mt-0.5 h-11 w-32 rounded-lg border border-linea bg-background px-2 text-right text-base ${
                          !sale && costo(r) === 0 ? "ring-2 ring-saldo-debe" : ""
                        }`}
                      />
                    </label>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {veCostos && (
          <div className="grid gap-3 border-t border-linea px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block">
              <span className="text-sm text-muted-foreground">Flete y gastos</span>
              <CampoImporte
                valor={flete}
                alCambiar={setFlete}
                className="tabular mt-0.5 h-11 w-full rounded-lg border border-linea bg-background px-2 text-right text-base sm:w-40"
              />
            </label>
            <p className="tabular text-right">
              <span className="block text-sm text-muted-foreground">Neto total</span>
              <span className="text-xl font-bold">{formatearMonto(mercaderia + importeDelCampo(flete))}</span>
            </p>
          </div>
        )}
      </section>

      <section className="tarjeta space-y-3 p-5">
        <p className="estado-espera text-base font-medium">Todavía no entró al stock.</p>
        {(resultado.error || resultado.ok) && (
          <p className={`text-base ${resultado.error ? "text-saldo-debe" : "text-saldo-favor"}`} role="status">
            {resultado.error ?? resultado.ok}
          </p>
        )}

        {seguro ? (
          <div className="space-y-3">
            <p className="text-base">
              Entra el stock, se mezcla el costo promedio y sube la deuda. <strong>El costo no se puede revertir.</strong>
              {enCero > 0 && (
                <strong className="estado-problema mt-1 block">
                  {enCero === 1 ? "1 renglón a $0" : `${enCero} renglones a $0`}
                </strong>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  empezar(async () => {
                    // Una sola acción: guarda y confirma, y trae la pantalla
                    // confirmada en la misma respuesta.
                    const r = await confirmarRecepcion(id, cambiado ? datos() : undefined);
                    setResultado(r);
                    setSeguro(false);
                    if (r.ok) router.refresh();
                  })
                }
                disabled={enCurso}
                className="boton-accion inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-60 sm:flex-none"
              >
                {enCurso ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Sí, confirmar
              </button>
              <button
                type="button"
                onClick={() => setSeguro(false)}
                className="h-12 flex-1 rounded-xl border border-linea px-4 text-base sm:flex-none"
              >
                Volver
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSeguro(true)}
              disabled={ilegible || vienen.length === 0}
              className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-50 sm:w-auto"
            >
              <Check className="h-4 w-4" />
              Confirmar la recepción
            </button>
            {cambiado && (
              <button
                type="button"
                disabled={enCurso || ilegible || vienen.length === 0}
                onClick={() =>
                  empezar(async () => {
                    if (await guardar()) router.refresh();
                  })
                }
                className="tarjeta-hundida inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-base font-medium disabled:opacity-50 sm:w-auto"
              >
                {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar los cambios
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}

/** Anular: el stock vuelve atrás y la deuda se acredita; el costo promedio queda. */
export function AnularRecepcion({ id }: { id: string }) {
  const router = useRouter();
  const [resultado, setResultado] = useState<EstadoRecepcion>({});
  const [enCurso, empezar] = useTransition();
  const [motivo, setMotivo] = useState("");
  return (
    <details className="tarjeta p-5">
      <summary className="cursor-pointer text-base text-muted-foreground">Anular esta recepción</summary>
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
              const r = await anularRecepcion(id, motivo);
              setResultado(r);
              if (r.ok) router.refresh();
            })
          }
          disabled={enCurso || !motivo.trim()}
          className="h-11 shrink-0 rounded-lg border border-linea px-4 text-base font-medium disabled:opacity-50"
        >
          Anular
        </button>
      </div>
      {(resultado.error || resultado.ok) && (
        <p className={`mt-2 text-base ${resultado.error ? "text-saldo-debe" : "text-saldo-favor"}`}>{resultado.error ?? resultado.ok}</p>
      )}
      {/* El costo promedio queda como quedó: revertir la mezcla exigiría
          recalcular todas las recepciones posteriores de esa mercadería. */}
      <p className="mt-2 text-sm text-muted-foreground">El stock vuelve atrás y la deuda se acredita. El costo promedio no se toca.</p>
    </details>
  );
}
