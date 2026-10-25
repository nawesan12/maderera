// Las etiquetas (palabras clave de IMAP, ver backend/internal/correo/etiquetas.go)
// con su color. Las de siempre traen el suyo; una nueva toma uno fijo según
// el nombre, para que no cambie de un día a otro.

export type Familia = "mar" | "esp" | "inf" | "ok" | "pr" | "ce" | "vio";

export const etiquetasDeSiempre: [string, Familia][] = [
  ["Presupuesto", "mar"],
  ["Pedido abierto", "esp"],
  ["Espera respuesta", "esp"],
  ["Proveedor", "inf"],
  ["Pago", "ok"],
  ["Reclamo", "pr"],
  ["Debe", "pr"],
];

const rueda: Familia[] = ["vio", "inf", "ok", "mar", "esp", "ce"];

export function familiaDe(nombre: string): Familia {
  const fija = etiquetasDeSiempre.find(([n]) => n.toLowerCase() === nombre.toLowerCase());
  if (fija) return fija[1];
  let h = 0;
  for (const ch of nombre.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return rueda[h % rueda.length];
}

/** El color del cuadradito de la etiqueta en el menú. */
export function colorDe(nombre: string): string {
  const f = familiaDe(nombre);
  return f === "vio" ? "oklch(0.6 0.13 300)" : `var(--${f}T)`;
}

/** Las etiquetas creadas en este navegador, para ofrecerlas aunque ningún correo las tenga todavía. */
export function propias(): string[] {
  try {
    return JSON.parse(localStorage.getItem("correo:etiquetas") ?? "[]");
  } catch {
    return [];
  }
}

export function guardarPropia(nombre: string) {
  try {
    const l = [...new Set([...propias(), nombre])].slice(-50);
    localStorage.setItem("correo:etiquetas", JSON.stringify(l));
  } catch {
    // sin almacenamiento
  }
}
