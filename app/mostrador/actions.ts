"use server";

import { revalidatePath } from "next/cache";
import { api, datos, mensajeDe, type Problema } from "@/lib/api/servidor";
import type { Esquemas } from "@/lib/api/tipos";
import { requireStaff } from "@/lib/dal/session";
import { fichaDeCorte } from "@/lib/dal/admin/cortes";
import { avisarPedidoNuevo } from "@/lib/dal/existencia";
import { emitirParaLaVenta, letraQueSaldria } from "@/lib/mostrador/comprobante";
import type { CorteDeMostrador, ResultadoDeMostrador } from "@/lib/mostrador/tipos";
import { hayVentaja } from "@/lib/mostrador/ventaja";
import type { LineaDeVenta, MedioDeMostrador, PagoDeVenta } from "@/lib/mostrador/importes";
import type { Autorizacion } from "@/components/autorizacion/campo-pin";

/*
 * Las acciones del mostrador. La venta, la anulación, la caja, el buscador,
 * el alta rápida, el presupuesto y el cobro de la cuenta los hace la API de Go
 * (backend/internal/mostrador): una venta pasa entera o no pasa, repetible
 * por su clave, con los mismos candados de siempre. Quedan acá el
 * comprobante fiscal (facturación sigue en TS, tanda 7) y las
 * revalidaciones de Next.
 */

export interface EstadoMostrador {
  error?: string;
  ok?: string;
  /** Número del pedido recién hecho, para poder ofrecer el comprobante. */
  numero?: string;
  orderId?: string;
  invoiceId?: string;
  /**
   * Qué salió mal con el comprobante, sobre una venta que igual quedó hecha.
   * Es distinto de `error`: la venta está, lo que falta es el papel.
   */
  avisoFiscal?: string;
  /** Lo que tenía la venta anulada, para «Anular y rehacer». */
  renglones?: LineaDeVenta[];
  /** La venta anulada tenía un corte, que hay que volver a armar. */
  conCorte?: boolean;
  /** Para «Rehacer»: el cliente, el papel, cómo pagó y el corte que quedó en la cola. */
  rehacer?: {
    customerId: string | null;
    comprobante: "interno" | "fiscal" | null;
    pagos: PagoDeVenta[];
    cortes: string[];
  };
  /** La venta es igual a una de recién al mismo cliente (M3S4-015): se confirma y se reenvía. */
  repetida?: string;
  /** La venta dejó medidas vendidas de más: hay que pedirlas (mes simulado, H218). */
  avisoStock?: string;
  /**
   * Falta el PIN de un admin: lo que se deja de cobrar pasa lo libre, la
   * cuenta corriente pasa el límite, o la anulación no es del vendedor. La
   * pantalla muestra el campo del PIN y reenvía lo mismo.
   */
  autorizacion?: Autorizacion;
  /**
   * Un PIN ya tecleado para esta venta: si después falló por otra cosa, se
   * reenvía con la ficha y no hace falta volver a llamar al admin.
   */
  ficha?: string;
}

/** Lo que manda la pantalla para cobrar (lo valida Go con el esquema de siempre). */
export interface VentaDelMostrador {
  clave: string;
  branchId: string;
  lineas: LineaDeVenta[];
  customerId: string | null;
  contactoNombre: string;
  contactoTelefono?: string | null;
  medioPago: MedioDeMostrador;
  pagos?: PagoDeVenta[];
  acopio?: boolean;
  comprobante?: "interno" | "fiscal";
  cuit?: string | null;
  descuento?: number;
  descuentoMotivo?: string | null;
  notas?: string | null;
  /** Los cortes de la venta; cada renglón de uno lleva su índice en `corte`. */
  cortes?: CorteDeMostrador[];
  /** El pago partido en medios distintos: el descuento por forma de pago no corre. */
  sinEscala?: boolean;
  /** El cliente con lista propia compra esta vez a la lista general. */
  aLista?: boolean;
  /** El PIN de un admin, o la ficha de un PIN anterior para esta venta. */
  pin?: string;
  ficha?: string;
  /** El presupuesto que armó la venta: al cobrar queda aceptado y atado al pedido. */
  presupuestoId?: string;
  /** Con cuánto pagó en efectivo: el ticket dice el vuelto. */
  efectivoRecibido?: number | null;
  /** Quien atiende vio que es igual a una de recién y la cobra igual. */
  repetidaOk?: boolean;
}

