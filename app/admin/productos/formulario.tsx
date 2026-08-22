"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GaleriaImagenes,
  type ImagenProducto,
} from "@/components/admin/galeria-imagenes";
import { generarSlug } from "@/lib/validation/product";
import { guardarProducto, type EstadoFormulario } from "./actions";

export interface VarianteForm {
  id?: string;
  sku: string;
  label: string;
  largoMm: number | null;
  anchoMm: number | null;
  espesorMm: number | null;
  material: string;
  color: string;
  precioGeneral: string;
  precioProfesional: string;
  stockCentral: number;
  stockAserradero: number;
  minCentral: number;
  minAserradero: number;
}

export interface ProductoForm {
  id?: string;
  name: string;
  slug: string;
  categoryId: string;
  subcategory: string;
  description: string;
  brand: string;
  unit: string;
  featured: boolean;
  active: boolean;
  imagen: string;
  variantes: VarianteForm[];
}

const UNIDADES = [
  { valor: "unidad", texto: "Por unidad" },
  { valor: "metro_lineal", texto: "Por metro lineal" },
  { valor: "metro_cuadrado", texto: "Por metro cuadrado" },
  { valor: "placa", texto: "Por placa" },
  { valor: "rollo", texto: "Por rollo" },
  { valor: "par", texto: "Por par" },
  { valor: "juego", texto: "Por juego" },
  { valor: "kg", texto: "Por kilo" },
  { valor: "litro", texto: "Por litro" },
];

const varianteVacia = (): VarianteForm => ({
  sku: "",
  label: "",
  largoMm: null,
  anchoMm: null,
  espesorMm: null,
  material: "",
  color: "",
  precioGeneral: "0",
  precioProfesional: "0",
  stockCentral: 0,
  stockAserradero: 0,
  minCentral: 0,
  minAserradero: 0,
});

const estadoInicial: EstadoFormulario = {};

