"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { transferirStock, type EstadoTransferencia } from "./actions";

const estadoInicial: EstadoTransferencia = {};

export function DialogoTransferencia({
  variantes,
  sucursales,
}: {
  variantes: { id: string; texto: string }[];
  sucursales: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [estado, accion, pendiente] = useActionState(
    transferirStock,
    estadoInicial,
  );

  const [variante, setVariante] = useState(variantes[0]?.id ?? "");
  const [origen, setOrigen] = useState(sucursales[0]?.id ?? "");
  const [destino, setDestino] = useState(sucursales[1]?.id ?? "");

  useEffect(() => {
    if (estado.ok) {
      toast.success(estado.ok);
      setAbierto(false);
      router.refresh();
    }
    if (estado.error) toast.error(estado.error);
  }, [estado, router]);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-brand-orange px-3 text-sm font-medium text-white transition-colors hover:bg-brand-orange-dark">
        <ArrowLeftRight className="h-4 w-4" />
        Transferir stock
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Transferir stock entre sucursales</DialogTitle>
        </DialogHeader>

        <form action={accion} className="space-y-4">
          <input type="hidden" name="variantId" value={variante} />
          <input type="hidden" name="origenId" value={origen} />
          <input type="hidden" name="destinoId" value={destino} />

          <div className="space-y-2">
            <Label>Producto</Label>
            <Select
              value={variante}
              onValueChange={(v) => v && setVariante(v)}
              items={Object.fromEntries(
                variantes.map((v) => [v.id, v.texto]),
              )}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elegí un producto" />
              </SelectTrigger>
              <SelectContent>
                {variantes.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.texto}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Desde</Label>
              <Select
                value={origen}
                onValueChange={(v) => v && setOrigen(v)}
                items={Object.fromEntries(sucursales.map((s) => [s.id, s.name]))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sucursales.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Hacia</Label>
              <Select
                value={destino}
                onValueChange={(v) => v && setDestino(v)}
                items={Object.fromEntries(sucursales.map((s) => [s.id, s.name]))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sucursales.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cantidad">Cantidad</Label>
            <Input
              id="cantidad"
              name="cantidad"
              type="number"
              min={1}
              defaultValue={1}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="nota">Nota (opcional)</Label>
            <Textarea
              id="nota"
              name="nota"
              rows={2}
              placeholder="Motivo del movimiento, remito, quién lo lleva…"
            />
          </div>

          <Button
            type="submit"
            disabled={pendiente}
            className="w-full boton-accion"
          >
            {pendiente ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Registrando…
              </>
            ) : (
              "Registrar transferencia"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
