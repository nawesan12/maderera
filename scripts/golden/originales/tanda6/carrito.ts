/**
 * Copias textuales de lo puro del carrito y el checkout (791cc3f), que se
 * borraron o pasaron a envoltorios en la tanda 6: el armado de los renglones
 * de obtenerCarrito (lib/dal/carrito.ts) sin las consultas, contarPiezas, los
 * esquemas de zod de las acciones y las cuentas de confirmarCompra.
 */
import { z } from "zod";
import { descuentoPorVolumen, precioConDescuento, type EscalaDeVolumen } from "../../../../lib/precios/volumen";
import { esPresentacion, precioDeLinea } from "../../../../lib/ventas/forma-de-venta";
import { calcularEnvio, type ZonaEnvio } from "../../../../lib/envios";
import {
  descuentoPorMedioDePago,
  medioPermitido,
  montoDelDescuentoDePago,
  type EscalaDePago,
} from "../../../../lib/precios/medio-pago";

/* ----------------------------- lib/dal/carrito.ts ----------------------------- */

export interface FilaDelCarrito {
  id: string;
  variantId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: string;
  precioUnitario: string | null;
  origen: string;
  notas: string | null;
  presentacion: string | null;
  unit: string | null;
  formaDeVenta: "entera" | "entera_o_media" | "metro_cuadrado" | null;
  precioMediaPct: number | null;
  slug: string | null;
  categoryId: string | null;
  /** Ya resuelto por la consulta (coalesce de la propia y la general × factor). */
  precioActual: string | null;
}

export interface FilaDeCorte {
  id: string;
  variantId: string | null;
  materialDescripcion: string;
  placaLargoMm: number;
  placaAnchoMm: number;
  mitad: string | null;
  cantoDescripcion: string | null;
  piezas: string;
  placas: number;
  pasadas: number;
  total: string;
}

export function armarCarrito(
  id: string,
  filas: FilaDelCarrito[],
  cortes: FilaDeCorte[],
  escalas: EscalaDeVolumen[],
  listaDiferenciada: string | null,
) {
  let ahorroPorVolumen = 0;

  const items = filas.map((f) => {
    const cantidad = Number(f.cantidad);
    const precio = f.precioUnitario !== null ? Number(f.precioUnitario) : null;
    const presentacion = esPresentacion(f.presentacion) ? f.presentacion : null;
    const deLista =
      f.precioActual !== null
        ? f.unit && f.formaDeVenta
          ? precioDeLinea(
              Number(f.precioActual),
              {
                unit: f.unit,
                formaDeVenta: f.formaDeVenta,
                precioMediaPct: f.precioMediaPct ?? 50,
              },
              presentacion,
            )
          : Number(f.precioActual)
        : null;

    const descuento =
      deLista !== null
        ? descuentoPorVolumen(escalas, {
            variantId: f.variantId,
            categoryId: f.categoryId,
            cantidad,
          })
        : 0;

    const actual = deLista !== null ? precioConDescuento(deLista, descuento) : null;

    if (deLista !== null && descuento > 0) {
      ahorroPorVolumen += (deLista - (actual ?? deLista)) * cantidad;
    }

    return {
      id: f.id,
      variantId: f.variantId,
      descripcion: f.descripcion,
      unidad: f.unidad,
      cantidad,
      presentacion,
      precioUnitario: precio,
      precioActual: actual,
      descuento,
      precioSinDescuento: descuento > 0 ? deLista : null,
      subtotal: (actual ?? precio ?? 0) * cantidad,
      origen: f.origen,
      notas: f.notas,
      slug: f.slug,
      imagen: null,
    };
  });

  const cortesDelCarrito = cortes.map((c) => ({
    id: c.id,
    variantId: c.variantId,
    material: c.materialDescripcion,
    placaLargoMm: c.placaLargoMm,
    placaAnchoMm: c.placaAnchoMm,
    mitad: (c.mitad as "largo" | "ancho" | null) ?? null,
    cantoDescripcion: c.cantoDescripcion,
    piezas: contarPiezas(c.piezas),
    placas: c.placas,
    pasadas: c.pasadas,
    total: Number(c.total),
  }));

  return {
    id,
    items,
    cortes: cortesDelCarrito,
    cantidadItems: items.length + cortesDelCarrito.length,
    subtotal:
      items.reduce((s, i) => s + i.subtotal, 0) + cortesDelCarrito.reduce((s, c) => s + c.total, 0),
    conPrecioDesactualizado: items.filter((i) => {
      const deLista = i.precioSinDescuento ?? i.precioActual;
      return i.precioUnitario !== null && deLista !== null && i.precioUnitario !== deLista;
    }).length,
    ahorroPorVolumen: Math.round(ahorroPorVolumen * 100) / 100,
    listaDiferenciada,
  };
}

export function contarPiezas(crudo: string): number {
  try {
    const piezas = JSON.parse(crudo);
    if (!Array.isArray(piezas)) return 0;

    return piezas.reduce(
      (total: number, p: { cantidad?: unknown }) => total + (Number(p?.cantidad) || 0),
      0,
    );
  } catch {
    return 0;
  }
}

/* ------------------------- app/(public)/carrito-actions.ts ------------------------- */

