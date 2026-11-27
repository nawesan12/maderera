import { primerNombre } from "@/lib/formato";
import { soloDigitos } from "@/lib/cuit";
import { nombreDeSaludo } from "@/lib/whatsapp/saludo";

/**
 * Lo que «Mi cuenta» dice de cada cosa, en un solo lugar.
 *
 * El mes simulado de noviembre de 2026 encontró la misma frase contradiciendo
 * al estado en varias pantallas: «Falta abonarlo» en un pedido a cuenta, «Te
 * pasamos los datos bancarios» en uno pagado o cancelado, «1 en camino» con el
 * pedido pendiente. La decisión va acá y se prueba (tests/portal-cliente).
 */

/**
 * Cómo se saluda. A una persona, por su nombre de pila; a una empresa (CUIT
 * de persona jurídica: 30, 33, 34) con su nombre entero: «Hola, Constructora»
 * no es un saludo (H091).
 */
export function saludoDelCliente(nombre: string, cuit: string | null | undefined): string {
  const digitos = cuit ? soloDigitos(cuit) : "";
  if (/^3[034]/.test(digitos)) return nombre.trim();
  // Sin CUIT de empresa, el nombre igual puede ser de una: «Constructora
  // Costa Atlántica SRL» no se saluda «Hola Constructora».
  return nombreDeSaludo(nombre, primerNombre);
}

/**
 * El distintivo junto al nombre: el de la lista de precios que tiene
 * («Constructora»), no «Profesional» para todos los que no son la general.
 */
export function distintivoDeLista(tipo: string | undefined, lista: string | null | undefined): string | null {
  if (lista) return lista.replace(/^lista\s+/i, "").replace(/^./, (l) => l.toUpperCase());
  return tipo === "profesional" ? "Profesional" : null;
}

/**
 * El importe que propone «Pagar tu cuenta»: lo que se debe menos lo que ya
 * se informó y se está verificando. Con el saldo entero, lo propuesto
 * disparaba el aviso de que se informa de más (mes simulado). Null si no
 * queda nada por informar: el campo va vacío.
 */
export function importeAInformar(saldo: number, enRevision: number): number | null {
  const resto = Math.round((saldo - Math.max(enRevision, 0)) * 100) / 100;
  return resto > 0.005 ? resto : null;
}

/**
 * El estado que el portal muestra. Un retiro con su remito preparado y sin
 * firmar todavía no está entregado: el pedido figuraba «Entregado» con el
 * remito sin firmar (mes simulado, M2S1-071 y M2S2-115). Queda «Para firmar»
 * hasta la firma: «Listo para retirar» se lo decía al que ya se lo había
 * llevado (mes 23, PED-1150). Go manda lo mismo (fragmentos.EstadoParaElCliente).
 */
export function estadoVisibleDelPedido(
  estado: string,
  remitos: { estado: string; tipo: string }[],
): string {
  if (estado !== "entregado") return estado;
  return remitos.some((r) => r.estado === "preparada" && r.tipo === "retiro") ? "por-firmar" : estado;
}

/**
 * El título de los remitos de un pedido, sin los anulados: un envío no es un
 * retiro («1 retiro» con «Te lo llevamos a», M2S1-155).
 */
export function tituloDeRemitos(remitos: { tipo: string }[]): string {
  const envios = remitos.filter((r) => r.tipo === "envio").length;
  const n = remitos.length;
  if (envios === n) return n === 1 ? "1 envío" : `${n} envíos`;
  if (envios === 0) return n === 1 ? "1 retiro" : `${n} retiros`;
  return `${n} remitos`;
}

/** El contador de pedidos abiertos: «en curso», nunca «en camino» (H083, H313). */
export function pedidosEnCurso(n: number): string {
  return `${n} en curso`;
}

export interface PagoDelPedido {
  estado: string;
  estadoPago: string;
  medioPago: string | null;
  total: number;
  /** Lo que falta pagar de un pedido a cuenta (null: no se cargó a la cuenta). */
  debeEnCuenta: number | null;
  /**
   * Lo que cuesta en la cuenta después de sus notas de crédito: una
   * devolución baja lo que se debe sin que nadie pague (PED-1218).
   */
  cuestaEnCuenta?: number | null;
  /** Lo informado que se está verificando. */
  enRevision?: number | null;
}

export interface EstadoDelPago {
  /** Clave de EtiquetaEstado. */
  clave: "pagado" | "parcial" | "pendiente" | "reintegrado" | "en_revision" | "cuenta";
  etiqueta: string;
  /** Lo que sigue, si hay algo que decir; nunca contradice la etiqueta. */
  sigue: string | null;
  /** Cuánto falta, si falta algo. */
  falta: number | null;
}

const ABONA_AL_RETIRAR: Record<string, string> = {
  efectivo: "Abonás al retirar o cuando te lo entregamos.",
};

/**
 * Qué dice la tarjeta «Pago» de un pedido (H088, H208, H214, H310, H393).
 *
 * - Cancelado: lo que pasó con la plata y nada más; sin plata, null.
 * - A cuenta corriente: pagado, pagado en parte o «a tu cuenta», con lo que
 *   falta imputando los pagos a la deuda más vieja (lo hace Go).
 * - Pagado: «Pagado» y nada más.
 * - Pendiente: lo que sigue según el medio y la etapa; ya entregado, lo que
 *   se debe, sin la frase de «al retirar».
 */
