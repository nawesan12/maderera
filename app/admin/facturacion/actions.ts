"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  configuracionFiscal,
  invoicePayments,
  invoices,
  puntosVenta,
} from "@/lib/db/schema";
import { requireStaff, requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import {
  anularConNotaDeCredito,
  autorizarComprobante,
  emitirComprobante,
  obtenerConfiguracionFiscal,
} from "@/lib/fiscal/emitir";
import { pedidoParaFacturar } from "@/lib/dal/admin/facturacion";
import { parsearImporte } from "@/lib/formato";
import { enviarComprobantePorCorreo } from "@/lib/notificaciones/fiscal";

export interface EstadoFactura {
  error?: string;
  ok?: string;
}

function refrescar(id?: string) {
  revalidatePath("/admin/facturacion");
  revalidatePath("/admin/arca");
  if (id) revalidatePath(`/admin/facturacion/${id}`);
}

/* -------------------------------------------------------------------------- */
/* Emitir                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Factura un pedido.
 *
 * Los ítems y la condición frente al IVA salen del pedido y del cliente, no de
 * lo que se tipee: facturar es copiar lo que ya se vendió, y volver a cargarlo
 * a mano es la vía por la que la factura termina diciendo algo distinto del
 * remito.
 *
 * El envío entra como una línea más. Es parte de lo que se cobró y tiene que
 * estar en el comprobante.
 */
export async function facturarPedido(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const usuario = await requireStaff();

  const orderId = z.string().uuid().safeParse(formData.get("orderId"));
  if (!orderId.success) return { error: "No encontramos ese pedido." };

  const datos = await pedidoParaFacturar(orderId.data);
  if (!datos) return { error: "No encontramos ese pedido." };

  if (datos.yaFacturado) {
    return {
      error: `Ese pedido ya tiene el comprobante ${datos.yaFacturado.numero} emitido.`,
    };
  }

  const lineas = datos.items.map((item) => ({
    descripcion: item.descripcion,
    unidad: item.unidad,
    cantidad: Number(item.cantidad),
    precioFinalUnitario: Number(item.precioUnitario),
    alicuota: item.alicuota ? Number(item.alicuota) : 21,
  }));

  const costoEnvio = Number(datos.pedido.costoEnvio);

  if (costoEnvio > 0) {
    lineas.push({
      descripcion: `Envío${datos.pedido.zonaEnvio ? ` — ${datos.pedido.zonaEnvio}` : ""}`,
      unidad: "unidad",
      cantidad: 1,
      precioFinalUnitario: costoEnvio,
      alicuota: 21,
    });
  }

  const resultado = await emitirComprobante({
    customerId: datos.pedido.customerId,
    orderId: datos.pedido.id,
    receptorNombre:
      datos.pedido.clienteRazonSocial ??
      datos.pedido.clienteNombre ??
      datos.pedido.contactoNombre,
    receptorCuit: datos.pedido.clienteCuit,
    receptorCondicionIva:
      (datos.pedido.clienteCondicionIva as
        | "responsable_inscripto"
        | "monotributista"
        | "exento"
        | "consumidor_final"
        | "no_categorizado") ?? "consumidor_final",
    receptorDomicilio: datos.pedido.clienteDireccion,
    observaciones: `Pedido ${datos.pedido.numero}`,
    createdByUserId: usuario.userId,
    lineas,
  });

  if (resultado.error) return { error: resultado.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "factura",
    entidadId: resultado.invoiceId ?? null,
    descripcion: `Facturó el pedido ${datos.pedido.numero}`,
  });

  refrescar();
  revalidatePath(`/admin/pedidos/${orderId.data}`);

  // El comprobante en PDF sale por correo con el documento ya emitido y fuera
  // del camino de la respuesta: quien está facturando en el mostrador no tiene
  // que esperar a que se arme el PDF ni a que conteste el servidor de correo.
  if (resultado.invoiceId) {
    const id = resultado.invoiceId;
    after(async () => {
      await enviarComprobantePorCorreo(id);
    });
  }

  redirect(`/admin/facturacion/${resultado.invoiceId}`);
}

