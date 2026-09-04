import "server-only";

import { XMLParser } from "fast-xml-parser";
import { db } from "@/lib/db";
import { arcaLog } from "@/lib/db/schema";
import { esRectificativo } from "../notas";
import {
  CODIGO_COMPROBANTE,
  desdeFechaArca,
  documentoReceptor,
  fechaArca,
  CONDICION_IVA_RECEPTOR,
  type TipoComprobante,
} from "../comprobantes";
import { CODIGO_ALICUOTA_ARCA } from "../impuestos";
import { configArca, faltaParaArca } from "./config-arca";
import { ticketDeAcceso } from "./wsaa";
import type {
  ComprobanteAAutorizar,
  EstadoProveedorFiscal,
  ProveedorFiscal,
  ResultadoAutorizacion,
} from "./tipos";

/**
 * WSFEv1: emisión de comprobantes electrónicos.
 *
 * Se habla SOAP por `fetch`, sin librería de SOAP: los tres métodos que se usan
 * tienen un cuerpo simple y armarlo a mano evita arrastrar una dependencia
 * pesada y desactualizada para generar un XML de veinte líneas.
 *
 * Reglas que ARCA impone y que están reflejadas acá:
 *
 * - Los importes van con dos decimales y **tienen que cerrar exactamente**:
 *   `ImpTotal = ImpNeto + ImpIVA + ImpTrib + ImpOpEx`. Un centavo de
 *   diferencia y el comprobante se rechaza.
 * - En factura C no se informa IVA: el monotributista no lo discrimina, y
 *   mandar el array hace que rechace.
 * - Una nota de crédito lleva el comprobante asociado.
 * - `CondicionIVAReceptorId` es obligatorio desde abril de 2026.
 */

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
});

const TIMEOUT_MS = 25_000;

/** Escapa lo que se interpola en el XML. Los nombres traen "&" y comillas. */
function xml(valor: string | number): string {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Dos decimales, como los quiere ARCA: "1234.56". */
function importe(valor: number): string {
  return valor.toFixed(2);
}

async function llamar(
  metodo: string,
  cuerpo: string,
  invoiceId?: string,
): Promise<Record<string, unknown>> {
  const config = configArca();
  if (!config) throw new Error("ARCA no está configurado.");

  const sobre = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soap:Body>
    <ar:${metodo}>
${cuerpo}
    </ar:${metodo}>
  </soap:Body>
</soap:Envelope>`;

  let textoRespuesta = "";
  let exito = false;

  try {
    const respuesta = await fetch(config.urlWsfe, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `http://ar.gov.afip.dif.FEV1/${metodo}`,
      },
      body: sobre,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    textoRespuesta = await respuesta.text();
    exito = respuesta.ok;

    if (!respuesta.ok) {
      throw new Error(`ARCA respondió ${respuesta.status}`);
    }

    const parseado = parser.parse(textoRespuesta);
    return parseado?.Envelope?.Body ?? {};
  } finally {
    // Cada llamada queda registrada, salga bien o mal. Es documentación fiscal:
    // cuando aparece una diferencia, esto es lo único que permite reconstruir
    // qué se envió y qué contestaron.
    await db
      .insert(arcaLog)
      .values({
        invoiceId: invoiceId ?? null,
        operacion: metodo,
        ambiente: config.ambiente,
        exito,
        solicitud: sobre.slice(0, 20_000),
        respuesta: textoRespuesta.slice(0, 20_000),
      })
      .catch(() => {
        // Si ni siquiera se puede registrar, no se rompe la emisión por eso.
      });
  }
}

/** Encabezado de autenticación que llevan todos los métodos. */
async function auth(): Promise<string> {
  const config = configArca()!;
  const ticket = await ticketDeAcceso("wsfe");

  return `      <ar:Auth>
        <ar:Token>${ticket.token}</ar:Token>
        <ar:Sign>${ticket.sign}</ar:Sign>
        <ar:Cuit>${config.cuit}</ar:Cuit>
      </ar:Auth>`;
}

