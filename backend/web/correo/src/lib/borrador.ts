// Lo que comparten la ventana de redactar y la respuesta en línea: cómo se
// arma una respuesta o un reenvío desde el original, cómo se separan las
// direcciones y cómo se manda.

import { api, type Direccion, type Mensaje } from "./api";
import type { ModoRedactar } from "./estado.svelte";
import { direccionCompleta, fechaLarga, nombreDe } from "./formato";

export function separar(texto: string): Direccion[] {
  const out: Direccion[] = [];
  for (const trozo of texto.split(/[,;\n]+/)) {
    const t = trozo.trim();
    if (!t) continue;
    const m = t.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (m) out.push({ nombre: m[1].trim() || undefined, correo: m[2].trim().toLowerCase() });
    else out.push({ correo: t.toLowerCase() });
  }
  return out;
}

export const unir = (ds: Direccion[]) => ds.map(direccionCompleta).join(", ");

export const pareceCorreo = (s: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s.trim());

function prefijo(asunto: string, p: string) {
  return new RegExp(`^(${p}|re|rv|fwd?):`, "i").test(asunto.trim()) ? asunto : `${p}: ${asunto}`;
}

export function citar(texto: string) {
  return texto
    .split("\n")
    .map((l) => (l.startsWith(">") ? ">" + l : "> " + l))
    .join("\n");
}

export interface Inicio {
  para: Direccion[];
  cc: Direccion[];
  asunto: string;
  /** Lo que va debajo de lo escrito: la cita o el reenviado. */
  anterior: string;
  /** El encabezado de la cita, para mostrarlo plegado. */
  encabezado: string;
}

/** Los campos de una respuesta, un «a todos» o un reenvío. */
export function iniciar(modo: ModoRedactar, base: Mensaje | undefined, yo: string): Inicio {
  const vacio: Inicio = { para: [], cc: [], asunto: "", anterior: "", encabezado: "" };
  if (!base) return vacio;
  const sinMi = (ds: Direccion[]) => ds.filter((d) => d.correo.toLowerCase() !== yo.toLowerCase());
  const remitente = base.responderA.length ? base.responderA : base.de;
  const encabezado = `El ${fechaLarga(base.fecha)}, ${nombreDe(base.de[0])} escribió:`;
  if (modo === "responder") {
    return { ...vacio, para: remitente, asunto: prefijo(base.asunto, "Re"), anterior: `${encabezado}\n${citar(base.texto)}`, encabezado };
  }
  if (modo === "responder-todos") {
    const para = sinMi([...remitente, ...base.para]).filter((d, i, l) => l.findIndex((x) => x.correo === d.correo) === i);
    return {
      ...vacio,
      para,
      cc: sinMi(base.cc),
      asunto: prefijo(base.asunto, "Re"),
      anterior: `${encabezado}\n${citar(base.texto)}`,
      encabezado,
    };
  }
  if (modo === "reenviar") {
    const encab = "---------- Mensaje reenviado ----------";
    return {
      ...vacio,
      asunto: prefijo(base.asunto, "Rv"),
      anterior: `${encab}\nDe: ${unir(base.de)}\nFecha: ${fechaLarga(base.fecha)}\nAsunto: ${base.asunto}\nPara: ${unir(base.para)}\n\n${base.texto}`,
      encabezado: encab,
    };
  }
  return vacio;
}

// «Te mando adjunto el presupuesto», «va el PDF», «te paso el archivo»: si
// el texto dice algo así y no hay archivos, se avisa antes de mandar (2b).
const reAdjunto = /\b(adjunt[oaé]\w*|te (paso|mando|env[ií]o) (el|la|los|las) (pdf|archivo|planilla|plano|foto|presupuesto|despiece)|va el pdf|attached|attachment)\b/i;

/** La palabra que suena a adjunto, para resaltarla; vacío si no hay. */
export function mencionaAdjunto(texto: string): string {
  // Lo citado no cuenta: el «adjunto» del otro ya vino con su archivo.
  const propio = texto
    .split("\n")
    .filter((l) => !l.startsWith(">"))
    .join("\n");
  return propio.match(reAdjunto)?.[0] ?? "";
}

export interface Envio {
  nombre: string;
  para: Direccion[];
  cc: Direccion[];
  cco: Direccion[];
  asunto: string;
  texto: string;
  archivos: File[];
  modo: ModoRedactar;
  base?: Mensaje;
  carpeta?: string;
}

export function armar(e: Envio): FormData {
  const f = new FormData();
  f.set("nombre", e.nombre.trim());
  f.set("para", unir(e.para));
  f.set("cc", unir(e.cc));
  f.set("cco", unir(e.cco));
  f.set("asunto", e.asunto);
  f.set("texto", e.texto);
  if (e.base && e.modo !== "reenviar") {
    if (e.base.messageId) {
      f.set("enRespuestaA", e.base.messageId);
      f.set("referencias", [...(e.base.referencias ?? []), e.base.messageId].join(" "));
    }
    f.set("carpeta", e.carpeta ?? "");
    f.set("uid", String(e.base.uid));
  }
  for (const a of e.archivos) f.append("adjuntos", a, a.name);
  return f;
}

/** Los adjuntos del original, bajados para volver a mandarlos (reenviar). */
export async function traerAdjuntos(base: Mensaje, carpeta: string): Promise<File[]> {
  const lista = base.adjuntos.filter((a) => !a.bloqueado && !a.enLinea);
  return Promise.all(
    lista.map(async (a) => {
      const r = await fetch(api.urlAdjunto(carpeta, base.uid, a.indice));
      if (!r.ok) throw new Error();
      return new File([await r.blob()], a.nombre, { type: a.tipo });
    }),
  );
}

export const TOPE_ADJUNTOS = 18 * 1024 * 1024;