export const agregarSchema = z.object({
  variantId: z.string().uuid().optional(),
  descripcion: z.string().trim().min(1).max(240),
  unidad: z.string().trim().max(40).default("unidad"),
  cantidad: z.coerce.number().positive().max(100000),
  presentacion: z.enum(["media_largo", "media_ancho"]).nullable().optional(),
  origen: z.string().trim().max(40).default("catalogo"),
  notas: z.string().trim().max(300).optional(),
});

/* ------------------------- app/(public)/carrito/actions.ts ------------------------- */

export const presupuestoSchema = z.object({
  nombre: z.string().trim().min(2, "Necesitamos tu nombre.").max(120),
  email: z.string().trim().email("Revisá el correo."),
  telefono: z.string().trim().min(6, "Dejanos un teléfono.").max(40),
  sucursalId: z.string().uuid().optional(),
  necesitaPara: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? new Date(`${v}T12:00:00`) : null))
    .refine((d) => d === null || !Number.isNaN(d.getTime()), "Revisá la fecha."),
  motivos: z.array(z.string().max(40)).max(6).default([]),
  notas: z.string().trim().max(800).optional(),
});

export const MOTIVOS_DE_COTIZACION = [
  { valor: "volumen", etiqueta: "Compra por volumen" },
  { valor: "flete", etiqueta: "Flete especial o fuera de Mar del Plata" },
  { valor: "fabricacion", etiqueta: "Fabricación a pedido o medida especial" },
  { valor: "obra", etiqueta: "Obra completa" },
] as const;

/** Las notas del presupuesto: los motivos adelante y lo que escribió. */
export function notasDelPresupuesto(motivos: string[], notas: string | undefined): string | null {
  return (
    [
      motivos.length > 0
        ? `Cotización especial: ${motivos
            .map((m) => MOTIVOS_DE_COTIZACION.find((o) => o.valor === m)?.etiqueta ?? m)
            .join(" · ")}`
        : null,
      notas,
    ]
      .filter(Boolean)
      .join("\n") || null
  );
}

/* --------------------- app/(public)/carrito/confirmar/actions.ts -------------------- */

export const datosDeCompraSchema = z
  .object({
    nombre: z.string().trim().min(2, "Necesitamos tu nombre.").max(120),
    email: z.string().trim().email("Revisá el correo."),
    telefono: z.string().trim().min(6, "Dejanos un teléfono para coordinar.").max(40),
    entrega: z.enum(["retiro", "envio"]),
    sucursalId: z.string().uuid().optional(),
    zonaId: z.string().uuid().optional(),
    direccion: z.string().trim().max(240).optional(),
    medioPago: z.enum(["mercado_pago", "transferencia", "debito", "efectivo", "cuenta_corriente"]),
    notas: z.string().trim().max(600).optional(),
  })
  .refine(
    (d) => d.entrega === "retiro" || (d.zonaId && d.direccion),
    "Para el envío necesitamos la zona y la dirección.",
  )
  .refine(
    (d) => d.entrega === "envio" || Boolean(d.sucursalId),
    "Elegí en qué sucursal lo vas a retirar.",
  );

/**
 * Las cuentas de confirmarCompra sin la base: el subtotal de la mercadería y
 * los cortes, el envío, el medio permitido, el descuento y el total.
 */
export function cuentasDeLaCompra(e: {
  subtotalItems: number[];
  subtotalCortes: number[];
  zona: ZonaEnvio | null;
  medioPago: string;
  listaDiferenciada: boolean;
  escalas: EscalaDePago[];
}) {
  const subtotalCortes = e.subtotalCortes.reduce((total, c) => total + c, 0);
  const subtotal = e.subtotalItems.reduce((total, i) => total + i, 0) + subtotalCortes;
  let costoEnvio = 0;
  let nombreZona: string | null = null;
  if (e.zona) {
    costoEnvio = calcularEnvio(e.zona, subtotal);
    nombreZona = e.zona.aCotizar ? `${e.zona.nombre} (flete a cotizar)` : e.zona.nombre;
  }
  if (!medioPermitido(e.medioPago, e.listaDiferenciada)) {
    return { error: "Tu precio de profesional es de contado: pagá por transferencia, débito o efectivo." };
  }
  const escala = descuentoPorMedioDePago(e.escalas, e.medioPago, subtotal);
  const descuento = escala ? montoDelDescuentoDePago(subtotal, escala.porcentaje) : 0;
  const total = subtotal - descuento + costoEnvio;
  return {
    subtotal: subtotal.toFixed(2),
    costoEnvio: costoEnvio.toFixed(2),
    nombreZona,
    descuento: descuento.toFixed(2),
    total: total.toFixed(2),
    totalNumero: total,
  };
}

/* ------------------------ app/admin/pagos/actions.ts ------------------------ */

export const datosBancariosSchema = z.object({
  banco: z.string().trim().max(120),
  titular: z.string().trim().max(160),
  cuit: z.string().trim().max(20),
  cbu: z
    .string()
    .trim()
    .regex(/^\d{22}$|^$/, "El CBU tiene que tener 22 dígitos."),
  alias: z.string().trim().max(60),
  instrucciones: z.string().trim().max(400).optional(),
});
