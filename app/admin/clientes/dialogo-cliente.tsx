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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { guardarCliente, type EstadoCliente } from "./actions";

const CONDICIONES = {
  consumidor_final: "Consumidor final",
  responsable_inscripto: "Responsable inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
  no_categorizado: "No categorizado",
};

const TIPOS = {
  particular: "Particular",
  profesional: "Profesional",
};

export function DialogoCliente({
  listas,
}: {
  listas: { id: string; name: string; isDefault: boolean }[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [, accion, pendiente] = useAccionDeDialogo(
    guardarCliente,
    {} as EstadoCliente,
    () => setAbierto(false),
  );

  const [tipo, setTipo] = useState("particular");
  const [condicion, setCondicion] = useState("consumidor_final");
  const [lista, setLista] = useState("");


  // La lista de precios se elegía en ningún lado: el diálogo ya recibía
  // `listas` y nunca las mostraba, así que un cliente con precio especial había
  // que corregirlo por consola. La opción vacía es "la general".
  const opcionesDeLista: Record<string, string> = {
    "": "Lista general",
    ...Object.fromEntries(
      listas.filter((l) => !l.isDefault).map((l) => [l.id, l.name]),
    ),
  };

  // Un profesional casi siempre factura A: se propone, sin imponerlo.
  function cambiarTipo(valor: string) {
    setTipo(valor);
    if (valor === "profesional" && condicion === "consumidor_final") {
      setCondicion("responsable_inscripto");
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium transition-colors">
        <Plus className="h-5 w-5" />
        Nuevo cliente
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
        </DialogHeader>

        <form action={accion} className="space-y-4">
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="condicionIva" value={condicion} />
          <input type="hidden" name="priceListId" value={lista} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre y apellido</Label>
              <Input id="nombre" name="nombre" required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="razonSocial">Empresa</Label>
              <Input id="razonSocial" name="razonSocial" />
            </div>
            <div className="space-y-2">
              <Label>Tipo de cliente</Label>
              <Select value={tipo} onValueChange={(v) => v && cambiarTipo(v)} items={TIPOS}>
                <SelectTrigger className="w-full">
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="rubro">Rubro</Label>
              <Input id="rubro" name="rubro" placeholder="Arquitectura, Construcción…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cuit">CUIT</Label>
              <Input id="cuit" name="cuit" placeholder="20-12345678-9" inputMode="numeric" />
            </div>
            <div className="space-y-2">
              <Label>Condición frente al IVA</Label>
              <Select
                value={condicion}
                onValueChange={(v) => v && setCondicion(v)}
                items={CONDICIONES}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CONDICIONES).map(([valor, texto]) => (
                    <SelectItem key={valor} value={valor}>
                      {texto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                ARCA la exige en cada factura, así que conviene cargarla ahora.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Correo</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input id="telefono" name="telefono" inputMode="tel" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="direccion">Domicilio</Label>
              <Input id="direccion" name="direccion" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="asesor">Asesor</Label>
              <Input id="asesor" name="asesor" placeholder="Quién lo atiende" />
            </div>
            <div className="space-y-2">
              <Label>Lista de precios</Label>
              <Select
                value={lista}
                onValueChange={(v) => setLista(v ?? "")}
                items={opcionesDeLista}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(opcionesDeLista).map(([valor, texto]) => (
                    <SelectItem key={valor} value={valor}>
                      {texto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Sin elegir, paga la lista general.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="limiteCredito">Límite de cuenta corriente</Label>
              <Input
                id="limiteCredito"
                name="limiteCredito"
                defaultValue="0"
                inputMode="decimal"
              />
              <p className="text-sm text-muted-foreground">
                Cero significa que no opera a cuenta.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notas">Notas</Label>
            <Textarea id="notas" name="notas" rows={2} />
          </div>

          <Button
            type="submit"
            disabled={pendiente}
            className="w-full boton-accion"
          >
            {pendiente ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Guardando…
              </>
            ) : (
              "Guardar cliente"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
