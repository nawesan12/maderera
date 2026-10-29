// Copias textuales de lib/fiscal (56ef2a1), que se borró al mudarse a Go
// (backend/internal/fiscal): el armado del XML de arca.ts y wsaa.ts, la lectura
// de las respuestas, las cuentas de emitir.ts y la clave del candado de
// numeracion.ts. Lo único que cambia es que quedan separadas de la red y de la
// base (el ticket, la configuración y la respuesta llegan por parámetro): el
// texto de cada plantilla y de cada cuenta es el mismo. Las corre el golden
// (scripts/golden/fiscal.ts).
import { XMLParser } from "fast-xml-parser";
import { esRectificativo } from "./fiscal-notas";
import {
  CODIGO_COMPROBANTE,
  desdeFechaArca,
  documentoReceptor,
  fechaArca,
  CONDICION_IVA_RECEPTOR,
  type TipoComprobante,
} from "../../../lib/fiscal/comprobantes";
import { calcularTotales, CODIGO_ALICUOTA_ARCA, redondear } from "../../../lib/fiscal/impuestos";
import { lineasDeLaNota, prorratearTributos, revisarAcreditacion, type CantidadAAcreditar, type ItemOriginal } from "./fiscal-notas";

/* ------------------------------ arca.ts ------------------------------ */

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
});

