import { z } from "zod";
import { admiteDecimales } from "@/lib/unidades";

/**
 * Validación de productos y variantes.
 *
 * Estos schemas corren en el servidor, dentro de las Server Actions. Una Server
 * Action se puede invocar con un POST directo, sin pasar por el formulario, así
 * que validar en el cliente no alcanza: lo que llega siempre se revisa acá.
 */

/**
 * Las unidades de `unitOfSale`. Copiadas y no importadas porque este archivo
 * corre también en el navegador y el esquema de la base no tiene que viajar.
 * **Le faltaba `tabla`** y un deck no se podía guardar desde el panel:
 * `tests/validacion-producto.test.ts` compara las dos listas.
 */
export const UNIDADES_DE_PRODUCTO = [
  "unidad",
  "metro_lineal",
  "metro_cuadrado",
  "tabla",
  "placa",
  "rollo",
  "par",
  "juego",
  "kg",
  "litro",
] as const;

/** Números que vienen de un input: llegan como string y pueden venir vacíos. */
const enteroOpcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), {
    message: "Tiene que ser un número positivo.",
  });

/**
 * Cantidad de stock: admite «2,5» además de «2.5», a tres decimales. Que la
 * unidad admita o no decimales se revisa más abajo, con el producto entero.
 */
const cantidadOpcional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v.replace(",", "."))))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0), {
    message: "Tiene que ser un número positivo.",
  })
  .transform((v) => (v === null ? null : Math.round(v * 1000) / 1000));

const precio = z
  .string()
  .trim()
  .transform((v) => (v === "" ? "0" : v.replace(",", ".")))
  .refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, {
    message: "Revisá el precio.",
  });

export const varianteSchema = z.object({
  id: z.string().uuid().optional(),
  sku: z
    .string()
    .trim()
    .min(2, "El código tiene que tener al menos 2 letras o números.")
    .max(60),
  label: z.string().trim().min(1, "Poné cómo se muestra la medida.").max(120),
  largoMm: enteroOpcional,
  anchoMm: enteroOpcional,
  espesorMm: enteroOpcional,
  material: z.string().trim().max(80).optional(),
  color: z.string().trim().max(80).optional(),
  terminacion: z.string().trim().max(80).optional(),
  calidad: z.string().trim().max(80).optional(),
  precioGeneral: precio,
  precioProfesional: precio,
  stockCentral: cantidadOpcional,
  stockAserradero: cantidadOpcional,
  minCentral: cantidadOpcional,
  minAserradero: cantidadOpcional,
});

export const productoSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "El nombre es obligatorio.").max(160),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Solo se pueden usar minúsculas, números y guiones (sin espacios ni acentos).",
    ),
  categoryId: z.string().uuid("Elegí una categoría."),
  subcategory: z.string().trim().max(80).optional(),
  /**
   * El rubro elegido. Vacío es "sin rubro", no un error: hay productos que no
   * entran en ninguno y forzarlos a uno inventado ensucia la navegación.
   */
  subcategoryId: z.string().uuid().optional().or(z.literal("")),
  description: z.string().trim().max(2000).default(""),
  brand: z.string().trim().max(80).optional(),
  unit: z.enum(UNIDADES_DE_PRODUCTO),
  /** Cómo se vende la placa. Ver `formaDeVenta` en el esquema. */
  formaDeVenta: z.enum(["entera", "entera_o_media", "metro_cuadrado"]).default("entera"),
  /** Precio de la media placa en % de la entera. */
  precioMediaPct: z.coerce
    .number()
    .min(1, "El precio de la media tiene que ser mayor a cero.")
    .max(100, "La media no puede costar más que la entera.")
    .default(50),
  /**
   * La alícuota de IVA del producto. Las tres que existen en el rubro: la
   * general, la reducida y el exento. Decide cómo se desagrega el precio final
   * en la factura y en el neto que la ley obliga a publicar.
   */
  alicuotaIva: z.enum(["21", "10.5", "0"]).default("21"),
  /** Recargo por elaboración sobre el costo, en %. Vacío: no se elabora. */
  recargoElaboracionPct: z.coerce.number().min(0).max(500).optional(),
  /**
   * A qué cuenta contable imputa. Texto libre hasta que llegue el plan de
   * cuentas del contador; ver el comentario del schema.
   */
  imputacion: z.string().trim().max(80).optional(),
  featured: z.boolean().default(false),
  aPedido: z.boolean().default(false),
  active: z.boolean().default(true),
  imagen: z.string().trim().url("Pegá la dirección completa de la foto; tiene que empezar con https://").or(z.literal("")),
  variantes: z
    .array(varianteSchema)
    .min(1, "Cargá al menos una medida o presentación."),
}).superRefine((p, ctx) => {
  // La placa por m² convierte a placas con la superficie de cada variante:
  // sin largo y ancho no hay cuenta posible y el stock quedaría mal.
  if (p.unit === "placa" && p.formaDeVenta === "metro_cuadrado") {
    p.variantes.forEach((v, i) => {
      if (!v.largoMm || !v.anchoMm) {
        ctx.addIssue({
          code: "custom",
          path: ["variantes", i, "largoMm"],
          message: `Para vender por m², «${v.label || v.sku}» necesita largo y ancho de la placa.`,
        });
      }
    });
  }

  // Lo que se cuenta no tiene fracciones: 2,5 bisagras es un error de tipeo.
  if (!admiteDecimales(p.unit)) {
    p.variantes.forEach((v, i) => {
      for (const campo of ["stockCentral", "stockAserradero", "minCentral", "minAserradero"] as const) {
        const valor = v[campo];
        if (valor !== null && !Number.isInteger(valor)) {
          ctx.addIssue({
            code: "custom",
            path: ["variantes", i, campo],
            message: "Este producto se cuenta en unidades enteras: el stock va sin decimales.",
          });
        }
      }
    });
  }
});

export type ProductoInput = z.input<typeof productoSchema>;
export type ProductoParseado = z.output<typeof productoSchema>;

/** Convierte un nombre en slug: "Fenólico 18mm" -> "fenolico-18mm". */
export function generarSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
