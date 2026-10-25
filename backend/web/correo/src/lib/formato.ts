import type { Direccion } from "./api";
import type { NombreIcono } from "../componentes/Icono.svelte";

const hora = new Intl.DateTimeFormat("es-AR", { hour: "numeric", minute: "2-digit", hourCycle: "h23" });
const diaMes = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });
const conAnio = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" });
const diaSemana = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short" });
const completa = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

function inicioDelDia(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** La fecha de una fila: la hora si es de hoy o de ayer (van bajo su grupo), el día si es de antes. */
export function fechaCorta(iso: string, ahora = new Date()): string {
  const d = new Date(iso);
  const hoy = inicioDelDia(ahora);
  const ayer = new Date(hoy.getTime() - 864e5);
  if (d >= ayer) return hora.format(d);
  if (d.getFullYear() === ahora.getFullYear()) return diaMes.format(d).replace(".", "");
  return conAnio.format(d).replace(".", "");
}

/** El grupo de la lista en que cae una fecha: «Hoy», «Ayer», «Esta semana» o «Antes». */
export function grupoDeFecha(iso: string, ahora = new Date()): string {
  const d = new Date(iso);
  const hoy = inicioDelDia(ahora);
  if (d >= hoy) return "Hoy";
  if (d >= new Date(hoy.getTime() - 864e5)) return "Ayer";
  if (d >= new Date(hoy.getTime() - 6 * 864e5)) return "Esta semana";
  return "Antes";
}

/** Para la cabecera del mensaje: «Hoy, 9:42», «Ayer, 18:04» o «vie 17 oct, 9:42». */
export function fechaDelMensaje(iso: string, ahora = new Date()): string {
  const d = new Date(iso);
  const g = grupoDeFecha(iso, ahora);
  if (g === "Hoy" || g === "Ayer") return `${g}, ${hora.format(d)}`;
  return `${diaSemana.format(d).replace(/\./g, "")}, ${hora.format(d)}`;
}

export function fechaLarga(iso: string): string {
  return completa.format(new Date(iso));
}

export function tamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
}

export function nombreDe(d?: Direccion): string {
  if (!d) return "(sin remitente)";
  return d.nombre?.trim().replace(/^["']|["']$/g, "") || d.correo;
}

export function direccionCompleta(d: Direccion): string {
  return d.nombre ? `${d.nombre} <${d.correo}>` : d.correo;
}

const palabrasVacias = new Set(["de", "del", "la", "el", "los", "las", "y", "arq.", "ing.", "dr.", "dra.", "sr.", "sra."]);

/**
 * Las iniciales del avatar: dos si hay nombre y apellido («CP» de
 * Carpintería Pérez, «CM» de Arq. Carolina Méndez), una si no («F» de
 * Faplac). Los títulos y los «de» no cuentan.
 */
export function iniciales(d?: Direccion): string {
  const n = nombreDe(d).replace(/^["'\s]+/, "");
  if (n.includes("@")) return (n[0] ?? "?").toUpperCase();
  const palabras = n.split(/\s+/).filter((p) => p && !palabrasVacias.has(p.toLowerCase()) && /^\p{L}/u.test(p));
  if (palabras.length >= 2) return (palabras[0][0] + palabras[1][0]).toUpperCase();
  return (palabras[0]?.[0] ?? n[0] ?? "?").toUpperCase();
}

/** Lo que muestra cada tipo de adjunto: ícono, color y cómo se llama. */
export function tipoDeAdjunto(tipo: string, nombre: string): { icono: NombreIcono; color: string; clase: string } {
  const t = tipo.toLowerCase();
  const ext = nombre.toLowerCase().split(".").pop() ?? "";
  if (t === "application/pdf" || ext === "pdf") return { icono: "pdf", color: "var(--prT)", clase: "PDF" };
  if (t.startsWith("image/")) return { icono: "imagen", color: "var(--infT)", clase: "Foto" };
  if (/sheet|excel|csv/.test(t) || ["xlsx", "xls", "csv", "ods"].includes(ext))
    return { icono: "planilla", color: "var(--okT)", clase: "Planilla" };
  if (/word|document|text/.test(t) || ["doc", "docx", "odt", "txt"].includes(ext))
    return { icono: "pdf", color: "var(--infT)", clase: "Documento" };
  return { icono: "clip", color: "var(--mut)", clase: "Archivo" };
}

/** Cómo se dice el número: «1 adjunto», «3 adjuntos». */
export function cuantos(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}
