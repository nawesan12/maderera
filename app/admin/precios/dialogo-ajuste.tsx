"use client";

import { useRef, useState, useTransition } from "react";
import { Eye, Loader2, Percent } from "lucide-react";
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
import { ajustarPrecios, previsualizarAjuste, type EstadoPrecios, type VistaDeAjuste } from "./actions";

const REDONDEOS = {
  ninguno: "Sin redondear",
  decena: "A la decena ($10)",
  centena: "A la centena ($100)",
  mil: "Al millar ($1.000)",
};

const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });

const LISTAS = {
  ambas: "Las dos listas",
  general: "Solo lista general",
  profesional: "Solo lista profesional",
};

const BASES = {
  precio: "El precio vigente",
  costo: "El costo promedio",
  costo_elaborado: "El costo con elaboración",
};

export function DialogoAjuste({
  categorias,
  categoriaActual,
  rubros = [],
  proveedores = [],
  marcas = [],
}: {
  categorias: { slug: string; name: string }[];
  categoriaActual: string;
  rubros?: { slug: string; name: string; categorySlug: string }[];
  /** El aumento llega por proveedor: se acota a lo que trae. */
  proveedores?: { id: string; nombre: string }[];
  marcas?: string[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [, accion, pendiente] = useAccionDeDialogo(
    ajustarPrecios,
    {} as EstadoPrecios,
    () => setAbierto(false),
  );

  const [porcentaje, setPorcentaje] = useState("10");
  const [categoria, setCategoria] = useState(categoriaActual);
  const [rubro, setRubro] = useState("todos");
  const [base, setBase] = useState("precio");
  const [lista, setLista] = useState("ambas");
  const [redondeo, setRedondeo] = useState("centena");
  const [proveedor, setProveedor] = useState("todos");
  const [marca, setMarca] = useState("");
  const formulario = useRef<HTMLFormElement>(null);

  /*
   * Lo que el ajuste va a hacer, antes de hacerlo: cuántos precios toca y
   * cómo quedan algunos. Cualquier cambio en el formulario la invalida, así
   * el botón nunca aplica algo distinto de lo que se vio.
   */
  const [vista, setVista] = useState<VistaDeAjuste | null>(null);
  const [mirando, empezarAMirar] = useTransition();
  const clave = [porcentaje, categoria, rubro, base, lista, redondeo, proveedor, marca].join("|");
  const [claveVista, setClaveVista] = useState("");
  const vistaVigente = vista && claveVista === clave ? vista : null;

  function mirar() {
    if (!formulario.current) return;
    const datos = new FormData(formulario.current);
    const k = clave;
    empezarAMirar(async () => {
      setVista(await previsualizarAjuste(datos));
      setClaveVista(k);
    });
  }

  const numero = Number(porcentaje.replace(",", "."));
  const valido = Number.isFinite(numero) && numero !== 0;

  // Los rubros son de la categoría elegida; cambiar de categoría deja el
  // rubro anterior sin sentido, así que se deriva y no se sincroniza.
  const rubrosDeLaCategoria =
    categoria === "todos"
      ? []
      : rubros.filter((r) => r.categorySlug === categoria);
  const rubroValido = rubrosDeLaCategoria.some((r) => r.slug === rubro)
    ? rubro
    : "todos";

  const alcanceProveedor = proveedor !== "todos" ? proveedores.find((p) => p.id === proveedor)?.nombre : undefined;
  const alcance = alcanceProveedor
    ? `lo de ${alcanceProveedor}`
    : marca.trim()
      ? `la marca ${marca.trim()}`
      : categoria === "todos"
      ? "todo el catálogo"
      : rubroValido !== "todos"
        ? (rubrosDeLaCategoria.find((r) => r.slug === rubroValido)?.name ??
          rubroValido)
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

        <form ref={formulario} action={accion} className="space-y-4">
          <input type="hidden" name="proveedor" value={proveedor} />
          <input type="hidden" name="categoria" value={categoria} />
          <input type="hidden" name="rubro" value={rubroValido} />
          <input type="hidden" name="base" value={base} />
          <input type="hidden" name="listaSlug" value={lista} />
          <input type="hidden" name="redondeo" value={redondeo} />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="porcentaje">
                {base === "precio" ? "Porcentaje" : "Margen"}
              </Label>
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="ajuste-base">Sobre qué se calcula</Label>
              <Select
                value={base}
                onValueChange={(v) => v && setBase(v)}
                items={BASES}
              >
                <SelectTrigger id="ajuste-base" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(BASES).map(([valor, texto]) => (
                    <SelectItem key={valor} value={valor}>
                      {texto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {base !== "precio" && (
            <p className="text-sm text-muted-foreground">Sin costo cargado, el producto queda igual.</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ajuste-categoria">Qué productos</Label>
              <Select
                value={categoria}
                onValueChange={(v) => v && setCategoria(v)}
                items={{
                  todos: "Todo el catálogo",
                  ...Object.fromEntries(categorias.map((c) => [c.slug, c.name])),
                }}
              >
                <SelectTrigger id="ajuste-categoria" className="w-full">
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

            {/* El corte por rubro que pidió la clienta: dentro de Ferretería,
                tocar solo Tornillos. Aparece con la categoría elegida. */}
            <div className="space-y-2">
              <Label htmlFor="ajuste-rubro">Qué rubro</Label>
              <Select
                value={rubroValido}
                onValueChange={(v) => setRubro(v ?? "todos")}
                items={{
                  todos: "Todos los rubros",
                  ...Object.fromEntries(
                    rubrosDeLaCategoria.map((r) => [r.slug, r.name]),
                  ),
                }}
              >
                <SelectTrigger id="ajuste-rubro"
                  className="w-full"
                  disabled={rubrosDeLaCategoria.length === 0}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los rubros</SelectItem>
                  {rubrosDeLaCategoria.map((r) => (
                    <SelectItem key={r.slug} value={r.slug}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ajuste-proveedor">De qué proveedor</Label>
              <Select
                value={proveedor}
                onValueChange={(v) => setProveedor(v ?? "todos")}
                items={{ todos: "Todos", ...Object.fromEntries(proveedores.map((p) => [p.id, p.nombre])) }}
              >
                <SelectTrigger id="ajuste-proveedor" className="w-full" disabled={proveedores.length === 0}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {proveedores.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ajuste-marca">Qué marca</Label>
              <Input
                id="ajuste-marca"
                name="marca"
                list="ajuste-marcas"
                value={marca}
                onChange={(e) => setMarca(e.target.value)}
                placeholder="Todas"
              />
              <datalist id="ajuste-marcas">
                {marcas.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ajuste-lista">Qué lista</Label>
              <Select
                value={lista}
                onValueChange={(v) => v && setLista(v)}
                items={LISTAS}
              >
                <SelectTrigger id="ajuste-lista" className="w-full">
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
              <Label htmlFor="ajuste-redondeo">Redondeo</Label>
              <Select
                value={redondeo}
                onValueChange={(v) => v && setRedondeo(v)}
                items={REDONDEOS}
              >
                <SelectTrigger id="ajuste-redondeo" className="w-full">
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
          </div>

          {vistaVigente?.error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2.5 text-base text-destructive">
              {vistaVigente.error}
            </p>
          )}

          {vistaVigente && !vistaVigente.error && (
            <div className="tarjeta-hundida space-y-2 rounded-xl p-3">
              <p className="text-base">
                {vistaVigente.tocados === 0 ? (
                  "Con ese filtro no cambia ningún precio."
                ) : (
                  <>
                    Cambian <strong className="tabular">{vistaVigente.tocados}</strong>{" "}
                    {vistaVigente.tocados === 1 ? "precio" : "precios"} de <strong>{alcance}</strong>
                    {vistaVigente.sinCosto > 0 && ` · ${vistaVigente.sinCosto} sin costo quedan igual`}.
                  </>
                )}
              </p>
              {vistaVigente.muestra.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {vistaVigente.muestra.map((m, i) => (
                    <li key={i} className="flex flex-wrap justify-between gap-x-3">
                      <span className="min-w-0 truncate">
                        {m.producto} {m.medida}
                        <span className="text-muted-foreground"> · {m.lista}</span>
                      </span>
                      <span className="tabular whitespace-nowrap">
                        <span className="text-muted-foreground line-through">{pesos.format(Number(m.antes))}</span>{" "}
                        → <strong>{pesos.format(Number(m.despues))}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {vistaVigente && !vistaVigente.error && vistaVigente.tocados > 0 ? (
            <Button type="submit" disabled={pendiente} className="w-full boton-accion">
              {pendiente ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Aplicando…
                </>
              ) : base !== "precio" ? (
                `Recalcular ${vistaVigente.tocados} ${vistaVigente.tocados === 1 ? "precio" : "precios"}`
              ) : (
                `${numero > 0 ? "Subir" : "Bajar"} ${Math.abs(numero)} % a ${vistaVigente.tocados} ${
                  vistaVigente.tocados === 1 ? "precio" : "precios"
                }`
              )}
            </Button>
          ) : (
            <Button type="button" onClick={mirar} disabled={mirando || !valido} variant="outline" className="w-full">
              {mirando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Eye className="h-5 w-5" />}
              Ver cómo quedan
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
