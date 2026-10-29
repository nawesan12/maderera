/**
 * Los esquemas de zod de las acciones de la tanda 10, copiados tal cual
 * (go-cuentas 56ef2a1): app/admin/campanas/actions.ts, app/admin/avisos/
 * acciones.ts, app/admin/profesionales/actions.ts,
 * app/(public)/profesionales/actions.ts, app/admin/eventos/actions.ts y
 * app/(public)/eventos/actions.ts. Las acciones no los exportaban; ahora
 * valida Go y estas copias quedan para el golden.
 *
 * Cada uno recibe lo mismo que le pasaba la acción: `formData.get(x)` (null
 * si falta) o `… || undefined` donde la acción lo hacía.
 */
import { z } from "zod";
import { documentoValido } from "@/lib/cuit";

const enlace = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\//.test(v) || v.startsWith("/"), {
    message: "Tiene que empezar con https:// o con / (una página del sitio).",
  });

export const esquemaCampana = z.object({
  asunto: z.string().trim().min(3, "Falta el asunto.").max(150, "El asunto es demasiado largo: en el celular se corta a los 40 caracteres."),
  adelanto: z.string().trim().max(150).optional(),
  cuerpo: z.string().trim().min(10, "Falta el texto de la campaña.").max(10_000),
  imagenUrl: enlace.optional(),
  botonTexto: z.string().trim().max(40).optional(),
  botonUrl: enlace.optional(),
});

export const esquemaAvisoActivo = z.object({ id: z.string().uuid(), activo: z.enum(["si", "no"]) });

export const esquemaAvisoTexto = z.object({
  id: z.string().uuid(),
  asunto: z.string().trim().min(3, "El asunto no puede quedar vacío.").max(120),
  encabezado: z.string().trim().max(160).optional(),
});

export const esquemaSolicitud = z
  .object({
    nombre: z.string().trim().min(3, "Escribí tu nombre y apellido.").max(120),
    razonSocial: z.string().trim().max(160).optional(),
    documentoTipo: z.enum(["dni", "cuit"]),
    documentoNumero: z.string().trim().min(1, "Dejanos tu DNI o CUIT."),
    email: z.string().trim().email("Revisá el correo."),
    telefono: z.string().trim().min(6, "Dejanos un teléfono.").max(40),
    rubro: z.enum(["arquitecto", "constructora", "carpintero", "disenador", "instalador", "woodframer", "otro"]),
    volumenEstimado: z.string().trim().max(120).optional(),
    redSocial: z.string().trim().max(160).optional(),
    mensaje: z.string().trim().max(600).optional(),
  })
  .refine((d) => documentoValido(d.documentoTipo, d.documentoNumero), {
    path: ["documentoNumero"],
    message: "Revisá el número: no coincide con el tipo de documento.",
  });

export const esquemaAprobar = z.object({
  id: z.string().uuid(),
  priceListId: z.string().uuid().optional(),
  limiteCredito: z.string().optional(),
});

export const esquemaRechazar = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(5, "Escribí el motivo: se lo mandamos al solicitante.").max(300),
});

export const esquemaEvento = z.object({
  titulo: z.string().trim().min(4, "Poné un título.").max(160),
  resumen: z.string().trim().max(300).optional(),
  descripcion: z.string().trim().max(4000).optional(),
  lugar: z.string().trim().max(200).optional(),
  inicia: z.string().min(1, "Falta la fecha."),
  termina: z.string().optional(),
  cupo: z.coerce.number().int().min(0).max(10000),
  precio: z.string().optional(),
  soloProfesionales: z.boolean(),
});

export const esquemaEstadoEvento = z.object({
  id: z.string().uuid(),
  estado: z.enum(["borrador", "publicado", "cerrado", "cancelado"]),
});

export const esquemaAsistencia = z.object({
  id: z.string().uuid(),
  estado: z.enum(["asistio", "ausente", "confirmada", "cancelada"]),
});

export const esquemaAnotarse = z.object({
  eventId: z.string().uuid(),
  slug: z.string().min(1),
  nombre: z.string().trim().min(3, "Escribí tu nombre y apellido.").max(120),
  email: z.string().trim().email("Revisá el correo."),
  telefono: z.string().trim().max(40).optional(),
});

/** Convierte un título en slug (app/admin/eventos/actions.ts). */
export function aSlug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
