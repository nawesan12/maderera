// Calculadora de Techos
export interface RoofResult {
  tirantes: { cantidad: number; medida: string; descripcion: string };
  machimbre: { m2: number; descripcion: string };
  aislacion: { rollos: number; descripcion: string };
  membrana: { rollos: number; descripcion: string };
  clavos: { kg: number; descripcion: string };
}

export function calculateRoof(
  largo: number,
  ancho: number,
  tiranteType: "pino" | "saligna" = "pino"
): RoofResult {
  const superficie = largo * ancho;
  // Factor de pendiente (~15%)
  const superficieReal = superficie * 1.15;
  // Tirantes cada 60cm
  const cantTirantes = Math.ceil(ancho / 0.6) + 1;
  const tirMedida = tiranteType === "pino" ? '2" x 6"' : '3" x 6"';

  return {
    tirantes: {
      cantidad: cantTirantes,
      medida: `${tirMedida} x ${Math.ceil(largo + 0.3)}m`,
      descripcion: `Tirante ${tiranteType === "pino" ? "Pino Tratado" : "Saligna"} ${tirMedida}`,
    },
    machimbre: {
      m2: Math.ceil(superficieReal * 1.08), // 8% desperdicio
      descripcion: 'Machimbre Pino 1/2" x 4"',
    },
    aislacion: {
      rollos: Math.ceil(superficieReal / 21.6), // rollo cubre 21.6m²
      descripcion: "Lana de Vidrio 50mm (rollo 1.2m x 18m)",
    },
    membrana: {
      rollos: Math.ceil(superficieReal / 10), // rollo cubre 10m²
      descripcion: "Membrana Asfáltica 4mm x 1m x 10m",
    },
    clavos: {
      kg: Math.ceil(superficieReal * 0.15),
      descripcion: "Clavos para machimbre y estructura",
    },
  };
}

// Calculadora de Placas (optimización de cortes)
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
}

export function calculateBoards(
  piezas: BoardPiece[],
  placaAncho: number = 1830,
  placaLargo: number = 2820
): BoardResult {
  const areaPlaca = placaAncho * placaLargo;
  let areaTotalPiezas = 0;

  for (const pieza of piezas) {
    areaTotalPiezas += pieza.ancho * pieza.largo * pieza.cantidad;
  }

  // Factor de desperdicio por cortes (~12%)
  const placasTeoricas = areaTotalPiezas / areaPlaca;
  const placasReales = Math.ceil(placasTeoricas * 1.12);

  const aprovechamiento = Math.round(
    (areaTotalPiezas / (placasReales * areaPlaca)) * 100
  );

  return {
    placasNecesarias: Math.max(1, placasReales),
    placaDimension: `${placaAncho} x ${placaLargo}mm`,
    piezas,
    aprovechamiento,
    desperdicio: 100 - aprovechamiento,
  };
}

// Calculadora de Pisos
export interface FloorResult {
  pisoM2: number;
  cajasNecesarias: number;
  m2PorCaja: number;
  zocalos: number;
  zocaloML: number;
  underlayM2: number;
}

export function calculateFloor(
  largo: number,
  ancho: number,
  perimetro?: number
): FloorResult {
  const superficie = largo * ancho;
  const pisoM2 = Math.ceil(superficie * 1.1); // 10% desperdicio
  const m2PorCaja = 2.39; // estándar Decno
  const cajasNecesarias = Math.ceil(pisoM2 / m2PorCaja);

  const perim = perimetro || (largo + ancho) * 2;
  // Descontar puertas (~1.8m cada 4m de perímetro)
  const perimNeto = perim * 0.85;
  const zocaloML = Math.ceil(perimNeto);
  const zocalos = Math.ceil(zocaloML / 3); // zócalos de 3m

  return {
    pisoM2,
    cajasNecesarias,
    m2PorCaja,
    zocalos,
    zocaloML,
    underlayM2: pisoM2,
  };
}

// Calculadora de Deck
export interface DeckResult {
  tablasDeck: { m2: number; descripcion: string };
  estructura: { tirantes: number; medida: string };
  tornillos: { cantidad: number; descripcion: string };
  protector: { litros: number; descripcion: string };
}

export function calculateDeck(
  largo: number,
  ancho: number,
  material: "grandis" | "pvc" = "grandis"
): DeckResult {
  const superficie = largo * ancho;
  const m2Deck = Math.ceil(superficie * 1.12); // 12% desperdicio

  // Estructura: alfajías cada 40cm
  const cantAlfajias = Math.ceil(largo / 0.4) + 1;

  return {
    tablasDeck: {
      m2: m2Deck,
      descripcion:
        material === "grandis"
          ? 'Tabla Deck Grandis 1" x 5"'
          : "Tabla Deck PVC 25x150mm",
    },
    estructura: {
      tirantes: cantAlfajias,
      medida: '2" x 4" x ' + Math.ceil(ancho + 0.2) + "m",
    },
    tornillos: {
      cantidad: Math.ceil(superficie * 22),
      descripcion: "Tornillos galvanizados para deck",
    },
    protector: {
      litros: material === "grandis" ? Math.ceil(m2Deck * 0.25) : 0,
      descripcion:
        material === "grandis"
          ? "Protector para maderas exterior"
          : "No requiere (PVC)",
    },
  };
}
