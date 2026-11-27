"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgePercent, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampoFecha } from "@/components/ui/campo-fecha";
import { formatearMonto, hoyEnArgentina } from "@/lib/formato";
import { ofertarPrecio, terminarOferta } from "./actions";

const DIA = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

/**
 * La oferta de un precio de lista (M2S2-030): el precio baja hasta un día y
 * el de antes se ve tachado en el catálogo y el mostrador; al vencer vuelve
 * solo. En oferta, se ve el de antes y hasta cuándo, y se termina con un
 * toque.
 */
export function OfertaDelPrecio({
  variantId,
  priceListId,
  producto,
  precio,
  precioAnterior,
  ofertaHasta,
}: {
  variantId: string;
  priceListId: string;
  producto: string;
  precio: string;
  precioAnterior?: string | null;
  ofertaHasta?: string | Date | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState("");
  const [hasta, setHasta] = useState("");
  const [pendiente, empezar] = useTransition();

  if (precioAnterior && ofertaHasta) {
    // oferta_hasta es el comienzo del día siguiente: el último día es el anterior.
    const ultimo = new Date(new Date(ofertaHasta).getTime() - 1);
    return (
      <p className="mt-0.5 flex items-center justify-end gap-1.5 text-sm">
        <span className="tabular text-muted-foreground line-through">{formatearMonto(Number(precioAnterior))}</span>
        <span className="estado-marca rounded-full bg-[var(--estado-fondo)] px-2 py-0.5 text-xs font-semibold text-[var(--estado-tinta)]">
          hasta {DIA.format(ultimo)}
        </span>
        <button
          type="button"
          disabled={pendiente}
          aria-label={`Terminar la oferta de ${producto}`}
          onClick={() =>
            empezar(async () => {
              const r = await terminarOferta(variantId, priceListId);
              if (r.error) toast.error(r.error);
              else {
                toast.success(r.ok ?? "Listo.");
                router.refresh();
              }
            })
          }
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {pendiente ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        </button>
      </p>
    );
  }

  if (!(Number(precio) > 0)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={`Poner en oferta ${producto}`}
        className="ml-auto mt-0.5 flex items-center gap-1 rounded-md px-2 py-0.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <BadgePercent className="h-3.5 w-3.5" aria-hidden="true" />
        Oferta
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="break-words pr-8">Oferta · {producto}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              empezar(async () => {
                const r = await ofertarPrecio(variantId, priceListId, valor, hasta);
                if (r.error) toast.error(r.error);
                else {
                  toast.success(r.ok ?? "Listo.");
                  setAbierto(false);
                  router.refresh();
                }
              });
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor={`oferta-${variantId}`}>Precio</Label>
                <Input
                  id={`oferta-${variantId}`}
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  inputMode="decimal"
                  required
                  autoFocus
                  className="tabular text-right"
                />
                <p className="tabular text-sm text-muted-foreground line-through">{formatearMonto(Number(precio))}</p>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor={`hasta-${variantId}`}>Hasta</Label>
                <CampoFecha
                  id={`hasta-${variantId}`}
                  value={hasta}
                  min={hoyEnArgentina()}
                  onChange={(e) => setHasta(e.target.value)}
                  required
                  Entrada={Input}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={pendiente || !valor.trim() || !hasta}
              className="boton-accion inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-base font-semibold disabled:opacity-60"
            >
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Poner en oferta
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
