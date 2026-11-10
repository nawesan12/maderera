"use client";

import { useState } from "react";
import {
  Banknote,
  FileMinus,
  FilePlus,
  Loader2,
  Plus,
  ShoppingCart,
  SlidersHorizontal,
} from "lucide-react";
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
import { Opciones, Seccion } from "@/components/admin/formulario";
import { registrarMovimiento, type EstadoCliente } from "../actions";

/**
 * Los movimientos que corrigen la cuenta. El pago no está: se registra con su
 * recibo, desde «Registrar cobro», para que diga con qué se pagó.
 */
const TIPOS = [
  { valor: "compra", texto: "Compra a cuenta", icono: ShoppingCart },
  { valor: "nota_credito", texto: "Nota de crédito", icono: FileMinus },
  { valor: "nota_debito", texto: "Nota de débito", icono: FilePlus },
  { valor: "ajuste", texto: "Ajuste", icono: SlidersHorizontal },
];

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

          <div className="divide-y divide-linea-suave">
            <Seccion titulo="Tipo" icono={SlidersHorizontal} columnas={1}>
              <div className="space-y-2">
                <Opciones
                  nombre="tipo-opcion"
                  opciones={TIPOS}
                  valor={tipo}
                  alCambiar={setTipo}
                  columnas={2}
                />
                {/* El efecto sobre el saldo se dice: elegir mal el tipo da
                    vuelta la deuda del cliente. */}
                <p className="text-sm text-muted-foreground">{EFECTO[tipo]}</p>
              </div>
            </Seccion>

            <Seccion titulo="Importe" icono={Banknote} columnas={1}>
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="detalle">Detalle</Label>
                <Input
                  id="detalle"
                  name="detalle"
                  placeholder="Nota de crédito por devolución, factura 0001-00012847…"
                />
              </div>
            </Seccion>
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