function xml(valor: string | number): string {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function importe(valor: number): string {
  return valor.toFixed(2);
}

export function sobre(metodo: string, cuerpo: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:${metodo}>
${cuerpo}
    </ar:${metodo}>
  </soap:Body>
</soap:Envelope>`;
}

/** El `parser.parse(textoRespuesta)?.Envelope?.Body ?? {}` de llamar(). */
export function cuerpoDe(textoRespuesta: string): Record<string, unknown> {
  const parseado = parser.parse(textoRespuesta);
  return parseado?.Envelope?.Body ?? {};
}

export function auth(ticket: { token: string; sign: string }, cuit: string): string {
  return `      <ar:Auth>
        <ar:Token>${ticket.token}</ar:Token>
        <ar:Sign>${ticket.sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>`;
}

function mensajesDe(nodo: unknown): string | undefined {
  if (!nodo || typeof nodo !== "object") return undefined;

  const contenedor = nodo as Record<string, unknown>;
  const salida: string[] = [];

  for (const clave of ["Err", "Obs", "Evt"]) {
    const valor = contenedor[clave];
    const lista = Array.isArray(valor) ? valor : valor ? [valor] : [];

    for (const item of lista as Record<string, unknown>[]) {
      const codigo = item?.Code ?? item?.Codigo ?? "";
      const mensaje = item?.Msg ?? item?.Mensaje ?? "";
      if (mensaje) salida.push(`${codigo ? `[${codigo}] ` : ""}${mensaje}`);
    }
  }

  return salida.length > 0 ? salida.join(" · ") : undefined;
}

export interface ComprobanteAAutorizar {
  tipo: TipoComprobante;
  puntoVenta: number;
  numero: number;
  fechaEmision: Date;
  receptorCuit: string | null;
  receptorCondicionIva: "responsable_inscripto" | "monotributista" | "exento" | "consumidor_final" | "no_categorizado";
  neto: number;
  exento: number;
  iva: { alicuota: number; base: number; importe: number }[];
  tributos: { codigo: string; descripcion: string; base: number; alicuota: number; importe: number }[];
  total: number;
  asociado?: { tipo: TipoComprobante; puntoVenta: number; numero: number; fecha: Date } | null;
}

/** El cuerpo que armaba autorizar() antes de llamar a FECAESolicitar. */
export function cuerpoAutorizar(comprobante: ComprobanteAAutorizar, config: { cuit: string }, encabezado: string): string {
    const codigo = CODIGO_COMPROBANTE[comprobante.tipo];
    const doc = documentoReceptor(comprobante.receptorCuit);
    const esC = comprobante.tipo.endsWith("_c");

    const neto = esC ? comprobante.total : comprobante.neto;
    const totalIva = esC
      ? 0
      : comprobante.iva.reduce((suma, i) => suma + i.importe, 0);
    const totalTributos = comprobante.tributos.reduce(
      (suma, t) => suma + t.importe,
      0,
    );

    const detalleIva =
      esC || comprobante.iva.length === 0
        ? ""
        : `        <ar:Iva>
${comprobante.iva
  .map(
    (i) => `          <ar:AlicIva>
            <ar:Id>${CODIGO_ALICUOTA_ARCA[i.alicuota] ?? 5}</ar:Id>
            <ar:BaseImp>${importe(i.base)}</ar:BaseImp>
            <ar:Importe>${importe(i.importe)}</ar:Importe>
          </ar:AlicIva>`,
  )
  .join("\n")}
        </ar:Iva>`;

    const detalleTributos =
      comprobante.tributos.length === 0
        ? ""
        : `        <ar:Tributos>
${comprobante.tributos
  .map(
    (t) => `          <ar:Tributo>
            <ar:Id>${xml(t.codigo)}</ar:Id>
            <ar:Desc>${xml(t.descripcion)}</ar:Desc>
            <ar:BaseImp>${importe(t.base)}</ar:BaseImp>
            <ar:Alic>${importe(t.alicuota)}</ar:Alic>
            <ar:Importe>${importe(t.importe)}</ar:Importe>
          </ar:Tributo>`,
  )
  .join("\n")}
        </ar:Tributos>`;

    const asociados =
      comprobante.asociado && esRectificativo(comprobante.tipo)
        ? `        <ar:CbtesAsoc>
          <ar:CbteAsoc>
            <ar:Tipo>${CODIGO_COMPROBANTE[comprobante.asociado.tipo]}</ar:Tipo>
            <ar:PtoVta>${comprobante.asociado.puntoVenta}</ar:PtoVta>
            <ar:Nro>${comprobante.asociado.numero}</ar:Nro>
            <ar:Cuit>${config.cuit}</ar:Cuit>
            <ar:CbteFch>${fechaArca(comprobante.asociado.fecha)}</ar:CbteFch>
          </ar:CbteAsoc>
        </ar:CbtesAsoc>`
        : "";

    const fecha = fechaArca(comprobante.fechaEmision);

    const cuerpo = `${encabezado}
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${comprobante.puntoVenta}</ar:PtoVta>
          <ar:CbteTipo>${codigo}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>${doc.tipo}</ar:DocTipo>
            <ar:DocNro>${doc.numero}</ar:DocNro>
            <ar:CbteDesde>${comprobante.numero}</ar:CbteDesde>
            <ar:CbteHasta>${comprobante.numero}</ar:CbteHasta>
            <ar:CbteFch>${fecha}</ar:CbteFch>
            <ar:ImpTotal>${importe(comprobante.total)}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>${importe(neto)}</ar:ImpNeto>
            <ar:ImpOpEx>${importe(comprobante.exento)}</ar:ImpOpEx>
            <ar:ImpTrib>${importe(totalTributos)}</ar:ImpTrib>
            <ar:ImpIVA>${importe(totalIva)}</ar:ImpIVA>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:CondicionIVAReceptorId>${CONDICION_IVA_RECEPTOR[comprobante.receptorCondicionIva]}</ar:CondicionIVAReceptorId>
${asociados}
${detalleTributos}
${detalleIva}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>`;
    return cuerpo;
}

/** El cuerpo de ultimoAutorizado(). */
export function cuerpoUltimo(encabezado: string, puntoVenta: number, tipo: TipoComprobante): string {
  return `${encabezado}
      <ar:PtoVta>${puntoVenta}</ar:PtoVta>
      <ar:CbteTipo>${CODIGO_COMPROBANTE[tipo]}</ar:CbteTipo>`;
}

/** Lo que hacía autorizar() con la respuesta de FECAESolicitar. */
export function interpretarAutorizacion(respuesta: Record<string, unknown>) {
      const resultado = (
        respuesta?.FECAESolicitarResponse as Record<string, unknown>
      )?.FECAESolicitarResult as Record<string, unknown> | undefined;

      const errores = mensajesDe(resultado?.Errors);
      if (errores) return { autorizado: false, observaciones: errores };

      const detalle = (
        (resultado?.FeDetResp as Record<string, unknown>)
          ?.FECAEDetResponse as Record<string, unknown>
      );

      const observaciones = mensajesDe(detalle?.Observaciones);

      if (detalle?.Resultado !== "A" || !detalle?.CAE) {
        return {
          autorizado: false,
          observaciones:
            observaciones ?? "ARCA rechazó el comprobante sin detallar el motivo.",
        };
      }

      return {
        autorizado: true,
        cae: String(detalle.CAE),
        caeVencimiento:
          desdeFechaArca(String(detalle.CAEFchVto ?? "")) ?? undefined,
        observaciones,
      };
}

/** Lo que hacía estado() con la respuesta de FEDummy. */
export function interpretarDummy(cuerpo: Record<string, unknown>): boolean {
  const dummy = (cuerpo?.FEDummyResponse as Record<string, unknown>)
    ?.FEDummyResult as Record<string, unknown> | undefined;
  return (
    dummy?.AppServer === "OK" &&
    dummy?.DbServer === "OK" &&
    dummy?.AuthServer === "OK"
  );
}

/* ------------------------------ wsaa.ts ------------------------------ */

export function armarTra(servicio: string, ahora: number): string {
  const desde = new Date(ahora - 10 * 60_000).toISOString();
  const hasta = new Date(ahora + 12 * 3_600_000).toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(ahora / 1000)}</uniqueId>
    <generationTime>${desde}</generationTime>
    <expirationTime>${hasta}</expirationTime>
  </header>
  <service>${servicio}</service>
</loginTicketRequest>`;
}

export function sobreLoginCms(cms: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desa.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function motivoDeFalla(xml: string): string | null {
  const coincidencia = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
  return coincidencia ? coincidencia[1].trim() : null;
}

/** Lo que hacía pedirTicket() con la respuesta del WSAA (ahora por parámetro). */
export function leerTicket(texto: string, ok: boolean, status: number, ahora: number) {
  if (!ok) {
    throw new Error(motivoDeFalla(texto) ?? `WSAA respondió ${status}`);
  }

  const sobreParseado = parser.parse(texto);
  const contenido =
    sobreParseado?.Envelope?.Body?.loginCmsResponse?.loginCmsReturn;

  if (typeof contenido !== "string") {
    throw new Error(motivoDeFalla(texto) ?? "WSAA devolvió una respuesta que no se pudo leer.");
  }

  const ticket = parser.parse(contenido);
  const credenciales = ticket?.loginTicketResponse?.credentials;
  const expira = ticket?.loginTicketResponse?.header?.expirationTime;

  if (!credenciales?.token || !credenciales?.sign) {
    throw new Error("El ticket de ARCA vino sin token.");
  }

  return {
    token: String(credenciales.token),
    sign: String(credenciales.sign),
    expira: expira ? new Date(String(expira)) : new Date(ahora + 11 * 3_600_000),
  };
}

/* ----------------------------- emitir.ts ----------------------------- */

type Linea = {
  descripcion: string;
  unidad?: string;
  cantidad: number;
  precioFinalUnitario: number;
  alicuota?: number;
};
type TributoDado = { codigo: string; descripcion: string; base: number; alicuota: number; importe: number };

/** Las cuentas de emitirEnTransaccion: totales, percepción y total. */
export function importesDeEmision(
  lineas: Linea[],
  tributosDados: TributoDado[] | undefined,
  config: { percibeIibb: boolean; alicuotaPercepcionIibb: string },
) {
  const datos = { lineas, tributosDados };
  const totales = calcularTotales(datos.lineas);

  const tributos: TributoDado[] = [];

  const alicuotaIibb = Number(config.alicuotaPercepcionIibb);

  if (datos.tributosDados) {
    tributos.push(...datos.tributosDados);
  } else if (config.percibeIibb && alicuotaIibb > 0) {
    const importePercepcion = redondear((totales.neto * alicuotaIibb) / 100);
    if (importePercepcion > 0) {
      tributos.push({
        codigo: "02",
        descripcion: "Percepción Ingresos Brutos",
        base: totales.neto,
        alicuota: alicuotaIibb,
        importe: importePercepcion,
      });
    }
  }

  const totalTributos = redondear(
    tributos.reduce((suma, t) => suma + t.importe, 0),
  );
  const total = redondear(totales.total + totalTributos);

  const iva21 = totales.ivaPorAlicuota.get(21)?.importe ?? 0;
  const iva105 = totales.ivaPorAlicuota.get(10.5)?.importe ?? 0;
  const iva27 = totales.ivaPorAlicuota.get(27)?.importe ?? 0;

  return { totales, tributos, totalTributos, total, iva21, iva105, iva27 };
}

/** Las cuentas de emitirNotaDeCredito, antes de emitir. */
export function calculoDeNota(
  original: { neto: string; iva21: string; iva105: string; iva27: string; exento: string; total: string; acreditado: string },
  items: ItemOriginal[],
  parciales: CantidadAAcreditar[] | null,
  tributosOriginales: TributoDado[],
) {
      let lineas;
      try {
        lineas = lineasDeLaNota(items, parciales);
      } catch (error) {
        return {
          error:
            error instanceof Error ? error.message : "No se pudo armar la nota.",
        };
      }

      if (lineas.length === 0) {
        return { error: "No hay nada que acreditar." };
      }

      const netoDeLaNota = redondear(
        lineas.reduce((t, l) => t + l.cantidad * l.precioFinalUnitario, 0),
      );

      const baseOriginal =
        Number(original.neto) +
        Number(original.iva21) +
        Number(original.iva105) +
        Number(original.iva27) +
        Number(original.exento);

      const proporcion =
        baseOriginal > 0 ? Math.min(1, netoDeLaNota / baseOriginal) : 1;

      const tributosDados = prorratearTributos(tributosOriginales, proporcion);

      const totalDeLaNota = redondear(
        netoDeLaNota + tributosDados.reduce((t, x) => t + x.importe, 0),
      );

      const problema = revisarAcreditacion(
        Number(original.total),
        Number(original.acreditado),
        totalDeLaNota,
      );
      return { lineas, netoDeLaNota, proporcion, tributosDados, totalDeLaNota, problema };
}

/** El total de una nota de débito (lo que se suma a `debitado`). */
export function totalDebitado(lineas: Linea[]): number {
  return redondear(lineas.reduce((t, l) => t + l.cantidad * l.precioFinalUnitario, 0));
}

/* --------------------------- numeracion.ts --------------------------- */

export function claveDeLock(puntoVenta: number, tipo: string): number {
  let hash = 5381;
  for (const caracter of tipo) {
    hash = (hash * 33) ^ caracter.charCodeAt(0);
  }
  return Math.abs((hash >>> 0) % 1_000_000) * 10_000 + (puntoVenta % 10_000);
}
