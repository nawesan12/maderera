// @ts-nocheck: copiado tal cual de git 9a17128, ver ../../README.md.
/**
 * Plantillas de WhatsApp: leer lo que devuelve Meta y armar lo que hay que
 * mandarle.
 *
 * Puro, para poder probarlo y usarlo del lado del navegador (el compositor de
 * la bandeja arma la vista previa con esto mismo).
 *
 * Una plantilla de Meta es una lista de componentes —`HEADER`, `BODY`,
 * `FOOTER`, `BUTTONS`— y cada uno puede tener variables. Las variables son
 * posicionales (`{{1}}`, `{{2}}`) o con nombre (`{{nombre}}`), según cómo se
 * creó la plantilla (`parameter_format`). Al enviarla se mandan **solo los
 * valores**, ordenados por componente; el texto lo arma Meta con lo que
 * aprobó. Por eso la vista previa del panel tiene que salir de los mismos
 * componentes: si se armara aparte, el panel mostraría un texto y el cliente
 * leería otro.
 */

export type FormatoParametros = "POSITIONAL" | "NAMED";

export interface ComponenteMeta {
  type?: string;
  format?: string;
  text?: string;
  example?: {
    header_text?: string[];
    header_text_named_params?: { param_name: string; example: string }[];
    body_text?: string[][];
    body_text_named_params?: { param_name: string; example: string }[];
    header_handle?: string[];
  };
  buttons?: {
    type?: string;
    text?: string;
    url?: string;
    phone_number?: string;
    example?: string[];
  }[];
}

export type DondeVa = "encabezado" | "cuerpo" | "boton";

/** Un dato a completar antes de mandar la plantilla. */
export interface CampoPlantilla {
  /** Identifica el valor: `cuerpo:1`, `cuerpo:nombre`, `encabezado:media`, `boton:0`. */
  clave: string;
  donde: DondeVa;
  /** `1`, `nombre`, o `media` para el archivo del encabezado. */
  marcador: string;
  ejemplo: string | null;
  /** Encabezado con archivo: qué tipo de archivo pide. */
  media?: "document" | "image" | "video";
  /** Botón de URL con parte variable: su posición entre los botones. */
  indiceBoton?: number;
}

export interface PlantillaLeida {
  nombre: string;
  idioma: string;
  categoria: string | null;
  estado: string;
  formato: FormatoParametros;
  encabezado: string | null;
  /** El encabezado es un archivo (factura, remito) y no texto. */
  encabezadoMedia: "document" | "image" | "video" | null;
  cuerpo: string;
  pie: string | null;
  botones: { tipo: string; texto: string }[];
  campos: CampoPlantilla[];
}

const MARCADOR = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/** Los marcadores de un texto, sin repetir y en el orden en que aparecen. */
export function marcadores(texto: string): string[] {
  const vistos: string[] = [];
  for (const m of texto.matchAll(MARCADOR)) {
    if (!vistos.includes(m[1])) vistos.push(m[1]);
  }
  return vistos;
}

/** Cuántas variables distintas tiene un texto. */
export function contarVariables(texto: string): number {
  return marcadores(texto).length;
}

function mayus(valor: string | undefined): string {
  return (valor ?? "").toUpperCase();
}

