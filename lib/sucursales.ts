/**
 * Las dos sucursales, tal como se publican.
 *
 * **Por qué es una constante y no filas editables.** La maderera tiene dos
 * locales y los tiene desde hace décadas: la dirección, el teléfono y el
 * horario no son datos que cambien con la operación, son parte de la identidad
 * del negocio. Tenerlos en columnas editables agregaba una pantalla de
 * administración, un camino de caché que invalidar y —lo que de verdad
 * pasó— tres versiones distintas del domicilio del aserradero conviviendo:
 * "Canosa 61", "Canosa N°61" y el real, "Diagonal Canosa 61".
 *
 * **La tabla `branches` sigue existiendo y no se toca.** De su `id` cuelgan el
 * stock por sucursal, los pedidos, las órdenes de corte, los turnos de caja,
 * los remitos y los puntos de venta fiscales. Lo que se movió acá es solo lo
 * que se publica; la fila sigue siendo la identidad relacional, y el `slug` es
 * lo que une una con la otra.
 *
 * Los datos salen del brief del cliente (5/9/2026).
 */

export interface SucursalPublicada {
  slug: string;
  nombre: string;
  direccion: string;
  telefono: string;
  /** Con código de país y el 9: así lo necesita el enlace de chat. */
  whatsapp: string;
  email: string | null;
  horario: string;
  /**
   * El local en Google Maps.
   *
   * Por ahora es una búsqueda por nombre **y** dirección, que cae en la ficha
   * del negocio y no en el número de la calle a secas (que es lo que hacía
   * «Cómo llegar» buscando solo la dirección). Lo ideal es el enlace para
   * compartir del Perfil de Empresa de cada local: lo tiene la clienta y está
   * anotado en `docs/CAMBIOS.md`. El marcado lo declara como `hasMap`.
   */
  mapUrl: string | null;
  /**
   * Las coordenadas del local, para el marcado (`geo`).
   *
   * Salen de los mapas que tenía insertados el sitio viejo
   * (`mjbj.ar/sucursales`), centrados en la dirección de cada local; la de
   * Casa Central coincide a pocos metros con la que declaraba su marcado
   * (Yoast Local). Conviene confirmarlas contra el Perfil de Empresa: está
   * anotado en `docs/CAMBIOS.md`.
   */
  geo: { lat: number; lng: number } | null;
  /** Foto del local. Null muestra la placa de marca. */
  imagenUrl: string | null;
  /**
   * La foto del frente que publicaba el sitio viejo, en su tamaño real
   * (358 px de ancho).
   *
   * Va aparte de `imagenUrl` porque es chica: alcanza para el marcado y para
   * mostrarla a su tamaño en la ficha de la sucursal, no para estirarla al
   * ancho de una tarjeta. Cuando lleguen las fotos nuevas, reemplazan a esta.
   */
  foto: { ruta: string; ancho: number; alto: number } | null;
  /** Uno por renglón, como los espera la página de sucursales. */
  servicios: string;
  destacados: string;
}

/**
 * Dónde se cortan las placas, en un solo lugar (hallazgo 46 del comité,
 * 18/11/2026).
 *
 * **PENDIENTE de confirmar con la clienta**: el brief del 5/9 anuncia el corte
 * en Casa Central y el armador de cortes manda al aserradero. Hasta que
 * conteste (decisión 7 del comité final, anotada en docs/go/progreso.md) va
 * lo prudente: se corta en el aserradero, que es donde está la seccionadora,
 * y nada del sitio ofrece cortar en Casa Central —ni el chip del armador ni
 * sus servicios—. Todo lo que dice dónde se corta —el armador, el catálogo,
 * contacto, nosotros, sucursales, mi cuenta y el asistente— lee de acá: si
 * la respuesta es otra, se cambia SUCURSALES_QUE_CORTAN y nada más.
 *
 * Va antes que SUCURSALES porque los servicios de cada local salen de acá.
 */
const FRASE_DE_SUCURSAL: Record<string, string> = {
  "casa-central": "en Casa Central",
  aserradero: "en el aserradero",
};

const SUCURSALES_QUE_CORTAN: readonly string[] = ["aserradero"];

