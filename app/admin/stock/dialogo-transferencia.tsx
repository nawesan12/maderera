"use client";

import { useEffect, useState } from "react";
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
import { buscarMedidas, transferirStock, type EstadoTransferencia, type MedidaEncontrada } from "./actions";

const estadoInicial: EstadoTransferencia = {};

export function DialogoTransferencia({
  sucursales,
}: {
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

          <BuscadorDeMedida elegida={variante} alElegir={setVariante} />

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
 * había forma de encontrar una. Después fue un filtro sobre la lista entera
 * que mandaba la página; ahora busca Go y vuelven las que coinciden.
 */
export function BuscadorDeMedida({
  elegida,
  alElegir,
  id = "transferencia-buscar",
}: {
  elegida: string;
  alElegir: (id: string, medida?: MedidaEncontrada) => void;
  id?: string;
}) {
  const [texto, setTexto] = useState("");
  const [encontradas, setEncontradas] = useState<MedidaEncontrada[]>([]);
  const [actual, setActual] = useState<MedidaEncontrada | null>(null);
  const [buscado, setBuscado] = useState("");

  // El mismo retardo que los buscadores de las listas: una consulta por pausa,
  // no por tecla. La respuesta vieja que llega tarde no pisa a la nueva.
  useEffect(() => {
    const t = texto.trim();
    if (t.length < 2) return;
    let vigente = true;
    const reloj = setTimeout(() => {
      buscarMedidas(t).then((r) => {
        if (!vigente) return;
        setEncontradas(r.slice(0, 8));
        setBuscado(t);
      });
    }, 300);
    return () => {
      vigente = false;
      clearTimeout(reloj);
    };
  }, [texto]);

  const largo = texto.trim().length >= 2;
  const visibles = largo ? encontradas : [];

  if (elegida && actual) {
    return (
      <div className="space-y-2">
        <Label>Producto</Label>
        <div className="flex items-center justify-between gap-2 rounded-lg bg-hundida px-3 py-2.5">
          <span className="text-base font-medium">
            {actual.producto} — {actual.medida} · {actual.sku}
          </span>
          <button
            type="button"
            onClick={() => {
              alElegir("");
              setActual(null);
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
      <Label htmlFor={id}>Producto</Label>
      <Input
        id={id}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Nombre, medida o código"
        autoComplete="off"
        autoFocus
      />
      {visibles.length > 0 && (
        <ul className="max-h-64 overflow-y-auto rounded-lg bg-card shadow-sm">
          {visibles.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => {
                  setActual(v);
                  alElegir(v.id, v);
                }}
                className="w-full px-3 py-2.5 text-left text-base hover:bg-muted"
              >
                {v.producto} — {v.medida} · {v.sku}
              </button>
            </li>
          ))}
        </ul>
      )}
      {largo && buscado === texto.trim() && visibles.length === 0 && (
        <p className="text-sm text-muted-foreground">Nada con ese nombre.</p>
      )}
    </div>
  );
}
