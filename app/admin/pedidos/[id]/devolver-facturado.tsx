"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Undo2 } from "lucide-react";
import { calcularDevolucionFacturada, devolverPedidoFacturado } from "@/app/admin/ventas-actions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cantidadConUnidad, formatearMonto } from "@/lib/formato";

/** Un renglón de la factura del pedido, con lo que queda por devolver. */
export interface RenglonFacturado {
  itemId: string;
  descripcion: string;
  unidad: string;
  queda: number;
}

/** «1,5» y «1.5» son lo mismo en una cantidad. */
function leerCantidad(texto: string): number {
  const t = texto.trim().replace(",", ".");
  return t === "" ? 0 : Number(t);
}

/**
 * La devolución de un pedido facturado, desde el pedido (H279): sale la nota
 * de crédito sobre su factura, lo traído vuelve al stock y la plata baja lo
 * que falta cobrar o va a la cuenta corriente. El importe lo calcula Go (con
 * los tributos) y se confirma ese: si cambia, no se hace.
 */
export function DevolverFacturado({
  id,
  numero,
  factura,
  destino,
  tope,
  renglones,
}: {
  id: string;
  numero: string;
  factura: string;
  destino: "cuenta" | "deuda";
  tope: number;
  renglones: RenglonFacturado[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [clave, setClave] = useState("");
  // Lo que contestó Go para estas cantidades (clave: las cantidades).
  const [calculo, setCalculo] = useState<{ clave: string; importe: number | null; error: string | null } | null>(null);
  const [pendiente, startTransition] = useTransition();

  const elegidos = renglones
    .map((r) => ({ r, cantidad: leerCantidad(cantidades[r.itemId] ?? "") }))
    .filter((x) => Number.isFinite(x.cantidad) && x.cantidad > 0);
  const mal = renglones.some((r) => {
    const c = leerCantidad(cantidades[r.itemId] ?? "");
    return !Number.isFinite(c) || c < 0 || c > r.queda + 1e-9;
  });
  const clavePedido = JSON.stringify(elegidos.map((x) => [x.r.itemId, x.cantidad]));
  const vale = abierto && !mal && elegidos.length > 0 && calculo?.clave === clavePedido;
  const importe = vale ? calculo.importe : null;
  const error = vale ? calculo.error : null;

  // El importe de la nota, de Go, apenas se dejan de tipear las cantidades.
  useEffect(() => {
    if (!abierto || mal || elegidos.length === 0) return;
    let vigente = true;
    const t = setTimeout(async () => {
      const r = await calcularDevolucionFacturada(
        id,
        elegidos.map((x) => ({ itemId: x.r.itemId, cantidad: x.cantidad })),
      );
      if (vigente) setCalculo({ clave: clavePedido, importe: r.importe ?? null, error: r.error ?? null });
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
    // clavePedido resume las cantidades elegidas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, mal, clavePedido, id]);

  const pasa = importe !== null && importe > tope + 0.005;

  function abrir(v: boolean) {
    if (v && !abierto) {
      // Una clave por intento: el doble clic devuelve la misma devolución.
      setClave(crypto.randomUUID());
      setCantidades({});
      setMotivo("");
      setCalculo(null);
    }
    setAbierto(v);
  }

  function devolver() {
    startTransition(async () => {
      const r = await devolverPedidoFacturado(
        id,
        elegidos.map((x) => ({ itemId: x.r.itemId, cantidad: x.cantidad })),
        motivo.trim(),
        clave,
        importe,
      );
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.ok ?? "Devolución registrada.");
      setAbierto(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => abrir(true)}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
      >
        <Undo2 className="h-5 w-5" aria-hidden="true" />
        Devolver
      </button>
      <Dialog open={abierto} onOpenChange={(v) => !pendiente && abrir(v)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              Devolución de <span className="tabular whitespace-nowrap">{numero}</span>
            </DialogTitle>
            <p className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
              <span className="tabular whitespace-nowrap">Nota de crédito · {factura}</span>
              <span className="whitespace-nowrap">
                {destino === "cuenta" ? "A la cuenta" : "Baja la deuda"} · hasta{" "}
                <span className="tabular">{formatearMonto(tope)}</span>
              </span>
            </p>
          </DialogHeader>
          <div className="space-y-2">
            {renglones.map((r) => {
              const sinNada = r.queda <= 1e-9;
              return (
                <div key={r.itemId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <label
                    htmlFor={`devuelve-f-${r.itemId}`}
                    className={`min-w-0 flex-1 basis-48 text-base ${sinNada ? "text-muted-foreground" : ""}`}
                  >
                    {r.descripcion}
                    <span className="block text-sm text-muted-foreground">
                      {sinNada ? "Devuelto" : `de ${cantidadConUnidad(r.queda, r.unidad, r.descripcion)}`}
                    </span>
                  </label>
                  <Input
                    id={`devuelve-f-${r.itemId}`}
                    inputMode="decimal"
                    placeholder="0"
                    disabled={sinNada}
                    value={cantidades[r.itemId] ?? ""}
                    onChange={(e) => setCantidades((c) => ({ ...c, [r.itemId]: e.target.value }))}
                    aria-invalid={leerCantidad(cantidades[r.itemId] ?? "") > r.queda + 1e-9 || undefined}
                    className="tabular h-11 w-24 text-right text-base"
                  />
                </div>
              );
            })}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="motivo-devolucion-f" className="text-base font-medium">
              Por qué
            </label>
            <Textarea id="motivo-devolucion-f" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} rows={2} />
          </div>
          {(error || pasa) && (
            <p role="alert" className="estado-problema text-sm">
              {error ?? `Pasa lo que se puede devolver desde acá (${formatearMonto(tope)}).`}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAbierto(false)} className="h-11 rounded-lg px-4 text-base font-medium hover:bg-hundida">
              Mejor no
            </button>
            <button
              type="button"
              disabled={pendiente || mal || elegidos.length === 0 || !motivo.trim() || importe === null || pasa || !!error}
              onClick={devolver}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
            >
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Devolver {importe !== null && importe > 0 && <span className="tabular">{formatearMonto(importe)}</span>}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
