/**
 * Las calculadoras de materiales.
 *
 * Los números salen del brief del cliente (5/9/2026), donde se pidieron
 * expresamente las fórmulas que usan hoy en el mostrador. Los que el brief no
 * contestó están marcados: **una cifra inventada acá le hace comprar de menos
 * a alguien que está por techar una casa**, y eso se descubre con el techo a
 * medio hacer.
 *
 * Todo son funciones puras, con tests, y ninguna toca la base.
 */

/* -------------------------------------------------------------------------- */
/* Las constantes, con nombre y con motivo                                     */
/* -------------------------------------------------------------------------- */

/** Separación recomendada entre tirantes de techo. Del brief: cada 60 cm. */
export const SEPARACION_TIRANTES_TECHO = 0.6;

/** Entre piso la separación baja a 40 cm, también del brief. */
export const SEPARACION_TIRANTES_PISO = 0.4;

/**
 * Cuánto machimbre de más hay que comprar.
 *
 * Del brief: **"El rendimiento del machimbre se calcula por encastre siempre
 * un +20%"**. El código tenía 8 %, que venía del prototipo. En un techo de
 * 60 m² la diferencia son siete metros cuadrados: alcanza para quedarse corto.
 */
export const MERMA_MACHIMBRE = 0.2;

/**
 * Pendiente del techo sobre la superficie en planta.
 *
 * No lo contestó el brief. Se deja el 15 % del prototipo, que es una pendiente
 * de techo habitual, y queda anotado como pendiente de confirmar.
 */
export const FACTOR_PENDIENTE = 0.15;

/**
 * Solape de la membrana asfáltica.
 *
 * El brief preguntaba por esto y no lo contestó. Se toma el **10 cm de solape
 * lateral que viene impreso en el propio rollo** —no es un número inventado,
 * es la especificación del material—, así que un rollo de 1 m × 10 m rinde
 * 9 m² y no 10. El cálculo anterior no descontaba nada y devolvía siempre un
 * rollo de menos en techos grandes.
 */
export const RINDE_ROLLO_MEMBRANA = 9;

/** Un rollo de lana de vidrio de 1,2 m × 18 m. */
export const RINDE_ROLLO_AISLACION = 21.6;

/**
 * Lo que se come la sierra en cada pasada.
 *
 * Del brief: **"los mm a tener en cuenta por cada pasada de máquina en cortes
 * es de 5mm"**. No estaba contemplado en ningún lado: el cálculo era por área
 * pura, como si la sierra no tuviera espesor.
 */
export const ANCHO_DE_SIERRA_MM = 5;

/**
 * Margen de seguridad sobre el material, además de lo que se lleva la sierra.
 *
 * El brief dice que el desperdicio **"depende del material"** y no da los
 * porcentajes. Hasta que los defina queda este único valor, que es el que ya
 * usaba el sistema. Está anotado en `docs/CAMBIOS.md`.
 */
export const MARGEN_DE_SEGURIDAD = 0.12;

/**
 * Las medidas de placa que se manejan en plaza, del brief.
 *
 * El sistema calculaba sobre 1830 × 2820 mm, que **no es ninguna de las
 * cuatro**: era un número del prototipo. Quien calculaba con esa medida
 * compraba placas que no existen.
 */
export const MEDIDAS_DE_PLACA = [
  { ancho: 1830, largo: 2750, usos: "Melamina, enchapados y MDF" },
  { ancho: 1830, largo: 2600, usos: "Melamina, enchapados, Fibro Plus y MDF" },
  { ancho: 1220, largo: 2440, usos: "Fenólicos, OSB y tableros de madera" },
  { ancho: 1220, largo: 3050, usos: "Tableros de madera" },
] as const;

/**
 * Todos los parámetros que las cuatro calculadoras aceptan por argumento.
 *
 * Vive acá y no en el DAL porque lo usan las dos puntas: el servidor lo lee de
 * la base y la isla de cliente lo recibe como prop. Este archivo no importa
 * nada, así que se puede compartir sin arrastrar la base al navegador.
 */
export interface ParametrosDeCalculo {
  mermaMachimbre: number;
  factorPendiente: number;
  margenSeguridad: number;
  anchoSierraMm: number;
  rindeRolloMembrana: number;
  rindeRolloAislacion: number;
  separacionTechoM: number;
  separacionPisoM: number;
  deck: { grandis: MedidaDeTabla; pvc: MedidaDeTabla };
}

