// Copia textual de la parte pura de lib/entregas/index.ts,
// app/admin/pedidos/entregas-actions.ts, app/firmar/[token]/actions.ts y
// app/admin/envios/actions.ts (commit 3f7910e), que se mudaron a Go
// (backend/internal/entregas). Lo que en el TS estaba mezclado con la base
// está separado en funciones, con las mismas expresiones: la corre el golden
// (scripts/golden/entregas.ts) para que Go dé lo mismo que daba.
import { z } from "zod";
import { parsearImporte } from "../../../lib/formato";

export interface RenglonPendiente {
  orderItemId: string;
  descripcion: string;
  unidad: string;
  pedido: number;
  entregado: number;
  pendiente: number;
}

/** El map de saldoDeAcopio: los numeric llegan como texto. */
export function renglon(f: {
  orderItemId: string;
  descripcion: string;
  unidad: string;
  pedido: string;
  entregado: string;
}): RenglonPendiente {
  const pedido = Number(f.pedido);
  const entregado = Number(f.entregado);
  return {
    orderItemId: f.orderItemId,
    descripcion: f.descripcion,
    unidad: f.unidad,
    pedido,
    entregado,
    pendiente: Math.max(pedido - entregado, 0),
  };
}

/** El map + filter de saldoAlRemito. */
export function saldoAlRemito(
  filas: { orderItemId: string; descripcion: string; unidad: string; pedido: string; entregado: string }[],
): RenglonPendiente[] {
  return filas
    .map((f) => {
      const pedido = Number(f.pedido);
      const entregado = Number(f.entregado);
      return {
        orderItemId: f.orderItemId,
        descripcion: f.descripcion,
        unidad: f.unidad,
        pedido,
        entregado,
        pendiente: Math.max(0, pedido - entregado),
      };
    })
    .filter((f) => f.pendiente > 0);
}

export class ErrorDeEntrega extends Error {}

export interface LineaAEntregar {
  orderItemId: string;
  cantidad: number;
}

/** Lo que crearEntrega controlaba antes de tocar nada, y si queda completo. */
export function validarEntrega(
  pendientes: RenglonPendiente[],
  opciones: { lineas: LineaAEntregar[] },
): { lineas: LineaAEntregar[]; completo: boolean } {
  const porItem = new Map(pendientes.map((p) => [p.orderItemId, p]));

  const lineas = opciones.lineas.filter((l) => l.cantidad > 0);

  if (lineas.length === 0) {
    throw new ErrorDeEntrega("Elegí al menos un producto para entregar.");
  }

  for (const linea of lineas) {
    const renglon = porItem.get(linea.orderItemId);

    if (!renglon) {
      throw new ErrorDeEntrega("Hay un producto que no pertenece a este pedido.");
    }

    if (linea.cantidad - renglon.pendiente > 0.01) {
      throw new ErrorDeEntrega(
        `De "${renglon.descripcion}" quedan ${renglon.pendiente} y estás entregando ${linea.cantidad}.`,
      );
    }
  }

  const entregadoAhora = new Map<string, number>();
  for (const linea of lineas) {
    entregadoAhora.set(
      linea.orderItemId,
      (entregadoAhora.get(linea.orderItemId) ?? 0) + linea.cantidad,
    );
  }

  const completo = pendientes.every((p) => {
    const restante = p.pendiente - (entregadoAhora.get(p.orderItemId) ?? 0);
    return restante <= 0.01;
  });

  return { lineas, completo };
}

/** Las líneas del remito de constancia, con lo que se guarda. */
export function lineasDeConstancia(pendientes: RenglonPendiente[]) {
  return pendientes
    .filter((p) => p.pendiente > 0)
    .map((linea, i) => ({ orderItemId: linea.orderItemId, cantidad: linea.pendiente.toFixed(2), orden: i }));
}

/** Lo que se guarda de cada línea de crearEntrega. */
export function cantidadGuardada(cantidad: number): string {
  return cantidad.toFixed(2);
}

/**
 * prepararRemito, desde el safeParse hasta armar las líneas. `entrada` es
 * lo que la acción le pasaba al esquema; `entradas` son las del FormData.
 */
export function leerRemito(
  entrada: Record<string, unknown>,
  entradas: [string, string][],
): { error: string } | { data: Record<string, unknown>; lineas: LineaAEntregar[] } {
  const parsed = z
    .object({
      orderId: z.string().uuid(),
      tipo: z.enum(["retiro", "envio"]),
      receptorNombre: z.string().trim().max(120).optional(),
      receptorDocumento: z.string().trim().max(30).optional(),
      transportista: z.string().trim().max(80).optional(),
      numeroSeguimiento: z.string().trim().max(60).optional(),
      notas: z.string().trim().max(400).optional(),
    })
    .safeParse(entrada);

  if (
    parsed.success &&
    parsed.data.tipo === "retiro" &&
    !parsed.data.receptorDocumento
  ) {
    return {
      error:
        "Falta el documento de quien retira. En un retiro es obligatorio: la firma sola no identifica a nadie.",
    };
  }

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const lineas: { orderItemId: string; cantidad: number }[] = [];

  for (const [clave, valor] of entradas) {
    if (!clave.startsWith("cantidad-")) continue;

    const orderItemId = clave.slice("cantidad-".length);
    const cantidad = Number(String(valor).replace(",", "."));

    if (Number.isFinite(cantidad) && cantidad > 0) {
      lineas.push({ orderItemId, cantidad });
    }
  }

  return { data: parsed.data, lineas };
}

const TAMANO_MAXIMO = 100_000;

export const esquemaFirma = z.object({
  token: z.string().min(10).max(120),
  receptorNombre: z
    .string()
    .trim()
    .min(3, "Escribí tu nombre y apellido.")
    .max(120),
  receptorDocumento: z.string().trim().max(30).optional(),
  firma: z
    .string()
    .startsWith("data:image/png;base64,", "La firma no se guardó bien.")
    .max(TAMANO_MAXIMO, "La firma es demasiado grande."),
});

export const esquemaZona = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().trim().min(1, "Poné el nombre de la zona.").max(80),
  cobertura: z.string().trim().max(300).default(""),
  demoraEstimada: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : null)),
  aCotizar: z.boolean().default(false),
  costo: z.string().default("0"),
  envioGratisDesde: z.string().default("0"),
  orden: z.string().default("0"),
  activa: z.boolean().default(true),
});

/** guardarZona desde el safeParse hasta lo que se guarda y la bitácora. */
export function leerZona(entrada: Record<string, unknown>) {
  const parsed = esquemaZona.safeParse(entrada);

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;

  const costo = datos.aCotizar ? 0 : parsearImporte(datos.costo);
  const gratisDesde = datos.aCotizar ? 0 : parsearImporte(datos.envioGratisDesde);

  if (!Number.isFinite(costo) || costo < 0) {
    return { error: "El costo no puede ser negativo." };
  }
  if (!Number.isFinite(gratisDesde) || gratisDesde < 0) {
    return { error: "El monto de envío gratis no puede ser negativo." };
  }

  const valores = {
    nombre: datos.nombre,
    cobertura: datos.cobertura,
    demoraEstimada: datos.demoraEstimada,
    aCotizar: datos.aCotizar,
    costo: costo.toFixed(2),
    envioGratisDesde: gratisDesde.toFixed(2),
    orden: String(Number(datos.orden) || 0),
    activa: datos.activa,
  };

  return {
    id: datos.id ?? null,
    valores,
    descripcion: `Zona de envío "${datos.nombre}": ${
      datos.aCotizar ? "flete a cotizar" : `$${costo.toFixed(2)}`
    }`,
  };
}