/** Lee los componentes de Meta y arma la lista de datos a completar. */
export function leerPlantilla(datos: {
  nombre: string;
  idioma: string;
  categoria?: string | null;
  estado?: string | null;
  formato?: string | null;
  componentes: unknown;
}): PlantillaLeida {
  const componentes = (Array.isArray(datos.componentes) ? datos.componentes : []) as ComponenteMeta[];
  const formato: FormatoParametros = mayus(datos.formato ?? undefined) === "NAMED" ? "NAMED" : "POSITIONAL";

  const header = componentes.find((c) => mayus(c.type) === "HEADER");
  const body = componentes.find((c) => mayus(c.type) === "BODY");
  const footer = componentes.find((c) => mayus(c.type) === "FOOTER");
  const buttons = componentes.find((c) => mayus(c.type) === "BUTTONS");

  const campos: CampoPlantilla[] = [];

  let encabezado: string | null = null;
  let encabezadoMedia: PlantillaLeida["encabezadoMedia"] = null;

  if (header) {
    const formatoHeader = mayus(header.format) || "TEXT";
    if (formatoHeader === "TEXT") {
      encabezado = header.text ?? null;
      const ejemplosNombrados = header.example?.header_text_named_params ?? [];
      marcadores(header.text ?? "").forEach((marcador, i) => {
        campos.push({
          clave: `encabezado:${marcador}`,
          donde: "encabezado",
          marcador,
          ejemplo:
            ejemplosNombrados.find((e) => e.param_name === marcador)?.example ??
            header.example?.header_text?.[i] ??
            null,
        });
      });
    } else if (formatoHeader === "DOCUMENT" || formatoHeader === "IMAGE" || formatoHeader === "VIDEO") {
      encabezadoMedia = formatoHeader.toLowerCase() as "document" | "image" | "video";
      campos.push({
        clave: "encabezado:media",
        donde: "encabezado",
        marcador: "media",
        ejemplo: null,
        media: encabezadoMedia,
      });
    }
  }

  const cuerpo = body?.text ?? "";
  const ejemplosCuerpo = body?.example?.body_text_named_params ?? [];
  marcadores(cuerpo).forEach((marcador, i) => {
    campos.push({
      clave: `cuerpo:${marcador}`,
      donde: "cuerpo",
      marcador,
      ejemplo:
        ejemplosCuerpo.find((e) => e.param_name === marcador)?.example ??
        body?.example?.body_text?.[0]?.[i] ??
        null,
    });
  });

  const botones = (buttons?.buttons ?? []).map((b, indice) => {
    // Un botón de URL con `{{1}}` al final: la parte variable se manda al
    // enviar (por ejemplo, el token del seguimiento del pedido).
    if (mayus(b.type) === "URL" && b.url && /\{\{\s*1\s*\}\}/.test(b.url)) {
      campos.push({
        clave: `boton:${indice}`,
        donde: "boton",
        marcador: "1",
        ejemplo: b.example?.[0] ?? null,
        indiceBoton: indice,
      });
    }
    return { tipo: mayus(b.type), texto: b.text ?? "" };
  });

  return {
    nombre: datos.nombre,
    idioma: datos.idioma,
    categoria: datos.categoria ? mayus(datos.categoria) : null,
    estado: mayus(datos.estado ?? "APPROVED"),
    formato,
    encabezado,
    encabezadoMedia,
    cuerpo,
    pie: footer?.text ?? null,
    botones,
    campos,
  };
}

/**
 * Reemplaza los marcadores por los valores, para mostrar.
 *
 * Un marcador sin valor queda a la vista (`{{pedido}}`): mejor que el panel
 * muestre el hueco a que lo tape y se mande igual.
 */
export function completar(texto: string, valores: Record<string, string>): string {
  return texto.replace(MARCADOR, (entero, marcador: string) => {
    const valor = valores[marcador];
    return valor && valor.trim() ? valor : entero;
  });
}