/* -------------------------------------------------------------------------- */
/* Techos                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Cada renglón lleva, además de cómo se lee, **con qué buscarlo en el
 * catálogo**.
 *
 * Van separados a propósito. La descripción es específica —«Machimbre Pino
 * 1/2" x 4"»— porque es lo que hay que leer; buscar el catálogo con esa cadena
 * entera no encuentra nada, porque ningún producto se llama exactamente así.
 * El término de búsqueda es corto y genérico, que es lo que sí encuentra.
 */
export interface ItemCalculado {
  descripcion: string;
  /** Con qué buscar este material en el catálogo. */
  busqueda: string;
}

/**
 * Los cuatro números del techo que se editan desde el panel.
 *
 * Van por argumento y no leídos de la base: este archivo es puro y con tests, y
 * eso es lo que permite probar las fórmulas sin levantar nada.
 */
export interface ParametrosDeTecho {
  factorPendiente: number;
  separacionTechoM: number;
  mermaMachimbre: number;
  rindeRolloAislacion: number;
  rindeRolloMembrana: number;
}

export const PARAMETROS_DE_TECHO: ParametrosDeTecho = {
  factorPendiente: FACTOR_PENDIENTE,
  separacionTechoM: SEPARACION_TIRANTES_TECHO,
  mermaMachimbre: MERMA_MACHIMBRE,
  rindeRolloAislacion: RINDE_ROLLO_AISLACION,
  rindeRolloMembrana: RINDE_ROLLO_MEMBRANA,
};

export interface RoofResult {
  tirantes: { cantidad: number; medida: string } & ItemCalculado;
  machimbre: { m2: number } & ItemCalculado;
  aislacion: { rollos: number } & ItemCalculado;
  membrana: { rollos: number } & ItemCalculado;
  /**
   * Los clavos son una estimación y hay que decirlo.
   *
   * Del brief: *"Los clavos son de diversas medidas y se sacan dependiendo de
   * la cantidad de madera que compre y DEL USO QUE LE QUIERAN DAR"*. Un número
   * presentado como exacto acá sería el único dato de la pantalla que el
   * propio cliente dice que no se puede calcular así.
   */
  clavos: { kg: number; estimado: true } & ItemCalculado;
}

