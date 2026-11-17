"use client";

import { useState } from "react";
import { ArrowLeftRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccionDeDialogo } from "@/components/admin/usar-accion";
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
  const [abierto, setAbierto] = useState(false);
  const [, accion, pendiente] = useAccionDeDialogo(
    transferirStock,
    estadoInicial,
    () => setAbierto(false),
  );

  // Sin elegir de entrada: con miles de medidas, la primera de la lista
  // nunca es la que se quiere mover.
  const [variante, setVariante] = useState("");
  const [origen, setOrigen] = useState(sucursales[0]?.id ?? "");
  const [destino, setDestino] = useState(sucursales[1]?.id ?? "");


  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark">
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

          <BuscadorDeMedida variantes={variantes} elegida={variante} alElegir={setVariante} />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="transferencia-origen">Desde</Label>
              <Select
                value={origen}
                onValueChange={(v) => v && setOrigen(v)}
                items={Object.fromEntries(sucursales.map((s) => [s.id, s.name]))}
              >
                <SelectTrigger id="transferencia-origen" className="w-full">
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
              <Label htmlFor="transferencia-destino">Hacia</Label>
              <Select
                value={destino}
                onValueChange={(v) => v && setDestino(v)}
                items={Object.fromEntries(sucursales.map((s) => [s.id, s.name]))}
              >
                <SelectTrigger id="transferencia-destino" className="w-full">
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

/**
 * Elegir la medida escribiendo parte del nombre o del código. Era un
 * desplegable con todo el catálogo, sin buscador: con miles de medidas no
 * había forma de encontrar una.
 */
function BuscadorDeMedida({
  variantes,
  elegida,
  alElegir,
}: {
  variantes: { id: string; texto: string }[];
  elegida: string;
  alElegir: (id: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const actual = variantes.find((v) => v.id === elegida);
  const palabras = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter(Boolean);
  const encontradas =
    palabras.length === 0
      ? []
      : variantes
          .filter((v) => {
            const t = v.texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return palabras.every((p) => t.includes(p));
          })
          .slice(0, 8);

  if (actual) {
    return (
      <div className="space-y-2">
        <Label>Producto</Label>
        <div className="flex items-center justify-between gap-2 rounded-lg bg-hundida px-3 py-2.5">
          <span className="text-base font-medium">{actual.texto}</span>
          <button
            type="button"
            onClick={() => {
              alElegir("");
              setTexto("");
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cambiar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="transferencia-buscar">Producto</Label>
      <Input
        id="transferencia-buscar"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Nombre, medida o código"
        autoComplete="off"
        autoFocus
      />
      {encontradas.length > 0 && (
        <ul className="max-h-64 overflow-y-auto rounded-lg bg-card shadow-sm">
          {encontradas.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => alElegir(v.id)}
                className="w-full px-3 py-2.5 text-left text-base hover:bg-muted"
              >
                {v.texto}
              </button>
            </li>
          ))}
        </ul>
      )}
      {palabras.length > 0 && encontradas.length === 0 && (
        <p className="text-sm text-muted-foreground">Nada con ese nombre.</p>
      )}
    </div>
  );
}
