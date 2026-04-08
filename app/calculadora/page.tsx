"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Calculator, Home, Layers, Grid3X3, Footprints, ArrowRight, Plus, Ruler, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useBudget } from "@/lib/budget-context";
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
} from "@/lib/calculations";

function ResultRow({ label, value, unit, onAdd }: { label: string; value: string | number; unit: string; onAdd?: () => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-dashed last:border-0">
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
  );
}

export default function CalculadoraPage() {
  const { addItem } = useBudget();

  // Roof
  const [roofLargo, setRoofLargo] = useState("");
  const [roofAncho, setRoofAncho] = useState("");
  const [roofType, setRoofType] = useState<"pino" | "saligna">("pino");
  const [roofResult, setRoofResult] = useState<RoofResult | null>(null);

  // Boards
  const [boardPieces, setBoardPieces] = useState<BoardPiece[]>([{ ancho: 0, largo: 0, cantidad: 1 }]);
  const [boardPlacaAncho, setBoardPlacaAncho] = useState("1830");
  const [boardPlacaLargo, setBoardPlacaLargo] = useState("2820");
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
    <div className="min-h-screen">
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=1920&q=80"
            alt="Calculadora"
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 bg-brand-gray/90" />
        </div>
        <div className="container mx-auto px-4 relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-brand-orange font-semibold text-sm uppercase tracking-wider mb-3">Herramienta gratuita</p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 tracking-tight">
              Calculadora de <span className="text-brand-orange">Medidas</span>
            </h1>
            <p className="text-white/60 text-lg max-w-xl">
              Ingresá las dimensiones de tu proyecto y obtené la lista exacta de materiales.
              Los resultados se agregan directo al presupuesto.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-12">
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
                    onClick={() => setRoofResult(calculateRoof(Number(roofLargo), Number(roofAncho), roofType))}
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
                      onAdd={() => addItem({ name: roofResult.tirantes.descripcion, quantity: roofResult.tirantes.cantidad, unit: "unidades", category: "techos" })}
                    />
                    <ResultRow
                      label={roofResult.machimbre.descripcion}
                      value={roofResult.machimbre.m2}
                      unit="m²"
                      onAdd={() => addItem({ name: roofResult.machimbre.descripcion, quantity: roofResult.machimbre.m2, unit: "m²", category: "techos" })}
                    />
                    <ResultRow
                      label={roofResult.aislacion.descripcion}
                      value={roofResult.aislacion.rollos}
                      unit="rollos"
                      onAdd={() => addItem({ name: roofResult.aislacion.descripcion, quantity: roofResult.aislacion.rollos, unit: "rollos", category: "techos" })}
                    />
                    <ResultRow
                      label={roofResult.membrana.descripcion}
                      value={roofResult.membrana.rollos}
                      unit="rollos"
                      onAdd={() => addItem({ name: roofResult.membrana.descripcion, quantity: roofResult.membrana.rollos, unit: "rollos", category: "techos" })}
                    />
                    <ResultRow
                      label={roofResult.clavos.descripcion}
                      value={roofResult.clavos.kg}
                      unit="kg"
                      onAdd={() => addItem({ name: roofResult.clavos.descripcion, quantity: roofResult.clavos.kg, unit: "kg", category: "techos" })}
                    />
                    <div className="pt-4 mt-2">
                      <Button
                        className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20"
                        onClick={() => {
                          addItem({ name: roofResult.tirantes.descripcion, quantity: roofResult.tirantes.cantidad, unit: "un", category: "techos" });
                          addItem({ name: roofResult.machimbre.descripcion, quantity: roofResult.machimbre.m2, unit: "m²", category: "techos" });
                          addItem({ name: roofResult.aislacion.descripcion, quantity: roofResult.aislacion.rollos, unit: "rollos", category: "techos" });
                          addItem({ name: roofResult.membrana.descripcion, quantity: roofResult.membrana.rollos, unit: "rollos", category: "techos" });
                          addItem({ name: roofResult.clavos.descripcion, quantity: roofResult.clavos.kg, unit: "kg", category: "techos" });
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
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Placa ancho (mm)</Label>
                      <Input type="number" value={boardPlacaAncho} onChange={(e) => setBoardPlacaAncho(e.target.value)} className="h-12 rounded-xl border-border/60 text-base" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Placa largo (mm)</Label>
                      <Input type="number" value={boardPlacaLargo} onChange={(e) => setBoardPlacaLargo(e.target.value)} className="h-12 rounded-xl border-border/60 text-base" />
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
                    onClick={() => setBoardResult(calculateBoards(boardPieces.filter(p => p.ancho > 0 && p.largo > 0), Number(boardPlacaAncho), Number(boardPlacaLargo)))}
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
                    <ResultRow label="Placas necesarias" value={boardResult.placasNecesarias} unit={`placas (${boardResult.placaDimension})`} />
                    <ResultRow label="Aprovechamiento" value={`${boardResult.aprovechamiento}%`} unit="" />
                    <ResultRow label="Desperdicio" value={`${boardResult.desperdicio}%`} unit="" />
                    <div className="pt-4 mt-2">
                      <Button
                        className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20"
                        onClick={() => addItem({ name: `Placa Melamina ${boardResult.placaDimension}`, quantity: boardResult.placasNecesarias, unit: "placas", category: "placas" })}
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
                    onClick={() => setFloorResult(calculateFloor(Number(floorLargo), Number(floorAncho)))}
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
                    <ResultRow label={`Cajas necesarias (${floorResult.m2PorCaja} m²/caja)`} value={floorResult.cajasNecesarias} unit="cajas" />
                    <ResultRow label="Zócalos (3m c/u)" value={floorResult.zocalos} unit="unidades" />
                    <ResultRow label="Metros lineales de zócalo" value={floorResult.zocaloML} unit="ml" />
                    <ResultRow label="Underlay / foam" value={floorResult.underlayM2} unit="m²" />
                    <div className="pt-4 mt-2">
                      <Button
                        className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20"
                        onClick={() => {
                          addItem({ name: "Piso Melamínico Decno Flooring", quantity: floorResult.cajasNecesarias, unit: "cajas", category: "pisos" });
                          addItem({ name: "Zócalo Moldava 7cm", quantity: floorResult.zocalos, unit: "unidades", category: "molduras" });
                          addItem({ name: "Underlay Foam 2mm", quantity: floorResult.underlayM2, unit: "m²", category: "pisos" });
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
                    onClick={() => setDeckResult(calculateDeck(Number(deckLargo), Number(deckAncho), deckMaterial))}
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
                    <ResultRow label={deckResult.tablasDeck.descripcion} value={deckResult.tablasDeck.m2} unit="m²" />
                    <ResultRow label="Alfajías / estructura" value={deckResult.estructura.tirantes} unit={`un (${deckResult.estructura.medida})`} />
                    <ResultRow label={deckResult.tornillos.descripcion} value={deckResult.tornillos.cantidad} unit="unidades" />
                    {deckResult.protector.litros > 0 && (
                      <ResultRow label={deckResult.protector.descripcion} value={deckResult.protector.litros} unit="litros" />
                    )}
                    <div className="pt-4 mt-2">
                      <Button
                        className="w-full bg-brand-orange hover:bg-brand-orange-dark text-white rounded-full h-12 font-semibold shadow-lg shadow-brand-orange/20"
                        onClick={() => {
                          addItem({ name: deckResult.tablasDeck.descripcion, quantity: deckResult.tablasDeck.m2, unit: "m²", category: "decks" });
                          addItem({ name: "Alfajía para deck", quantity: deckResult.estructura.tirantes, unit: "unidades", category: "decks" });
                          addItem({ name: deckResult.tornillos.descripcion, quantity: deckResult.tornillos.cantidad, unit: "unidades", category: "ferreteria" });
                          if (deckResult.protector.litros > 0) {
                            addItem({ name: deckResult.protector.descripcion, quantity: deckResult.protector.litros, unit: "litros", category: "ferreteria" });
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
    </div>
  );
}