export function calculateRoof(
  largo: number,
  ancho: number,
  tiranteType: "pino" | "saligna" = "pino",
  p: ParametrosDeTecho = PARAMETROS_DE_TECHO,
): RoofResult {
  const superficieReal = largo * ancho * (1 + p.factorPendiente);
  const cantTirantes = Math.ceil(ancho / p.separacionTechoM) + 1;
  const tirMedida = tiranteType === "pino" ? '2" x 6"' : '3" x 6"';

  return {
    tirantes: {
      cantidad: cantTirantes,
      medida: `${tirMedida} x ${Math.ceil(largo + 0.3)}m`,
      descripcion: `Tirante ${tiranteType === "pino" ? "Pino Tratado" : "Saligna"} ${tirMedida}`,
      busqueda: `tirante ${tiranteType}`,
    },
    machimbre: {
      m2: Math.ceil(superficieReal * (1 + p.mermaMachimbre)),
      descripcion: 'Machimbre Pino 1/2" x 4"',
      busqueda: "machimbre pino",
    },
    aislacion: {
      rollos: Math.ceil(superficieReal / p.rindeRolloAislacion),
      descripcion: "Lana de Vidrio 50mm (rollo 1.2m x 18m)",
      busqueda: "lana vidrio",
    },
    membrana: {
      rollos: Math.ceil(superficieReal / p.rindeRolloMembrana),
      descripcion: "Membrana Asfáltica 4mm x 1m x 10m",
      busqueda: "membrana asfaltica",
    },
    clavos: {
      kg: Math.ceil(superficieReal * 0.15),
      descripcion: "Clavos para machimbre y estructura",
      busqueda: "clavos",
      estimado: true,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Placas                                                                      */
/* -------------------------------------------------------------------------- */

export interface BoardPiece {
  ancho: number;
  largo: number;
  cantidad: number;
}

export interface BoardResult {
  placasNecesarias: number;
  placaDimension: string;
  piezas: BoardPiece[];
  aprovechamiento: number;
  desperdicio: number;
  /** Cuántos milímetros se lleva la sierra en total. Explica el resultado. */
  perdidaPorSierraMm2: number;
}

/**
 * Cuántas placas hacen falta para un despiece.
 *
 * **La sierra se cobra el suyo antes que el margen de seguridad.** Cada pieza
 * consume su medida más una pasada de sierra a lo largo y otra a lo ancho, que
 * es lo que pasa físicamente al despiezar. Con el cálculo por área pura que
 * había antes, un despiece de cuarenta piezas chicas —donde el aserrín es una
 * placa entera— daba exactamente igual que uno de cuatro piezas grandes.
 *
 * Recién sobre eso se aplica el margen de seguridad, que cubre lo que la
 * geometría no: los recortes que quedan chicos para todo.
 */
export function calculateBoards(
  piezas: BoardPiece[],
  placaAncho: number = MEDIDAS_DE_PLACA[0].ancho,
  placaLargo: number = MEDIDAS_DE_PLACA[0].largo,
  anchoSierraMm: number = ANCHO_DE_SIERRA_MM,
  margen: number = MARGEN_DE_SEGURIDAD,
): BoardResult {
  const areaPlaca = placaAncho * placaLargo;

  let areaUtil = 0;
  let areaConSierra = 0;

  for (const pieza of piezas) {
    areaUtil += pieza.ancho * pieza.largo * pieza.cantidad;
    areaConSierra +=
      (pieza.ancho + anchoSierraMm) *
      (pieza.largo + anchoSierraMm) *
      pieza.cantidad;
  }

  const placasReales = Math.ceil(
    (areaConSierra / areaPlaca) * (1 + margen),
  );
  const placasNecesarias = Math.max(piezas.length > 0 ? 1 : 0, placasReales);

  // El aprovechamiento se mide contra el área útil —lo que se lleva el
  // cliente—, no contra la que incluye el aserrín: ese es justamente el
  // desperdicio que se quiere ver.
  const aprovechamiento =
    placasNecesarias > 0
      ? Math.round((areaUtil / (placasNecesarias * areaPlaca)) * 100)
      : 0;

  return {
    placasNecesarias,
    placaDimension: `${placaAncho} x ${placaLargo}mm`,
    piezas,
    aprovechamiento,
    desperdicio: 100 - aprovechamiento,
    perdidaPorSierraMm2: Math.round(areaConSierra - areaUtil),
  };
}

/* -------------------------------------------------------------------------- */
/* Pisos                                                                       */
/* -------------------------------------------------------------------------- */

export interface FloorResult {
  pisoM2: number;
  cajasNecesarias: number;
  m2PorCaja: number;
  zocalos: number;
  zocaloML: number;
  underlayM2: number;
  /** Tirantes de entrepiso, si se pide. Del brief: cada 40 cm. */
  tirantesDeEntrepiso: number;
}

export function calculateFloor(
  largo: number,
  ancho: number,
  perimetro?: number,
  separacionPisoM: number = SEPARACION_TIRANTES_PISO,
): FloorResult {
  const superficie = largo * ancho;
  const pisoM2 = Math.ceil(superficie * 1.1); // 10 % de desperdicio
  const m2PorCaja = 2.39; // estándar Decno
  const cajasNecesarias = Math.ceil(pisoM2 / m2PorCaja);

  const perim = perimetro || (largo + ancho) * 2;
  // Descontar puertas (~1,8 m cada 4 m de perímetro)
  const perimNeto = perim * 0.85;
  const zocaloML = Math.ceil(perimNeto);
  const zocalos = Math.ceil(zocaloML / 3); // zócalos de 3 m

  return {
    pisoM2,
    cajasNecesarias,
    m2PorCaja,
    zocalos,
    zocaloML,
    underlayM2: pisoM2,
    tirantesDeEntrepiso: Math.ceil(ancho / separacionPisoM) + 1,
  };
}

/* -------------------------------------------------------------------------- */
/* Deck                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Redondeo para arriba que no se deja engañar por el punto flotante.
 *
 * `13.44 / 0.24` da 56,00000000000001 en JavaScript, y `Math.ceil` lo convierte
 * en 57. Es una tabla de más en cada cálculo que da exacto, y en el mostrador
 * eso es plata que alguien paga de más por un error de representación.
 *
 * La tolerancia es de una millonésima: cualquier resto real de material es
 * órdenes de magnitud más grande, así que no tapa un redondeo legítimo.
 */
function techoJusto(valor: number): number {
  return Math.ceil(Number(valor.toFixed(6)));
}

/**
 * Las medidas de tabla de deck que se venden.
 *
 * El deck se vendía por metro cuadrado y la clienta lo cambió a venta por
 * tabla: *"cosa de que cada tabla y sus medidas tengan sus precios y no pierdan
 * plata, que no tenga que intervenir un humano"*.
 *
 * Ahí está el motivo real. Cobrar por m² obliga a alguien a convertir la
 * superficie a tablas enteras y a decidir qué hacer con el resto, y esa cuenta
 * la hacía una persona en el mostrador, distinto cada vez. La tabla es lo que
 * se saca del galpón: es lo que hay que cobrar.
 *
 * Son los valores por defecto. Se editan en `/admin/calculadoras` y llegan acá
 * por argumento, porque este archivo no toca la base.
 */
export const MEDIDA_DECK_POR_DEFECTO = {
  // Las medidas de las tablas que hay cargadas: 1" x 4" x 2,40 m el grandis y
  // 2,90 m x 14 cm el de PVC. Se editan en `/admin/calculadoras` cuando cambie
  // lo que se compra.
  grandis: { largoM: 2.4, anchoM: 0.1 },
  pvc: { largoM: 2.9, anchoM: 0.14 },
} as const;

export interface MedidaDeTabla {
  largoM: number;
  anchoM: number;
}

export interface DeckResult {
  /**
   * Lo que se compra: tablas enteras.
   *
   * `m2` queda para mostrar la superficie cubierta, que es lo que la persona
   * midió y reconoce; lo que entra al presupuesto es `tablas`.
   */
  tablasDeck: { tablas: number; m2: number; medida: string } & ItemCalculado;
  estructura: { tirantes: number; medida: string } & ItemCalculado;
  tornillos: { cantidad: number } & ItemCalculado;
  protector: { litros: number } & ItemCalculado;
}

export function calculateDeck(
  largo: number,
  ancho: number,
  material: "grandis" | "pvc" = "grandis",
  medidaTabla: MedidaDeTabla = MEDIDA_DECK_POR_DEFECTO[material],
  margen: number = MARGEN_DE_SEGURIDAD,
  separacionPisoM: number = SEPARACION_TIRANTES_PISO,
): DeckResult {
  const superficie = largo * ancho;
  const m2Deck = superficie * (1 + margen);

  /*
   * Tablas enteras, redondeando para arriba.
   *
   * Media tabla no se vende ni se compra: quien necesita 20,4 tablas se lleva
   * 21. Redondear para abajo deja un deck sin terminar, que es el error que no
   * se puede cometer.
   */
  const areaTabla = medidaTabla.largoM * medidaTabla.anchoM;
  const tablas = areaTabla > 0 ? techoJusto(m2Deck / areaTabla) : 0;

  // Alfajías cada 40 cm, igual que los tirantes de entrepiso.
  const cantAlfajias = Math.ceil(largo / separacionPisoM) + 1;

  return {
    tablasDeck: {
      tablas,
      m2: Math.ceil(m2Deck),
      medida: `${medidaTabla.largoM} m x ${Math.round(medidaTabla.anchoM * 100)} cm`,
      descripcion:
        material === "grandis"
          ? 'Tabla Deck Grandis 1" x 5"'
          : "Tabla Deck PVC 25x150mm",
      busqueda: material === "grandis" ? "deck grandis" : "deck pvc",
    },
    estructura: {
      tirantes: cantAlfajias,
      medida: '2" x 4" x ' + Math.ceil(ancho + 0.2) + "m",
      descripcion: 'Alfajía 2" x 4"',
      busqueda: "alfajia",
    },
    tornillos: {
      cantidad: Math.ceil(superficie * 22),
      descripcion: "Tornillos galvanizados para deck",
      busqueda: "tornillo deck",
    },
    protector: {
      litros: material === "grandis" ? Math.ceil(m2Deck * 0.25) : 0,
      descripcion:
        material === "grandis"
          ? "Protector para maderas exterior"
          : "No requiere (PVC)",
      busqueda: "protector madera",
    },
  };
}
