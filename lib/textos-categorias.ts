/**
 * El texto propio de cada categoría del catálogo.
 *
 * Una página de categoría que es solo una grilla de tarjetas no tiene con qué
 * aparecer cuando alguien busca «placas de melamina Mar del Plata» o
 * «machimbre»: el buscador necesita un texto que diga qué hay ahí, y la
 * persona que llega, saber si está en el lugar correcto antes de recorrer
 * fichas.
 *
 * **De dónde sale.** De las páginas por rubro del sitio viejo (`mjbj.ar`,
 * relevado el 14/10/2026 y guardado en `docs/sitio-viejo/`), que escribió la
 * empresa: qué es cada material, para qué se usa y en qué maderas se trabaja.
 * Se reescribió corto y se dejó afuera **todo lo que pudo haber cambiado**
 * desde 2023 —las marcas que se representaban, las medidas de presentación,
 * «más de 30 años de experiencia»—, porque eso lo confirma la clienta y no un
 * texto viejo. Lo pendiente está en `docs/CAMBIOS.md`.
 *
 * Lo que varía con el catálogo —cuántos productos hay, desde qué precio, qué
 * rubros y qué marcas— **no** está acá: la página lo arma con la base, así no
 * queda viejo.
 *
 * Es una constante en código y no una columna editable, como las sucursales
 * (ver `lib/sucursales.ts`): son ocho textos que cambian una vez por año, si
 * cambian.
 */

export interface TextoDeCategoria {
  /** Lo que se busca, para el título de la página: «Placas de melamina, MDF y fenólicos». */
  titulo: string;
  /** Uno o dos párrafos. */
  parrafos: string[];
  /** Lo que se consigue en el rubro, en palabras de quien lo busca. */
  incluye: string[];
}

export const TEXTOS_DE_CATEGORIA: Record<string, TextoDeCategoria> = {
  techos: {
    titulo: "Tirantes, machimbre y materiales para techos",
    parrafos: [
      "Todo lo que lleva un techo de madera, de la estructura a la aislación: tirantes preparados y maquinados en nuestro aserradero, machimbre y tablas para entrepisos, aislantes hidrófugos y térmicos, y los herrajes y fijaciones para armarlo.",
      "Trabajamos tirantería en pino tratado, saligna y otras maderas; si tu obra pide una sección o un largo que no está en la lista, se hace a medida en el aserradero.",
    ],
    incluye: [
      "Tirantes de pino tratado y saligna",
      "Machimbre y tablados",
      "Tablas para entrepisos",
      "Aislaciones hidrófugas y térmicas",
      "Herrajes, soportes y clavos",
      "Protectores y preservadores para madera",
    ],
  },
  placas: {
    titulo: "Placas de melamina, MDF, fenólicos y terciados",
    parrafos: [
      "Placas para muebles y para obra, con servicio de corte a medida: la melamina —un tablero de MDF o aglomerado revestido en las dos caras, cerrado, sin poros y resistente al desgaste— para cocinas, placares y oficinas; el MDF crudo para mecanizar, lacar o pintar; los terciados y fenólicos para obra y encofrado.",
      "Pasá las medidas en el armador de cortes y ves cómo entra en la placa y cuánto sale antes de comprar; el corte y el pegado de tapacantos se hacen en el aserradero.",
    ],
    incluye: [
      "Melaminas en distintos colores y espesores",
      "MDF crudo",
      "Fenólicos para encofrado",
      "Terciados",
      "Corte a medida y pegado de tapacantos",
    ],
  },
  pisos: {
    titulo: "Pisos flotantes melamínicos",
    parrafos: [
      "Pisos flotantes melamínicos de colocación por encastre: no se pegan a la superficie de apoyo ni piden albañilería, y por su poco espesor sirven para renovar un ambiente en pocas horas.",
      "Junto con el piso están las terminaciones —zócalos, perfiles de desnivel— y la manta bajo piso para colocarlo.",
    ],
    incluye: [
      "Pisos flotantes melamínicos",
      "Zócalos y terminaciones",
      "Manta y espuma bajo piso",
    ],
  },
  molduras: {
    titulo: "Molduras y listones de pino finger joint",
    parrafos: [
      "Molduras y listones de pino finger joint de Moldava, la línea propia de la maderera: dos piezas de madera unidas por un dentado que elimina los nudos y deja una pieza pareja, lista para pintar o barnizar.",
      "Contramarcos, zócalos, rinconeros, cornisas, tapajuntas y listones en varias secciones, para la obra y para la carpintería.",
    ],
    incluye: [
      "Zócalos y contramarcos",
      "Rinconeros, esquineros y cornisas",
      "Tapajuntas, tapacintas y contravidrios",
      "Listones en varias secciones",
      "Venta minorista y mayorista",
    ],
  },
  ferreteria: {
    titulo: "Ferretería para madera y carpintería",
    parrafos: [
      "Los herrajes, adhesivos y terminaciones para completar el trabajo con la madera sin hacer otro viaje: bisagras, correderas, tornillería, colas, lacas, barnices, selladores y diluyentes.",
    ],
    incluye: [
      "Bisagras, correderas y manijas",
      "Tornillos, tarugos y bulonería",
      "Colas vinílicas y adhesivos",
      "Lacas, barnices y selladores",
      "Lijas, discos y hojas de sierra",
    ],
  },
  "decks-y-escaleras": {
    titulo: "Decks de madera y PVC, y escaleras",
    parrafos: [
      "Decks para galerías, bordes de pileta, balcones y terrazas: en madera maciza —con tablas de cantos redondeados para elegir la cara— o en PVC, que no se astilla y casi no pide mantenimiento.",
      "Además del tablado está la tirantería para la estructura, los tornillos y herrajes, y los protectores para la madera. Las escaleras y los proyectos de medidas especiales se hacen a medida en el aserradero.",
    ],
    incluye: [
      "Tablas para deck de madera",
      "Deck de PVC",
      "Tirantería para la estructura",
      "Escaleras a medida",
      "Protectores y barnices",
    ],
  },
  "construccion-en-seco": {
    titulo: "Construcción en seco: placas de yeso y perfilería",
    parrafos: [
      "Placas para tabiques, revestimientos y cielorrasos sin mezclas húmedas: la placa de yeso estándar para lugares secos, la verde antihumedad para cocinas, baños y lavaderos, y las cementicias para exteriores y zonas húmedas.",
      "Con las placas va la perfilería —soleras, montantes, ángulos, omegas—, las masillas y los aislantes para completar el sistema.",
    ],
    incluye: [
      "Placas de yeso estándar y antihumedad",
      "Placas cementicias",
      "Soleras, montantes y perfiles",
      "Masillas y cintas",
      "Aislantes",
    ],
  },
  cubiertas: {
    titulo: "Chapas y cubiertas metálicas",
    parrafos: [
      "Chapas, tejados metálicos y cubiertas para techos, cocheras, aleros y galpones: más livianos que la teja, no se rompen ni se vuelan, y piden menos estructura.",
    ],
    incluye: [
      "Chapas",
      "Tejados metálicos",
      "Cubrecocheras y aleros",
      "Accesorios de cubierta",
    ],
  },
};

