// Genera los casos golden de backend/internal/jsmath: corre las funciones de
// redondeo de verdad (las de JS) sobre miles de valores y guarda entrada y
// salida. Los tests de Go tienen que dar lo mismo, bit a bit.
//
//   node scripts/golden/jsmath.mjs
//
// Los números viajan como su representación de bits (hex de 64 bits) para
// que nada se pierda en el camino: JSON redondearía -0 a 0, por ejemplo.
import { writeFileSync } from "node:fs";

// Un generador con semilla: el archivo sale igual cada vez.
let s = 0x5eed1234;
const azar = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);

const bits = (x) => {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  return v.getBigUint64(0).toString(16).padStart(16, "0");
};

const entradas = [
  0, -0, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 0.49999999999999994, -0.49999999999999994,
  1.005, 2.675, 1.115, 8.345, 0.285, 1.255, 4.35, 123456.785, -1.005, 1e15 + 0.5, 4503599627370495.5,
  0.1 + 0.2, 1234.5678, 99.995, 0.045, 21 / 121 * 100, 1210 / 1.21,
];
for (let i = 0; i < 6000; i++) {
  const escala = [1, 10, 100, 1000, 1e5, 1e7][i % 6];
  let x = (azar() - 0.25) * escala;
  // La mitad, con tres decimales y terminados en 5: donde se juega el redondeo.
  if (i % 2) x = Math.trunc(x * 1000) / 1000 + (x >= 0 ? 0.0005 : -0.0005) * (i % 4 === 1 ? 10 : 1);
  // Y productos y cocientes como los de un IVA o un descuento.
  if (i % 7 === 0) x = x * 1.21;
  if (i % 11 === 0) x = x / 1.21;
  entradas.push(x);
}

const casos = entradas.map((x) => ({
  x: bits(x),
  round: bits(Math.round(x)),
  r2: bits(Math.round(x * 100) / 100),
  r2eps: bits(Math.round((x + Number.EPSILON) * 100) / 100),
  // Cómo lee JS un numeric que viene de Postgres como texto.
  texto: String(x),
  numero: bits(Number(String(x))),
}));

const destino = new URL("../../backend/testdata/golden/jsmath/redondeo.json", import.meta.url);
writeFileSync(destino, JSON.stringify(casos, null, 0) + "\n");
console.log(`${casos.length} casos en ${destino.pathname}`);
