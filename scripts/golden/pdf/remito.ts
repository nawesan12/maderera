import { crc32, deflateSync } from "node:zlib";
import { remitoPdf } from "./ts/remito";
import type { RemitoCompleto } from "@/lib/dal/admin/entregas";
import type { CasoPdf } from "../pdf";
import { EMISOR, EMISOR_LARGO, azarCon } from "./_azar";

const { entero, palabras, azar, elegir } = azarCon(1203);

type Emisor = Parameters<typeof remitoPdf>[1];

function caso(nombre: string, remito: RemitoCompleto, emisor: Emisor): CasoPdf {
  return { nombre, datos: { remito, emisor }, generar: () => remitoPdf(remito, emisor) };
}

/** Una PNG de verdad, armada a mano: tipo de color 6 (RGBA) o 2 (RGB). */
function png(ancho: number, alto: number, conAlfa: boolean): Buffer {
  const canales = conAlfa ? 4 : 3;
  const crudo = Buffer.alloc((ancho * canales + 1) * alto);
  for (let y = 0; y < alto; y++) {
    const fila = y * (ancho * canales + 1);
    crudo[fila] = 0;
    for (let x = 0; x < ancho; x++) {
      const o = fila + 1 + x * canales;
      // Un trazo de firma: una senoide gruesa sobre fondo transparente.
      const enTrazo = Math.abs(y - alto / 2 - Math.sin(x / 6) * (alto / 3)) < 2.5;
      crudo[o] = enTrazo ? 20 : 255;
      crudo[o + 1] = enTrazo ? 30 : 255;
      crudo[o + 2] = enTrazo ? 120 : 255;
      if (conAlfa) crudo[o + 3] = enTrazo ? 255 : (x * 7) % 40;
    }
  }
  const trozo = (tipo: string, datos: Buffer) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const td = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([largo, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;
  ihdr[9] = conAlfa ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", deflateSync(crudo)),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

const base: RemitoCompleto = {
  id: "r1",
  numero: "R-0001-00001234",
  tipo: "retiro",
  estado: "entregada",
  receptorNombre: "Juan Pérez",
  receptorDocumento: "30.123.456",
  firmaUrl: null,
  firmadoAt: null,
  notas: null,
  createdAt: new Date("2026-03-04T23:30:00.000Z"),
  pedidoNumero: "P-000987",
  pedidoId: "p1",
  clienteNombre: "Constructora Ñandú S.A.",
  clienteDireccion: "Av. Rivadavia 12.345, Flores",
  customerId: "c1",
  estadoPago: "pagado",
  medioPago: "efectivo",
  sucursal: "Casa central",
  sucursalDireccion: "Av. Juan B. Justo 5678",
  transportista: null,
  numeroSeguimiento: null,
  lineas: [
    { descripcion: "Machimbre de pino 1/2\" × 4\" cepillado", unidad: "metro_lineal", cantidad: 120.5 },
    { descripcion: "Fenólico 18 mm 1,22 × 2,44", unidad: "placa", cantidad: 12 },
  ],
  pendientes: [],
  factura: null,
};

function lineas(n: number): RemitoCompleto["lineas"] {
  return Array.from({ length: n }, () => ({
    descripcion: palabras(1 + entero(22)),
    unidad: elegir(["unidad", "metro_lineal", "metro_cuadrado", "kg", "bolsa_grande", ""]),
    cantidad: azar() < 0.2 ? Number((azar() * 1000).toFixed(3)) : entero(10000),
  }));
}

export const casos: CasoPdf[] = [
  caso("minimo", { ...base, lineas: [], receptorNombre: null, receptorDocumento: null, clienteDireccion: null, sucursal: null, estadoPago: "raro" }, null),
  caso("normal", base, EMISOR),
  caso("envio-cae", {
    ...base,
    tipo: "envio",
    estadoPago: "pendiente",
    medioPago: "cuenta_corriente",
    transportista: "Expreso “Rápido” — Sur",
    numeroSeguimiento: "TRK-99887766",
    factura: { etiqueta: "Factura A 0003-00004567", cae: "76123456789012", caeVencimiento: new Date("2026-03-15T00:00:00.000Z") },
    notas: "Entregar por la puerta de atrás — portón verde… llamar antes 😀 al 11-5555-5555. " + palabras(60),
  }, EMISOR_LARGO),
  caso("sin-cae-parcial", {
    ...base,
    estadoPago: "parcial",
    factura: { etiqueta: "Factura B 0001-00000001", cae: null, caeVencimiento: null },
    pendientes: [
      { descripcion: "Tirante de eucalipto 3\" × 6\" × 5,50 m", unidad: "unidad", pendiente: 40 },
      { descripcion: palabras(12), unidad: "m²", pendiente: 12.75 },
      { descripcion: "Ñandubay", unidad: "kg", pendiente: 0.001 },
    ],
    lineas: lineas(8),
  }, EMISOR),
  caso("anulado-firmado", {
    ...base,
    estado: "anulada",
    estadoPago: "reintegrado",
    firmaUrl: "data:image/png;base64," + png(240, 60, true).toString("base64"),
    firmadoAt: new Date("2026-03-05T19:45:00.000Z"),
  }, EMISOR),
  caso("firma-opaca", {
    ...base,
    estadoPago: "rechazado",
    receptorNombre: null,
    firmaUrl: "data:image/png;base64," + png(50, 200, false).toString("base64"),
    firmadoAt: new Date("2026-03-05T02:10:00.000Z"),
  }, EMISOR),
  caso("firma-rota", {
    ...base,
    firmaUrl: "data:image/png;base64,esto-no-es-una-png",
    firmadoAt: new Date("2026-03-05T15:00:00.000Z"),
  }, EMISOR),
  caso("muchas-lineas", { ...base, lineas: lineas(30), transportista: "Propio" }, EMISOR),
];
