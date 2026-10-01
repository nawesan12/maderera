/**
 * El banco de prueba del plano de corte.
 *
 * Doscientos despieces armados al azar pero **siempre los mismos** (semilla
 * fija), con la forma de los trabajos que entran al mostrador: módulos de
 * cocina, placares, estantes sueltos, cajones, alguna tapa larga. Sobre placas
 * de 2750 × 1830 y 2600 × 1830, con sierra de 5 mm.
 *
 * Mide lo que importa y no el «aprovechamiento» (que para un despiece dado
 * depende solo de cuántas placas se usaron): **placas totales** y **el retal
 * mayor** de cada trabajo, sumado. Y el tiempo, porque el plano se recalcula en
 * cada tecla del mostrador.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/benchmark-plano.ts
 *
 * El primer motor de 2026 daba 876 placas sobre otro juego de 200 despieces,
 * que no quedó guardado; este sí queda, para que la próxima comparación sea
 * contra el mismo material.
 */

import { calcularPlanoDeCorte, type PiezaAcortar } from "../lib/cortes/plano";

function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function despiecesDePrueba(cantidad = 200, semilla = 20260914) {
  const azar = mulberry32(semilla);
  const entre = (a: number, b: number) => Math.round(a + azar() * (b - a));
  const redondo = (n: number) => Math.round(n / 5) * 5;

  const despieces: { piezas: PiezaAcortar[]; placaLargo: number; placaAncho: number }[] = [];

  for (let d = 0; d < cantidad; d++) {
    const piezas: PiezaAcortar[] = [];
    const renglones = entre(3, 14);
    for (let r = 0; r < renglones; r++) {
      const tipo = azar();
      let largo: number;
      let ancho: number;
      if (tipo < 0.3) {
        // Laterales y tapas de módulo.
        largo = redondo(entre(500, 2200));
        ancho = redondo(entre(300, 600));
      } else if (tipo < 0.55) {
        // Estantes y travesaños.
        largo = redondo(entre(300, 1200));
        ancho = redondo(entre(80, 450));
      } else if (tipo < 0.75) {
        // Puertas y frentes.
        largo = redondo(entre(300, 900));
        ancho = redondo(entre(200, 600));
      } else if (tipo < 0.9) {
        // Fondos y laterales de cajón.
        largo = redondo(entre(250, 600));
        ancho = redondo(entre(100, 250));
      } else {
        // Una tapa o un panel grande.
        largo = redondo(entre(1200, 2700));
        ancho = redondo(entre(500, 1200));
      }
      piezas.push({
        largoMm: Math.max(largo, ancho),
        anchoMm: Math.min(largo, ancho),
        cantidad: entre(1, 4),
        respetaVeta: azar() < 0.2 ? 1 : 0,
      });
    }
    const placaLargo = azar() < 0.7 ? 2750 : 2600;
    despieces.push({ piezas, placaLargo, placaAncho: 1830 });
  }
  return despieces;
}

function comparar() {
  const despieces = despiecesDePrueba();
  const area = (r: { ancho: number; alto: number } | null) => (r ? r.ancho * r.alto : 0);
  let antes = 0;
  let despues = 0;
  let piso = 0;
  let menosPlacas = 0;
  let retalMejor = 0;
  let retalIgual = 0;
  let iguales = 0;
  let tiempoAntes = 0;
  let tiempoDespues = 0;
  let peor = 0;

  // Una vuelta en blanco para que el JIT no cuente como tiempo del motor.
  for (const d of despieces.slice(0, 20)) calcularPlanoDeCorte({ ...d, anchoSierra: 5 });

  for (const d of despieces) {
    let t = performance.now();
    const h = calcularPlanoDeCorte({ ...d, anchoSierra: 5, busqueda: false });
    tiempoAntes += performance.now() - t;
    t = performance.now();
    const b = calcularPlanoDeCorte({ ...d, anchoSierra: 5 });
    const dt = performance.now() - t;
    tiempoDespues += dt;
    peor = Math.max(peor, dt);

    antes += h.placas.length;
    despues += b.placas.length;
    const util = d.piezas.reduce((t2, p) => t2 + p.largoMm * p.anchoMm * p.cantidad, 0);
    piso += Math.ceil(util / (d.placaLargo * d.placaAncho));
    if (b.placas.length < h.placas.length) menosPlacas++;
    else {
      iguales++;
      if (area(b.recorteMayor) > area(h.recorteMayor)) retalMejor++;
      else retalIgual++;
    }
  }

  const n = despieces.length;
  console.log(`Banco: ${n} despieces, sierra de 5 mm. Piso teórico (superficie): ${piso} placas.`);
  console.log(`  Heurística sola: ${antes} placas, ${(tiempoAntes / n).toFixed(1)} ms por despiece.`);
  console.log(
    `  Con búsqueda:    ${despues} placas, ${(tiempoDespues / n).toFixed(1)} ms por despiece (el peor, ${peor.toFixed(0)} ms).`,
  );
  console.log(`  Despieces que ahorran placas: ${menosPlacas}.`);
  console.log(
    `  De los ${iguales} con las mismas placas: ${retalMejor} con un retal mayor más grande, ${retalIgual} iguales.`,
  );
}

if (process.argv[1]?.endsWith("benchmark-plano.ts")) comparar();
