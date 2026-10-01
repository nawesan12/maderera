"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
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
import { registrarMovimiento, type EstadoCliente } from "../actions";

/**
 * Los movimientos que corrigen la cuenta. El pago no está: se registra con su
 * recibo, desde «Registrar cobro», para que diga con qué se pagó.
 */
const TIPOS = {
  compra: "Compra a cuenta",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  ajuste: "Ajuste",
};

/** Qué hace cada tipo con el saldo, dicho en criollo. */
const EFECTO: Record<string, string> = {
  compra: "Suma deuda.",
  nota_credito: "Baja la deuda.",
  nota_debito: "Suma deuda.",
  ajuste: "Baja la deuda.",
};

export function DialogoMovimiento({
  customerId,
  nombre,
}: {
  customerId: string;
  nombre: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState("nota_credito");
  const [, accion, pendiente] = useAccionDeDialogo(
    registrarMovimiento,
    {} as EstadoCliente,
    () => setAbierto(false),
  );


  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-linea px-3 text-base font-medium transition-colors hover:bg-muted">
        <Plus className="h-5 w-5" />
        Otro movimiento
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Movimiento de cuenta — {nombre}</DialogTitle>
        </DialogHeader>

        <form action={accion} className="space-y-4">
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="tipo" value={tipo} />

          <div className="space-y-2">
            <Label htmlFor="movimiento-tipo">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => v && setTipo(v)} items={TIPOS}>
              <SelectTrigger id="movimiento-tipo" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TIPOS).map(([valor, texto]) => (
                  <SelectItem key={valor} value={valor}>
                    {texto}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">{EFECTO[tipo]}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="monto">Importe</Label>
            <Input
              id="monto"
              name="monto"
              inputMode="decimal"
              placeholder="150000"
              required
              autoFocus
            />
            <p className="text-sm text-muted-foreground">
              Poné el importe en positivo: el signo lo pone el tipo de movimiento.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="detalle">Detalle</Label>
            <Input
              id="detalle"
              name="detalle"
              placeholder="Nota de crédito por devolución, factura 0001-00012847…"
            />
          </div>

          <Button
            type="submit"
            disabled={pendiente}
            className="w-full boton-accion"
          >
            {pendiente ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Registrando…
              </>
            ) : (
              "Registrar"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
