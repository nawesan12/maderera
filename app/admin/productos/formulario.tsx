"use client";

import { useActionState, useEffect, useState } from "react";
import { GrillaDeMedidas, etiquetaSugerida, vacia, type Atributos } from "./medidas";
import Link from "next/link";
import {
  AlertCircle,
  Boxes,
  Columns2,
  Cylinder,
  Droplet,
  Eye,
  Globe,
  Grid2x2,
  Hammer,
  ImageIcon,
  Layers,
  Loader2,
  Package,
  Receipt,
  RectangleHorizontal,
  Ruler,
  Star,
  Weight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  GaleriaImagenes,
  type ImagenProducto,
} from "@/components/admin/galeria-imagenes";
import { generarSlug } from "@/lib/validation/product";
import { importeDelCampo, importeParaElCampo } from "@/lib/formato";
import { guardarProducto, type EstadoFormulario } from "./actions";
import {
  BarraGuardar,
  Hoja,
  Pestanas,
  Seccion,
  sinReiniciar,
  Interruptor,
  Opciones,
} from "@/components/admin/formulario";

export interface VarianteForm {
  id?: string;
  /** Para la pantalla: identifica la fila nueva hasta que tenga id. */
  clave?: string;
  sku: string;
  label: string;
  largoMm: number | null;
  anchoMm: number | null;
  espesorMm: number | null;
  material: string;
  color: string;
  terminacion: string;
  calidad: string;
  codigoBarras: string;
  precioGeneral: string;
  precioProfesional: string;
  /**
   * El stock y el mínimo de cada sucursal, por id de la fila de `branches`.
   * Stock null: el campo quedó vacío y el físico no se toca.
   */
  stocks: Record<string, { stock: number | null; minimo: number }>;
}

/** Una sucursal activa de la base: una columna de stock en la grilla de medidas. */
export interface SucursalDeFicha {
  id: string;
  slug: string;
  nombre: string;
}

export interface ProductoForm {
  id?: string;
  name: string;
  slug: string;
  categoryId: string;
  subcategory: string;
  subcategoryId: string;
  description: string;
  brand: string;
  unit: string;
  /** Cómo se vende la placa: entera, entera o media, por m². */
  formaDeVenta: "entera" | "entera_o_media" | "metro_cuadrado";
  /** Precio de la media placa, en % de la entera. */
  precioMediaPct: string;
  /** "21", "10.5" o "0". */
  alicuotaIva: string;
  /** Recargo por elaboración sobre el costo, en %. Vacío: no se elabora. */
  recargoElaboracionPct: string;
  /** A qué cuenta contable imputa. Texto libre. */
  imputacion: string;
  /** Para qué sirve y cómo se cuida: van a la ficha pública. */
  usos: string;
  cuidados: string;
  featured: boolean;
  aPedido: boolean;
  active: boolean;
  imagen: string;
  variantes: VarianteForm[];
}

/**
 * Las unidades de venta, en el orden en que se ofrecen.
 *
 * Tienen que ser las mismas que `unitOfSale` en `lib/db/schema/catalog.ts`.
 * Faltaba **tabla**, que es la unidad del deck: la clienta pidió dejar de
 * venderlo por metro cuadrado, el modelo y el sembrado se cambiaron, y el
 * selector se quedó atrás. Un producto nuevo de deck no se podía cargar bien
 * desde el panel.
 */
const UNIDADES = [
  { valor: "unidad", texto: "Por unidad", nombre: "unidades", icono: Package },
  {
    valor: "metro_lineal",
    texto: "Por metro lineal",
    nombre: "metros",
    icono: Ruler,
  },
  {
    valor: "metro_cuadrado",
    texto: "Por metro cuadrado",
    nombre: "metros cuadrados",
    icono: Grid2x2,
  },
  {
    valor: "tabla",
    texto: "Por tabla",
    nombre: "tablas",
    icono: RectangleHorizontal,
  },
  { valor: "placa", texto: "Por placa", nombre: "placas", icono: Layers },
  { valor: "rollo", texto: "Por rollo", nombre: "rollos", icono: Cylinder },
  { valor: "par", texto: "Por par", nombre: "pares", icono: Columns2 },
  { valor: "juego", texto: "Por juego", nombre: "juegos", icono: Boxes },
  { valor: "kg", texto: "Por kilo", nombre: "kilos", icono: Weight },
  { valor: "litro", texto: "Por litro", nombre: "litros", icono: Droplet },
];