const lineaManualSchema = z.object({
  descripcion: z.string().trim().min(1).max(240),
  cantidad: z.coerce.number().positive().max(100000),
  precio: z.coerce.number().positive().max(100_000_000),
  alicuota: z.coerce.number(),
});

/** Alta manual, para la venta de mostrador que no pasó por un pedido. */
export async function emitirManual(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const usuario = await requireStaff();

  const cabecera = z
    .object({
      receptorNombre: z.string().trim().min(2, "Falta el nombre.").max(160),
      receptorCuit: z
        .string()
        .trim()
        .max(20)
        .optional()
        .refine(
          (v) => !v || /^\d{2}-?\d{8}-?\d$/.test(v),
          "El CUIT tiene que tener 11 dígitos.",
        ),
      receptorCondicionIva: z.enum([
        "responsable_inscripto",
        "monotributista",
        "exento",
        "consumidor_final",
        "no_categorizado",
      ]),
      receptorDomicilio: z.string().trim().max(200).optional(),
      observaciones: z.string().trim().max(600).optional(),
      customerId: z.string().uuid().optional(),
    })
    .safeParse({
      receptorNombre: formData.get("receptorNombre"),
      receptorCuit: (formData.get("receptorCuit") as string) || undefined,
      receptorCondicionIva: formData.get("receptorCondicionIva"),
      receptorDomicilio: (formData.get("receptorDomicilio") as string) || undefined,
      observaciones: (formData.get("observaciones") as string) || undefined,
      customerId: (formData.get("customerId") as string) || undefined,
    });

  if (!cabecera.success) {
    return { error: cabecera.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const descripciones = formData.getAll("descripcion").map(String);
  const cantidades = formData.getAll("cantidad").map(String);
  const precios = formData.getAll("precio").map(String);
  const alicuotas = formData.getAll("alicuota").map(String);

  const lineas = [];

  for (let i = 0; i < descripciones.length; i++) {
    if (!descripciones[i]?.trim()) continue;

    const parsed = lineaManualSchema.safeParse({
      descripcion: descripciones[i],
      cantidad: cantidades[i],
      precio: precios[i],
      alicuota: alicuotas[i] || "21",
    });

    if (!parsed.success) {
      return { error: `Revisá la línea ${i + 1}: cantidad y precio deben ser mayores a cero.` };
    }

    lineas.push({
      descripcion: parsed.data.descripcion,
      cantidad: parsed.data.cantidad,
      precioFinalUnitario: parsed.data.precio,
      alicuota: parsed.data.alicuota,
    });
  }

  if (lineas.length === 0) {
    return { error: "Cargá al menos un ítem." };
  }

  const resultado = await emitirComprobante({
    ...cabecera.data,
    receptorCuit: cabecera.data.receptorCuit?.replace(/\D/g, "") || null,
    createdByUserId: usuario.userId,
    lineas,
  });

  if (resultado.error) return { error: resultado.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "factura",
    entidadId: resultado.invoiceId ?? null,
    descripcion: `Emitió un comprobante manual a ${cabecera.data.receptorNombre ?? "consumidor final"}`,
  });

  refrescar();

  if (resultado.invoiceId) {
    const id = resultado.invoiceId;
    after(async () => {
      await enviarComprobantePorCorreo(id);
    });
  }

  redirect(`/admin/facturacion/${resultado.invoiceId}`);
}

/* -------------------------------------------------------------------------- */
/* Autorizar, anular, cobrar                                                   */
/* -------------------------------------------------------------------------- */

export async function autorizar(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const usuario = await requireStaff();

  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "No encontramos el comprobante." };

  const resultado = await autorizarComprobante(id.data);
  refrescar(id.data);

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "factura",
    entidadId: id.data,
    descripcion: resultado.error
      ? `Intentó autorizar un comprobante en ARCA y falló: ${resultado.error}`
      : "Autorizó un comprobante en ARCA",
  });

  // Con el CAE en la mano vale la pena mandar el definitivo: el que salió al
  // emitir decía que todavía no estaba autorizado.
  if (!resultado.error) {
    const id2 = id.data;
    after(async () => {
      await enviarComprobantePorCorreo(id2);
    });
  }

  return resultado;
}

