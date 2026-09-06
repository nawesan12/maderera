"use client";

import { useState } from "react";
import { Calculator, Home, Layers, Grid3X3, Footprints, Plus, Ruler, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useCarrito } from "@/lib/carrito-context";
import { formatearPrecio, formatearUnidad } from "@/lib/formato";
import {
  calculateRoof,
  calculateBoards,
  calculateFloor,
  calculateDeck,
  type RoofResult,
  type BoardResult,
  type FloorResult,
  type DeckResult,
  type BoardPiece,
  MEDIDAS_DE_PLACA,
  ANCHO_DE_SIERRA_MM,
} from "@/lib/calculations";
import { buscarSugerencias } from "./actions";
import type { Sugerencia } from "@/lib/dal/sugerencias";

function ResultRow({ label, value, unit, onAdd, sugerencia, nota }: {
  label: string;
  value: string | number;
  unit: string;
  onAdd?: () => void;
  /** Qué producto del catálogo se encontró para este material. */
  sugerencia?: Sugerencia;
  /** Aclaración del renglón, como el "estimado" de los clavos. */
  nota?: string;
}) {
  return (
    <div className="py-3 border-b border-dashed last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-orange shrink-0" />
          <p className="text-sm font-medium">{label}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold bg-brand-orange/10 text-brand-orange px-3 py-1 rounded-lg">
            {value} {unit}
          </span>
          {onAdd && (
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 rounded-full text-brand-orange hover:text-white hover:bg-brand-orange" onClick={onAdd}>
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Qué producto del catálogo se va a agregar. Sin esto el "+" mete un
          renglón de texto y nadie sabe qué terminó pidiendo. */}
      {sugerencia && (
        <p className="mt-1 pl-3.5 text-xs text-muted-foreground">
          {sugerencia.descripcion}
          {sugerencia.precio
            ? ` · ${formatearPrecio(sugerencia.precio)} por ${formatearUnidad(sugerencia.unidad)}`
            : " · precio a consultar"}
          {!sugerencia.hayStock && " · sin stock, se encarga"}
        </p>
      )}

      {nota && <p className="mt-1 pl-3.5 text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}

/**
 * Las cuatro calculadoras.
 *
 * Es la única parte de `/calculadora` que necesita JavaScript, y por eso está
 * separada: la página que la contiene es un Server Component y el texto, el
 * encabezado y la metadata no viajan al navegador. La lógica de cálculo vive
 * en `lib/calculations.ts` y no acá.
 */
export function Calculadoras() {
  const { agregar } = useCarrito();

  /*
   * Lo que hay en el catálogo para cada material calculado.
   *
   * Se busca después de calcular: hasta que no se sabe qué material hace falta
   * no hay nada que buscar. Un fallo de red no rompe la calculadora —queda sin
   * sugerencias y las líneas entran como texto, que es exactamente como
   * entraban antes—.
   */
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);

  function pedirSugerencias(items: { busqueda: string }[]) {
    void buscarSugerencias(items.map((i) => i.busqueda))
      .then(setSugerencias)
      .catch(() => setSugerencias([]));
  }

  /** Qué encontró el catálogo para este renglón. */
  function sugerenciaDe(busqueda: string) {
    return sugerencias.find((s) => s.busqueda === busqueda);
  }

  /**
   * Agrega el renglón al presupuesto, con el producto del catálogo si lo hay.
   *
   * **Con `variantId` cuando se encontró, y como texto cuando no.** Sin el
   * `variantId` el renglón entra sin precio y sin stock: así entraban todos
   * antes, y por eso un techo calculado daba un presupuesto con total cero.
   * Cuando el material no está cargado el texto se conserva igual, porque el
   * material existe aunque el catálogo todavía no lo tenga.
   */
  function agregarDelCalculo(
    item: { descripcion: string; busqueda: string },
    cantidad: number,
    unidad: string,
  ) {
    const encontrada = sugerenciaDe(item.busqueda);

    agregar({
      variantId: encontrada?.variantId,
      descripcion: encontrada?.descripcion ?? item.descripcion,
      cantidad,
      unidad: encontrada?.unidad ?? unidad,
      origen: "calculadora",
    });
  }

  // Roof
  const [roofLargo, setRoofLargo] = useState("");
  const [roofAncho, setRoofAncho] = useState("");
  const [roofType, setRoofType] = useState<"pino" | "saligna">("pino");
  const [roofResult, setRoofResult] = useState<RoofResult | null>(null);

  // Boards
  const [boardPieces, setBoardPieces] = useState<BoardPiece[]>([{ ancho: 0, largo: 0, cantidad: 1 }]);
  /*
   * La medida de placa se elige de las cuatro que existen en plaza, no se
   * tipea. El valor por defecto era 1830 × 2820, que no es ninguna de ellas:
   * quien calculaba con eso compraba placas que no se venden.
   */
  const [medidaPlaca, setMedidaPlaca] = useState(0);
  const boardPlacaAncho = MEDIDAS_DE_PLACA[medidaPlaca].ancho;
  const boardPlacaLargo = MEDIDAS_DE_PLACA[medidaPlaca].largo;
  const [boardResult, setBoardResult] = useState<BoardResult | null>(null);

  // Floor
  const [floorLargo, setFloorLargo] = useState("");
  const [floorAncho, setFloorAncho] = useState("");
  const [floorResult, setFloorResult] = useState<FloorResult | null>(null);

  // Deck
  const [deckLargo, setDeckLargo] = useState("");
  const [deckAncho, setDeckAncho] = useState("");
  const [deckMaterial, setDeckMaterial] = useState<"grandis" | "pvc">("grandis");
  const [deckResult, setDeckResult] = useState<DeckResult | null>(null);

  return (
    <div className="contenedor py-12">
        <Tabs defaultValue="techos" className="space-y-8">
          <TabsList className="grid grid-cols-2 md:grid-cols-4 h-auto gap-3 bg-transparent p-0">
            {[
              { value: "techos", icon: Home, label: "Techos" },
              { value: "placas", icon: Layers, label: "Placas" },
              { value: "pisos", icon: Grid3X3, label: "Pisos" },
              { value: "decks", icon: Footprints, label: "Decks" },
            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex items-center gap-2.5 border-2 rounded-xl h-14 text-sm font-semibold data-[state=active]:bg-brand-orange data-[state=active]:text-white data-[state=active]:border-brand-orange data-[state=active]:shadow-lg data-[state=active]:shadow-brand-orange/20 transition-all"
              >
                <tab.icon className="h-5 w-5" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* TECHOS */}
          <TabsContent value="techos">
            <div className="grid lg:grid-cols-2 gap-8">
              <Card className="border-0 shadow-xl overflow-hidden">
                <div className="bg-brand-gray p-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                      <Home className="h-5 w-5 text-brand-orange" />
                    </div>
                    <div>
                      <CardTitle className="text-lg text-white">Calculadora de Techos</CardTitle>
                      <CardDescription className="text-white/50 text-xs mt-0.5">Ingresá las medidas para calcular materiales.</CardDescription>
                    </div>
                  </div>
                </div>
                <CardContent className="p-6 space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Largo (metros)</Label>
                      <div className="relative">
                        <Ruler className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                        <Input type="number" placeholder="ej: 6" value={roofLargo} onChange={(e) => setRoofLargo(e.target.value)} className="pl-10 h-12 rounded-xl border-border/60 text-base" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Ancho (metros)</Label>
                      <div className="relative">
                        <Ruler className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50 rotate-90" />
                        <Input type="number" placeholder="ej: 4" value={roofAncho} onChange={(e) => setRoofAncho(e.target.value)} className="pl-10 h-12 rounded-xl border-border/60 text-base" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tipo de madera</Label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { id: "pino" as const, label: "Pino Tratado", sub: "Económico" },
                        { id: "saligna" as const, label: "Saligna", sub: "Premium" },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => setRoofType(opt.id)}
                          className={`p-3.5 rounded-xl border-2 text-left transition-all ${
                            roofType === opt.id
                              ? "border-brand-orange bg-brand-orange/5 shadow-sm"
                              : "border-border/60 hover:border-brand-orange/30"
                          }`}
                        >
                          <p className="text-sm font-semibold">{opt.label}</p>
                          <p className="text-[11px] text-muted-foreground">{opt.sub}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button
                    className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20 text-base"
                    disabled={!roofLargo || !roofAncho}
                    onClick={() => {
                      const r = calculateRoof(Number(roofLargo), Number(roofAncho), roofType);
                      setRoofResult(r);
                      pedirSugerencias([r.tirantes, r.machimbre, r.aislacion, r.membrana, r.clavos]);
                    }}
                  >
                    <Calculator className="h-5 w-5 mr-2" />
                    Calcular Materiales
                  </Button>
                </CardContent>
              </Card>

              {roofResult && (
                <Card className="border-0 shadow-xl overflow-hidden">
                  <div className="bg-brand-green p-6 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white">Resultado</h3>
                    <Badge className="bg-white/20 border-0 text-white text-sm px-4 py-1.5">
                      {Number(roofLargo) * Number(roofAncho)} m² de techo
                    </Badge>
                  </div>
                  <CardContent className="p-6">
                    <ResultRow
                      label={roofResult.tirantes.descripcion}
                      value={roofResult.tirantes.cantidad}
                      unit={`unidades (${roofResult.tirantes.medida})`}
                      onAdd={() => agregarDelCalculo(roofResult.tirantes, roofResult.tirantes.cantidad, "unidades")}
                      sugerencia={sugerenciaDe(roofResult.tirantes.busqueda)}
                    />
                    <ResultRow
                      label={roofResult.machimbre.descripcion}
                      value={roofResult.machimbre.m2}
                      unit="m²"
                      onAdd={() => agregarDelCalculo(roofResult.machimbre, roofResult.machimbre.m2, "m²")}
                      sugerencia={sugerenciaDe(roofResult.machimbre.busqueda)}
                    />
                    <ResultRow
                      label={roofResult.aislacion.descripcion}
                      value={roofResult.aislacion.rollos}
                      unit="rollos"
                      onAdd={() => agregarDelCalculo(roofResult.aislacion, roofResult.aislacion.rollos, "rollos")}
                      sugerencia={sugerenciaDe(roofResult.aislacion.busqueda)}
                    />
                    <ResultRow
                      label={roofResult.membrana.descripcion}
                      value={roofResult.membrana.rollos}
                      unit="rollos"
                      onAdd={() => agregarDelCalculo(roofResult.membrana, roofResult.membrana.rollos, "rollos")}
                      sugerencia={sugerenciaDe(roofResult.membrana.busqueda)}
                    />
                    <ResultRow
                      label={roofResult.clavos.descripcion}
                      value={roofResult.clavos.kg}
                      unit="kg"
                      onAdd={() => agregarDelCalculo(roofResult.clavos, roofResult.clavos.kg, "kg")}
                      sugerencia={sugerenciaDe(roofResult.clavos.busqueda)}
                      nota="La cantidad de clavos depende de la medida y del uso: confirmala en el mostrador."
                    />
                    <div className="pt-4 mt-2">
                      <Button
                        className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20"
                        onClick={() => {
                          agregarDelCalculo(roofResult.tirantes, roofResult.tirantes.cantidad, "un");
                          agregarDelCalculo(roofResult.machimbre, roofResult.machimbre.m2, "m²");
                          agregarDelCalculo(roofResult.aislacion, roofResult.aislacion.rollos, "rollos");
                          agregarDelCalculo(roofResult.membrana, roofResult.membrana.rollos, "rollos");
                          agregarDelCalculo(roofResult.clavos, roofResult.clavos.kg, "kg");
                        }}
                      >
                        <ShoppingCart className="h-4 w-4 mr-2" />
                        Agregar todo al presupuesto
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* PLACAS */}
          <TabsContent value="placas">
            <div className="grid lg:grid-cols-2 gap-8">
              <Card className="border-0 shadow-xl overflow-hidden">
                <div className="bg-brand-gray p-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                      <Layers className="h-5 w-5 text-brand-orange" />
                    </div>
                    <div>
                      <CardTitle className="text-lg text-white">Optimización de Cortes</CardTitle>
                      <CardDescription className="text-white/50 text-xs mt-0.5">Calculamos cuántas placas necesitás.</CardDescription>
                    </div>
                  </div>
                </div>
                <CardContent className="p-6 space-y-5">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Medida de la placa</Label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {MEDIDAS_DE_PLACA.map((m, i) => (
                        <button
                          key={`${m.ancho}x${m.largo}`}
                          type="button"
                          onClick={() => setMedidaPlaca(i)}
                          className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                            medidaPlaca === i
                              ? "border-brand-orange bg-brand-orange/10"
                              : "border-border/60 hover:bg-muted"
                          }`}
                        >
                          <span className="block text-sm font-semibold">
                            {(m.ancho / 1000).toFixed(2)} × {(m.largo / 1000).toFixed(2)} m
                          </span>
                          <span className="block text-xs text-muted-foreground">{m.usos}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-3">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Piezas a cortar</Label>
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-1">Ancho mm</p>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-1">Largo mm</p>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-1">Cantidad</p>
                      </div>
                      {boardPieces.map((piece, idx) => (
                        <div key={idx} className="grid grid-cols-3 gap-2">
                          <Input type="number" placeholder="600" value={piece.ancho || ""} className="h-11 rounded-xl border-border/60" onChange={(e) => {
                            const newPieces = [...boardPieces];
                            newPieces[idx].ancho = Number(e.target.value);
                            setBoardPieces(newPieces);
                          }} />
                          <Input type="number" placeholder="400" value={piece.largo || ""} className="h-11 rounded-xl border-border/60" onChange={(e) => {
                            const newPieces = [...boardPieces];
                            newPieces[idx].largo = Number(e.target.value);
                            setBoardPieces(newPieces);
                          }} />
                          <Input type="number" placeholder="1" value={piece.cantidad || ""} className="h-11 rounded-xl border-border/60" onChange={(e) => {
                            const newPieces = [...boardPieces];
                            newPieces[idx].cantidad = Number(e.target.value);
                            setBoardPieces(newPieces);
                          }} />
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      onClick={() => setBoardPieces([...boardPieces, { ancho: 0, largo: 0, cantidad: 1 }])}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Agregar pieza
                    </Button>
                  </div>
                  <Button
                    className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20 text-base"
                    onClick={() => {
                      setBoardResult(calculateBoards(boardPieces.filter(p => p.ancho > 0 && p.largo > 0), boardPlacaAncho, boardPlacaLargo));
                      pedirSugerencias([{ busqueda: "placa melamina" }]);
                    }}
                  >
                    <Calculator className="h-5 w-5 mr-2" />
                    Calcular Placas
                  </Button>
                </CardContent>
              </Card>

              {boardResult && (
                <Card className="border-0 shadow-xl overflow-hidden">
                  <div className="bg-brand-green p-6 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white">Resultado</h3>
                  </div>
                  <CardContent className="p-6">
                    <ResultRow label="Placas necesarias" value={boardResult.placasNecesarias} unit={`placas (${boardResult.placaDimension})`} sugerencia={sugerenciaDe("placa melamina")} />
                    <ResultRow label="Aprovechamiento" value={`${boardResult.aprovechamiento}%`} unit="" />
                    <ResultRow label="Desperdicio" value={`${boardResult.desperdicio}%`} unit="" nota={`Incluye los ${ANCHO_DE_SIERRA_MM} mm que se lleva la sierra en cada pasada.`} />
                    <div className="pt-4 mt-2">
                      <Button
                        className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20"
                        onClick={() => agregarDelCalculo({ descripcion: `Placa ${boardResult.placaDimension}`, busqueda: "placa melamina" }, boardResult.placasNecesarias, "placas")}
                      >
                        <ShoppingCart className="h-4 w-4 mr-2" />
                        Agregar al presupuesto
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* PISOS */}
          <TabsContent value="pisos">
            <div className="grid lg:grid-cols-2 gap-8">
              <Card className="border-0 shadow-xl overflow-hidden">
                <div className="bg-brand-gray p-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                      <Grid3X3 className="h-5 w-5 text-brand-orange" />
                    </div>
                    <div>
                      <CardTitle className="text-lg text-white">Calculadora de Pisos</CardTitle>
                      <CardDescription className="text-white/50 text-xs mt-0.5">Piso melamínico, zócalos y underlay.</CardDescription>
                    </div>
                  </div>
                </div>
                <CardContent className="p-6 space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Largo del ambiente (m)</Label>
                      <div className="relative">
                        <Ruler className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                        <Input type="number" placeholder="ej: 5" value={floorLargo} onChange={(e) => setFloorLargo(e.target.value)} className="pl-10 h-12 rounded-xl border-border/60 text-base" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Ancho del ambiente (m)</Label>
                      <div className="relative">
                        <Ruler className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50 rotate-90" />
                        <Input type="number" placeholder="ej: 4" value={floorAncho} onChange={(e) => setFloorAncho(e.target.value)} className="pl-10 h-12 rounded-xl border-border/60 text-base" />
                      </div>
                    </div>
                  </div>
                  <Button
                    className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20 text-base"
                    disabled={!floorLargo || !floorAncho}
                    onClick={() => {
                      setFloorResult(calculateFloor(Number(floorLargo), Number(floorAncho)));
                      pedirSugerencias([
                        { busqueda: "piso melaminico" },
                        { busqueda: "zocalo" },
                        { busqueda: "underlay" },
                      ]);
                    }}
                  >
                    <Calculator className="h-5 w-5 mr-2" />
                    Calcular Materiales
                  </Button>
                </CardContent>
              </Card>

              {floorResult && (
                <Card className="border-0 shadow-xl overflow-hidden">
                  <div className="bg-brand-green p-6 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white">Resultado</h3>
                    <Badge className="bg-white/20 border-0 text-white text-sm px-4 py-1.5">
                      {Number(floorLargo) * Number(floorAncho)} m²
                    </Badge>
                  </div>
                  <CardContent className="p-6">
                    <ResultRow label="Piso melamínico" value={floorResult.pisoM2} unit="m²" />
                    <ResultRow label={`Cajas necesarias (${floorResult.m2PorCaja} m²/caja)`} value={floorResult.cajasNecesarias} unit="cajas" sugerencia={sugerenciaDe("piso melaminico")} />
                    <ResultRow label="Zócalos (3m c/u)" value={floorResult.zocalos} unit="unidades" sugerencia={sugerenciaDe("zocalo")} />
                    <ResultRow label="Metros lineales de zócalo" value={floorResult.zocaloML} unit="ml" />
                    <ResultRow label="Underlay / foam" value={floorResult.underlayM2} unit="m²" sugerencia={sugerenciaDe("underlay")} />
                    <div className="pt-4 mt-2">
                      <Button
                        className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20"
                        onClick={() => {
                          agregarDelCalculo({ descripcion: "Piso Melamínico Decno Flooring", busqueda: "piso melaminico" }, floorResult.cajasNecesarias, "cajas");
                          agregarDelCalculo({ descripcion: "Zócalo Moldava 7cm", busqueda: "zocalo" }, floorResult.zocalos, "unidades");
                          agregarDelCalculo({ descripcion: "Underlay Foam 2mm", busqueda: "underlay" }, floorResult.underlayM2, "m²");
                        }}
                      >
                        <ShoppingCart className="h-4 w-4 mr-2" />
                        Agregar todo al presupuesto
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* DECKS */}
          <TabsContent value="decks">
            <div className="grid lg:grid-cols-2 gap-8">
              <Card className="border-0 shadow-xl overflow-hidden">
                <div className="bg-brand-gray p-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                      <Footprints className="h-5 w-5 text-brand-orange" />
                    </div>
                    <div>
                      <CardTitle className="text-lg text-white">Calculadora de Deck</CardTitle>
                      <CardDescription className="text-white/50 text-xs mt-0.5">Tablas, estructura y tornillos.</CardDescription>
                    </div>
                  </div>
                </div>
                <CardContent className="p-6 space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Largo (metros)</Label>
                      <div className="relative">
                        <Ruler className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                        <Input type="number" placeholder="ej: 5" value={deckLargo} onChange={(e) => setDeckLargo(e.target.value)} className="pl-10 h-12 rounded-xl border-border/60 text-base" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Ancho (metros)</Label>
                      <div className="relative">
                        <Ruler className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50 rotate-90" />
                        <Input type="number" placeholder="ej: 3" value={deckAncho} onChange={(e) => setDeckAncho(e.target.value)} className="pl-10 h-12 rounded-xl border-border/60 text-base" />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Material</Label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { id: "grandis" as const, label: "Grandis Tratado", sub: "Natural, requiere mantenimiento" },
                        { id: "pvc" as const, label: "PVC Símil Madera", sub: "Sin mantenimiento" },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => setDeckMaterial(opt.id)}
                          className={`p-3.5 rounded-xl border-2 text-left transition-all ${
                            deckMaterial === opt.id
                              ? "border-brand-orange bg-brand-orange/5 shadow-sm"
                              : "border-border/60 hover:border-brand-orange/30"
                          }`}
                        >
                          <p className="text-sm font-semibold">{opt.label}</p>
                          <p className="text-[11px] text-muted-foreground">{opt.sub}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button
                    className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20 text-base"
                    disabled={!deckLargo || !deckAncho}
                    onClick={() => {
                      const r = calculateDeck(Number(deckLargo), Number(deckAncho), deckMaterial);
                      setDeckResult(r);
                      pedirSugerencias([r.tablasDeck, r.estructura, r.tornillos, r.protector]);
                    }}
                  >
                    <Calculator className="h-4 w-4 mr-2" />
                    Calcular Materiales
                  </Button>
                </CardContent>
              </Card>

              {deckResult && (
                <Card className="border-0 shadow-xl overflow-hidden">
                  <div className="bg-brand-green p-6 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white">Resultado</h3>
                    <Badge className="bg-white/20 border-0 text-white text-sm px-4 py-1.5">
                      {Number(deckLargo) * Number(deckAncho)} m² de deck
                    </Badge>
                  </div>
                  <CardContent className="p-6">
                    <ResultRow label={deckResult.tablasDeck.descripcion} value={deckResult.tablasDeck.m2} unit="m²" sugerencia={sugerenciaDe(deckResult.tablasDeck.busqueda)} />
                    <ResultRow label="Alfajías / estructura" value={deckResult.estructura.tirantes} unit={`un (${deckResult.estructura.medida})`} sugerencia={sugerenciaDe(deckResult.estructura.busqueda)} />
                    <ResultRow label={deckResult.tornillos.descripcion} value={deckResult.tornillos.cantidad} unit="unidades" sugerencia={sugerenciaDe(deckResult.tornillos.busqueda)} />
                    {deckResult.protector.litros > 0 && (
                      <ResultRow label={deckResult.protector.descripcion} value={deckResult.protector.litros} unit="litros" sugerencia={sugerenciaDe(deckResult.protector.busqueda)} />
                    )}
                    <div className="pt-4 mt-2">
                      <Button
                        className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20"
                        onClick={() => {
                          agregarDelCalculo(deckResult.tablasDeck, deckResult.tablasDeck.m2, "m²");
                          agregarDelCalculo(deckResult.estructura, deckResult.estructura.tirantes, "unidades");
                          agregarDelCalculo(deckResult.tornillos, deckResult.tornillos.cantidad, "unidades");
                          if (deckResult.protector.litros > 0) {
                            agregarDelCalculo(deckResult.protector, deckResult.protector.litros, "litros");
                          }
                        }}
                      >
                        <ShoppingCart className="h-4 w-4 mr-2" />
                        Agregar todo al presupuesto
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
      </Tabs>
    </div>
  );
}
