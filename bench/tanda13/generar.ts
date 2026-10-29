/**
 * Los archivos grandes del benchmark de la tanda 13: una exportación de ISIS
 * por entidad, con la forma de las muestras del golden (punto y coma, UTF-8
 * con BOM, importes y fechas con formato argentino). Siempre los mismos
 * (semilla fija), y los mismos para los dos lados.
 *
 *   npx tsx bench/tanda13/generar.ts [carpeta]     # por omisión bench/tanda13/archivos
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const carpeta = process.argv[2] ?? new URL("archivos/", import.meta.url).pathname;
mkdirSync(carpeta, { recursive: true });

let semilla = 13;
const azar = () => {
  semilla = (semilla * 1103515245 + 12345) % 2147483648;
  return semilla / 2147483648;
};
const elegir = <T>(xs: T[]) => xs[Math.floor(azar() * xs.length)];

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
function cuit(n: number): string {
  const diez = "20" + String(10_000_000 + n).padStart(8, "0");
  const suma = [...diez].reduce((s, d, i) => s + Number(d) * PESOS[i], 0);
  const resto = 11 - (suma % 11);
  const v = resto === 11 ? 0 : resto === 10 ? 9 : resto;
  return `${diez.slice(0, 2)}-${diez.slice(2)}-${v}`;
}
function importe(max: number): string {
  const n = Math.round(azar() * max * 100) / 100;
  const [e, d] = n.toFixed(2).split(".");
  return `${e.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`;
}
const fecha = (i: number) => {
  const d = new Date(Date.UTC(2020, 0, 1) + (i % 2000) * 86400000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};

function escribir(nombre: string, encabezado: string, n: number, fila: (i: number) => string[]) {
  const lineas = [encabezado];
  for (let i = 0; i < n; i++) lineas.push(fila(i).join(";"));
  writeFileSync(join(carpeta, nombre), "﻿" + lineas.join("\r\n") + "\r\n");
  console.log(`${nombre}: ${n} filas`);
}

export const CLIENTES = 10_000;
const CONDICIONES = ["Consumidor Final", "Resp. Inscripto", "Monotributo", "Exento"];

escribir("1-clientes.csv", "Código;Razón Social;C.U.I.T.;Condición IVA;E-mail;Teléfono;Domicilio;Límite Crédito;Vendedor", CLIENTES, (i) => [
  `B13-C${i}`,
  `Cliente ${i} Pérez`,
  i % 5 === 0 ? "" : cuit(i),
  elegir(CONDICIONES),
  i % 3 === 0 ? "" : `cliente${i}@correo.com.ar`,
  `223 ${100000 + i}`,
  `Calle ${i % 300} ${i}`,
  importe(2_000_000),
  elegir(["Pablo", "María", ""]),
]);

escribir("2-productos.csv", "Cód. Artículo;Descripción;Rubro;Medida;Unidad Medida;Precio Lista;Precio Profesional;% IVA;Largo", 5_000, (i) => [
  `B13-P${i}`,
  `Producto de banco ${Math.floor(i / 4)}`,
  `Rubro de banco ${i % 40}`,
  `${2 + (i % 4)}" x 4" x 3.60m`,
  elegir(["UN", "M2", "Metro lineal", "Placa"]),
  importe(90_000),
  i % 2 ? importe(80_000) : "",
  "21",
  String(3000 + (i % 4) * 600),
]);

escribir("3-stock.csv", "Artículo;Depósito;Existencia;Stock Mínimo", 5_000, (i) => [
  `B13-P${i}`,
  i % 2 ? "Casa Central" : "Aserradero",
  String(Math.floor(azar() * 500)),
  i % 3 ? String(10) : "",
]);

escribir("4-saldos.csv", "Cód. Cliente;Razón Social;Saldo Actual", CLIENTES, (i) => [
  `B13-C${i}`,
  `Cliente ${i} Pérez`,
  i % 7 === 0 ? `(${importe(50_000)})` : importe(500_000),
]);

escribir("5-proveedores.csv", "Código;Proveedor;CUIT;Situación IVA;Correo;Saldo", 2_000, (i) => [
  `B13-PR${i}`,
  `Proveedor ${i} SA`,
  cuit(500_000 + i),
  "Responsable Inscripto",
  `ventas${i}@proveedor.com`,
  i % 4 ? importe(1_000_000) : "",
]);

escribir("6-ventas.csv", "Nro. Comprobante;Fecha;Cód. Cliente;Cliente;Total;Detalle;Sucursal;Vendedor", 20_000, (i) => [
  `B13-FA-${String(i).padStart(8, "0")}`,
  fecha(i),
  `B13-C${i % CLIENTES}`,
  `Cliente ${i % CLIENTES} Pérez`,
  importe(300_000),
  "Tirantes y placas",
  "Casa Central",
  "Pablo",
]);

escribir(
  "7-comprobantes.csv",
  "Pto. Vta.;Tipo Comprobante;Número;Fecha Emisión;Cód. Cliente;CUIT;Neto Gravado;IVA;Total;CAE;Vto. CAE",
  20_000,
  (i) => [
    "13",
    i % 2 ? "Factura A" : "Factura B",
    String(i + 1),
    fecha(i),
    `B13-C${i % CLIENTES}`,
    i % 5 === 0 ? "" : cuit(i % CLIENTES),
    "10.000,00",
    "2.100,00",
    "12.100,00",
    String(76_000_000_000_000 + i),
    fecha(i + 10),
  ],
);
