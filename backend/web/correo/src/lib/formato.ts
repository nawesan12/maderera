import type { Direccion } from "./api";

const hora = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const diaMes = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });
const conAnio = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" });
const completa = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** La fecha de una fila: la hora si es de hoy, «ayer», el día si es de este año. */
export function fechaCorta(iso: string, ahora = new Date()): string {
  const d = new Date(iso);
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  if (d >= hoy) return hora.format(d);
  const ayer = new Date(hoy.getTime() - 864e5);
  if (d >= ayer) return "ayer";
  if (d.getFullYear() === ahora.getFullYear()) return diaMes.format(d).replace(".", "");
  return conAnio.format(d).replace(".", "");
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
  return d.nombre?.trim() || d.correo;
}

export function direccionCompleta(d: Direccion): string {
  return d.nombre ? `${d.nombre} <${d.correo}>` : d.correo;
}

/** La inicial para el avatar. */
export function inicial(d?: Direccion): string {
  const n = nombreDe(d).replace(/^["'\s]+/, "");
  return (n[0] ?? "?").toUpperCase();
}

/** Un color estable por persona (nombre y dirección), de la paleta cálida. */
export function colorDe(d?: Direccion): string {
  let h = 0;
  for (const ch of nombreDe(d) + (d?.correo ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tonos = [48, 148, 25, 200, 80, 300, 170, 260];
  return `oklch(0.62 0.13 ${tonos[h % tonos.length]})`;
}
