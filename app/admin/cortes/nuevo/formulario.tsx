"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { crearCorte } from "../actions";
import { buscarClientes, buscarEnMostrador } from "@/app/mostrador/actions";
import { medidaDePlaca, nombreDeLaMitad, type Mitad } from "@/lib/cortes/placa";
import {
  calcularPlanoDeCorte,
  type PiezaFijada,
} from "@/lib/cortes/plano";
import { PlanoEnVivo } from "@/components/cortes/plano-en-vivo";
import { metrosDeTapacanto } from "@/lib/cortes/tarifa";

/** La placa elegida del catálogo, con lo que el plano necesita saber de ella. */
interface PlacaElegida {
  variantId: string;
  descripcion: string;
  largoMm: number | null;
  anchoMm: number | null;
  /** Para avisar al partir: en una placa de color el dibujo tiene sentido. */
  color: string | null;
}

interface Pieza {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  respetaVeta: boolean;
  /** Cuántos lados de cada medida llevan tapacanto: 0, 1 o 2. */
  cantoLargo: number;
  cantoAncho: number;
  /** Excepción puntual: otro color o espesor de canto para esta pieza. */
  aclaracion: string;
  etiqueta: string;
}

const piezaVacia = (): Pieza => ({
  largoMm: 0,
  anchoMm: 0,
  cantidad: 1,
  respetaVeta: false,
  cantoLargo: 0,
  cantoAncho: 0,
  aclaracion: "",
  etiqueta: "",
});

const estadoInicial = {} as { error?: string; ok?: string };

