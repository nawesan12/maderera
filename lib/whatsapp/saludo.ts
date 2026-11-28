/**
 * Cómo se nombra a alguien en «Hola …,».
 *
 * A una persona, por el primer nombre; a una empresa, por el nombre entero
 * sin la forma societaria: «Hola Carpintería,» salía de «Carpintería Prueba
 * SRL» (mes simulado). Espejo de backend/internal/whatsapp/saludo.go.
 */

const FORMAS_SOCIETARIAS = new Set(["srl", "sa", "sas", "sau", "sh", "sca", "scs", "sc", "ltda", "coop", "saic", "saci"]);

const RUBROS = new Set([
  "carpinteria", "maderera", "maderas", "constructora", "construcciones", "corralon", "aberturas", "muebles",
  "amoblamientos", "ferreteria", "herreria", "taller", "fabrica", "distribuidora", "comercial", "grupo",
  "industrias", "estudio", "inmobiliaria", "empresa", "obras", "cooperativa", "aserradero", "metalurgica",
  // Del mes simulado: «Hola Sim» a «Sim Mueblería Atlántica» y a «Sim Obra Barrio Parque».
  "muebleria", "obra", "barraca", "pintureria", "vivero", "techos", "estructuras", "arquitectura", "viviendas",
  "desarrollos",
  // Del recorrido (M4-106): «Hola Sim» a «Sim Club Náutico Sur Asociación Civil» y a «Sim Escuela Técnica 5».
  "club", "asociacion", "fundacion", "escuela", "colegio", "instituto",
]);

function clave(palabra: string): string {
  return palabra
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/^[,;]+|[,;]+$/g, "");
}

/** Vacío si no hay nombre. `primera` decide cómo se toma el de una persona. */
export function nombreDeSaludo(nombre: string | null | undefined, primera: (n: string) => string = (n) => n.trim().split(/\s+/)[0] ?? ""): string {
  const palabras = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return "";
  let corte = palabras.length;
  for (let i = 1; i < palabras.length; i++) {
    // «Asociación Civil» cierra la razón social como una sociedad.
    const civil = clave(palabras[i]) === "asociacion" && clave(palabras[i + 1] ?? "") === "civil";
    if (FORMAS_SOCIETARIAS.has(clave(palabras[i])) || civil) {
      corte = i;
      break;
    }
  }
  if (corte === palabras.length && !esNegocio(palabras)) return primera(nombre ?? "");
  return palabras.slice(0, corte).join(" ").replace(/[,;]+$/, "");
}

/**
 * El rubro va primero («Carpintería Ferreyra»), o segundo o tercero detrás de
 * una sigla o un apodo, con algo después («Sim V1at Carpintería Ruiz»: el mes
 * 23 saludaba «Hola Sim»).
 */
function esNegocio(palabras: string[]): boolean {
  if (RUBROS.has(clave(palabras[0]))) return true;
  for (let i = 1; i <= 2 && i < palabras.length - 1; i++) if (RUBROS.has(clave(palabras[i]))) return true;
  return false;
}