function refrescar() {
  revalidatePath("/mostrador");
  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/pagos");
  revalidatePath("/admin/stock");
}

const error = (r: { error?: unknown }) => ({ error: mensajeDe(r.error as Problema | undefined) });

/* -------------------------------------------------------------------------- */
/* Caja                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Abre el turno. Si el fondo no es lo que quedó contado al cerrar el turno
 * anterior, Go pide el motivo de la diferencia (`motivo`) y la deja como un
 * retiro o ingreso «entre turnos». `cajaId` es la caja física de esta PC.
 */
export async function abrirCaja(
  branchId: string,
  fondoInicial: number,
  extra: { motivo?: string; cajaId?: string | null; corregir?: boolean } = {},
): Promise<EstadoMostrador> {
  const body = {
    branchId,
    fondoInicial,
    ...(extra.motivo?.trim() ? { motivo: extra.motivo.trim() } : {}),
    ...(extra.cajaId ? { cajaId: extra.cajaId } : {}),
    // «Conté mal»: se corrige el arqueo anterior en vez de cargar un retiro (M2S3-002).
    ...(extra.corregir ? { corregir: true } : {}),
  };
  const r = await (await api()).POST("/api/v1/mostrador/caja/abrir", { body });
  if (!r.data) return error(r);
  refrescar();
  return { ok: r.data.ok };
}

export async function registrarMovimientoDeCaja(
  sessionId: string,
  tipo: "ingreso" | "retiro",
  monto: number,
  motivo: string,
  destino?: "banco" | "caja_fuerte" | "otro",
  categoria?: string,
): Promise<EstadoMostrador> {
  const r = await (await api()).POST("/api/v1/mostrador/caja/movimiento", {
    body: { sessionId, tipo, monto, motivo, ...(destino ? { destino } : {}), ...(categoria ? { categoria } : {}) },
  });
  if (!r.data) return error(r);
  refrescar();
  return { ok: r.data.ok };
}

export async function cerrarCaja(sessionId: string, contado: number, notas: string): Promise<EstadoMostrador> {
  const r = await (await api()).POST("/api/v1/mostrador/caja/cerrar", { body: { sessionId, contado, notas } });
  if (!r.data) return error(r);
  refrescar();
  return { ok: r.data.ok };
}

/** Suelta la caja física de esta PC. Solo admin (lo controla Go). */
export async function desvincularTerminal(cajaId: string, pendientes = 0): Promise<EstadoMostrador> {
  const r = await (await api()).POST("/api/v1/mostrador/caja/desvincular", {
    body: { cajaId, pendientes: Math.max(0, Math.trunc(pendientes)) },
  });
  if (!r.data) return error(r);
  revalidatePath("/admin/caja");
  return { ok: r.data.ok };
}

/* -------------------------------------------------------------------------- */
/* Venta                                                                       */
/* -------------------------------------------------------------------------- */

export async function cobrarVenta(venta: VentaDelMostrador): Promise<EstadoMostrador> {
  const usuario = await requireStaff();
  const r = await (await api()).POST("/api/v1/mostrador/ventas", { body: venta as never });
  if (!r.data) return error(r);
  const resultado = r.data;
  if (!resultado.ok) {
    return {
      error: resultado.error,
      autorizacion: resultado.autorizacion as Autorizacion | undefined,
      ficha: resultado.ficha,
      repetida: resultado.repetida,
    };
  }
  // El seguimiento de este número tiene que existir aunque alguien lo haya
  // pedido antes (ver `avisarPedidoNuevo`).
  if (resultado.nueva) avisarPedidoNuevo(resultado.numero!);

  /*
   * El comprobante va acá, fuera de la transacción de la venta. También si la
   * venta ya estaba (un reintento después de un corte: la respuesta se
   * perdió entre la venta y la factura, y la factura no salía nunca). Emitir
   * es idempotente: una venta, un comprobante; el «ya tiene» no es un aviso.
   * La plata ya está en la caja: si ARCA no contesta, queda una venta sin
   * comprobante —que se resuelve después desde Facturación— y no una venta
   * deshecha, que no se resuelve nunca.
   */
  let avisoFiscal: string | undefined;
  let invoiceId: string | undefined;
  if (venta.comprobante === "fiscal") {
    const fiscal = await emitirParaLaVenta({
      orderId: resultado.orderId!,
      customerId: venta.customerId,
      receptorNombre: venta.contactoNombre,
      cuit: venta.cuit ?? null,
      // Las de la venta, con el descuento ya repartido.
      lineas: (resultado.lineas ?? []) as LineaDeVenta[],
      usuarioId: usuario.userId,
    });
    const yaEstaba = !resultado.nueva && fiscal.aviso?.startsWith("Esa venta ya tiene el comprobante");
    avisoFiscal = fiscal.autorizado || yaEstaba ? undefined : fiscal.aviso;
    invoiceId = fiscal.invoiceId;
  }

  refrescar();
  return {
    ok: resultado.nueva
      ? `Venta ${resultado.numero} registrada.`
      : `Esa venta ya estaba registrada como ${resultado.numero}.`,
    numero: resultado.numero,
    orderId: resultado.orderId,
    invoiceId,
    avisoFiscal,
    avisoStock: resultado.avisoStock,
  };
}