/** Junta los mensajes de Errors y Observaciones en un texto legible. */
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

export const proveedorArca: ProveedorFiscal = {
  id: "arca",

  async estado(): Promise<EstadoProveedorFiscal> {
    const config = configArca();

    if (!config) {
      return {
        id: "arca",
        operativo: false,
        ambiente: null,
        cuit: null,
        detalle: faltaParaArca(),
        servicioArriba: null,
      };
    }

    // `FEDummy` es el ping de ARCA: no necesita ticket y dice si el servicio
    // está en pie. Sirve para distinguir "está caído ARCA" de "algo está mal
    // configurado acá", que es la primera pregunta cuando falla una emisión.
    let servicioArriba: boolean | null = null;

    try {
      const cuerpo = await llamar("FEDummy", "");
      const dummy = (cuerpo?.FEDummyResponse as Record<string, unknown>)
        ?.FEDummyResult as Record<string, unknown> | undefined;
      servicioArriba =
        dummy?.AppServer === "OK" &&
        dummy?.DbServer === "OK" &&
        dummy?.AuthServer === "OK";
    } catch {
      servicioArriba = false;
    }

    return {
      id: "arca",
      operativo: servicioArriba !== false,
      ambiente: config.ambiente,
      cuit: config.cuit,
      detalle:
        servicioArriba === false
          ? "Los servicios de ARCA no están respondiendo en este momento."
          : config.ambiente === "homologacion"
            ? "Conectado al ambiente de homologación: los comprobantes son de prueba y no tienen valor fiscal."
            : null,
      servicioArriba,
    };
  },

  async ultimoAutorizado(
    puntoVenta: number,
    tipo: TipoComprobante,
  ): Promise<number | null> {
    try {
      const cuerpo = await llamar(
        "FECompUltimoAutorizado",
        `${await auth()}
      <ar:PtoVta>${puntoVenta}</ar:PtoVta>
      <ar:CbteTipo>${CODIGO_COMPROBANTE[tipo]}</ar:CbteTipo>`,
      );

      const resultado = (
        cuerpo?.FECompUltimoAutorizadoResponse as Record<string, unknown>
      )?.FECompUltimoAutorizadoResult as Record<string, unknown> | undefined;

      const numero = resultado?.CbteNro;
      return numero !== undefined ? Number(numero) : null;
    } catch {
      return null;
    }
  },

  async autorizar(
    comprobante: ComprobanteAAutorizar,
  ): Promise<ResultadoAutorizacion> {
    const config = configArca();
    if (!config) {
      return { autorizado: false, error: faltaParaArca() ?? "ARCA no configurado." };
    }

    const codigo = CODIGO_COMPROBANTE[comprobante.tipo];
    const doc = documentoReceptor(comprobante.receptorCuit);
    const esC = comprobante.tipo.endsWith("_c");

    // En factura C el IVA no se informa y el neto es el total: el
    // monotributista no discrimina. Mandar el array de IVA hace que rechace.
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

    /*
     * Todo comprobante rectificativo tiene que decir cuál corrige.
     *
     * **Acá había un bug:** el filtro era `esNotaDeCredito`, así que una nota
     * de débito salía sin `CbtesAsoc` y ARCA la rechaza. `esRectificativo`
     * cubre las dos, y `tests/notas.test.ts` fija que sea más amplio que el
     * predicado de nota de crédito para que no vuelvan a coincidir.
     */
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

    const cuerpo = `${await auth()}
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

    try {
      const respuesta = await llamar("FECAESolicitar", cuerpo);

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
        // Un comprobante puede quedar aprobado y traer observaciones: se
        // guardan igual porque suelen avisar de algo a corregir.
        observaciones,
      };
    } catch (error) {
      return {
        autorizado: false,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo conectar con ARCA.",
      };
    }
  },
};
