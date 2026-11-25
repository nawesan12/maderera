// @ts-nocheck: copiado tal cual de git 9a17128, ver ../../README.md.
/**
 * Números de teléfono, de como los tipea la gente a como los quiere WhatsApp.
 *
 * Sin `server-only` y sin base: lo usan la ingesta, los avisos, la bandeja del
 * navegador y los tests, y tiene que dar lo mismo en todos lados.
 *
 * **El problema del 9.** Un celular argentino se marca de tres formas según
 * desde dónde: `223 15 590-3118` adentro del país, `+54 9 223 590-3118` desde
 * afuera, y WhatsApp lo identifica como `5492235903118`. Meta manda el `wa_id`
 * con el 9, la ficha del cliente lo tiene como lo dictó por teléfono —con 15,
 * con 0, sin característica— y el sistema viejo guardaba `542235903118`, sin el
 * 9, que wa.me no reconoce. Si cada lugar normalizara a su manera, el mismo
 * cliente quedaría en dos conversaciones y sin ficha en ninguna.
 *
 * Por eso hay una sola forma canónica, el **número nacional de diez dígitos**
 * (característica + abonado, sin 0 ni 15: `2235903118`). De ahí sale el
 * identificador de WhatsApp (`549` + nacional) y contra eso se compara con las
 * fichas.
 */

/** La característica que se asume cuando el número viene sin ella: Mar del Plata. */
export const CARACTERISTICA_LOCAL = "223";

export function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

/**
 * Saca el 15 de celular que va entre la característica y el abonado.
 *
 * Las características argentinas tienen de dos a cuatro dígitos y el número
 * nacional siempre suma diez, así que con el 15 adentro son doce: se busca un
 * «15» justo después de una característica de 2, 3 o 4 dígitos. Se prueba de
 * la más corta a la más larga porque las de dos (11, Buenos Aires) son las
 * únicas que no pueden confundirse con el comienzo de otra.
 */
function sinQuince(digitos: string): string {
  if (digitos.length !== 12) return digitos;
  for (const largo of [2, 3, 4]) {
    if (digitos.slice(largo, largo + 2) === "15") {
      return digitos.slice(0, largo) + digitos.slice(largo + 2);
    }
  }
  return digitos;
}

/**
 * El número nacional de diez dígitos, o `null` si no es un número argentino
 * reconocible.
 *
 * Acepta lo que aparece en las fichas: `+54 9 223 590-3118`, `(0223)
 * 15-590-3118`, `2235903118`, `590-3118` (sin característica: se asume la de
 * Mar del Plata, que es como lo dicta un cliente del barrio), `5492235903118` y
 * `542235903118` (el formato viejo, sin el 9).
 */
export function numeroNacional(
  telefono: string,
  caracteristica = CARACTERISTICA_LOCAL,
): string | null {
  const crudo = telefono.trim();
  let d = soloDigitos(crudo);
  if (d.length < 6) return null;

  // Prefijo internacional marcado a la antigua: 00 54 …
  if (d.startsWith("0054")) d = d.slice(2);

  const conPais = crudo.startsWith("+") || d.startsWith("54");
  if (conPais) {
    if (!d.startsWith("54")) return null; // Otro país: no es nuestro formato.
    d = d.slice(2);
    // El 9 de celular para llamadas desde el exterior.
    if (d.length === 11 && d.startsWith("9")) d = d.slice(1);
    // Algunos lo escriben con el 0 de larga distancia igual: +54 0223…
    if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
    d = sinQuince(d);
    return d.length === 10 ? d : null;
  }

  // Adentro del país: 0 de larga distancia, 15 de celular.
  if (d.startsWith("0")) d = d.slice(1);
  d = sinQuince(d);

  // Sin característica: un número local de siete dígitos (o de nueve con el 15
  // adelante, como se dicta un celular: «15 590-3118»).
  if (d.length === 9 && d.startsWith("15")) d = d.slice(2);
  if (d.length === 6 || d.length === 7 || d.length === 8) {
    const completo = caracteristica + d;
    if (completo.length === 10) return completo;
    return null;
  }

  return d.length === 10 ? d : null;
}

