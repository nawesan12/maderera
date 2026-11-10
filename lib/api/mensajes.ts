/**
 * Los mensajes de validación, en castellano y con el nombre del campo.
 *
 * La validación de Go copia la de zod del TypeScript para dar las mismas
 * respuestas, y con ella sus mensajes: «Invalid input: expected number,
 * received NaN», sin decir de qué campo. Llegaban así a la pantalla del panel.
 * Se traducen acá, en el único lugar por donde pasan todos los errores hacia
 * la pantalla (`mensajeDe`). Un mensaje que ya está en castellano pasa igual.
 */

const NOMBRES: Record<string, string> = {
  name: "Nombre",
  nombre: "Nombre",
  slug: "Dirección web",
  description: "Descripción",
  brand: "Marca",
  unit: "Unidad",
  sku: "Código",
  label: "Medida",
  precioMediaPct: "Precio de la media placa",
  recargoElaboracionPct: "Recargo por elaboración",
  alicuotaIva: "IVA",
  imputacion: "Imputación contable",
  precioGeneral: "Precio de lista",
  precioProfesional: "Precio profesional",
  largoMm: "Largo",
  anchoMm: "Ancho",
  espesorMm: "Espesor",
  cantidad: "Cantidad",
  variantId: "Placa",
  anchoSierraMm: "Ancho de sierra",
  email: "Correo",
  correo: "Correo",
  telefono: "Teléfono",
  cuit: "CUIT",
  precioPorPasada: "Precio por pasada",
  precioPorMetroCanto: "Precio por metro de canto",
  material: "Material",
  titulo: "Título",
  monto: "Monto",
  importe: "Importe",
  fecha: "Fecha",
};

/** «precioPorPasada» → «Precio por pasada», si no está en la lista. */
function nombreDeCampo(clave: string): string {
  if (NOMBRES[clave]) return NOMBRES[clave];
  const palabras = clave
    .replace(/\[\d+\]/g, "")
    .split(".")
    .pop()!
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return palabras.charAt(0).toUpperCase() + palabras.slice(1);
}

const REGLAS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Invalid input: expected number, received NaN$/, () => "tiene que ser un número"],
  [/^Too small: expected number to be >=?(-?[\d.]+)$/, (m) => `tiene que ser ${m[1].replace(".", ",")} o más`],
  [/^Too small: expected number to be >(-?[\d.]+)$/, (m) => `tiene que ser mayor a ${m[1].replace(".", ",")}`],
  [/^Too big: expected number to be <=?(-?[\d.]+)$/, (m) => `no puede pasar de ${m[1].replace(".", ",")}`],
  [/^Too small: expected string to have >=1 characters?$/, () => "no puede quedar vacío"],
  [/^Too small: expected string to have >=(\d+) characters?$/, (m) => `tiene que tener al menos ${m[1]} letras`],
  [/^Too big: expected string to have <=(\d+) characters?$/, (m) => `no puede pasar de ${m[1]} letras`],
  [/^Too big: expected array to have <=(\d+) items?$/, (m) => `son demasiados (el máximo es ${m[1]})`],
  [/^Too small: expected array to have >=1 items?$/, () => "falta cargar al menos uno"],
  [/^Invalid UUID$/, () => "no es válido"],
  [/^Invalid input: expected \w+, received \w+$/, () => "falta o no es válido"],
  [/^Invalid (email address|input)$/, () => "no es válido"],
];

/**
 * El mensaje de un campo, traducido si hace falta. `campo` es la clave del
 * error (`errores` del problema); también se lee del texto cuando Go lo
 * antepone («anchoSierraMm: Más de 10 mm…»).
 */
export function traducirMensaje(mensaje: string, campo?: string): string {
  let clave = campo;
  let texto = mensaje.trim();
  const prefijo = texto.match(/^([a-zA-Z][\w.[\]]*): (.+)$/);
  if (prefijo) {
    clave = prefijo[1];
    texto = prefijo[2];
  }
  for (const [patron, armar] of REGLAS) {
    const m = texto.match(patron);
    if (m) return clave && clave !== "form" ? `${nombreDeCampo(clave)}: ${armar(m)}.` : `${armar(m)}.`.replace(/^./, (c) => c.toUpperCase());
  }
  // Ya en castellano: si venía con la clave adelante, se cambia por su nombre.
  return prefijo && clave ? `${nombreDeCampo(clave)}: ${texto}` : mensaje;
}