/* -------------------------------------------------------------------------- */
/* Búsqueda                                                                    */
/* -------------------------------------------------------------------------- */

export async function buscarEnMostrador(
  texto: string,
  branchId: string,
  customerId: string | null,
): Promise<ResultadoDeMostrador[]> {
  return datos(
    await (await api()).GET("/api/v1/mostrador/buscar", {
      params: { query: { q: texto, sucursal: branchId, cliente: customerId ?? undefined } },
    }),
  );
}

export async function buscarClientes(texto: string) {
  return datos(await (await api()).GET("/api/v1/mostrador/clientes", { params: { query: { q: texto } } }));
}

/** Los últimos clientes atendidos en la sucursal, para la caja vacía. */
export async function clientesRecientes(branchId: string) {
  return datos(
    await (await api()).GET("/api/v1/mostrador/clientes/recientes", { params: { query: { sucursal: branchId } } }),
  );
}

export type ResultadoAltaRapida =
  | { ok: true; cliente: NonNullable<Esquemas["MostradorAltaRapida"]["cliente"]> }
  | { ok: false; error: string; existente?: { id: string; nombre: string } };

/**
 * Alta de un cliente sin salir de la venta. Si el documento ya está en otra
 * ficha, no se crea: se ofrece la que existe.
 */
export async function crearClienteEnMostrador(alta: {
  nombre: string;
  documento: string;
  condicionIva: string;
  telefono?: string;
  rubro?: string;
}): Promise<ResultadoAltaRapida> {
  const r = await (await api()).POST("/api/v1/mostrador/clientes", { body: alta });
  if (!r.data) return { ok: false, error: mensajeDe(r.error as Problema | undefined) };
  if (r.data.ok && r.data.cliente) {
    revalidatePath("/admin/clientes");
    return { ok: true, cliente: r.data.cliente };
  }
  return { ok: false, error: r.data.error ?? "Revisá los datos.", existente: r.data.existente };
}

/**
 * El presupuesto que se trae a la venta por su número (mes simulado: desde el
 * mostrador no había forma de cargarlo). Con lo que no se puede, el motivo.
 */
export async function presupuestoParaLaVenta(
  numero: string,
): Promise<Esquemas["MostradorPresupuesto"] | { error: string }> {
  const r = await (await api()).GET("/api/v1/mostrador/presupuestos/{numero}", { params: { path: { numero } } });
  if (!r.data) return error(r);
  return r.data;
}

/** Un cliente por id, con lo que necesita la venta. Lo usa «usar el existente». */
export async function clientePorId(id: string) {
  return datos(await (await api()).GET("/api/v1/mostrador/clientes/{id}", { params: { path: { id } } })) ?? null;
}

/**
 * Los precios que le corresponden a un cliente para las variantes ya cargadas.
 * La pantalla la usa cuando se identifica al cliente con la venta empezada.
 */
export async function preciosDelCliente(variantIds: string[], customerId: string | null) {
  return datos(await (await api()).POST("/api/v1/mostrador/precios", { body: { variantIds, customerId } }));
}

/**
 * Si la lista del cliente le da algo mejor que la general en algún renglón:
 * ahí su lista es de contado. Una sola acción con las dos consultas en
 * paralelo: como dos acciones, Next las encolaba una detrás de la otra (y
 * detrás de cualquier otra del mostrador), y el Cheque quedaba bloqueado
 * hasta 5 s esperando la respuesta (mes simulado, tercera prueba).
 */
