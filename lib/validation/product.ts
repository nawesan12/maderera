import { z } from "zod";

/**
 * Validación de productos y variantes.
 *
 * Estos schemas corren en el servidor, dentro de las Server Actions. Una Server
 * Action se puede invocar con un POST directo, sin pasar por el formulario, así
 * que validar en el cliente no alcanza: lo que llega siempre se revisa acá.
 */

const unidades = [
  "unidad",
  "metro_lineal",
  "metro_cuadrado",
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
    .min(2, "El código tiene que tener al menos 2 caracteres.")
    .max(60),
  label: z.string().trim().min(1, "Poné cómo se muestra la medida.").max(120),
  largoMm: enteroOpcional,
  anchoMm: enteroOpcional,
  espesorMm: enteroOpcional,
  material: z.string().trim().max(80).optional(),
  color: z.string().trim().max(80).optional(),
  precioGeneral: precio,
  precioProfesional: precio,
  stockCentral: enteroOpcional,
  stockAserradero: enteroOpcional,
  minCentral: enteroOpcional,
  minAserradero: enteroOpcional,
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
      "Solo minúsculas, números y guiones.",
    ),
  categoryId: z.string().uuid("Elegí una categoría."),
  subcategory: z.string().trim().max(80).optional(),
  description: z.string().trim().max(2000).default(""),
  brand: z.string().trim().max(80).optional(),
  unit: z.enum(unidades),
  featured: z.boolean().default(false),
  active: z.boolean().default(true),
  imagen: z.string().trim().url("La imagen tiene que ser una URL.").or(z.literal("")),
  variantes: z
    .array(varianteSchema)
    .min(1, "Cargá al menos una medida o presentación."),
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
