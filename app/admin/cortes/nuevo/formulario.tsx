"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { crearCorte } from "../actions";
import { buscarClientes, buscarEnMostrador } from "@/app/mostrador/actions";

interface Pieza {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  respetaVeta: boolean;
  cantoLargo: boolean;
  cantoAncho: boolean;
  etiqueta: string;
}

const piezaVacia = (): Pieza => ({
  largoMm: 0,
  anchoMm: 0,
  cantidad: 1,
  respetaVeta: false,
  cantoLargo: false,
  cantoAncho: false,
  etiqueta: "",
});

const estadoInicial = {} as { error?: string; ok?: string };

export function FormularioCorte({
  sucursales,
}: {
  sucursales: { id: string; nombre: string }[];
}) {
  const [estado, accion, pendiente] = useActionState(crearCorte, estadoInicial);

  const [sucursal, setSucursal] = useState(sucursales[0]?.id ?? "");
  const [cliente, setCliente] = useState<{ id: string; nombre: string; razonSocial: string | null } | null>(null);
  const [nombre, setNombre] = useState("");
  const [placa, setPlaca] = useState<{ variantId: string; descripcion: string } | null>(null);
  const [material, setMaterial] = useState("");
  const [piezas, setPiezas] = useState<Pieza[]>([piezaVacia()]);

  const validas = piezas.filter((p) => p.largoMm > 0 && p.anchoMm > 0 && p.cantidad > 0);
  const totalPiezas = validas.reduce((s, p) => s + p.cantidad, 0);
  // Los metros cuadrados del despiece: no reemplazan al optimizador, pero
  // permiten ver de un vistazo si el número de placas tiene sentido.
  const m2 = validas.reduce(
    (s, p) => s + (p.largoMm / 1000) * (p.anchoMm / 1000) * p.cantidad,
    0,
  );

  function actualizar(indice: number, campo: keyof Pieza, valor: string | boolean) {
    setPiezas((previas) =>
      previas.map((p, i) =>
        i === indice
          ? {
              ...p,
              [campo]:
                typeof valor === "boolean"
                  ? valor
                  : campo === "etiqueta"
                    ? valor
                    : Number(valor),
            }
          : p,
      ),
    );
  }

  return (
    <form action={accion} className="space-y-5">
      <input type="hidden" name="branchId" value={sucursal} />
      {cliente && <input type="hidden" name="customerId" value={cliente.id} />}
      {placa && <input type="hidden" name="variantId" value={placa.variantId} />}
      {validas.map((p, i) => (
        <input key={i} type="hidden" name="pieza" value={JSON.stringify(p)} />
      ))}

      <Card className="border-border bg-card">
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold">Para quién y qué se corta</h2>

          <BuscadorDeCliente
            elegido={cliente}
            onElegir={(c) => {
              setCliente(c);
              if (c) setNombre(c.razonSocial ?? c.nombre);
            }}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contactoNombre">Nombre</Label>
              <Input
                id="contactoNombre"
                name="contactoNombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch">Dónde se corta</Label>
              <select
                id="branch"
                value={sucursal}
                onChange={(e) => setSucursal(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-base"
              >
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <BuscadorDePlaca
            branchId={sucursal}
            elegida={placa}
            onElegir={(p) => {
              setPlaca(p);
              if (p) setMaterial(p.descripcion);
            }}
          />

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div className="space-y-2">
              <Label htmlFor="materialDescripcion">Placa</Label>
              <Input
                id="materialDescripcion"
                name="materialDescripcion"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="Melamina blanca 18mm"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="placas">Placas</Label>
              <Input
                id="placas"
                name="placas"
                type="number"
                min="1"
                defaultValue={1}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">Despiece</h2>
            {totalPiezas > 0 && (
              <p className="text-sm text-muted-foreground">
                {totalPiezas} {totalPiezas === 1 ? "pieza" : "piezas"} ·{" "}
                {m2.toFixed(2)} m²
              </p>
            )}
          </div>

          <div className="space-y-3">
            {piezas.map((p, i) => (
              <div
                key={i}
                className="space-y-3 rounded-lg border border-border p-4"
              >
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-28 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Largo (mm)
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      value={p.largoMm || ""}
                      onChange={(e) => actualizar(i, "largoMm", e.target.value)}
                    />
                  </div>

                  <div className="w-28 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Ancho (mm)
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      value={p.anchoMm || ""}
                      onChange={(e) => actualizar(i, "anchoMm", e.target.value)}
                    />
                  </div>

                  <div className="w-24 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Cantidad
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      value={p.cantidad}
                      onChange={(e) => actualizar(i, "cantidad", e.target.value)}
                    />
                  </div>

                  <div className="min-w-40 flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Etiqueta
                    </Label>
                    <Input
                      value={p.etiqueta}
                      onChange={(e) => actualizar(i, "etiqueta", e.target.value)}
                      placeholder="Puerta, estante…"
                    />
                  </div>

                  {piezas.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setPiezas((previas) => previas.filter((_, j) => j !== i))
                      }
                      aria-label={`Quitar pieza ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap gap-5">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={p.respetaVeta}
                      onCheckedChange={(v) =>
                        actualizar(i, "respetaVeta", v === true)
                      }
                    />
                    Respeta la veta
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={p.cantoLargo}
                      onCheckedChange={(v) =>
                        actualizar(i, "cantoLargo", v === true)
                      }
                    />
                    Canto en el largo
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={p.cantoAncho}
                      onCheckedChange={(v) =>
                        actualizar(i, "cantoAncho", v === true)
                      }
                    />
                    Canto en el ancho
                  </label>
                </div>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => setPiezas((previas) => [...previas, piezaVacia()])}
          >
            <Plus className="h-4 w-4" />
            Agregar pieza
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <Label htmlFor="notas">Notas para el taller</Label>
            <Textarea
              id="notas"
              name="notas"
              rows={2}
              placeholder="Cuándo lo retiran, si hay que avisar, medidas críticas."
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="urgente" value="si" />
            Urgente: va primero en la cola del taller
          </label>
        </CardContent>
      </Card>

      {estado.error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive"
        >
          {estado.error}
        </p>
      )}

      {estado.ok && (
        <p className="rounded-lg border border-brand-green/40 bg-brand-green/10 px-4 py-3 text-brand-green">
          {estado.ok}
        </p>
      )}

      <Button
        type="submit"
        disabled={pendiente || validas.length === 0}
        className="h-11 px-6"
      >
        {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
        Mandar a la cola del taller
      </Button>
    </form>
  );
}

function BuscadorDeCliente({
  elegido,
  onElegir,
}: {
  elegido: { id: string; nombre: string; razonSocial: string | null } | null;
  onElegir: (c: { id: string; nombre: string; razonSocial: string | null } | null) => void;
}) {
  const [texto, setTexto] = useState("");
  const [traidos, setTraidos] = useState<{
    texto: string;
    items: { id: string; nombre: string; razonSocial: string | null }[];
  }>({ texto: "", items: [] });

  const consulta = texto.trim();
  const resultados =
    consulta.length >= 2 && traidos.texto === consulta ? traidos.items : [];

  useEffect(() => {
    if (consulta.length < 2) return;

    let vigente = true;
    const id = setTimeout(async () => {
      const encontrados = await buscarClientes(consulta);
      if (vigente) setTraidos({ texto: consulta, items: encontrados });
    }, 250);

    return () => {
      vigente = false;
      clearTimeout(id);
    };
  }, [consulta]);

  if (elegido) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <UserRound className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 font-medium">
          {elegido.razonSocial ?? elegido.nombre}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onElegir(null);
            setTexto("");
          }}
        >
          <X className="h-4 w-4" />
          Quitar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="buscarCliente">Cliente (opcional)</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="buscarCliente"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nombre, razón social o CUIT"
          className="pl-9"
        />
      </div>

      {resultados.length > 0 && (
        <ul className="rounded-lg border border-border">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onElegir(c);
                  setTexto("");
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted"
              >
                <span className="font-medium">{c.razonSocial ?? c.nombre}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BuscadorDePlaca({
  branchId,
  elegida,
  onElegir,
}: {
  branchId: string;
  elegida: { variantId: string; descripcion: string } | null;
  onElegir: (p: { variantId: string; descripcion: string } | null) => void;
}) {
  const [texto, setTexto] = useState("");
  const [traidos, setTraidos] = useState<{
    clave: string;
    items: { variantId: string; producto: string; medida: string }[];
  }>({ clave: "", items: [] });

  const consulta = texto.trim();
  const clave = `${consulta}|${branchId}`;
  const resultados =
    consulta.length >= 2 && traidos.clave === clave ? traidos.items : [];

  useEffect(() => {
    if (consulta.length < 2 || !branchId) return;

    let vigente = true;
    const id = setTimeout(async () => {
      const encontrados = await buscarEnMostrador(consulta, branchId, null);
      if (vigente) setTraidos({ clave, items: encontrados });
    }, 250);

    return () => {
      vigente = false;
      clearTimeout(id);
    };
  }, [consulta, branchId, clave]);

  if (elegida) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <span className="flex-1 font-medium">{elegida.descripcion}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onElegir(null);
            setTexto("");
          }}
        >
          <X className="h-4 w-4" />
          Quitar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="buscarPlaca">Buscar la placa en el catálogo</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="buscarPlaca"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Melamina, fenólico, MDF…"
          className="pl-9"
        />
      </div>

      {resultados.length > 0 && (
        <ul className="rounded-lg border border-border">
          {resultados.map((r) => (
            <li key={r.variantId}>
              <button
                type="button"
                onClick={() => {
                  onElegir({
                    variantId: r.variantId,
                    descripcion: `${r.producto} — ${r.medida}`,
                  });
                  setTexto("");
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted"
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{r.producto}</span>
                <span className="text-muted-foreground">{r.medida}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-muted-foreground">
        Opcional: si la placa no está en el catálogo, escribila abajo a mano.
      </p>
    </div>
  );
}
