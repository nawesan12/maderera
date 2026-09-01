import { formatearPrecio } from "@/lib/formato";
import { urlBase } from "@/lib/pagos/config";
import { enlaceDeSeguimiento } from "@/lib/seguimiento";

/** El enlace de seguimiento, absoluto: en un correo no sirve uno relativo. */
function urlAbsolutaDelPedido(numero: string, token: string): string {
  return `${urlBase()}${enlaceDeSeguimiento(numero, token)}`;
}

/**
 * Plantillas de los correos.
 *
 * HTML con tablas y estilos en línea, no porque sea lindo sino porque es lo
 * único que se ve igual en Gmail, en Outlook de escritorio y en el Mail del
 * iPhone. Flexbox, grid y hojas de estilo externas no existen en el correo, y
 * los colores van en hexadecimal: los `oklch()` del sitio no los entiende
 * ningún cliente de correo.
 *
 * Cada plantilla devuelve asunto, HTML y texto plano. El texto no es un
 * descarte: los filtros de spam castigan al correo que solo trae HTML.
 */

const MARCA = {
  naranja: "#F16A00",
  naranjaOscuro: "#B83300",
  gris: "#1E1A16",
  grisSuave: "#6B625A",
  crema: "#F9F4EE",
  borde: "#E4DCD1",
  verde: "#388447",
  blanco: "#FFFFFF",
};

const FUENTE =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Escapa texto para meterlo en el HTML del correo.
 *
 * `parrafos` se inserta crudo a propósito —las plantillas propias mandan
 * `<strong>` adentro—, así que **todo lo que venga de afuera tiene que pasar
 * por acá antes**. El formulario de contacto es el caso: lo escribe cualquiera
 * y termina en la bandeja de quien atiende.
 */
export function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface Bloque {
  etiqueta: string;
  valor: string;
}

export interface LineaCorreo {
  descripcion: string;
  cantidad: number | string;
  unidad?: string | null;
  /**
   * Importe del renglón, o null cuando no corresponde.
   *
   * Un remito es constancia de entrega, no de venta: no lleva precios. Mandar
   * "$ 0,00" sería peor que no mandar nada.
   */
  importe?: number | string | null;
}

interface OpcionesEnvoltura {
  titulo: string;
  /** Primera línea que se ve en la bandeja, antes de abrir. */
  adelanto: string;
  saludo?: string;
  parrafos: string[];
  datos?: Bloque[];
  lineas?: LineaCorreo[];
  total?: number | string;
  cta?: { texto: string; url: string };
  cierre?: string;
}

function filaDato(bloque: Bloque): string {
  return `<tr>
    <td style="padding:6px 0;font-size:14px;color:${MARCA.grisSuave};">${escapar(bloque.etiqueta)}</td>
    <td style="padding:6px 0;font-size:14px;color:${MARCA.gris};font-weight:600;text-align:right;">${escapar(bloque.valor)}</td>
  </tr>`;
}