export function estadoDelPago(p: PagoDelPedido): EstadoDelPago | null {
  // El que falta firmar ya se lo llevó: no es «Abonás al retirar».
  const entregado = p.estado === "entregado" || p.estado === "por-firmar";
  if (p.estado === "cancelado") {
    // Cancelado sin plata de por medio, no hay nada que decir del pago: «Sin
    // cobrar» se leía como una deuda (H310).
    if (p.estadoPago === "reintegrado") return { clave: "reintegrado", etiqueta: "Reintegrado", sigue: null, falta: null };
    if (p.estadoPago === "pagado") return { clave: "pagado", etiqueta: "Pagado", sigue: null, falta: null };
    return null;
  }
  if (p.debeEnCuenta !== null) {
    if (p.debeEnCuenta <= 0.005) return { clave: "pagado", etiqueta: "Pagado", sigue: null, falta: null };
    if (p.debeEnCuenta < (p.cuestaEnCuenta ?? p.total) - 0.005) {
      return { clave: "parcial", etiqueta: "Pagado en parte", sigue: null, falta: p.debeEnCuenta };
    }
    return { clave: "cuenta", etiqueta: "A cuenta corriente", sigue: null, falta: p.debeEnCuenta };
  }
  if (p.estadoPago === "pagado") return { clave: "pagado", etiqueta: "Pagado", sigue: null, falta: null };
  if (p.estadoPago === "reintegrado") return { clave: "reintegrado", etiqueta: "Reintegrado", sigue: null, falta: null };
  if (p.enRevision && p.enRevision > 0) {
    return { clave: "en_revision", etiqueta: "Verificando tu pago", sigue: null, falta: null };
  }
  if (entregado) return { clave: "pendiente", etiqueta: "Falta abonarlo", sigue: null, falta: p.total };
  if (p.medioPago === "cuenta_corriente") {
    return { clave: "cuenta", etiqueta: "A cuenta corriente", sigue: null, falta: null };
  }
  // Transferencia: el comprobante se sube desde el pedido; no hace falta
  // decir que se manda por WhatsApp.
  const sigue = p.medioPago ? (ABONA_AL_RETIRAR[p.medioPago] ?? null) : "Coordinamos el pago por WhatsApp.";
  return { clave: "pendiente", etiqueta: "Falta abonarlo", sigue, falta: null };
}

/** El aviso de pagos en verificación, con el pronombre que corresponde (H314). */
export function avisoDePagosEnVerificacion(n: number): string {
  return n === 1
    ? "Tenés un pago que estamos verificando. Cuando lo confirmemos baja tu saldo y te llega el recibo por correo."
    : `Tenés ${n} pagos que estamos verificando. Cuando los confirmemos baja tu saldo y te llegan los recibos por correo.`;
}

/**
 * El mensaje de WhatsApp para consultar por algo del portal. Sale con quién
 * pregunta, así el vendedor no tiene que preguntarlo (H087).
 */
export function mensajeDeConsulta(texto: string, cliente?: { nombre: string; cuit?: string | null } | null): string {
  if (!cliente?.nombre) return texto;
  const cuit = cliente.cuit ? ` (CUIT ${cliente.cuit})` : "";
  return `${texto} Soy ${conPunto(`${cliente.nombre.trim()}${cuit}`)}`;
}

/**
 * Si un segundo nombre suma algo debajo del primero en un papel: «Maderera
 * Juan B. Justo» bajo «Maderera Juan B. Justo S.R.L.», o el nombre del cliente
 * igual a su razón social, se leían dos veces (mes simulado). Se comparan sin
 * la forma societaria, los puntos ni las mayúsculas.
 */
export function sumaAlNombre(principal: string | null | undefined, otro: string | null | undefined): boolean {
  if (!otro?.trim()) return false;
  const base = (n: string) => nombreDeSaludo(n.replace(/\b(S)\.\s*(R)\.\s*(L)\.?/gi, "SRL").replace(/\b(S)\.\s*(A)\.?(?=\s|$)/gi, "SA"), (x) => x.trim())
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return base(otro) !== base(principal ?? "");
}

/**
 * Quién firma la consulta del catálogo: el nombre de la ficha del cliente,
 * como el portal y /contacto, y el del usuario web solo si no tiene ficha.
 * Nadie si no hay sesión o es de la casa.
 */
export function quienConsulta(
  sesion: { nombre: string; esStaff: boolean; firma: string | null } | null,
): { nombre: string } | null {
  if (!sesion || sesion.esStaff) return null;
  return { nombre: sesion.firma ?? sesion.nombre };
}

/**
 * Cierra la frase con un punto, sin duplicarlo: «Soy Constructora S.R.L.» y
 * no «S.R.L..» (mes simulado).
 */
export function conPunto(frase: string): string {
  const f = frase.trimEnd();
  return /[.!?]$/.test(f) ? f : `${f}.`;
}

/**
 * Los productos para reseñar, uno por producto aunque se haya comprado en
 * varios pedidos (H391: la membrana salía cuatro veces). Si ya se reseñó en
 * alguno, queda reseñado. Conserva el orden en que llegan, así al publicar la
 * tarjeta no salta de lugar.
 */
export function unaPorProducto<T extends { productId: string; yaResenado: boolean; estadoResena?: string }>(items: T[]): T[] {
  // La reseña de cada producto, con su estado: el renglón que queda dice si
  // se publicó o no (M2S3-077).
  const reseñados = new Map<string, T>();
  for (const i of items) if (i.yaResenado && !reseñados.has(i.productId)) reseñados.set(i.productId, i);
  const vistos = new Set<string>();
  const out: T[] = [];
  for (const i of items) {
    if (vistos.has(i.productId)) continue;
    vistos.add(i.productId);
    const r = reseñados.get(i.productId);
    out.push(r && !i.yaResenado ? { ...i, yaResenado: true, estadoResena: r.estadoResena } : i);
  }
  return out;
}
