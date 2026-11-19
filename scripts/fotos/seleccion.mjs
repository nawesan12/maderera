/**
 * Qué foto del Drive de la clienta va a dónde, y con qué recorte.
 *
 * `procesar.mjs` lee esta lista. Cada entrada:
 *
 * - `origen`: ruta dentro de la carpeta del Drive (o `{ pdf, pagina }` para una
 *   foto que viene adentro de un PDF).
 * - `destino`: dónde queda el archivo dentro de la salida.
 *   - `estatico/` → `lib/sitio/` (las importa el código: Next les pone hash y
 *     caché permanente).
 *   - `sitio/` → `public/sitio/` (las que nombra la base, como las portadas de
 *     rubro: llevan versión en el nombre porque la caché de imágenes de Next
 *     dura 30 días y sobrevive a los despliegues).
 *   - `biblioteca/` → el volumen privado de producción (`mjbj fotos cargar`).
 *   - `sin-codigo/` → para subir a mano desde el panel o para la biblioteca
 *     cuando la clienta diga qué código lleva cada una. No va a git.
 * - `ancho` × `alto`: medida final.
 * - `foco`: [x, y] del centro del recorte, en fracciones de la foto original.
 * - `zoom`: 1 es el recorte más grande con esa proporción; 1,5 es un recorte
 *   1,5 veces más chico (más cerca).
 * - `tipo`: `producto` dibuja en la hoja el cuadrado del teléfono
 *   (`tarjeta-de-producto.tsx` es cuadrada en una columna); `banda` muestra
 *   cómo queda en `EncabezadoPublico` a 1440×300 y a 390×330.
 * - `ajuste`: retoque de tono (`galpon`: menos luces altas; `bn`: se deja en
 *   blanco y negro, como el catálogo).
 *
 * La regla de la biblioteca: 1600 px o más por el lado largo en el original.
 * Las de 640 px (Moldava, entramados, MADERAS VARIOS) no entran: de borde a
 * borde en el teléfono se ven borrosas, y la tarjeta sin foto queda mejor.
 *
 * Fuera a propósito (docs/fotos.md): las 7 de `mjbj enchapados` (generadas con
 * IA, marca C2PA), MADERAS VARIOS, los PNG de logos del Drive (dicen
 * «JUAN. B.»), `STOCK PLACAS` y `FENOLICOS TERCIPLAK` (publicidad de
 * proveedores), `FENOLICOS PLACAS RIVADAVIA` (la pintada de otro proveedor en el
 * medio), las muestras de color (esperan qué colores trabaja la maderera).
 */

const P = "PLACAS/";
const F = "FERRETERIA/";

// Fotos de estudio de 7952 × 5304 (3:2) llevadas a 4:3: solo se recortan los
// costados, el canto de abajo queda.
const producto = (origen, destino, extra = {}) => ({
  origen,
  destino,
  ancho: 1920,
  alto: 1440,
  calidad: 85,
  tipo: "producto",
  foco: [0.5, 0.5],
  zoom: 1,
  ...extra,
});

// El detalle: un recorte en píxeles originales, sin achicar (hallazgo 5 del
// comité): en la tarjeta Guatambú, Paraíso y Peteribí se separan apenas por el
// tono; de cerca, por el dibujo de la veta.
const detalle = (origen, destino, [x, y]) => ({
  origen,
  destino,
  ancho: 1500,
  alto: 1125,
  calidad: 85,
  tipo: "detalle",
  pixeles: [x, y],
});