export async function ventajaDeLaLista(variantIds: string[], customerId: string): Promise<boolean> {
  const cliente = await api();
  const [suyos, generales] = await Promise.all([
    cliente.POST("/api/v1/mostrador/precios", { body: { variantIds, customerId } }).then(datos),
    cliente.POST("/api/v1/mostrador/precios", { body: { variantIds, customerId: null } }).then(datos),
  ]);
  return hayVentaja(variantIds, suyos, generales);
}

/** Qué letra saldría con el cliente y el CUIT que hay en pantalla. */
export async function letraDelComprobante(customerId: string | null, cuit: string | null) {
  await requireStaff();
  return letraQueSaldria(customerId, cuit);
}

/* -------------------------------------------------------------------------- */
/* Remito y presupuesto                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Emite el remito de una venta que acaba de salir por el mostrador: qué se
 * llevó la persona y si pagó. El stock no se toca —ya se descontó al cobrar—.
 */
export async function emitirRemitoDeVenta(
  orderId: string,
  receptorNombre?: string | null,
): Promise<EstadoMostrador & { remitoId?: string; remitoNumero?: string }> {
  // Lo emite Go (backend/internal/entregas), con su bitácora.
  const r = await (await api()).POST("/api/v1/mostrador/pedidos/{id}/remito", {
    params: { path: { id: orderId } },
    body: { receptorNombre: receptorNombre ?? null },
  });
  if (!r.data) return error(r);
  refrescar();
  return { ok: r.data.ok, remitoId: r.data.remitoId, remitoNumero: r.data.remitoNumero };
}

/**
 * Arma un presupuesto con lo que hay cargado en el mostrador, sin cobrar: no
 * mueve stock ni caja; queda en la cola de presupuestos con origen "mostrador".
 */
export async function emitirPresupuestoDeMostrador(presupuesto: {
  branchId: string;
  lineas: LineaDeVenta[];
  customerId: string | null;
  contactoNombre: string;
  contactoTelefono?: string | null;
  notas?: string | null;
  /** Una por carrito: el segundo toque devuelve el mismo (M3S2-050). */
  clave?: string;
}): Promise<EstadoMostrador & { quoteId?: string }> {
  const r = await (await api()).POST("/api/v1/mostrador/presupuestos", { body: presupuesto as never });
  if (!r.data) return error(r);
  revalidatePath("/admin/presupuestos");
  return { ok: r.data.ok, quoteId: r.data.quoteId };
}

/**
 * Anula una venta del mostrador. Si la venta tenía factura, esto **no** emite
 * la nota de crédito: avisa que hace falta. Sin CAE no hay nota posible (Go
 * la rechaza): esa factura se da de baja, o la serie la mandaría a ARCA. Una
 * venta ajena, de otro turno, ya cobrada o cuya mercadería no vuelve pide el
 * PIN de un admin.
 */
export async function anularVenta(
  orderId: string,
  motivo: string,
  opciones: { volvioLaMercaderia: boolean; pin?: string; rehacer?: boolean },
): Promise<EstadoMostrador> {
  const r = await (await api()).POST("/api/v1/mostrador/ventas/{id}/anular", {
    params: { path: { id: orderId } },
    body: {
      motivo,
      volvioLaMercaderia: opciones.volvioLaMercaderia,
      ...(opciones.pin ? { pin: opciones.pin } : {}),
      ...(opciones.rehacer ? { rehacer: true } : {}),
    },
  });
  if (!r.data) return error(r);
  if (r.data.autorizacion) {
    return { error: r.data.error, autorizacion: r.data.autorizacion as Autorizacion };
  }
  refrescar();
  return {
    ok: r.data.ok,
    // A quien no entra a Facturación no se lo manda ahí: Go ya le avisó a
    // administración (mes simulado, H178).
    avisoFiscal: !r.data.facturaPendiente
      ? undefined
      : r.data.avisado
        ? "Administración ya tiene el aviso de la factura."
        : r.data.facturaSinCae
          ? "La venta tenía factura sin CAE. Dala de baja desde Facturación."
          : "La venta tenía factura. Emitile la nota de crédito desde Facturación.",
    renglones: (r.data.renglones ?? []).map((l) => ({
      variantId: l.variantId ?? null,
      descripcion: l.descripcion,
      unidad: l.unidad,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      precioLista: l.variantId ? l.precioUnitario : null,
      presentacion: (l.presentacion as LineaDeVenta["presentacion"]) ?? null,
    })),
    conCorte: r.data.conCorte ?? false,
    rehacer: {
      customerId: r.data.customerId ?? null,
      comprobante: r.data.comprobante === "fiscal" || r.data.comprobante === "interno" ? r.data.comprobante : null,
      pagos: (r.data.pagos ?? []).map((p) => ({
        medio: p.medio as MedioDeMostrador,
        importe: p.importe,
        nroLote: p.nroLote,
        nroCupon: p.nroCupon,
        tarjeta: p.tarjeta,
        cuotas: p.cuotas,
        cheque: p.cheque
          ? {
              tipo: p.cheque.tipo === "echeq" ? "echeq" : "fisico",
              numero: p.cheque.numero,
              banco: p.cheque.banco,
              librador: p.cheque.librador,
              fechaPago: p.cheque.fechaPago,
            }
          : null,
      })),
      cortes: r.data.cortes ?? [],
    },
  };
}

