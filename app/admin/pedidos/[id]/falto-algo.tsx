"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackagePlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ajustarStock } from "@/app/admin/stock/ajuste-actions";
import { formatearCantidad } from "@/lib/unidades";

interface Renglon {
  variantId: string;
  descripcion: string;
  cantidad: number;
}

/**
 * «Le faltó algo»: lo que el cliente reclama que no se llevó sale del stock
 * como reposición sin cargo, atada al pedido (mes simulado, M3S3-021). El
 * único camino era Stock → buscar el producto → Restar → «A cliente» →
 * tipear el pedido; desde el mostrador, con un descuento del 100 %, no había
 * forma. Es el mismo ajuste del Stock, con el pedido ya puesto.
 */
export function FaltoAlgo({
  numero,
  sucursal,
  renglones,
  abiertoAlEntrar = false,
}: {
  numero: string;
  /** El slug de la sucursal de la que sale. */
  sucursal: string;
  renglones: Renglon[];
  /** Llega abierto desde «Ventas de hoy» (?falto=1). */
  abiertoAlEntrar?: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(abiertoAlEntrar);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [enCurso, empezar] = useTransition();

  const leer = (t: string | undefined) => {
    const n = Number((t ?? "").trim().replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const aReponer = renglones
    .map((r) => ({ ...r, falta: Math.min(leer(cantidades[r.variantId]), r.cantidad) }))
    .filter((r) => r.falta > 0);

  function reponer() {
    if (aReponer.length === 0) return;
    setAviso(null);
    empezar(async () => {
      for (const r of aReponer) {
        const res = await ajustarStock(r.variantId, sucursal, -r.falta, { motivo: "reposicion", pedido: numero });
        if (res.error) {
          setAviso(res.error);
          return;
        }
      }
      setAbierto(false);
      setCantidades({});
      router.refresh();
    });
  }

  if (renglones.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
      >
        <PackagePlus className="h-4 w-4" />
        Le faltó algo
      </button>
      {abierto && (
        <Dialog open onOpenChange={(v) => !v && setAbierto(false)}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold tracking-tight">Le faltó algo · {numero}</DialogTitle>
            </DialogHeader>
            <ul className="divide-y divide-linea">
              {renglones.map((r, i) => (
                <li key={r.variantId} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-base">{r.descripcion}</span>
                    <span className="tabular block text-sm text-muted-foreground">se llevó {formatearCantidad(r.cantidad)}</span>
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus={i === 0}
                    value={cantidades[r.variantId] ?? ""}
                    onChange={(e) => setCantidades({ ...cantidades, [r.variantId]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        reponer();
                      }
                    }}
                    aria-label={`Cuánto le faltó de ${r.descripcion}`}
                    placeholder="0"
                    className="tabular h-11 w-20 shrink-0 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
                  />
                </li>
              ))}
            </ul>
            {aviso && (
              <p role="alert" className="estado-problema rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base">
                {aviso}
              </p>
            )}
            <button
              type="button"
              disabled={enCurso || aReponer.length === 0}
              onClick={reponer}
              className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold disabled:opacity-50"
            >
              {enCurso && <Loader2 className="h-5 w-5 animate-spin" />}
              Reponer sin cargo
            </button>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
