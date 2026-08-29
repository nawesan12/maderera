"use client";

import { useState } from "react";
import { Loader2, Percent } from "lucide-react";
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
import { ajustarPrecios, type EstadoPrecios } from "./actions";

const REDONDEOS = {
  ninguno: "Sin redondear",
  decena: "A la decena ($10)",
  centena: "A la centena ($100)",
  mil: "Al millar ($1.000)",
};

/** Mismo cálculo que hace el servidor, para que el ejemplo no mienta. */
function ajustar(base: number, porcentaje: number, redondeo: string): number {
  const conAjuste = Math.round(base * (1 + porcentaje / 100) * 100) / 100;

  if (redondeo === "decena") return Math.ceil(conAjuste / 10) * 10;
  if (redondeo === "centena") return Math.ceil(conAjuste / 100) * 100;
  if (redondeo === "mil") return Math.ceil(conAjuste / 1000) * 1000;
  return conAjuste;
}

const LISTAS = {
  ambas: "Las dos listas",
  general: "Solo lista general",
  profesional: "Solo lista profesional",
};

export function DialogoAjuste({
  categorias,
  categoriaActual,
}: {
  categorias: { slug: string; name: string }[];
  categoriaActual: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [, accion, pendiente] = useAccionDeDialogo(
    ajustarPrecios,
    {} as EstadoPrecios,
    () => setAbierto(false),
  );

  const [porcentaje, setPorcentaje] = useState("10");
  const [categoria, setCategoria] = useState(categoriaActual);
  const [lista, setLista] = useState("ambas");
  const [redondeo, setRedondeo] = useState("centena");


  const numero = Number(porcentaje.replace(",", "."));
  const valido = Number.isFinite(numero) && numero !== 0;
  const alcance =
    categoria === "todos"
      ? "todo el catálogo"
      : (categorias.find((c) => c.slug === categoria)?.name ?? categoria);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted">
        <Percent className="h-5 w-5" />
        Ajustar precios
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajustar precios por porcentaje</DialogTitle>
        </DialogHeader>

        <form action={accion} className="space-y-4">
          <input type="hidden" name="categoria" value={categoria} />
          <input type="hidden" name="listaSlug" value={lista} />
          <input type="hidden" name="redondeo" value={redondeo} />

          <div className="space-y-2">
            <Label htmlFor="porcentaje">Porcentaje</Label>
            <div className="relative">
              <Input
                id="porcentaje"
                name="porcentaje"
                value={porcentaje}
                onChange={(e) => setPorcentaje(e.target.value)}
                inputMode="decimal"
                className="pr-9"
                required
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                %
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Para bajar precios, poné un número negativo.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Qué productos</Label>
            <Select
              value={categoria}
              onValueChange={(v) => v && setCategoria(v)}
              items={{
                todos: "Todo el catálogo",
                ...Object.fromEntries(categorias.map((c) => [c.slug, c.name])),
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todo el catálogo</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Qué lista</Label>
              <Select
                value={lista}
                onValueChange={(v) => v && setLista(v)}
                items={LISTAS}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LISTAS).map(([valor, texto]) => (
                    <SelectItem key={valor} value={valor}>
                      {texto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Redondeo</Label>
              <Select
                value={redondeo}
                onValueChange={(v) => v && setRedondeo(v)}
                items={REDONDEOS}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REDONDEOS).map(([valor, texto]) => (
                    <SelectItem key={valor} value={valor}>
                      {texto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo (opcional)</Label>
            <Input
              id="motivo"
              name="motivo"
              placeholder="Aumento de lista del proveedor, abril"
            />
            <p className="text-sm text-muted-foreground">
              Queda guardado en el historial junto al cambio.
            </p>
          </div>

          {valido && (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-base">
              {numero > 0 ? "Aumentar" : "Bajar"}{" "}
              <strong className="tabular">{Math.abs(numero)}%</strong> en{" "}
              <strong>{alcance}</strong>. Un precio de{" "}
              <span className="tabular">$100.000</span> pasa a{" "}
              <span className="tabular font-medium">
                {new Intl.NumberFormat("es-AR", {
                  style: "currency",
                  currency: "ARS",
                  maximumFractionDigits: 0,
                }).format(ajustar(100000, numero, redondeo))}
              </span>
              .
            </p>
          )}

          <Button
            type="submit"
            disabled={pendiente || !valido}
            className="w-full boton-accion"
          >
            {pendiente ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Aplicando…
              </>
            ) : (
              "Aplicar ajuste"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