export const SELECCION = [
  /* ------------------------------ el sitio ------------------------------ */

  // Portada: el galpón propio, vertical como viene. No es una foto de estudio
  // (celular, angular, P3): va detrás de la capa oscura en el teléfono y al
  // costado en la computadora. Se recorta un poco de los bordes, que es donde
  // el angular curva los tubos.
  {
    origen: P + "IMG_20220910_103737.jpg",
    destino: "estatico/galpon.webp",
    ancho: 1800,
    alto: 2400,
    calidad: 82,
    foco: [0.5, 0.55],
    zoom: 1.1,
    ajuste: "galpon",
  },
  // /nosotros: la otra toma del galpón, en banda. La de la portada y esta son
  // casi la misma: una por página.
  {
    origen: P + "IMG_20220910_103813.jpg",
    destino: "estatico/galpon-banda.webp",
    ancho: 1920,
    alto: 800,
    calidad: 85,
    tipo: "banda",
    foco: [0.5, 0.52],
    zoom: 1.1,
    ajuste: "galpon",
  },
  // Corte a medida: las cabezas de los listones cortados.
  {
    origen: P + "CANTOS TABLEROS PINO.jpg",
    destino: "estatico/corte-cantos.webp",
    ancho: 1920,
    alto: 1280,
    // Mucho detalle fino: a 85 pesaba 760 KB, y Next la vuelve a comprimir.
    calidad: 78,
    foco: [0.5, 0.5],
    zoom: 1,
  },
  // Profesionales (portada y encabezado): el fenólico negro con los cantos.
  {
    origen: P + "FENOLICO CON FILM MIRALUZ.jpg",
    destino: "estatico/fenolico.webp",
    ancho: 1920,
    alto: 1280,
    calidad: 85,
    // Abajo, en los cantos de la pila: arriba el film lleva impresa la marca
    // del fabricante.
    foco: [0.62, 0.82],
    zoom: 1.5,
  },
  {
    origen: P + "FENOLICO CON FILM MIRALUZ.jpg",
    destino: "estatico/fenolico-banda.webp",
    ancho: 1920,
    alto: 800,
    calidad: 85,
    tipo: "banda",
    foco: [0.5, 0.75],
    zoom: 1.15,
  },
  // Moldava: la estantería en color, en banda para el encabezado…
  {
    origen: "MOLDURAS MOLDAVA/👆ESTANTERIA MOLDURAS.jpg",
    destino: "estatico/moldava-estanteria.webp",
    ancho: 1920,
    alto: 800,
    calidad: 85,
    tipo: "banda",
    foco: [0.5, 0.5],
    zoom: 1,
  },
  // …y de cerca, los casilleros (portada, bloque de nosotros; /nosotros,
  // bloque de Moldava).
  {
    origen: "MOLDURAS MOLDAVA/👆ESTANTERIA MOLDURAS.jpg",
    destino: "estatico/moldava-casilleros.webp",
    ancho: 1600,
    alto: 1280,
    calidad: 85,
    foco: [0.68, 0.45],
    zoom: 1.7,
  },
  // /moldava, el bloque del proceso: las puntas de las molduras, la foto de la
  // página 26 del catálogo 2026. En blanco y negro, como en el catálogo.
  {
    origen: { pdf: "MOLDURAS MOLDAVA/CATÁLOGO MOLDAVA 2024/CATALOGO MOLDAVA 2026.pdf", pagina: 26 },
    destino: "estatico/moldava-puntas.webp",
    ancho: 1920,
    alto: 1400,
    calidad: 78,
    foco: [0.5, 0.5],
    zoom: 1,
    ajuste: "bn",
  },

  /* ---------------- portadas de rubro (las nombra la base) ---------------- */

  // Placas: tablero de pino en dos espesores, anclado abajo para que se vean
  // los cantos. Sin marca de ningún proveedor.
  {
    origen: P + "TABLERO PINO CON NUDOS ESPESORES vs.jpg",
    destino: "sitio/placas-v1.webp",
    ancho: 1440,
    alto: 1080,
    calidad: 85,
    foco: [0.5, 0.72],
    zoom: 1.15,
  },
  // Ferretería: los accesorios de cortinería que la clienta marcó con 👆.
  {
    origen: F + "👆ACCESORIOS CORTINERIA NATURALES.jpg",
    destino: "sitio/ferreteria-v1.webp",
    ancho: 1440,
    alto: 1080,
    calidad: 85,
    foco: [0.48, 0.55],
    zoom: 1.45,
  },
  // Construcción en seco: OSB con el canto.
  {
    origen: P + "OSB.jpg",
    destino: "sitio/seco-v1.webp",
    ancho: 1440,
    alto: 1080,
    calidad: 85,
    foco: [0.5, 0.62],
    zoom: 1.1,
  },

  /* ------------------- biblioteca: fotos con código MJBJ ------------------ */

  producto(P + "CHAPADUR MARRON 3MM (392).jpg", "biblioteca/392.webp"),
  producto(P + "CHAPADUR PERFORADO BLANCO 3MM (391).jpg", "biblioteca/391.webp"),
  producto(P + "ENCHAPADO AGLOMERADO EN GUATAMBU (4145).jpg", "biblioteca/4145.webp"),
  detalle(P + "ENCHAPADO AGLOMERADO EN GUATAMBU (4145).jpg", "biblioteca/4145-veta.webp", [3200, 1400]),
  producto(P + "ENCHAPADO AGLOMERADO EN PARAISO (4159).jpg", "biblioteca/4159.webp"),
  detalle(P + "ENCHAPADO AGLOMERADO EN PARAISO (4159).jpg", "biblioteca/4159-veta.webp", [3200, 1400]),
  producto(P + "ENCHAPADO AGLOMERADO EN PETERIBY (4147).jpg", "biblioteca/4147.webp"),
  detalle(P + "ENCHAPADO AGLOMERADO EN PETERIBY (4147).jpg", "biblioteca/4147-veta.webp", [3200, 1400]),
  producto(P + "FENOLICO UNA CARA LIJADA CON NUDOS (5743).jpg", "biblioteca/5743.webp"),
  producto(P + "MELAMINA BLANCA AGLO. 18MM (12724).jpg", "biblioteca/12724.webp"),
  producto(P + "👆MELAMINA BLANCA MDF 18MM (4696).jpg", "biblioteca/4696.webp"),
  producto(P + "RANURADO BLANCO 18MM (4172).jpg", "biblioteca/4172.webp"),
  // Las cuatro texturas de eucalipto se parecen: una con el canto a la vista
  // (12848, anclada abajo) y la otra centrada en la textura (12850-12851).
  producto(P + "TABLERO EUCALIPTUS 20MM (12848).jpg", "biblioteca/12848.webp", { foco: [0.5, 0.75], zoom: 1.15 }),
  producto(P + "TABLERO EUCALIPTUS (12850 y 12851).jpg", "biblioteca/12850-12851.webp", { foco: [0.5, 0.45], zoom: 1.3 }),
  producto(P + "TABLERO PINO CON NUDOS 30MM (12801).jpg", "biblioteca/12801.webp"),
  producto(P + "TERCIADO PINO 3MM (9035).jpg", "biblioteca/9035.webp"),

  /* ------------- sin código: esperan la planilla de la clienta ------------- */

  ...[
    "ENCHAPADO AGLOMERADO EN JAQUETIVA.jpg",
    "FENOLICO CON FILM MIRALUZ.jpg",
    "FENOLICO CON FILM.jpg",
    "FENOLICO INDUSTRIAL.jpg",
    "OSB.jpg",
    "PLACA CEMENTICIA.jpg",
    "SIDING.jpg",
    "TABLERO EUCALIPTUS 2.jpg",
    "TABLERO EUCALIPTUS 20MM.jpg",
    "TABLERO PINO CON NUDOS ESPESORES vs.jpg",
    "TABLERO PINO SIN NUDOS ESPESORES vs.jpg",
    "TABLERO PINO SIN NUDOS.jpg",
  ].map((n) => producto(P + n, "sin-codigo/" + nombreLimpio(n))),

  // Ferretería: un recorte por foto, la pieza con margen y la punta del perfil
  // (lo que muestra la sección) dentro del cuadrado del teléfono.
  ...[
    ["BISAGRAS.jpg", [0.53, 0.53], 1.35],
    ["CAÑO OVAL.jpg", [0.5, 0.56], 1.25],
    ["CORREDERA COMUN.jpg", [0.53, 0.47], 1.25],
    ["CORREDERAS COMUNES.jpg", [0.47, 0.5], 1.3],
    ["CORREDERAS TELESCOPICAS.jpg", [0.45, 0.5], 1.4],
    ["KEKOL.jpg", [0.53, 0.55], 1.25],
    ["KIT PLACARD.jpg", [0.5, 0.5], 1.1],
    ["KIT PUERTA GRANERO.jpg", [0.47, 0.5], 1.25],
    ["MOLDURA TELGOPOR.jpg", [0.48, 0.56], 1.15],
    ["PATA ALUMINIO PARA MUEBLES.jpg", [0.5, 0.55], 1.4],
    ["PATA ALUMINIO REDONDA.jpg", [0.5, 0.55], 1.35],
    ["PERFIL MANIJON.jpg", [0.46, 0.6], 1.3],
    ["PERFIL TIRADOR C.jpg", [0.5, 0.6], 1.3],
    ["PERFIL TIRADOR J.jpg", [0.45, 0.6], 1.3],
    ["PETRILAC.jpg", [0.5, 0.55], 1.3],
    ["PISTON A GAS.jpg", [0.5, 0.55], 1.45],
    ["RUEDAS PLASTICAS CON BASE.jpg", [0.5, 0.55], 1.25],
    ["TAPACANTO U ALUMINIO.jpg", [0.5, 0.6], 1.3],
    ["👆ACCESORIOS CORTINERIA CEDRO.jpg", [0.5, 0.57], 1.25],
    ["👆ACCESORIOS CORTINERIA NATURALES.jpg", [0.5, 0.55], 1.25],
  ].map(([n, foco, zoom]) => producto(F + n, "sin-codigo/ferreteria-" + nombreLimpio(n), { foco, zoom })),
];

/** «👆MELAMINA BLANCA MDF 18MM (4696).jpg» → «melamina-blanca-mdf-18mm-4696.webp». */
export function nombreLimpio(n) {
  return (
    n
      .replace(/\.[a-z]+$/i, "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() + ".webp"
  );
}