export function FormularioCorte({
  sucursales,
  desdePedido,
  anchoSierra,
}: {
  sucursales: { id: string; nombre: string }[];
  /**
   * Lo que se lleva el disco en cada pasada, de /admin/calculadoras.
   *
   * Viaja como prop porque esta pantalla es de cliente —el plano se rehace con
   * cada tecla— y el valor vive en la base. Antes el motor usaba su constante
   * de 5 mm y el número configurable no lo leía nadie: dos verdades para lo
   * mismo.
   */
  anchoSierra: number;
  /**
   * El pedido del que sale este corte, cuando se entra desde su ficha.
   *
   * Viene resuelto del servidor y no como un id suelto en el URL: el cliente y
   * la sucursal ya están decididos por el pedido, y volver a pedirlos sería
   * hacer tipear de nuevo algo que el sistema ya sabe —y arriesgar que quede
   * un corte a nombre de otro—.
   */
  desdePedido?: {
    id: string;
    numero: string;
    branchId: string | null;
    cliente: { id: string; nombre: string; razonSocial: string | null } | null;
    contactoNombre: string;
  };
}) {
  const [estado, accion, pendiente] = useActionState(crearCorte, estadoInicial);

  /*
   * Dónde se corta.
   *
   * Dejó de preguntarse —lo pidió la clienta— porque no era una decisión: el
   * corte se hace donde está la máquina y quien carga el trabajo ya está
   * parado ahí. La sucursal se sigue guardando, que es lo que hace que el
   * trabajo aparezca en la cola de ese taller y que el stock se descuente
   * donde corresponde; sale del pedido, o de la primera sucursal.
   */
  const sucursal = desdePedido?.branchId ?? sucursales[0]?.id ?? "";
  const [cliente, setCliente] = useState<{ id: string; nombre: string; razonSocial: string | null } | null>(
    desdePedido?.cliente ?? null,
  );
  const [nombre, setNombre] = useState(desdePedido?.contactoNombre ?? "");
  const [placa, setPlaca] = useState<PlacaElegida | null>(null);
  /** La medida de la placa, en milímetros, como está en pantalla. */
  const [largoPlaca, setLargoPlaca] = useState("");
  const [anchoPlaca, setAnchoPlaca] = useState("");
  /** Si sale de media placa, y en qué sentido se parte. */
  const [mitad, setMitad] = useState<Mitad>(null);
  const [material, setMaterial] = useState("");
  const [piezas, setPiezas] = useState<Pieza[]>([piezaVacia()]);
  const [placas, setPlacas] = useState(1);
  /** Las piezas que alguien mandó a mano a una placa. */
  const [fijadas, setFijadas] = useState<PiezaFijada[]>([]);
  /** Si alguien lo pisó a mano, el plano deja de moverlo solo. */
  const [placasTocado, setPlacasTocado] = useState(false);

  const validas = piezas.filter((p) => p.largoMm > 0 && p.anchoMm > 0 && p.cantidad > 0);
  const totalPiezas = validas.reduce((s, p) => s + p.cantidad, 0);
  // Los metros cuadrados del despiece: no reemplazan al optimizador, pero
  // permiten ver de un vistazo si el número de placas tiene sentido.
  const m2 = validas.reduce(
    (s, p) => s + (p.largoMm / 1000) * (p.anchoMm / 1000) * p.cantidad,
    0,
  );
  // Los metros de tapacanto, con la misma cuenta que la ficha y la planilla
  // del taller. Verlos mientras se carga es lo que atrapa el canto olvidado.
  const metrosCanto = metrosDeTapacanto(validas);

  /*
   * La medida de la placa sobre la que se acomoda.
   *
   * Manda lo que está escrito en los dos campos —que se autocompletan con la
   * variante del catálogo—, y encima se aplica la mitad si el trabajo sale de
   * media placa. Cuando no hay nada de dónde sacarla se usa la de plaza más
   * común y **se avisa en pantalla**: un plano hecho sobre una medida supuesta
   * no sirve para cobrar. Ver `lib/cortes/placa.ts`.
   */
  const medidaPlaca = medidaDePlaca({
    propiaLargo: Number(largoPlaca) || null,
    propiaAncho: Number(anchoPlaca) || null,
    varianteLargo: placa?.largoMm,
    varianteAncho: placa?.anchoMm,
    mitad,
  });

  const paraElPlano = useMemo(
    () =>
      validas.map((p) => ({
        largoMm: p.largoMm,
        anchoMm: p.anchoMm,
        cantidad: p.cantidad,
        respetaVeta: p.respetaVeta ? 1 : 0,
        etiqueta: p.etiqueta || null,
        cantoLargo: p.cantoLargo,
        cantoAncho: p.cantoAncho,
      })),
    // `validas` se deriva de `piezas` en cada render; la dependencia real es
    // esa, y compararla por JSON evita rehacer el plano por una identidad nueva
    // del array cuando los números no cambiaron.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(validas)],
  );

  /*
   * El plano se calcula acá y no adentro del dibujo porque el formulario lo
   * necesita para dos cosas: mostrarlo y proponer cuántas placas.
   */
  const plano = useMemo(
    () =>
      calcularPlanoDeCorte({
        piezas: paraElPlano,
        placaLargo: medidaPlaca.largo,
        placaAncho: medidaPlaca.ancho,
        anchoSierra,
        fijadas,
      }),
    [paraElPlano, medidaPlaca.largo, medidaPlaca.ancho, anchoSierra, fijadas],
  );

  const placasDelPlano = Math.max(1, plano.placas.length);

  // Mientras nadie lo pise a mano, el campo sigue al plano.
  useEffect(() => {
    if (!placasTocado) setPlacas(placasDelPlano);
  }, [placasDelPlano, placasTocado]);

  function actualizar(
    indice: number,
    campo: keyof Pieza,
    valor: string | boolean,
  ) {
    setPiezas((previas) =>
      previas.map((p, i) =>
        i === indice
          ? {
              ...p,
              [campo]:
                typeof valor === "boolean"
                  ? valor
                  : campo === "etiqueta" || campo === "aclaracion"
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
      {desdePedido && (
        <input type="hidden" name="orderId" value={desdePedido.id} />
      )}
      {cliente && <input type="hidden" name="customerId" value={cliente.id} />}
      {placa && <input type="hidden" name="variantId" value={placa.variantId} />}
      {/* El acomodo corregido a mano viaja con el formulario: sin esto, mover
          una pieza y apretar Guardar la devolvía al automático sin avisar. */}
      {fijadas.length > 0 && (
        <input
          type="hidden"
          name="acomodoManual"
          value={JSON.stringify(fijadas)}
        />
      )}
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

          </div>

          <BuscadorDePlaca
            branchId={sucursal}
            elegida={placa}
            onElegir={(p) => {
              setPlaca(p);
              if (p) {
                setMaterial(p.descripcion);
                // La medida de la variante entra en los campos, donde se puede
                // corregir: la placa que hay en el depósito no siempre mide lo
                // que dice el catálogo.
                setLargoPlaca(p.largoMm ? String(p.largoMm) : "");
                setAnchoPlaca(p.anchoMm ? String(p.anchoMm) : "");
              }
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

            {/* Cuántas placas.
                Ya no arranca en 1 a ciegas: lo calcula el plano con el despiece
                cargado y el campo lo sigue. Se puede pisar a mano —alguien
                puede querer llevarse una de más— pero el número de partida es
                el medido, no un supuesto. */}
            <div className="space-y-2">
              <Label htmlFor="placas">Placas</Label>
              <Input
                id="placas"
                name="placas"
                type="number"
                min="1"
                value={placas}
                onChange={(e) => {
                  setPlacasTocado(true);
                  setPlacas(Number(e.target.value) || 1);
                }}
              />
              {placasTocado && placas !== placasDelPlano && (
                <button
                  type="button"
                  onClick={() => {
                    setPlacas(placasDelPlano);
                    setPlacasTocado(false);
                  }}
                  className="text-sm text-muted-foreground underline-offset-2 hover:underline"
                >
                  El plano dice {placasDelPlano}
                </button>
              )}
            </div>
          </div>

          {/* La medida de la placa y de qué sale.

              Antes esto no se podía tocar: la medida salía de la variante y,
              si no había, el plano se armaba sobre 1830 × 2750 avisando
              «medida supuesta» sin dejar corregirla. Con material del cliente
              —que es la mitad de los trabajos— eso volvía inútil el plano. */}
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="placaLargoMm">Largo de la placa (mm)</Label>
              <Input
                id="placaLargoMm"
                name="placaLargoMm"
                type="number"
                min="1"
                inputMode="numeric"
                value={largoPlaca}
                onChange={(e) => setLargoPlaca(e.target.value)}
                placeholder={String(medidaPlaca.largo)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="placaAnchoMm">Ancho de la placa (mm)</Label>
              <Input
                id="placaAnchoMm"
                name="placaAnchoMm"
                type="number"
                min="1"
                inputMode="numeric"
                value={anchoPlaca}
                onChange={(e) => setAnchoPlaca(e.target.value)}
                placeholder={String(medidaPlaca.ancho)}
              />
            </div>

            <div className="space-y-2">
              <Label>De qué sale</Label>
              <input type="hidden" name="mitad" value={mitad ?? ""} />
              <div className="flex gap-1.5" role="group" aria-label="De qué sale">
                {([null, "largo", "ancho"] as const).map((m) => (
                  <button
                    key={m ?? "entera"}
                    type="button"
                    onClick={() => setMitad(m)}
                    aria-pressed={mitad === m}
                    className={`h-10 rounded-md px-3 text-base font-medium transition-colors ${
                      mitad === m
                        ? "bg-brand-orange text-white"
                        : "border border-input text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {m === null
                      ? "Placa entera"
                      : m === "largo"
                        ? "Media a lo largo"
                        : "Media al ancho"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {nombreDeLaMitad(mitad)} de {medidaPlaca.largo} × {medidaPlaca.ancho}{" "}
            mm
            {medidaPlaca.supuesta
              ? " · medida supuesta: elegí la placa del catálogo o escribí la medida"
              : ""}
            {` · la sierra se lleva ${anchoSierra} mm por corte`}
          </p>

          {/* Partir una placa de color no es lo mismo que partir una blanca:
              el dibujo corre en un sentido y la mitad cortada al ancho puede
              quedar con la veta cruzada. No se bloquea —quien atiende sabe qué
              placa tiene en la mano—, se avisa. */}
          {mitad && placa?.color && (
            <p className="tarjeta-atencion px-4 py-3 text-base">
              La placa es <strong>{placa.color}</strong>: fijate cómo corre el
              dibujo antes de partirla. Al ancho, las dos mitades quedan con la
              veta cruzada.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="cantoDescripcion">Tapacanto del trabajo</Label>
            <Input
              id="cantoDescripcion"
              name="cantoDescripcion"
              placeholder="Blanco 0,45 mm — vacío si no lleva"
            />
            <p className="text-sm text-muted-foreground">
              El color y el espesor del canto, una vez para todo el despiece. La
              excepción de una pieza va en su aclaración.
            </p>
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
                {metrosCanto > 0 &&
                  ` · ${metrosCanto.toFixed(2)} m de tapacanto`}
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
                    <Label htmlFor={`largo-${i}`} className="text-base">
                      Largo (mm)
                    </Label>
                    <Input
                      id={`largo-${i}`}
                      type="number"
                      min="1"
                      value={p.largoMm || ""}
                      onChange={(e) => actualizar(i, "largoMm", e.target.value)}
                    />
                  </div>

                  <div className="w-28 space-y-1">
                    <Label htmlFor={`ancho-${i}`} className="text-base">
                      Ancho (mm)
                    </Label>
                    <Input
                      id={`ancho-${i}`}
                      type="number"
                      min="1"
                      value={p.anchoMm || ""}
                      onChange={(e) => actualizar(i, "anchoMm", e.target.value)}
                    />
                  </div>

                  <div className="w-24 space-y-1">
                    <Label htmlFor={`cantidad-${i}`} className="text-base">
                      Cantidad
                    </Label>
                    <Input
                      id={`cantidad-${i}`}
                      type="number"
                      min="1"
                      value={p.cantidad}
                      onChange={(e) => actualizar(i, "cantidad", e.target.value)}
                    />
                  </div>

                  <div className="min-w-40 flex-1 space-y-1">
                    <Label htmlFor={`etiqueta-${i}`} className="text-base">
                      Etiqueta
                    </Label>
                    <Input
                      id={`etiqueta-${i}`}
                      value={p.etiqueta}
                      onChange={(e) => actualizar(i, "etiqueta", e.target.value)}
                      placeholder="Puerta, estante…"
                    />
                  </div>

                  {piezas.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setPiezas((previas) => previas.filter((_, j) => j !== i))
                      }
                      className="h-11 gap-1.5 text-base text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Quitar
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={p.respetaVeta}
                      onCheckedChange={(v) =>
                        actualizar(i, "respetaVeta", v === true)
                      }
                    />
                    Respeta la veta
                  </label>

                  {/* Los cantos van 0/1/2 por medida, como la planilla del
                      taller: "2" es canto en los dos lados de esa medida. */}
                  <label className="flex items-center gap-2 text-base">
                    Canto en el largo
                    <select
                      value={p.cantoLargo}
                      onChange={(e) => actualizar(i, "cantoLargo", e.target.value)}
                      className="h-11 rounded-md border border-input bg-transparent px-2.5 text-base"
                      aria-label="Lados con canto en el largo"
                    >
                      <option value={0}>No</option>
                      <option value={1}>1 lado</option>
                      <option value={2}>2 lados</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-base">
                    Canto en el ancho
                    <select
                      value={p.cantoAncho}
                      onChange={(e) => actualizar(i, "cantoAncho", e.target.value)}
                      className="h-11 rounded-md border border-input bg-transparent px-2.5 text-base"
                      aria-label="Lados con canto en el ancho"
                    >
                      <option value={0}>No</option>
                      <option value={1}>1 lado</option>
                      <option value={2}>2 lados</option>
                    </select>
                  </label>

                  {(p.cantoLargo > 0 || p.cantoAncho > 0) && (
                    <div className="min-w-44 flex-1 space-y-1">
                      <Label htmlFor={`aclaracion-${i}`} className="text-base">
                        Aclaración del canto
                      </Label>
                      <Input
                        id={`aclaracion-${i}`}
                        value={p.aclaracion}
                        onChange={(e) =>
                          actualizar(i, "aclaracion", e.target.value)
                        }
                        placeholder="Otro color o espesor, solo si difiere"
                      />
                    </div>
                  )}
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

      {/* El plano, acá y no después de guardar.
          No se puede vender un corte sin ver cómo queda adentro de la placa: de
          este acomodo salen las placas que hacen falta, si conviene vender la
          placa entera y cuántas pasadas se cobran. Se recalcula con cada medida
          que se tipea porque el cálculo corre en el navegador. */}
      <Card className="border-border bg-card">
        <CardContent className="space-y-4 p-6">
          <div className="space-y-1">
            <h2 className="text-base font-semibold">Cómo entra en la placa</h2>
            <p className="text-base text-muted-foreground">
              Se rehace solo a medida que cargás las piezas.
            </p>
          </div>

          <PlanoEnVivo
            plano={plano}
            medidaSupuesta={medidaPlaca.supuesta}
            fijadas={fijadas}
            onFijadas={setFijadas}
          />
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
  elegida: PlacaElegida | null;
  onElegir: (p: PlacaElegida | null) => void;
}) {
  const [texto, setTexto] = useState("");
  const [traidos, setTraidos] = useState<{
    clave: string;
    items: {
      variantId: string;
      producto: string;
      medida: string;
      largoMm?: number | null;
      anchoMm?: number | null;
      color?: string | null;
    }[];
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
                    largoMm: r.largoMm ?? null,
                    anchoMm: r.anchoMm ?? null,
                    color: r.color ?? null,
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