export const DONDE_SE_CORTA = {
  /** Las sucursales que cortan: las únicas que ofrece el armador. */
  sucursales: SUCURSALES_QUE_CORTAN,
  /** La sucursal que el armador de cortes elige de entrada. */
  sucursal: SUCURSALES_QUE_CORTAN[0]!,
  /** Cómo se dice en una oración: «lo cortamos en el aserradero». */
  frase: FRASE_DE_SUCURSAL[SUCURSALES_QUE_CORTAN[0]!]!,
} as const;

/** Si esa sucursal corta placas (y el armador la ofrece). */
export function cortaPlacas(slug: string): boolean {
  return DONDE_SE_CORTA.sucursales.includes(slug);
}

/**
 * «En el aserradero», «En Casa Central»: el subtítulo del armador con la
 * sucursal elegida. Antes decía «En el aserradero» con Casa Central elegida
 * (comité final, M20).
 */
export function dondeSeCortaEn(slug: string): string {
  const frase = FRASE_DE_SUCURSAL[slug] ?? DONDE_SE_CORTA.frase;
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

/** La frase con mayúscula, para cuando empieza el renglón. */
export function dondeSeCortaAlEmpezar(): string {
  return dondeSeCortaEn(DONDE_SE_CORTA.sucursal);
}

/** Los servicios del corte, en la ficha de la sucursal que corta. */
function serviciosDeCorte(slug: string): string[] {
  return cortaPlacas(slug) ? ["Servicio de corte de placas a medida", "Pegado de tapacantos"] : [];
}

export const SUCURSALES: SucursalPublicada[] = [
  {
    slug: "casa-central",
    nombre: "Casa Central",
    direccion: "Av. Juan B. Justo 4153, Mar del Plata",
    telefono: "223 590-3118",
    whatsapp: "5492235903118",
    email: "info@mjbj.com.ar",
    horario: "Lun a Vie 8:00-16:00 · Sáb 8:00-12:00",
    mapUrl:
      "https://www.google.com/maps/search/?api=1&query=Maderera+Juan+B.+Justo+Av.+Juan+B.+Justo+4153+Mar+del+Plata",
    geo: { lat: -38.01232, lng: -57.57916 },
    imagenUrl: null,
    foto: { ruta: "/sucursales/casa-central.jpg", ancho: 358, alto: 239 },
    servicios: [
      ...serviciosDeCorte("casa-central"),
      "Amplio stock de molduras y listonería Moldava",
      "Fenólicos, tablas y puntales para obra",
      "Melaminas, MDF y terciados con fraccionamiento",
      "Asesoramiento para tu proyecto",
    ].join("\n"),
    destacados: [...(cortaPlacas("casa-central") ? ["Corte a medida"] : []), "Retiro en sucursal", "Cuenta corriente"].join("\n"),
  },
  {
    slug: "aserradero",
    nombre: "Aserradero",
    direccion: "Diagonal Canosa 61, Mar del Plata",
    telefono: "223 506-0817",
    whatsapp: "5492235060817",
    email: "info@mjbj.com.ar",
    horario: "Lun a Vie 8:00-16:00 · Sáb 8:00-12:00",
    mapUrl:
      "https://www.google.com/maps/search/?api=1&query=Maderera+Juan+B.+Justo+Aserradero+Diagonal+Canosa+61+Mar+del+Plata",
    geo: { lat: -38.01473, lng: -57.58046 },
    imagenUrl: null,
    foto: { ruta: "/sucursales/aserradero.jpg", ancho: 358, alto: 238 },
    servicios: [
      "Planta de elaboración propia",
      ...serviciosDeCorte("aserradero"),
      "Molduras y listonería Moldava — línea completa",
      "Machimbres en pino, saligna y grandis",
      "Maquinados especiales: escaleras y tirantes a medida",
      "Techos, decks y escaleras",
      "Ferretería: lacas, diluyentes y selladores",
    ].join("\n"),
    destacados: ["Fábrica propia", "Madera a medida", ...(cortaPlacas("aserradero") ? ["Corte a medida"] : []), "Maquinados"].join("\n"),
  },
];

/** La ficha publicada de una sucursal, por su slug. */
export function sucursalPublicada(slug: string): SucursalPublicada | undefined {
  return SUCURSALES.find((s) => s.slug === slug);
}

/**
 * Los horarios de atención del corte, que no son los del local.
 *
 * Del brief: la cola de cortes se atiende de lunes a viernes de 8 a 16 y los
 * sábados de 8 a 12.
 */
export const HORARIO_CORTES = "Lun a Vie 8 a 16 h · Sáb 8 a 12 h";