/**
 * Lo propio de algunos rubros, que se buscan por su nombre: «machimbre»,
 * «tirantes», «melamina», «fenólico». Un párrafo que diga qué es cada uno es
 * lo que separa esa página de la de la categoría entera, que si no sería la
 * misma grilla recortada.
 *
 * La clave es el slug del rubro (`subcategories.slug`); un rubro sin texto acá
 * usa el de su categoría.
 */
export const TEXTOS_DE_RUBRO: Record<string, string> = {
  melaminas:
    "La melamina es un tablero de MDF o aglomerado revestido en las dos caras con un papel decorativo impregnado en resina: queda una superficie cerrada, sin poros, dura y fácil de limpiar. Es la placa de los muebles de cocina, baño, placares y oficina.",
  mdf:
    "El MDF es un tablero de fibras de madera prensadas con colas especiales. A diferencia del aglomerado se puede mecanizar, y es una base pareja para lacar o pintar. No es apto para exterior ni para lugares húmedos.",
  fenolicos:
    "El fenólico es un terciado con caras impregnadas en resina fenólica, que lo hacen resistente al agua. Es la placa del encofrado y de la obra: se reutiliza varias veces.",
  terciados:
    "El terciado son chapas finas de madera pegadas con la fibra cruzada, lo que le da rigidez y estabilidad con poco peso. Se trabaja con herramientas comunes.",
  machimbres:
    "El machimbre son tablas con encastre macho y hembra para cielorrasos, revestimientos y techos a la vista. Se trabaja en pino, saligna y grandis.",
  tiranteria:
    "Los tirantes salen de nuestro aserradero, preparados y maquinados a medida. Pino tratado y saligna son los más pedidos; otras maderas y secciones se consiguen a pedido.",
  aislaciones:
    "Para que la humedad no arruine el techo: membranas, fieltros y lanas para aislación hidrófuga y térmica.",
  decks:
    "Tablas para deck de cantos redondeados, para galerías, bordes de pileta y terrazas, con todo lo necesario para armar la estructura.",
  escaleras: "Escaleras de madera a medida, hechas en el aserradero.",
  "pisos-flotantes":
    "Pisos flotantes melamínicos de encastre: no se pegan ni piden albañilería, y se colocan en pocas horas.",
  zocalos: "Zócalos de pino finger joint, sin nudos, listos para pintar o barnizar.",
};