/**
 * El identificador de WhatsApp de un número: `549` + nacional para los
 * argentinos. Un número de otro país escrito con `+` se respeta tal cual.
 */
export function aWaId(telefono: string): string | null {
  const nacional = numeroNacional(telefono);
  if (nacional) return `549${nacional}`;

  const crudo = telefono.trim();
  const d = soloDigitos(crudo);
  // Extranjero: solo si vino con su código de país explícito.
  if ((crudo.startsWith("+") || crudo.startsWith("00")) && !d.startsWith("54")) {
    const sinCeros = d.replace(/^00/, "");
    return sinCeros.length >= 8 && sinCeros.length <= 15 ? sinCeros : null;
  }
  return null;
}

/**
 * Lo que llega de Meta (`wa_id`, `from`) llevado a la forma canónica.
 *
 * Meta lo manda casi siempre con el 9, pero no se confía: si llegara sin él
 * (`542235903118`), la conversación tiene que ser la misma que la del 9.
 */
export function waIdDeMeta(waId: string): string {
  const d = soloDigitos(waId);
  if (d.startsWith("54")) return aWaId(`+${d}`) ?? d;
  return d;
}

/** La conversación se guarda con el formato de JID que usa la bandeja. */
export function jidDeWaId(waId: string): string {
  return `${waIdDeMeta(waId)}@s.whatsapp.net`;
}

export function waIdDeJid(waJid: string): string {
  return soloDigitos(waJid.split("@")[0]);
}

/** Si dos teléfonos, escritos como sea, son el mismo número. */
export function mismoNumero(a: string, b: string): boolean {
  const na = numeroNacional(a);
  const nb = numeroNacional(b);
  if (na && nb) return na === nb;
  return soloDigitos(a) !== "" && soloDigitos(a) === soloDigitos(b);
}

/** «+54 9 223 590-3118» para mostrar. */
export function numeroLegible(waIdOJid: string): string {
  const d = waIdDeJid(waIdOJid);
  const nacional = d.startsWith("54") ? numeroNacional(`+${d}`) : null;
  if (!nacional) return d ? `+${d}` : waIdOJid;

  // La característica de Mar del Plata y las de tres dígitos son las que más
  // aparecen; las de 2 (11) y 4 se cortan por largo de abonado.
  const area = nacional.startsWith("11") ? nacional.slice(0, 2) : nacional.slice(0, 3);
  const abonado = nacional.slice(area.length);
  return `+54 9 ${area} ${abonado.slice(0, abonado.length - 4)}-${abonado.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/* Usuarios sin número (BSUID)                                                 */
/* -------------------------------------------------------------------------- */

const PREFIJO_BSUID = "bsuid:";

/** Si es un BSUID de Meta: código de país, punto y alfanuméricos («AR.1A2B…»). */
export function esBsuid(valor: string): boolean {
  return /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/.test(valor);
}

/** La clave de la conversación de alguien que llegó sin número. */
export function jidDeBsuid(bsuid: string): string {
  return `${PREFIJO_BSUID}${bsuid}`;
}

/**
 * A quién se le manda: el `wa_id` (dígitos) o el BSUID, según cómo esté
 * guardada la conversación. El proveedor elige `to` o `recipient` por eso.
 */
export function destinoDeJid(waJid: string): string {
  if (waJid.startsWith(PREFIJO_BSUID)) return waJid.slice(PREFIJO_BSUID.length);
  return waIdDeJid(waJid);
}

/** Si la conversación es de alguien del que no se conoce el teléfono. */
export function sinNumero(waJid: string): boolean {
  return waJid.startsWith(PREFIJO_BSUID);
}