export function FormularioProducto({
  inicial,
  categorias,
  galeria = [],
}: {
  inicial: ProductoForm;
  categorias: { id: string; name: string }[];
  galeria?: ImagenProducto[];
}) {
  const [estado, accion, pendiente] = useActionState(
    guardarProducto,
    estadoInicial,
  );

  const [nombre, setNombre] = useState(inicial.name);
  const [slug, setSlug] = useState(inicial.slug);
  const [slugTocado, setSlugTocado] = useState(Boolean(inicial.id));
  const [unidad, setUnidad] = useState(inicial.unit);
  const [categoria, setCategoria] = useState(inicial.categoryId);
  const [variantes, setVariantes] = useState<VarianteForm[]>(
    inicial.variantes.length > 0 ? inicial.variantes : [varianteVacia()],
  );

  // Mientras nadie edite el slug a mano, sigue al nombre.
  function cambiarNombre(valor: string) {
    setNombre(valor);
    if (!slugTocado) setSlug(generarSlug(valor));
  }

  function actualizarVariante(
    indice: number,
    campo: keyof VarianteForm,
    valor: string,
  ) {
    setVariantes((prev) =>
      prev.map((v, i) => {
        if (i !== indice) return v;
        const numericos: (keyof VarianteForm)[] = [
          "largoMm",
          "anchoMm",
          "espesorMm",
          "stockCentral",
          "stockAserradero",
          "minCentral",
          "minAserradero",
        ];
        if (numericos.includes(campo)) {
          return { ...v, [campo]: valor === "" ? null : Number(valor) };
        }
        return { ...v, [campo]: valor };
      }),
    );
  }

  return (
    <form action={accion} className="space-y-6">
      {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
      <input
        type="hidden"
        name="variantes"
        value={JSON.stringify(
          variantes.map((v) => ({
            ...v,
            largoMm: v.largoMm === null ? "" : String(v.largoMm),
            anchoMm: v.anchoMm === null ? "" : String(v.anchoMm),
            espesorMm: v.espesorMm === null ? "" : String(v.espesorMm),
            stockCentral: String(v.stockCentral ?? 0),
            stockAserradero: String(v.stockAserradero ?? 0),
            minCentral: String(v.minCentral ?? 0),
            minAserradero: String(v.minAserradero ?? 0),
          })),
        )}
      />
      <input type="hidden" name="unit" value={unidad} />
      <input type="hidden" name="categoryId" value={categoria} />

      {estado.error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-brand-red/10 px-4 py-3 text-base text-brand-red"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          {estado.error}
        </p>
      )}

      {/* Datos generales */}
      <Card className="border-border bg-card">
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold text-foreground">Datos generales</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                name="name"
                value={nombre}
                onChange={(e) => cambiarNombre(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">Dirección web</Label>
              <Input
                id="slug"
                name="slug"
                value={slug}
                onChange={(e) => {
                  setSlugTocado(true);
                  setSlug(e.target.value);
                }}
                required
              />
              <p className="text-sm text-muted-foreground">/catalogo/{slug || "…"}</p>
            </div>

            <div className="space-y-2">
              <Label>Categoría</Label>
              <Select
                value={categoria}
                onValueChange={(v) => v && setCategoria(v)}
                items={Object.fromEntries(
                  categorias.map((c) => [c.id, c.name]),
                )}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Elegí una categoría" />
                </SelectTrigger>
                <SelectContent>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subcategory">Subcategoría</Label>
              <Input
                id="subcategory"
                name="subcategory"
                defaultValue={inicial.subcategory}
                placeholder="Tirantería, Melaminas…"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand">Marca</Label>
              <Input
                id="brand"
                name="brand"
                defaultValue={inicial.brand}
                placeholder="Moldava, Curvin…"
              />
            </div>

            <div className="space-y-2">
              <Label>Unidad de venta</Label>
              <Select
                value={unidad}
                onValueChange={(v) => v && setUnidad(v)}
                items={Object.fromEntries(
                  UNIDADES.map((u) => [u.valor, u.texto]),
                )}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIDADES.map((u) => (
                    <SelectItem key={u.valor} value={u.valor}>
                      {u.texto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripción</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={inicial.description}
              rows={3}
            />
          </div>

          <input type="hidden" name="imagen" value={inicial.imagen} />

          <div className="flex gap-8 pt-2">
            <label className="flex items-center gap-2 text-base text-foreground">
              <Switch name="featured" defaultChecked={inicial.featured} />
              Destacado
            </label>
            <label className="flex items-center gap-2 text-base text-foreground">
              <Switch name="active" defaultChecked={inicial.active} />
              Visible en el sitio
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Fotos */}
      {inicial.id ? (
        <Card className="tarjeta border-0">
          <CardContent className="space-y-4 p-6">
            <div>
              <h2 className="text-base font-semibold">Fotos</h2>
              <p className="text-sm text-muted-foreground">
                Lo primero que mira quien entra al catálogo.
              </p>
            </div>
            <GaleriaImagenes productId={inicial.id} imagenes={galeria} />
          </CardContent>
        </Card>
      ) : (
        <Card className="tarjeta-hundida border-0">
          <CardContent className="p-6 text-center">
            <p className="text-base text-muted-foreground">
              Guardá el producto y después le cargás las fotos.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Variantes */}
      <Card className="border-border bg-card">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Medidas y presentaciones
              </h2>
              <p className="text-sm text-muted-foreground">
                Cada medida tiene su propio código, precio y stock.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVariantes((p) => [...p, varianteVacia()])}
            >
              <Plus className="h-5 w-5" />
              Agregar medida
            </Button>
          </div>

          {variantes.map((variante, i) => (
            <div
              key={variante.id ?? `nueva-${i}`}
              className="tarjeta space-y-3 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Medida {i + 1}
                </span>
                {variantes.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setVariantes((p) => p.filter((_, idx) => idx !== i))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm">Código (SKU)</Label>
                  <Input
                    value={variante.sku}
                    onChange={(e) => actualizarVariante(i, "sku", e.target.value)}
                    placeholder="PLA-MEL-BLA-18"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Cómo se muestra</Label>
                  <Input
                    value={variante.label}
                    onChange={(e) => actualizarVariante(i, "label", e.target.value)}
                    placeholder='1830 x 2600mm — 18mm'
                  />
                </div>
              </div>

              <p className="text-sm font-medium text-muted-foreground">
                Geometría
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["largoMm", "Largo (mm)"],
                    ["anchoMm", "Ancho (mm)"],
                    ["espesorMm", "Espesor (mm)"],
                  ] as const
                ).map(([campo, etiqueta]) => (
                  <div key={campo} className="space-y-1.5">
                    <Label className="text-sm">{etiqueta}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={variante[campo] ?? ""}
                      onChange={(e) =>
                        actualizarVariante(i, campo, e.target.value)
                      }
                    />
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm">Material</Label>
                  <Input
                    value={variante.material}
                    onChange={(e) =>
                      actualizarVariante(i, "material", e.target.value)
                    }
                    placeholder="Pino Tratado"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Color</Label>
                  <Input
                    value={variante.color}
                    onChange={(e) => actualizarVariante(i, "color", e.target.value)}
                    placeholder="Blanco"
                  />
                </div>
              </div>

              <div className="border-t" />

              <p className="text-sm font-medium text-muted-foreground">
                Precios y stock
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm">Precio de lista</Label>
                  <Input
                    value={variante.precioGeneral}
                    onChange={(e) =>
                      actualizarVariante(i, "precioGeneral", e.target.value)
                    }
                    inputMode="decimal"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">Precio profesional</Label>
                  <Input
                    value={variante.precioProfesional}
                    onChange={(e) =>
                      actualizarVariante(i, "precioProfesional", e.target.value)
                    }
                    inputMode="decimal"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                {(
                  [
                    ["stockCentral", "Stock Central"],
                    ["minCentral", "Mínimo Central"],
                    ["stockAserradero", "Stock Aserradero"],
                    ["minAserradero", "Mínimo Aserradero"],
                  ] as const
                ).map(([campo, etiqueta]) => (
                  <div key={campo} className="space-y-1.5">
                    <Label className="text-sm">{etiqueta}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={variante[campo] ?? 0}
                      onChange={(e) =>
                        actualizarVariante(i, campo, e.target.value)
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={pendiente}
          className="boton-accion"
        >
          {pendiente ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Guardando…
            </>
          ) : (
            "Guardar producto"
          )}
        </Button>
        <Link href="/admin/productos">
          <Button type="button" variant="ghost">
            Cancelar
          </Button>
        </Link>
      </div>
    </form>
  );
}