export async function anular(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const usuario = await requireStaffRole("admin");

  const parsed = z
    .object({
      id: z.string().uuid(),
      motivo: z.string().trim().min(4, "Escribí el motivo de la anulación.").max(300),
    })
    .safeParse({
      id: formData.get("id"),
      motivo: formData.get("motivo"),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const resultado = await anularConNotaDeCredito(
    parsed.data.id,
    parsed.data.motivo,
    usuario.userId,
  );

  if (resultado.error) return { error: resultado.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "anular",
    entidad: "factura",
    entidadId: parsed.data.id,
    descripcion: `Anuló un comprobante con nota de crédito: ${parsed.data.motivo}`,
    detalle: { notaDeCreditoId: resultado.invoiceId },
  });

  refrescar(parsed.data.id);
  redirect(`/admin/facturacion/${resultado.invoiceId}`);
}

/**
 * Registra un cobro.
 *
 * Se permiten cobros parciales: una factura puede saldarse en varias veces y
 * con distintos medios, que es como se cobra de verdad en el mostrador.
 */
export async function registrarCobro(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      id: z.string().uuid(),
      medio: z.enum([
        "efectivo",
        "transferencia",
        "mercado_pago",
        "tarjeta",
        "cheque",
        "cuenta_corriente",
      ]),
      monto: z.string().trim().min(1, "Poné el importe."),
      referencia: z.string().trim().max(120).optional(),
    })
    .safeParse({
      id: formData.get("id"),
      medio: formData.get("medio"),
      monto: formData.get("monto"),
      referencia: (formData.get("referencia") as string) || undefined,
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const monto = parsearImporte(parsed.data.monto);

  if (!Number.isFinite(monto) || monto <= 0) {
    return { error: "El importe tiene que ser mayor a cero." };
  }

  const [comprobante] = await db
    .select({ id: invoices.id, estado: invoices.estado })
    .from(invoices)
    .where(eq(invoices.id, parsed.data.id))
    .limit(1);

  if (!comprobante) return { error: "No encontramos el comprobante." };
  if (comprobante.estado === "anulada") {
    return { error: "El comprobante está anulado." };
  }

  await db.insert(invoicePayments).values({
    invoiceId: parsed.data.id,
    medio: parsed.data.medio,
    monto: monto.toFixed(2),
    referencia: parsed.data.referencia ?? null,
    createdByUserId: usuario.userId,
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cobrar",
    entidad: "factura",
    entidadId: parsed.data.id,
    descripcion: `Registró un cobro de ${monto.toFixed(2)} por ${parsed.data.medio}`,
    detalle: { medio: parsed.data.medio, monto: monto.toFixed(2), referencia: parsed.data.referencia },
  });

  refrescar(parsed.data.id);
  return { ok: "Cobro registrado." };
}

/* -------------------------------------------------------------------------- */
/* Configuración tributaria                                                    */
/* -------------------------------------------------------------------------- */

export async function guardarDatosEmisor(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const usuario = await requireStaffRole("admin");

  const parsed = z
    .object({
      razonSocial: z.string().trim().min(2, "Falta la razón social.").max(160),
      nombreFantasia: z.string().trim().max(160).optional(),
      cuit: z
        .string()
        .trim()
        .refine(
          (v) => /^\d{2}-?\d{8}-?\d$/.test(v),
          "El CUIT tiene que tener 11 dígitos.",
        ),
      condicionIva: z.enum([
        "responsable_inscripto",
        "monotributista",
        "exento",
        "consumidor_final",
        "no_categorizado",
      ]),
      domicilio: z.string().trim().max(200).optional(),
      localidad: z.string().trim().max(80).optional(),
      codigoPostal: z.string().trim().max(12).optional(),
      telefono: z.string().trim().max(40).optional(),
      email: z.string().trim().max(120).optional(),
      ingresosBrutos: z.string().trim().max(40).optional(),
      regimenIibb: z.enum([
        "local",
        "convenio_multilateral",
        "exento",
        "no_inscripto",
      ]),
      alicuotaPercepcionIibb: z.string().trim().optional(),
      percibeIibb: z.coerce.boolean().optional(),
      inicioActividades: z.string().trim().optional(),
      leyenda: z.string().trim().max(500).optional(),
    })
    .safeParse({
      razonSocial: formData.get("razonSocial"),
      nombreFantasia: (formData.get("nombreFantasia") as string) || undefined,
      cuit: formData.get("cuit"),
      condicionIva: formData.get("condicionIva"),
      domicilio: (formData.get("domicilio") as string) || undefined,
      localidad: (formData.get("localidad") as string) || undefined,
      codigoPostal: (formData.get("codigoPostal") as string) || undefined,
      telefono: (formData.get("telefono") as string) || undefined,
      email: (formData.get("email") as string) || undefined,
      ingresosBrutos: (formData.get("ingresosBrutos") as string) || undefined,
      regimenIibb: formData.get("regimenIibb") || "local",
      alicuotaPercepcionIibb:
        (formData.get("alicuotaPercepcionIibb") as string) || undefined,
      percibeIibb: formData.get("percibeIibb") === "on",
      inicioActividades: (formData.get("inicioActividades") as string) || undefined,
      leyenda: (formData.get("leyenda") as string) || undefined,
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const datos = parsed.data;
  const config = await obtenerConfiguracionFiscal();

  const alicuota = parsearImporte(datos.alicuotaPercepcionIibb ?? "0");

  await db
    .update(configuracionFiscal)
    .set({
      razonSocial: datos.razonSocial,
      nombreFantasia: datos.nombreFantasia ?? null,
      cuit: datos.cuit.replace(/\D/g, ""),
      condicionIva: datos.condicionIva,
      domicilio: datos.domicilio ?? null,
      localidad: datos.localidad || "Mar del Plata",
      codigoPostal: datos.codigoPostal ?? null,
      telefono: datos.telefono ?? null,
      email: datos.email ?? null,
      ingresosBrutos: datos.ingresosBrutos ?? null,
      regimenIibb: datos.regimenIibb,
      alicuotaPercepcionIibb: (Number.isFinite(alicuota) ? alicuota : 0).toFixed(2),
      percibeIibb: Boolean(datos.percibeIibb),
      inicioActividades: datos.inicioActividades
        ? new Date(datos.inicioActividades)
        : null,
      leyenda: datos.leyenda ?? null,
      updatedAt: new Date(),
    })
    .where(eq(configuracionFiscal.id, config.id));

  revalidatePath("/admin/arca");
  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "configuracion",
    descripcion: "Cambió los datos fiscales del emisor",
  });

  return { ok: "Datos guardados." };
}

export async function guardarPuntoVenta(
  _previo: EstadoFactura,
  formData: FormData,
): Promise<EstadoFactura> {
  const usuario = await requireStaffRole("admin");

  const parsed = z
    .object({
      id: z.string().uuid().optional(),
      numero: z.coerce.number().int().min(1).max(99999),
      nombre: z.string().trim().min(2, "Poné un nombre.").max(80),
      branchId: z.string().uuid().optional(),
      activo: z.coerce.boolean().optional(),
    })
    .safeParse({
      id: (formData.get("id") as string) || undefined,
      numero: formData.get("numero"),
      nombre: formData.get("nombre"),
      branchId: (formData.get("branchId") as string) || undefined,
      activo: formData.get("activo") !== "off",
    });

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "El número de punto de venta tiene que ser el que habilitaste en ARCA.",
    };
  }

  const datos = parsed.data;

  try {
    if (datos.id) {
      await db
        .update(puntosVenta)
        .set({
          numero: datos.numero,
          nombre: datos.nombre,
          branchId: datos.branchId ?? null,
          activo: Boolean(datos.activo),
        })
        .where(eq(puntosVenta.id, datos.id));
    } else {
      await db.insert(puntosVenta).values({
        numero: datos.numero,
        nombre: datos.nombre,
        branchId: datos.branchId ?? null,
        activo: Boolean(datos.activo),
      });
    }
  } catch {
    return { error: `Ya hay un punto de venta con el número ${datos.numero}.` };
  }

  revalidatePath("/admin/arca");
  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "configuracion",
    descripcion: "Cambió un punto de venta",
  });

  return { ok: "Punto de venta guardado." };
}