function filaLinea(linea: LineaCorreo): string {
  const cantidad = `${linea.cantidad}${linea.unidad ? ` ${linea.unidad}` : ""}`;
  const importe =
    linea.importe == null
      ? ""
      : `<td style="padding:10px 0;border-bottom:1px solid ${MARCA.borde};font-size:14px;color:${MARCA.gris};text-align:right;white-space:nowrap;">
      ${escapar(formatearPrecio(linea.importe))}
    </td>`;

  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid ${MARCA.borde};font-size:14px;color:${MARCA.gris};">
      ${escapar(linea.descripcion)}<br>
      <span style="font-size:12px;color:${MARCA.grisSuave};">${escapar(cantidad)}</span>
    </td>
    ${importe}
  </tr>`;
}

/**
 * Arma el correo completo.
 *
 * El ancho fijo de 600px y la tabla exterior centrada son la receta vieja que
 * sigue siendo la que funciona: Outlook no centra un div con `margin:auto`.
 */
export function envolver(opciones: OpcionesEnvoltura): {
  html: string;
  texto: string;
} {
  const sitio = urlBase();

  const parrafos = opciones.parrafos
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${MARCA.gris};">${p}</p>`,
    )
    .join("");

  const datos = opciones.datos?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;padding:16px;background:${MARCA.crema};border-radius:10px;">
        ${opciones.datos.map(filaDato).join("")}
       </table>`
    : "";

  const lineas = opciones.lineas?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">
        ${opciones.lineas.map(filaLinea).join("")}
        ${
          opciones.total != null
            ? `<tr>
                <td style="padding:14px 0 0;font-size:16px;font-weight:700;color:${MARCA.gris};">Total</td>
                <td style="padding:14px 0 0;font-size:18px;font-weight:700;color:${MARCA.gris};text-align:right;">${escapar(formatearPrecio(opciones.total))}</td>
              </tr>`
            : ""
        }
       </table>`
    : "";

  const cta = opciones.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
        <tr><td style="border-radius:8px;background:${MARCA.naranja};">
          <a href="${opciones.cta.url}" style="display:inline-block;padding:14px 26px;font-family:${FUENTE};font-size:15px;font-weight:600;color:${MARCA.blanco};text-decoration:none;">${escapar(opciones.cta.texto)}</a>
        </td></tr>
       </table>`
    : "";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(opciones.titulo)}</title></head>
<body style="margin:0;padding:0;background:${MARCA.crema};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapar(opciones.adelanto)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MARCA.crema};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${MARCA.blanco};border-radius:14px;overflow:hidden;border:1px solid ${MARCA.borde};">
    <tr><td style="background:${MARCA.gris};padding:20px 28px;">
      <span style="font-family:${FUENTE};font-size:17px;font-weight:700;color:${MARCA.blanco};letter-spacing:-0.2px;">Maderera Juan B. Justo</span><br>
      <span style="font-family:${FUENTE};font-size:12px;color:#B9AFA4;">Tu proyecto. Nuestra madera.</span>
    </td></tr>
    <tr><td style="padding:28px;font-family:${FUENTE};">
      <h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:${MARCA.gris};">${escapar(opciones.titulo)}</h1>
      ${opciones.saludo ? `<p style="margin:0 0 14px;font-size:15px;color:${MARCA.gris};">Hola ${escapar(opciones.saludo)},</p>` : ""}
      ${parrafos}
      ${datos}
      ${lineas}
      ${cta}
      ${opciones.cierre ? `<p style="margin:18px 0 0;font-size:14px;color:${MARCA.grisSuave};line-height:1.6;">${opciones.cierre}</p>` : ""}
    </td></tr>
    <tr><td style="padding:18px 28px;background:${MARCA.crema};border-top:1px solid ${MARCA.borde};font-family:${FUENTE};font-size:12px;color:${MARCA.grisSuave};line-height:1.6;">
      Casa Central · Av. Juan B. Justo 4153 · (0223) 474-3328<br>
      Aserradero · Canosa 61 · (0223) 483-0535<br>
      <a href="${sitio}" style="color:${MARCA.naranjaOscuro};text-decoration:none;">mjbj.ar</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const texto = [
    opciones.titulo,
    "",
    opciones.saludo ? `Hola ${opciones.saludo},` : null,
    ...opciones.parrafos.map((p) => p.replace(/<[^>]+>/g, "")),
    opciones.datos?.length
      ? "\n" + opciones.datos.map((d) => `${d.etiqueta}: ${d.valor}`).join("\n")
      : null,
    opciones.lineas?.length
      ? "\n" +
        opciones.lineas
          .map(
            (l) =>
              `- ${l.descripcion} (${l.cantidad}${l.unidad ? ` ${l.unidad}` : ""})${l.importe == null ? "" : ` ${formatearPrecio(l.importe)}`}`,
          )
          .join("\n")
      : null,
    opciones.total != null ? `\nTotal: ${formatearPrecio(opciones.total)}` : null,
    opciones.cta ? `\n${opciones.cta.texto}: ${opciones.cta.url}` : null,
    opciones.cierre ? `\n${opciones.cierre.replace(/<[^>]+>/g, "")}` : null,
    "\n—\nMaderera Juan B. Justo · Mar del Plata\nCasa Central (0223) 474-3328 · Aserradero (0223) 483-0535",
  ]
    .filter((linea) => linea !== null)
    .join("\n");

  return { html, texto };
}

/* -------------------------------------------------------------------------- */
/* Plantillas por evento                                                       */
/* -------------------------------------------------------------------------- */

export interface CorreoArmado {
  asunto: string;
  html: string;
  texto: string;
}

export function pedidoRecibido(datos: {
  nombre: string;
  numero: string;
  token: string;
  total: number | string;
  entrega: string;
  lineas: LineaCorreo[];
  medioPago: string;
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: `Recibimos tu pedido ${datos.numero}`,
    adelanto: `Tu pedido ${datos.numero} quedó registrado.`,
    saludo: datos.nombre,
    parrafos: [
      "Ya lo tenemos. Lo estamos preparando y te vamos a ir avisando en cada paso.",
    ],
    datos: [
      { etiqueta: "Número de pedido", valor: datos.numero },
      { etiqueta: "Entrega", valor: datos.entrega },
      { etiqueta: "Medio de pago", valor: datos.medioPago },
    ],
    lineas: datos.lineas,
    total: datos.total,
    cta: { texto: "Ver el pedido", url: urlAbsolutaDelPedido(datos.numero, datos.token) },
    cierre:
      "Si algo no coincide, contestá este correo o escribinos por WhatsApp y lo corregimos antes de preparar la mercadería.",
  });

  return { asunto: `Pedido ${datos.numero} recibido`, ...cuerpo };
}

const TITULOS_ESTADO: Record<string, { titulo: string; texto: string }> = {
  preparando: {
    titulo: "Estamos preparando tu pedido",
    texto: "Ya lo estamos armando en el depósito.",
  },
  listo: {
    titulo: "Tu pedido está listo",
    texto:
      "Podés pasar a retirarlo en el horario de atención: lunes a viernes de 8 a 16, sábados de 8 a 12.",
  },
  "en-camino": {
    titulo: "Tu pedido salió para la entrega",
    texto: "Va en camino a la dirección que nos diste.",
  },
  entregado: {
    titulo: "Tu pedido fue entregado",
    texto: "Gracias por comprar en Maderera Juan B. Justo.",
  },
  cancelado: {
    titulo: "Tu pedido fue cancelado",
    texto:
      "Si esto no era lo que esperabas, escribinos y lo revisamos: puede haber sido un error nuestro.",
  },
};

export function pedidoCambioDeEstado(datos: {
  nombre: string;
  numero: string;
  token: string;
  estado: string;
  asuntoPersonalizado?: string | null;
  encabezadoPersonalizado?: string | null;
}): CorreoArmado {
  const base = TITULOS_ESTADO[datos.estado] ?? {
    titulo: `Novedades de tu pedido ${datos.numero}`,
    texto: `Tu pedido pasó a estado ${datos.estado}.`,
  };

  const cuerpo = envolver({
    titulo: datos.encabezadoPersonalizado || base.titulo,
    adelanto: base.texto,
    saludo: datos.nombre,
    parrafos: [base.texto],
    datos: [{ etiqueta: "Número de pedido", valor: datos.numero }],
    cta: { texto: "Ver el pedido", url: urlAbsolutaDelPedido(datos.numero, datos.token) },
  });

  return {
    asunto:
      datos.asuntoPersonalizado || `${base.titulo} · ${datos.numero}`,
    ...cuerpo,
  };
}

export function pagoAcreditado(datos: {
  nombre: string;
  monto: number | string;
  medio: string | null;
  referencia: string;
  /** Token del pedido. Null cuando el pago fue a la cuenta corriente. */
  token: string | null;
  esDeuda: boolean;
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: "Recibimos tu pago",
    adelanto: `Acreditamos ${formatearPrecio(datos.monto)}.`,
    saludo: datos.nombre,
    parrafos: [
      datos.esDeuda
        ? "Lo imputamos a tu cuenta corriente. El saldo ya está actualizado."
        : "Tu pedido queda confirmado y pasa a preparación.",
    ],
    datos: [
      { etiqueta: "Importe", valor: formatearPrecio(datos.monto) },
      ...(datos.medio ? [{ etiqueta: "Medio", valor: datos.medio }] : []),
      { etiqueta: "Referencia", valor: datos.referencia },
    ],
    cta:
      datos.esDeuda || !datos.token
        ? { texto: "Ver mi cuenta", url: `${urlBase()}/mi-cuenta/cuenta-corriente` }
        : {
            texto: "Ver el pedido",
            url: urlAbsolutaDelPedido(datos.referencia, datos.token),
          },
  });

  return { asunto: `Pago recibido · ${formatearPrecio(datos.monto)}`, ...cuerpo };
}

export function facturaEmitida(datos: {
  nombre: string;
  comprobante: string;
  total: number | string;
  conCae: boolean;
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: `Tu comprobante ${datos.comprobante}`,
    adelanto: `Adjuntamos el comprobante ${datos.comprobante}.`,
    saludo: datos.nombre,
    parrafos: [
      "Te lo adjuntamos en PDF. También queda disponible en tu cuenta, junto con todos los anteriores.",
      datos.conCae
        ? ""
        : "<strong>Atención:</strong> este comprobante todavía no tiene autorización de ARCA y no tiene validez fiscal. Te enviamos el definitivo apenas se autorice.",
    ].filter(Boolean),
    datos: [
      { etiqueta: "Comprobante", valor: datos.comprobante },
      { etiqueta: "Total", valor: formatearPrecio(datos.total) },
    ],
    cta: {
      texto: "Ver mis comprobantes",
      url: `${urlBase()}/mi-cuenta/comprobantes`,
    },
  });

  return { asunto: `Comprobante ${datos.comprobante}`, ...cuerpo };
}

export function presupuestoListo(datos: {
  nombre: string;
  numero: string;
  total: number | string;
  vence: string | null;
  lineas: LineaCorreo[];
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: `Tu presupuesto ${datos.numero}`,
    adelanto: `Preparamos el presupuesto ${datos.numero}.`,
    saludo: datos.nombre,
    parrafos: [
      "Lo podés aceptar desde tu cuenta y lo convertimos en pedido con estos mismos precios.",
    ],
    datos: [
      { etiqueta: "Presupuesto", valor: datos.numero },
      ...(datos.vence ? [{ etiqueta: "Válido hasta", valor: datos.vence }] : []),
    ],
    lineas: datos.lineas,
    total: datos.total,
    cta: {
      texto: "Ver el presupuesto",
      url: `${urlBase()}/mi-cuenta/presupuestos`,
    },
  });

  return { asunto: `Presupuesto ${datos.numero}`, ...cuerpo };
}

export function pedidoParaFirmar(datos: {
  nombre: string;
  numero: string;
  remito: string;
  url: string;
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: `Firmá el remito ${datos.remito}`,
    adelanto: "Confirmá desde el celular lo que estás retirando.",
    saludo: datos.nombre,
    parrafos: [
      "Abrí este link desde el celular y firmá con el dedo. Reemplaza al remito en papel.",
    ],
    datos: [
      { etiqueta: "Remito", valor: datos.remito },
      { etiqueta: "Pedido", valor: datos.numero },
    ],
    cta: { texto: "Firmar ahora", url: datos.url },
    cierre: "El link deja de servir una vez firmado.",
  });

  return { asunto: `Remito ${datos.remito} para firmar`, ...cuerpo };
}

export function remitoFirmado(datos: {
  nombre: string;
  remito: string;
  numero: string;
  fecha: string;
  lineas: LineaCorreo[];
  pendiente: boolean;
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: `Constancia de entrega ${datos.remito}`,
    adelanto: `Retiraste mercadería del pedido ${datos.numero}.`,
    saludo: datos.nombre,
    parrafos: [
      "Esto es lo que salió, con tu firma registrada.",
      datos.pendiente
        ? "Todavía te queda mercadería en acopio. La podés retirar cuando quieras."
        : "Con esto queda entregado el pedido completo.",
    ],
    datos: [
      { etiqueta: "Remito", valor: datos.remito },
      { etiqueta: "Pedido", valor: datos.numero },
      { etiqueta: "Fecha", valor: datos.fecha },
    ],
    lineas: datos.lineas,
    cta: {
      texto: "Ver el pedido",
      url: `${urlBase()}/mi-cuenta/pedidos/${datos.numero}`,
    },
  });

  return { asunto: `Entrega ${datos.remito} · pedido ${datos.numero}`, ...cuerpo };
}