/**
 * El corte que quedó en la cola al rehacer una venta, como lo necesita la
 * pantalla para volver a abrirlo con su despiece (M2S3-047). Es lo mismo que
 * arma la página con `?corte=`.
 */
export async function corteParaCobrar(id: string) {
  const ficha = await fichaDeCorte(id);
  if (!ficha || ficha.corte.orderId || ficha.corte.estado === "cancelado" || !ficha.corte.variantId) return null;
  return aCorteACobrar(ficha);
}

/** La ficha de un corte sin venta, como la usa la pantalla del mostrador. */
function aCorteACobrar(ficha: NonNullable<Awaited<ReturnType<typeof fichaDeCorte>>>) {
  return {
    id: ficha.corte.id,
    numero: ficha.corte.numero,
    customerId: ficha.corte.customerId,
    variantId: ficha.corte.variantId!,
    material: ficha.corte.material,
    unidad: ficha.corte.unidad ?? "placa",
    precio: ficha.corte.precioPlaca ?? 0,
    largoMm: ficha.corte.varianteLargoMm,
    anchoMm: ficha.corte.varianteAnchoMm,
    color: ficha.corte.color,
    categoria: ficha.corte.categoria,
    formaDeVenta: (ficha.corte.formaDeVenta ?? "entera") as "entera" | "entera_o_media" | "metro_cuadrado",
    precioMediaPct: ficha.corte.precioMediaPct ?? 50,
    mitad: ficha.corte.mitad as "largo" | "ancho" | null,
    canto: ficha.corte.cantoDescripcion ?? "",
    pasadas: ficha.pasadasACobrar,
    contacto: ficha.corte.customerId ? null : ficha.corte.cliente?.trim() || null,
    telefono: ficha.corte.customerId ? null : ficha.corte.telefono,
    piezas: ficha.corte.piezas.map((p) => ({
      largo: String(p.largoMm),
      ancho: String(p.anchoMm),
      cantidad: String(p.cantidad),
      veta: p.respetaVeta === 1,
      cantoLargo: p.cantoLargo,
      cantoAncho: p.cantoAncho,
      etiqueta: p.etiqueta ?? "",
    })),
  };
}

/** Lo que se puede devolver de una venta sin factura (M3S2-060). */
export async function datosDeDevolucionSinFactura(orderId: string) {
  const r = await (await api()).GET("/api/v1/mostrador/ventas/{id}/devolucion-sin-factura", { params: { path: { id: orderId } } });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined) };
  return { datos: r.data };
}

/** Devuelve una parte de una venta sin factura, por la caja o por el medio de pago. */
export async function devolverSinFactura(
  orderId: string,
  pedido: { clave: string; destino: "caja" | "afuera" | "cuenta"; motivo: string; renglones: { orderItemId: string; cantidad: number }[] },
  pin?: string,
): Promise<EstadoMostrador> {
  const r = await (await api()).POST("/api/v1/mostrador/ventas/{id}/devolucion-sin-factura", {
    params: { path: { id: orderId } },
    body: { ...pedido, ...(pin ? { pin } : {}) },
  });
  if (!r.data) return error(r);
  if (r.data.autorizacion) return { error: r.data.error, autorizacion: r.data.autorizacion as Autorizacion };
  refrescar();
  return { ok: r.data.ok };
}


