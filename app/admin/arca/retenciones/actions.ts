"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { saldoDelCliente } from "@/lib/dal/historial-cliente";
import { requireStaffRole } from "@/lib/dal/session";
import { nombreComprobante, numeroFormateado } from "@/lib/fiscal/comprobantes";

export interface EstadoSufrida {
  error?: string;
  /** El campo del error, para mostrarlo al lado de ese campo. */
  campo?: string;
  ok?: string;
}

export interface FacturaParaRetener {
  etiqueta: string;
  saldo: number;
}

/**
 * Lo que debe el cliente y sus facturas con saldo, la más vieja primero: la
 * carga de un certificado propone la factura sobre la que retuvieron, y si
 * el cliente no debe nada lo dice antes de cargar (M2S1-113).
 */
export async function deudaParaRetener(
  customerId: string,
): Promise<{ saldo: number; facturas: FacturaParaRetener[] }> {
  await requireStaffRole("admin");
  const [saldo, r] = await Promise.all([
    saldoDelCliente(customerId),
    (await api()).GET("/api/v1/admin/facturacion/comprobantes/pagina", {
      params: { query: { cliente: customerId, conSaldo: true, limite: 20 } },
    }),
  ]);
  const facturas = (r.data?.filas ?? [])
    .filter((f) => f.tipo.startsWith("factura"))
    .map((f) => ({
      etiqueta: `${nombreComprobante(f.tipo)} ${numeroFormateado(f.puntoVenta, f.numero)}`,
      saldo: f.total - f.cobrado,
    }))
    .reverse();
  return { saldo, facturas };
}

/**
 * Carga un certificado que nos entregó un cliente.
 *
 * **Baja lo que el cliente debe**, igual que un pago: es plata que ya entregó,
 * solo que al fisco. Lo hace la API de Go (backend/internal/cobros), con un
 * recibo por la misma puerta que todo cobro. Solo el admin.
 */
export async function cargarSufrida(datos: {
  customerId: string;
  numero: string;
  impuesto: string;
  codigoRegimen?: string;
  base: string | number;
  alicuota?: string | number;
  importe: string | number;
  fecha: string;
  referencia?: string;
}): Promise<EstadoSufrida> {
  const texto = (v: string | number | undefined) => (v === undefined ? undefined : String(v));
  const r = await (await api()).POST("/api/v1/admin/retenciones-sufridas", {
    body: {
      customerId: datos.customerId,
      numero: datos.numero,
      impuesto: datos.impuesto,
      codigoRegimen: datos.codigoRegimen,
      base: texto(datos.base),
      alicuota: texto(datos.alicuota),
      importe: texto(datos.importe),
      fecha: datos.fecha,
      referencia: datos.referencia,
    },
  });
  if (!r.data) {
    const problema = r.error as Problema | undefined;
    return {
      error: mensajeDe(problema, "Revisá los datos."),
      campo: problema?.errores ? Object.keys(problema.errores)[0] : undefined,
    };
  }
  revalidatePath("/admin/arca/retenciones");
  revalidatePath(`/admin/clientes/${datos.customerId}`);
  return { ok: r.data.ok };
}

export interface EstadoRegimen {
  error?: string;
  ok?: string;
}

/**
 * Cambia la alícuota de un régimen de retención, sus dos mínimos (no imponible
 * y de retención) y si está activo. Lo guarda
 * la API de Go (backend/internal/compras): un régimen en cero no retiene nada
 * y sigue cargado, con su código, para el día que vuelva a corresponder.
 */
export async function guardarRegimen(
  _previo: EstadoRegimen,
  formData: FormData,
): Promise<EstadoRegimen> {
  const campos: Record<string, string> = {};
  for (const [clave, valor] of formData) {
    if (!clave.startsWith("$") && typeof valor === "string") campos[clave] = valor;
  }
  const r = await (await api()).POST("/api/v1/admin/compras/regimenes", { body: campos });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };

  revalidatePath("/admin/arca/retenciones");
  revalidatePath("/admin/compras/pagos");
  return { ok: r.data.ok };
}