/** Cómo se nombra la unidad al lado de una cantidad. */
function textoDeUnidad(valor: string): string {
  return UNIDADES.find((u) => u.valor === valor)?.nombre ?? "unidades";
}

const varianteVacia = vacia;

const estadoInicial: EstadoFormulario = {};

export function FormularioProducto({
  inicial,
  imputaciones = [],
  categorias,
  rubros,
  galeria = [],
  atributos = { material: [], color: [], terminacion: [], calidad: [] },
  pestanaInicial = "datos",
  sucursales,
}: {
  inicial: ProductoForm;
  /** Las sucursales activas, en orden: salen de la base, no de una lista fija. */
  sucursales: SucursalDeFicha[];
  /** Lo ya cargado en material, color, terminación y calidad. */
  atributos?: Atributos;
  /** Recién creado, se abre en Fotos: es lo que le falta. */
  pestanaInicial?: "datos" | "fotos" | "medidas";
  categorias: { id: string; name: string }[];
  /** Las imputaciones ya cargadas, como sugerencia del campo. */
  imputaciones?: string[];
  /** Todos los rubros; el select muestra los de la categoría elegida. */
  rubros: { id: string; categoryId: string; name: string; active: boolean }[];
  galeria?: ImagenProducto[];
}) {
  const [estado, accion, pendiente] = useActionState(
    guardarProducto,
    estadoInicial,
  );
  const [pestana, setPestana] =
    useState<(typeof PESTANAS)[number]["id"]>(pestanaInicial);

  /*
   * El error del servidor, en su campo: abre la pestaña donde está y lo
   * enfoca. Antes llegaba solo el mensaje arriba, sin decir en qué medida ni
   * en qué pestaña estaba el problema.
   */
  useEffect(() => {
    const campo = estado.campo;
    if (!campo) return;
    const m = /^variantes\.(\d+)\.(\w+)$/.exec(campo);
    // El stock de una sucursal llega como «variantes.0.stocks.1.stock»: la
    // celda se llama por el slug de la sucursal.
    const st = /^variantes\.(\d+)\.stocks\.(\d+)\.(stock|minimo|sucursal)$/.exec(campo);
    const suc = st ? sucursales[Number(st[2])] : undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- responde a la respuesta del servidor, no a un render
    setPestana(m || st ? "medidas" : "datos");
    const id = st
      ? `v-${st[1]}-${st[3] === "minimo" ? "min" : "stock"}-${suc?.slug ?? ""}`
      : m
        ? `v-${m[1]}-${m[2]}`
        : campo;
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: "center" });
      el?.focus();
    });
  }, [estado, sucursales]);

  const [nombre, setNombre] = useState(inicial.name);
  const [slug, setSlug] = useState(inicial.slug);
  // Al editar, el slug queda fijo: la URL pública ya está indexada y
  // compartida. Solo el alta lo deriva del nombre.
  const slugFijo = Boolean(inicial.id);
  const [unidad, setUnidad] = useState(inicial.unit);
  const [forma, setForma] = useState(inicial.formaDeVenta);
  const [pctMedia, setPctMedia] = useState(inicial.precioMediaPct);
  const [categoria, setCategoria] = useState(inicial.categoryId);
  const [rubro, setRubro] = useState(inicial.subcategoryId);
  const [descripcion, setDescripcion] = useState(inicial.description);

  const rubrosDeLaCategoria = rubros.filter((r) => r.categoryId === categoria);

  /*
   * El rubro que realmente vale, calculado en el render.
   *
   * Cambiar de categoría deja el rubro anterior sin sentido, porque pertenece a
   * otra. Se resuelve derivándolo en vez de sincronizarlo con un efecto: un
   * `setState` dentro de un efecto encadena un render de más y, sobre todo,
   * deja un instante en el que el campo oculto todavía manda el rubro viejo.
   */
  const rubroValido = rubrosDeLaCategoria.some((r) => r.id === rubro)
    ? rubro
    : "";
  // Los precios llegan de la base como «55000.00» y se muestran como se
  // escriben («55.000»), que es como Go los vuelve a leer (M4-001).
  const [variantes, setVariantes] = useState<VarianteForm[]>(
    inicial.variantes.length > 0
      ? inicial.variantes.map((v) => ({
          ...v,
          precioGeneral: importeParaElCampo(v.precioGeneral) || "0",
          precioProfesional: importeParaElCampo(v.precioProfesional),
        }))
      : [varianteVacia()],
  );

  // En el alta el slug sigue al nombre; al editar no se toca.
  function cambiarNombre(valor: string) {
    setNombre(valor);
    if (!slugFijo) setSlug(generarSlug(valor));
  }

  return (
    <form {...sinReiniciar(accion)} className="space-y-6">
      {inicial.id && <input type="hidden" name="id" value={inicial.id} />}
      <input
        type="hidden"
        name="variantes"
        value={JSON.stringify(
          // eslint-disable-next-line @typescript-eslint/no-unused-vars -- la clave es solo de la pantalla
          variantes.map(({ clave, ...v }) => {
            // Lo que se vio al abrir la ficha: Go corrige el stock por
            // diferencia contra esto, así una venta hecha mientras tanto no
            // se pisa. Un stock vacío viaja vacío y no toca el físico.
            const visto = v.id
              ? inicial.variantes.find((x) => x.id === v.id)
              : undefined;
            return {
              ...v,
              // Sin texto propio, el que se arma con las medidas y el color.
              label: v.label.trim() || etiquetaSugerida(v),
              largoMm: v.largoMm === null ? "" : String(v.largoMm),
              anchoMm: v.anchoMm === null ? "" : String(v.anchoMm),
              espesorMm: v.espesorMm === null ? "" : String(v.espesorMm),
              // Una entrada por sucursal activa, en el orden de la pantalla:
              // Go señala el error por esa posición.
              stocks: sucursales.map((s) => {
                const st = v.stocks[s.id] ?? { stock: 0, minimo: 0 };
                const vio = visto?.stocks[s.id];
                return {
                  sucursal: s.id,
                  stock: st.stock === null ? "" : String(st.stock),
                  minimo: String(st.minimo ?? 0),
                  ...(visto ? { visto: String(vio?.stock ?? 0) } : {}),
                };
              }),
            };
          }),
        )}
      />
      <input type="hidden" name="unit" value={unidad} />
      <input
        type="hidden"
        name="formaDeVenta"
        value={unidad === "placa" ? forma : "entera"}
      />
      <input type="hidden" name="precioMediaPct" value={pctMedia} />
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

      <Pestanas pestanas={PESTANAS} activa={pestana} alCambiar={setPestana} />

      {/* Datos generales */}
      <div
        hidden={pestana !== "datos"}
        className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]"
      >
        <Hoja>
          <Seccion titulo="Producto" icono={Package}>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                name="name"
                value={nombre}
                onChange={(e) => cambiarNombre(e.target.value)}
                required
              />
            </div>
            {/* La "dirección web" salió del formulario a pedido de la
                clienta: el slug se genera solo desde el nombre en el alta y
                no se regenera al editar —la URL publicada ya está indexada—.
                Viaja oculto; si choca con otro producto, el alta lo
                desambigua sola. */}
            <input type="hidden" name="slug" value={slug} />
            <div className="space-y-2">
              <Label htmlFor="categoria">Categoría</Label>
              <Select
                value={categoria}
                onValueChange={(v) => v && setCategoria(v)}
                items={Object.fromEntries(
                  categorias.map((c) => [c.id, c.name]),
                )}
              >
                <SelectTrigger id="categoria" className="w-full">
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
              <Label htmlFor="rubro">Rubro</Label>
              {/* El valor viaja en un campo oculto: `Select` no es un
                  `<select>` nativo y no se envía solo con el formulario. */}
              <input type="hidden" name="subcategoryId" value={rubroValido} />
              <Select
                value={rubroValido}
                onValueChange={(v) => setRubro(v ?? "")}
                items={Object.fromEntries([
                  ["", "Sin rubro"],
                  ...rubrosDeLaCategoria.map((r) => [r.id, r.name]),
                ])}
              >
                <SelectTrigger id="rubro" className="w-full">
                  <SelectValue placeholder="Sin rubro" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Sin rubro</SelectItem>
                  {rubrosDeLaCategoria.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                      {r.active ? "" : " (dado de baja)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {rubrosDeLaCategoria.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Esta categoría todavía no tiene rubros cargados.
                </p>
              )}
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
            <div className="space-y-2 md:col-span-2">
              <Label>Unidad de venta</Label>
              <Opciones
                nombre="unidad-de-venta"
                opciones={UNIDADES}
                valor={unidad}
                alCambiar={setUnidad}
              />
            </div>
            {unidad === "placa" && (
              <div className="md:col-span-2">
                <FormaDeVentaDePlaca
                  forma={forma}
                  onForma={setForma}
                  pct={pctMedia}
                  onPct={setPctMedia}
                  precioEjemplo={importeDelCampo(variantes[0]?.precioGeneral)}
                  sinMedidas={
                    variantes.filter((v) => !v.largoMm || !v.anchoMm).length
                  }
                />
              </div>
            )}
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={inicial.description}
                onChange={(e) => setDescripcion(e.target.value)}
                rows={3}
              />
            </div>
          </Seccion>
          <Seccion titulo="En el sitio" icono={Globe}>
            <div className="space-y-2">
              <Label htmlFor="usos">Usos</Label>
              <Textarea
                id="usos"
                name="usos"
                defaultValue={inicial.usos}
                rows={4}
                placeholder="Muebles de cocina, placares, revestimientos…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cuidados">Cuidados</Label>
              <Textarea
                id="cuidados"
                name="cuidados"
                defaultValue={inicial.cuidados}
                rows={4}
                placeholder="Limpiar con paño húmedo, sin solventes…"
              />
            </div>
            <div className="grid gap-2.5 md:col-span-2 lg:grid-cols-3">
              <Interruptor
                nombre="featured"
                etiqueta="Destacado"
                icono={Star}
                defecto={inicial.featured}
              />
              {/* «Activo» y no «Visible en el sitio»: apagado, el producto
                  sale también del buscador del mostrador. Cómo arranca en el
                  alta lo decide la regla «alta_de_producto» (M3S2-036). */}
              <Interruptor
                nombre="active"
                etiqueta="Activo"
                icono={Eye}
                defecto={inicial.active}
              />
              <Interruptor
                nombre="aPedido"
                etiqueta="Se fabrica a pedido"
                icono={Hammer}
                defecto={inicial.aPedido}
              />
            </div>
            <input type="hidden" name="imagen" value={inicial.imagen} />
          </Seccion>
          <Seccion titulo="Impuestos" icono={Receipt}>
            {/* La clienta pidió "tipos de IVA" en productos. El campo existía
                en la base desde el primer schema y el formulario nunca lo
                ofreció, así que todo el catálogo quedaba al 21. */}
            <div className="space-y-2">
              <Label>IVA</Label>
              <Opciones
                nombre="alicuotaIva"
                defecto={inicial.alicuotaIva || "21"}
                columnas={3}
                opciones={[
                  { valor: "21", texto: "21 %" },
                  { valor: "10.5", texto: "10,5 %" },
                  { valor: "0", texto: "Exento" },
                ]}
              />
            </div>
            {/*
              La imputación contable, que pidió la clienta junto con subrubros,
              IVA y SKU. Las otras tres existían; esta no.

              Va como texto con sugerencias y no como lista cerrada porque el
              plan de cuentas lo maneja el contador y todavía no lo dio. El
              `datalist` es lo que evita que la misma cuenta se escriba de tres
              maneras: propone lo ya usado sin impedir cargar una nueva.
            */}
            <div className="space-y-2">
              <Label htmlFor="imputacion">Imputación contable</Label>
              <Input
                id="imputacion"
                name="imputacion"
                list="imputaciones-cargadas"
                defaultValue={inicial.imputacion}
                placeholder="Mercaderías"
              />
              <datalist id="imputaciones-cargadas">
                {imputaciones.map((i) => (
                  <option key={i} value={i} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="recargoElaboracionPct">
                Recargo por elaboración (%)
              </Label>
              <Input
                id="recargoElaboracionPct"
                name="recargoElaboracionPct"
                defaultValue={inicial.recargoElaboracionPct}
                inputMode="decimal"
                placeholder="0"
              />
            </div>
          </Seccion>
        </Hoja>
        <VistaPrevia
          nombre={nombre}
          categoria={categorias.find((c) => c.id === categoria)?.name ?? ""}
          descripcion={descripcion}
          unidad={UNIDADES.find((u) => u.valor === unidad)?.texto ?? ""}
          foto={galeria[0]?.url ?? inicial.imagen}
        />
      </div>

      {/* Fotos */}
      {inicial.id ? (
        <Card hidden={pestana !== "fotos"} className="tarjeta border-0">
          <CardContent className="space-y-4 p-6">
            <div>
              <h2 className="text-base font-semibold">Fotos</h2>
            </div>
            <GaleriaImagenes productId={inicial.id} imagenes={galeria} />
          </CardContent>
        </Card>
      ) : (
        <Card hidden={pestana !== "fotos"} className="tarjeta-hundida border-0">
          <CardContent className="p-6 text-center">
            <p className="text-base text-muted-foreground">
              Las fotos se cargan apenas se guarda el producto.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Medidas */}
      <Card hidden={pestana !== "medidas"} className="tarjeta border-0">
        <CardContent className="p-5">
          <GrillaDeMedidas
            variantes={variantes}
            setVariantes={setVariantes}
            unidad={unidad}
            nombreUnidad={textoDeUnidad(unidad)}
            atributos={atributos}
            sucursales={sucursales}
            campoConError={estado.campo}
          />
        </CardContent>
      </Card>

      <BarraGuardar>
        <Button type="submit" disabled={pendiente} className="boton-accion">
          {pendiente ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Guardando…
            </>
          ) : (
            "Guardar producto"
          )}
        </Button>
        {/* En la carga del catálogo se dan de alta muchos seguidos. */}
        {!inicial.id && (
          <Button type="submit" name="despues" value="otro" disabled={pendiente} variant="outline">
            Guardar y cargar otro
          </Button>
        )}
        <Button render={<Link href="/admin/productos" />} variant="ghost">
          Cancelar
        </Button>
      </BarraGuardar>
    </form>
  );
}

/** El producto, partido en tres: lo que es, cómo se ve y cómo se vende. */
const PESTANAS = [
  { id: "datos", nombre: "Datos" },
  { id: "fotos", nombre: "Fotos" },
  { id: "medidas", nombre: "Medidas y precios" },
] as const;

const FORMAS_DE_VENTA = [
  {
    valor: "entera",
    titulo: "Solo entera",
    detalle:
      "Se vende la placa completa. Es lo que corresponde a un fenólico o a una placa de color con dibujo.",
  },
  {
    valor: "entera_o_media",
    titulo: "Entera o media",
    detalle:
      "Además media placa, partida al largo o al ancho. La otra mitad queda en el stock.",
  },
  {
    valor: "metro_cuadrado",
    titulo: "Por metro cuadrado",
    detalle:
      "El precio de lista es el del m² y se pide en m². El stock se sigue contando en placas.",
  },
] as const;

/**
 * Cómo se vende la placa (pedido de la clienta del 30/9/2026).
 *
 * Tres tarjetas y no un desplegable: las opciones son pocas, se eligen una vez
 * por producto, y la explicación de cada una es lo que evita elegir mal.
 */
function FormaDeVentaDePlaca({
  forma,
  onForma,
  pct,
  onPct,
  precioEjemplo,
  sinMedidas,
}: {
  forma: ProductoForm["formaDeVenta"];
  onForma: (f: ProductoForm["formaDeVenta"]) => void;
  pct: string;
  onPct: (v: string) => void;
  precioEjemplo: number;
  sinMedidas: number;
}) {
  const pctNumero = Number(pct.replace(",", "."));
  const media =
    Number.isFinite(pctNumero) && precioEjemplo > 0
      ? Math.round((precioEjemplo * pctNumero) / 100)
      : null;

  return (
    <fieldset className="tarjeta-hundida space-y-3 rounded-xl p-4">
      <legend className="sr-only">Cómo se vende la placa</legend>
      <p className="text-base font-medium" aria-hidden>
        Cómo se vende la placa
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {FORMAS_DE_VENTA.map((f) => (
          <label
            key={f.valor}
            className={`flex cursor-pointer flex-col gap-1 rounded-lg border bg-card p-3 transition-colors ${
              forma === f.valor
                ? "border-brand-orange ring-1 ring-brand-orange"
                : "hover:border-foreground/30"
            }`}
          >
            <span className="flex items-center gap-2 text-base font-medium">
              <input
                type="radio"
                name="forma-de-venta-placa"
                value={f.valor}
                checked={forma === f.valor}
                onChange={() => onForma(f.valor)}
                className="accent-brand-orange"
              />
              {f.titulo}
            </span>
            <span className="text-sm text-muted-foreground">{f.detalle}</span>
          </label>
        ))}
      </div>

      {forma === "entera_o_media" && (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="space-y-1.5">
            <Label htmlFor="precioMediaPct">Precio de la media placa</Label>
            <div className="flex items-center gap-2">
              <Input
                id="precioMediaPct"
                value={pct}
                onChange={(e) => onPct(e.target.value)}
                inputMode="decimal"
                className="tabular w-24"
              />
              <span className="text-base text-muted-foreground">
                % de la entera
              </span>
            </div>
          </div>
          {media !== null && (
            <p className="text-base">
              Entera{" "}
              <span className="tabular">{formatearPesos(precioEjemplo)}</span> →
              media <strong className="tabular">{formatearPesos(media)}</strong>
            </p>
          )}
        </div>
      )}

      {forma === "metro_cuadrado" && sinMedidas > 0 && (
        <p className="estado-espera text-sm font-medium">
          {sinMedidas === 1
            ? "Una medida no tiene largo y ancho cargados."
            : `${sinMedidas} medidas no tienen largo y ancho cargados.`}{" "}
          Sin ellos no se puede pasar de m² a placas: cargalos abajo.
        </p>
      )}
    </fieldset>
  );
}

const PESOS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function formatearPesos(n: number): string {
  return PESOS.format(n);
}

/**
 * Cómo va a quedar la tarjeta en el catálogo, mientras se carga: el nombre, la
 * categoría y la descripción se ven ahí y no en una lista de campos.
 */
function VistaPrevia({
  nombre,
  categoria,
  descripcion,
  unidad,
  foto,
}: {
  nombre: string;
  categoria: string;
  descripcion: string;
  unidad: string;
  foto: string;
}) {
  return (
    <aside className="sticky top-24 hidden xl:block">
      <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-texto-3">
        En el catálogo
      </p>
      <div className="tarjeta overflow-hidden">
        <div className="flex aspect-[4/3] items-center justify-center bg-hundida">
          {foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={foto} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-10 w-10 text-texto-3" />
          )}
        </div>
        <div className="space-y-1.5 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-acento-texto">
            {categoria || "Categoría"}
          </p>
          <p className="text-lg font-bold leading-tight tracking-tight">
            {nombre || (
              <span className="text-texto-3">Nombre del producto</span>
            )}
          </p>
          {descripcion && (
            <p className="line-clamp-3 text-sm text-texto-2">{descripcion}</p>
          )}
          <p className="pt-1 text-sm font-medium text-texto-3">{unidad}</p>
        </div>
      </div>
    </aside>
  );
}