/** Lo que debe un cliente, para ofrecer cobrarle la cuenta en el mostrador. */
export async function saldoDeCuenta(customerId: string): Promise<number> {
  return (await cuentaDelCliente(customerId)).saldo;
}

/**
 * Lo que debe el cliente y sus pedidos entregados sin cobrar, que no están
 * en la cuenta: se ven junto al «Debe» (mes simulado, H367).
 */
export async function cuentaDelCliente(
  customerId: string,
): Promise<{ saldo: number; sinCobrar: { id: string; numero: string; monto: number }[] }> {
  const r = datos(await (await api()).GET("/api/v1/mostrador/clientes/{id}/saldo", { params: { path: { id: customerId } } }));
  return { saldo: r.saldo, sinCobrar: r.sinCobrar ?? [] };
}

export interface EstadoCobroDeCuenta {
  ok?: string;
  error?: string;
  receiptId?: string;
  numero?: string;
}

/**
 * Cobra la cuenta corriente de un cliente en el mostrador y emite el recibo
 * (cobros.EmitirRecibo en Go, la única forma de registrar un pago). El aviso
 * al cliente lo encola Go en la misma transacción.
 */
export async function cobrarCuentaEnMostrador(
  _previo: EstadoCobroDeCuenta,
  formData: FormData,
): Promise<EstadoCobroDeCuenta> {
  const customerId = (formData.get("customerId") as string | null) ?? "";
  const branchId = (formData.get("branchId") as string | null) ?? "";
  const r = await (await api()).POST("/api/v1/mostrador/clientes/{id}/cobro", {
    params: { path: { id: customerId || "-" } },
    body: {
      branchId,
      partes: (formData.get("partes") as string | null) ?? "",
      clave: (formData.get("clave") as string | null) || undefined,
    },
  });
  if (!r.data) return error(r);
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/caja");
  return { ok: r.data.ok, receiptId: r.data.receiptId, numero: r.data.numero };
}

/* -------------------------------------------------------------------------- */
/* Devolución parcial                                                          */
/* -------------------------------------------------------------------------- */

type RenglonADevolverEnMostrador = { itemId: string; cantidad: number; alStock: boolean; delAcopio: number | null };

/**
 * Lo que se puede devolver de una venta de hoy con factura: la misma ficha de
 * la devolución del panel (mes simulado, H270).
 */
export async function datosDeDevolucionDeVenta(orderId: string) {
  const r = await (await api()).GET("/api/v1/mostrador/ventas/{id}/devolucion", { params: { path: { id: orderId } } });
  if (!r.data) return { error: (error(r).error ?? "No se pudo abrir la devolución.") as string };
  return { datos: r.data as unknown as import("@/lib/dal/admin/facturacion").DatosDeDevolucion };
}

export async function calcularDevolucionDeVenta(
  orderId: string,
  renglones: RenglonADevolverEnMostrador[],
): Promise<{ importe?: number; error?: string }> {
  const r = await (await api()).POST("/api/v1/mostrador/ventas/{id}/devolucion/calculo", {
    params: { path: { id: orderId } },
    body: { renglones },
  });
  if (!r.data) return { error: error(r).error };
  return { importe: r.data.importe };
}

/** La devolución: al vendedor le pide la firma de un admin, como anular. */
export async function devolverDeVenta(
  orderId: string,
  pedido: {
    clave: string;
    destino: "caja" | "cuenta" | "afuera" | "deuda";
    motivo: string;
    sinStock: "rota" | "otro" | null;
    sucursalId: string | null;
    importe: number;
    renglones: RenglonADevolverEnMostrador[];
  },
  pin?: string,
): Promise<{ ok?: string; error?: string; autorizacion?: Autorizacion }> {
  const r = await (await api()).POST("/api/v1/mostrador/ventas/{id}/devolucion", {
    params: { path: { id: orderId } },
    body: { ...pedido, ...(pin ? { pin } : {}) },
  });
  if (!r.data) return { error: error(r).error };
  if (r.data.autorizacion) return { error: r.data.error, autorizacion: r.data.autorizacion as Autorizacion };
  refrescar();
  return { ok: r.data.ok };
}
