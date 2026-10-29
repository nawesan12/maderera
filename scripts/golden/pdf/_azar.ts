/**
 * Azar con semilla y textos de prueba para los golden de PDF. Cada archivo
 * de casos arma su propio generador con su semilla, así agregar casos a un
 * documento no cambia los de otro.
 */

export function azarCon(semilla: number) {
  let a = semilla >>> 0;
  const azar = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const entero = (n: number) => Math.floor(azar() * n);
  const elegir = <T>(xs: readonly T[]): T => xs[entero(xs.length)];
  const palabras = (n: number) => Array.from({ length: n }, () => elegir(PALABRAS)).join(" ");
  return { azar, entero, elegir, palabras };
}

/** Palabras con todo lo que puede romper: tildes, eñes, comillas, rayas, emoji. */
export const PALABRAS = [
  "machimbre", "pino", "eucalipto", "álamo", "fenólico", "melamina", "aglomerado",
  "tirante", "listón", "zócalo", "moldura", "cepillado", "seco", "en", "de", "con",
  "terciado", "MDF", "OSB", "18mm", "3\"", "1/2\"", "x", "2,75", "m²", "ñandubay",
  "“premium”", "—", "–", "…", "cañería", "güira", "pingüino", "Ñ", "ÁÉÍÓÚ", "çà",
  "😀", "€", "™", "•", "kilo", "placa", "puerta", "marco", "barniz", "cola", "sin",
  "tratamiento", "impregnado", "CCA", "SUPERLARGOSINESPACIOSQUENOENTRAENNINGUNRENGLONNIPORCASUALIDAD",
  "Lapacho", "Cedro", "Viraró", "Paraíso", "Kiri", "1.234", "x3,05m", "tablas", "a", "la",
] as const;

export const EMISOR = {
  razonSocial: "Maderera Juan B. Justo S.R.L.",
  nombreFantasia: "MJBJ · Maderas y placas",
  domicilio: "Av. Juan B. Justo 5678, C1416 CABA",
  cuit: "30-71234567-8",
};

export const EMISOR_LARGO = {
  razonSocial: "Maderera y Corralón Juan Bautista Justo Sociedad de Responsabilidad Limitada — Casa Central",
  nombreFantasia: "",
  domicilio: "Avenida Juan Bautista Justo 12.345, Piso 3º, Oficina «B», Villa Santa Rita, Ciudad Autónoma de Buenos Aires",
  cuit: "",
};