/** El texto que va a leer el cliente, con encabezado y pie. */
export function vistaPrevia(plantilla: PlantillaLeida, valores: Record<string, string>): string {
  const de = (donde: DondeVa) =>
    Object.fromEntries(
      plantilla.campos
        .filter((c) => c.donde === donde)
        .map((c) => [c.marcador, valores[c.clave] ?? ""]),
    );

  return [
    plantilla.encabezado ? completar(plantilla.encabezado, de("encabezado")) : null,
    completar(plantilla.cuerpo, de("cuerpo")),
    plantilla.pie,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Los datos que faltan completar (el archivo del encabezado no se cuenta acá). */
export function camposFaltantes(plantilla: PlantillaLeida, valores: Record<string, string>): CampoPlantilla[] {
  return plantilla.campos.filter((c) => c.marcador !== "media" && !(valores[c.clave] ?? "").trim());
}

/**
 * Un valor tal como lo acepta Meta: sin saltos de línea ni tabulaciones, sin
 * más de tres espacios seguidos (si no, rechaza el envío con 132018) y con un
 * largo razonable. Una dirección copiada de la ficha con un Enter adentro es el
 * caso típico.
 */
export function valorParaMeta(valor: string | undefined): string {
  return (valor ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim()
    .slice(0, 1000);
}

/** El archivo del encabezado, ya subido a Meta o con un link que Meta pueda bajar. */
export type MediaDeEncabezado = { id: string; nombre?: string | null } | { link: string; nombre?: string | null };

/**
 * Los `components` del envío, en la forma que pide la Cloud API.
 *
 * Con parámetros con nombre cada valor lleva su `parameter_name`; con
 * posicionales van en el orden del texto. Meta rechaza el envío entero
 * (132000) si sobra o falta uno, así que se manda exactamente lo que la
 * plantilla declara.
 */
export function armarComponentes(
  plantilla: PlantillaLeida,
  valores: Record<string, string>,
  media?: MediaDeEncabezado | null,
): Record<string, unknown>[] {
  const componentes: Record<string, unknown>[] = [];
  const conNombre = plantilla.formato === "NAMED";

  const parametro = (campo: CampoPlantilla) => ({
    type: "text",
    ...(conNombre ? { parameter_name: campo.marcador } : {}),
    text: valorParaMeta(valores[campo.clave]),
  });

  const deEncabezado = plantilla.campos.filter((c) => c.donde === "encabezado");
  if (plantilla.encabezadoMedia && media) {
    const tipo = plantilla.encabezadoMedia;
    const objeto: Record<string, unknown> = "id" in media ? { id: media.id } : { link: media.link };
    if (tipo === "document" && media.nombre) objeto.filename = media.nombre;
    componentes.push({ type: "header", parameters: [{ type: tipo, [tipo]: objeto }] });
  } else if (deEncabezado.length > 0 && !plantilla.encabezadoMedia) {
    componentes.push({ type: "header", parameters: deEncabezado.map(parametro) });
  }

  const deCuerpo = plantilla.campos.filter((c) => c.donde === "cuerpo");
  if (deCuerpo.length > 0) {
    componentes.push({ type: "body", parameters: deCuerpo.map(parametro) });
  }

  for (const campo of plantilla.campos.filter((c) => c.donde === "boton")) {
    componentes.push({
      type: "button",
      sub_type: "url",
      index: String(campo.indiceBoton ?? 0),
      parameters: [{ type: "text", text: valorParaMeta(valores[campo.clave]) }],
    });
  }

  return componentes;
}

/**
 * Sugiere valores para los campos a partir de lo que ya se sabe.
 *
 * Las plantillas propias usan nombres que dicen qué va (`nombre`, `pedido`,
 * `sucursal`); para las posicionales se sigue el orden de siempre —primero el
 * nombre, después el comprobante, después la sucursal—, que es como están
 * escritas las que se cargaron antes de que Meta aceptara nombres.
 */
export function sugerirValores(
  plantilla: PlantillaLeida,
  conocidos: Record<string, string>,
  ordenPosicional: string[] = ["nombre", "pedido", "sucursal"],
): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const campo of plantilla.campos) {
    if (campo.marcador === "media") continue;
    if (campo.donde === "boton") {
      if (conocidos.boton) valores[campo.clave] = conocidos.boton;
      continue;
    }
    const porNombre = conocidos[campo.marcador];
    if (porNombre !== undefined) {
      valores[campo.clave] = porNombre;
      continue;
    }
    const posicion = Number(campo.marcador);
    if (Number.isInteger(posicion) && posicion > 0) {
      const nombre = ordenPosicional[posicion - 1];
      if (nombre && conocidos[nombre] !== undefined) valores[campo.clave] = conocidos[nombre];
    }
  }
  return valores;
}

/** Nombre de la plantilla para mostrar: «pedido_listo» → «Pedido listo». */
export function nombreLegible(nombre: string): string {
  const texto = nombre.replace(/_/g, " ").trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
