"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import { CampoFecha } from "@/components/ui/campo-fecha";
import { hoyEnArgentina } from "@/lib/formato";
import { aIso } from "@/lib/fecha-texto";
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
  const hoy = hoyEnArgentina();
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

        <form
          action={accion}
          onSubmit={(e) => {
            // Una fecha que no se manda (a medio escribir o de mañana en
            // adelante) llegaba vacía y Go la guardaba como de hoy, sin
            // avisar (M3S3-017): se frena acá, con el motivo.
            const campo = e.currentTarget.elements.namedItem("fecha-movimiento") as HTMLInputElement | null;
            const problema = problemaDeFecha(campo?.value ?? "", hoy);
            if (problema) {
              e.preventDefault();
              toast.error(problema);
              campo?.setAttribute("aria-invalid", "true");
              campo?.focus();
            }
          }}
          className="space-y-4"
        >
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
              {/* La fecha junto al importe: una deuda vieja que se carga hoy
                  lleva la suya, y el seguimiento la cuenta atrasada
                  (M3S3-017). */}
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0 space-y-2">
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
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="fecha-movimiento">Fecha</Label>
                  <CampoFecha
                    id="fecha-movimiento"
                    name="fecha"
                    required
                    defaultValue={hoy}
                    max={hoy}
                    Entrada={Input}
                  />
                </div>
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

/** Por qué no se puede registrar con la fecha escrita, o null si está bien. */
function problemaDeFecha(escrita: string, hoy: string): string | null {
  const iso = escrita.trim() ? aIso(escrita) : null;
  if (!iso) return "Poné la fecha del movimiento.";
  if (iso > hoy) return "La fecha no puede ser de mañana en adelante.";
  return null;
}
