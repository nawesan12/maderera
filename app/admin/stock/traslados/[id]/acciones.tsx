"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2, PackageCheck, Printer, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { unidadConcordada } from "@/lib/formato";
import { admiteDecimales, formatearCantidad, leerCantidad } from "@/lib/unidades";
import { anularTraslado, recibirTraslado, type MedidaEncontrada } from "../../actions";
import { BuscadorDeMedida } from "../../dialogo-traslado";

/** Un renglón del comprobante, como lo necesita la recepción. */
export interface RenglonARecibir {
  variantId: string;
  producto: string;
  medida: string;
  sku: string;
  unidad: string;
  cantidad: number;
}

/**
 * Imprimir el comprobante y, mientras está en camino, recibirlo o anularlo.
 *
 * «Recibir» abre la lista con lo que se mandó precargado, para anotar lo que
 * llegó de verdad (mes simulado, M2S4-021): un solo botón daba por llegado
 * todo, en el mismo segundo. «Anular» es para el que salió mal cargado y
 * todavía no llegó (M3S3-016): antes había que recibirlo y corregir con
 * cuatro ajustes sueltos.
 */
export function AccionesDelTraslado({
  id,
  codigo,
  enCamino,
  origenId,
  origen,
  destino,
  renglones,
}: {
  id: string;
  codigo: string;
  enCamino: boolean;
  origenId: string;
  origen: string;
  destino: string;
  renglones: RenglonARecibir[];
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [recibiendo, setRecibiendo] = useState(false);
  const [anulando, setAnulando] = useState(false);

  function anular() {
    startTransition(async () => {
      const r = await anularTraslado(id);
      if (r.error) toast.error(r.error);
      else toast.success(`${codigo} anulado: vuelve todo a ${origen}`);
      setAnulando(false);
      router.refresh();
    });
  }

  return (
    <div className="no-imprimir">
      <div className="flex flex-wrap gap-2">
        {enCamino && (
          <button
            type="button"
            onClick={() => setRecibiendo(true)}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white hover:bg-brand-orange-dark"
          >
            <PackageCheck className="h-4 w-4" aria-hidden="true" />
            Recibir en {destino}
          </button>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-base font-medium hover:bg-muted"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Imprimir
        </button>
        {enCamino && (
          <button
            type="button"
            onClick={() => setAnulando(true)}
            className="inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium text-muted-foreground hover:bg-muted hover:text-foreground sm:ml-auto"
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
            Anular
          </button>
        )}
      </div>

      {enCamino && (
        <Recepcion
          abierto={recibiendo}
          alCerrar={() => setRecibiendo(false)}
          id={id}
          codigo={codigo}
          origenId={origenId}
          origen={origen}
          destino={destino}
          renglones={renglones}
        />
      )}

      <Dialog open={anulando} onOpenChange={setAnulando}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Anular {codigo}</DialogTitle>
          </DialogHeader>
          <p className="text-base">
            Vuelve todo a <strong>{origen}</strong>.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAnulando(false)}
              className="h-11 rounded-lg border text-base font-medium hover:bg-muted"
            >
              Volver
            </button>
            <button
              type="button"
              onClick={anular}
              disabled={pendiente}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accion text-base font-medium text-white hover:bg-brand-orange-dark disabled:opacity-50"
            >
              {pendiente ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Anular"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface Llegada {
  variantId: string;
  producto: string;
  medida: string;
  unidad: string;
  /** Lo que se mandó; 0 si es una medida que no figuraba. */
  mandado: number;
  texto: string;
}

/**
 * La recepción contada: cada renglón con lo que se mandó precargado, y lo
 * que llegó distinto se corrige ahí mismo. Si vino otra medida, se suma con
 * el buscador. Lo que falta vuelve al origen o se da por perdido.
 */
function Recepcion({
  abierto,
  alCerrar,
  id,
  codigo,
  origenId,
  origen,
  destino,
  renglones,
}: {
  abierto: boolean;
  alCerrar: () => void;
  id: string;
  codigo: string;
  origenId: string;
  origen: string;
  destino: string;
  renglones: RenglonARecibir[];
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const inicial = () =>
    renglones.map((r) => ({
      variantId: r.variantId,
      producto: r.producto,
      medida: r.medida,
      unidad: r.unidad,
      mandado: r.cantidad,
      texto: formatearCantidad(r.cantidad).replace(/\./g, ""),
    }));
  const [llegadas, setLlegadas] = useState<Llegada[]>(inicial);
  const [faltante, setFaltante] = useState<"origen" | "perdido">("origen");
  const [error, setError] = useState("");
  const campos = useRef(new Map<string, HTMLInputElement>());

  const revisadas = llegadas.map((l) => {
    const n = l.texto.trim() === "" ? 0 : leerCantidad(l.texto);
    const mal = !Number.isFinite(n) || n < 0 || (!admiteDecimales(l.unidad) && !Number.isInteger(n));
    return { ...l, n, mal };
  });
  const falta = revisadas.some((l) => !l.mal && l.n < l.mandado);
  const distinto = revisadas.some((l) => !l.mal && l.n !== l.mandado);
  const listo = !pendiente && revisadas.every((l) => !l.mal);

  function cambiar(variantId: string, texto: string) {
    setError("");
    setLlegadas((ls) => ls.map((l) => (l.variantId === variantId ? { ...l, texto } : l)));
  }

  function agregar(m: MedidaEncontrada) {
    setError("");
    if (!llegadas.some((l) => l.variantId === m.id)) {
      setLlegadas((ls) => [
        ...ls,
        { variantId: m.id, producto: m.producto, medida: m.medida, unidad: m.unidad, mandado: 0, texto: "" },
      ]);
    }
    requestAnimationFrame(() => campos.current.get(m.id)?.focus());
  }

  function sacar(variantId: string) {
    setLlegadas((ls) => ls.filter((l) => l.variantId !== variantId));
  }

  function recibir() {
    if (!listo) return;
    startTransition(async () => {
      const r = await recibirTraslado(id, {
        renglones: revisadas.map((l) => ({ variantId: l.variantId, cantidad: String(l.n) })),
        faltante,
      });
      // Con error también se refresca: si lo recibió otra pestaña o el
      // celular, la pantalla pasa a «Recibido» y el aviso dice por qué.
      if (r.error) {
        setError(r.error);
        toast.error(r.error);
      } else {
        toast.success(`Recibido en ${destino}`);
        alCerrar();
      }
      router.refresh();
    });
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(a) => {
        if (!a) {
          alCerrar();
          setLlegadas(inicial());
          setError("");
        }
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto max-sm:top-4 max-sm:translate-y-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Recibir <span className="codigo">{codigo}</span>
          </DialogTitle>
        </DialogHeader>

        <ul className="tarjeta-hundida divide-y divide-border/60 overflow-hidden">
          {revisadas.map((l) => {
            const nombre = `${l.producto} ${l.medida}`;
            const menos = !l.mal && l.n < l.mandado;
            const mas = !l.mal && l.n > l.mandado;
            return (
              <li key={l.variantId} className="px-3 py-2.5">
                <p className="text-base font-medium leading-snug break-words">{l.producto}</p>
                <p className="text-sm text-muted-foreground">{l.medida}</p>
                <div className="mt-2 flex items-center gap-2">
                  <p
                    id={`llego-${l.variantId}`}
                    className={`tabular min-w-0 flex-1 text-sm ${l.mal ? "font-medium text-saldo-debe" : menos || mas ? "font-medium text-foreground" : "text-muted-foreground"}`}
                  >
                    {l.mal
                      ? "Cantidad mal escrita"
                      : l.mandado > 0
                        ? `Mandaron ${formatearCantidad(l.mandado)}`
                        : "No figuraba"}
                  </p>
                  <label
                    htmlFor={`llego-cant-${l.variantId}`}
                    className="flex h-11 shrink-0 items-center gap-1.5 rounded-md bg-hundida pr-3 focus-within:ring-2 focus-within:ring-ring"
                  >
                    <span className="sr-only">Llegó de {nombre}</span>
                    <input
                      id={`llego-cant-${l.variantId}`}
                      ref={(el) => {
                        if (el) campos.current.set(l.variantId, el);
                        else campos.current.delete(l.variantId);
                      }}
                      inputMode="decimal"
                      autoComplete="off"
                      value={l.texto}
                      onChange={(e) => cambiar(l.variantId, e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          recibir();
                        }
                      }}
                      aria-invalid={l.mal || undefined}
                      aria-describedby={`llego-${l.variantId}`}
                      className="tabular h-11 w-16 bg-transparent text-right text-lg text-foreground outline-none"
                    />
                    <span className="text-sm text-muted-foreground">
                      {unidadConcordada(Number.isFinite(l.n) ? l.n : 2, l.unidad, nombre)}
                    </span>
                  </label>
                  {l.mandado === 0 ? (
                    <button
                      type="button"
                      onClick={() => sacar(l.variantId)}
                      aria-label={`Sacar ${nombre}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="w-11 shrink-0" aria-hidden="true" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <BuscadorDeMedida
          id="recibir-buscar"
          etiqueta="Llegó otra medida"
          alElegir={agregar}
          origen={origenId}
          autoFocus={false}
        />

        {falta && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Lo que no llegó</p>
            <div className="flex rounded-md bg-hundida p-0.5 text-base" role="group" aria-label="Lo que no llegó">
              {(
                [
                  ["origen", `Vuelve a ${origen}`],
                  ["perdido", "Se perdió"],
                ] as const
              ).map(([valor, texto]) => (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={faltante === valor}
                  onClick={() => setFaltante(valor)}
                  className={`h-10 min-w-0 flex-1 rounded px-2 ${faltante === valor ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
                >
                  {texto}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-base text-saldo-debe">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={recibir}
          disabled={!listo}
          className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg text-lg font-semibold disabled:opacity-50"
        >
          {pendiente ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <>
              <PackageCheck className="h-5 w-5" aria-hidden="true" />
              {distinto ? "Recibir con diferencias" : `Recibir en ${destino}`}
            </>
          )}
        </button>
      </DialogContent>
    </Dialog>
  );
}
