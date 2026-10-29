import { reporteDeVentasPdf } from "@/lib/pdf/reporte-ventas";
import type { FilaDeReporte } from "@/lib/dal/admin/reportes";
import type { CasoPdf } from "../pdf";
import { EMISOR, EMISOR_LARGO, azarCon } from "./_azar";

const { entero, azar, palabras } = azarCon(1222);

type Datos = Parameters<typeof reporteDeVentasPdf>[0];

function caso(nombre: string, datos: Datos): CasoPdf {
  return { nombre, datos, generar: () => reporteDeVentasPdf(datos) };
}

// Sin emoji ni caracteres fuera de WinAnsi en la etiqueta: el TS los mide
// crudos y pdf-lib tira un error (ver reporte_ventas.go).
const sinEmoji = (t: string) => t.replace(/[^\x20-\x7E -ÿ“”‘’—–…]/g, "");

function filas(n: number, conCosto: number): FilaDeReporte[] {
  return Array.from({ length: n }, (_, i) => {
    const total = azar() < 0.05 ? azar() * 1e11 : Math.round(azar() * 5e6 * 100) / 100;
    const neto = total / (azar() < 0.2 ? 1.105 : 1.21);
    const r = azar();
    return {
      clave: `k${i}`,
      etiqueta: sinEmoji(palabras(1 + entero(10))),
      detalle: null,
      cantidad: azar() < 0.1 ? -azar() * 3 : azar() * 20000,
      total,
      netoVenta: neto,
      costo: r < conCosto ? neto * (0.3 + azar() * 0.9) : null,
      lineasSinCosto: r < conCosto ? (azar() < 0.2 ? entero(3) : 0) : 1 + entero(5),
    };
  });
}

export const casos: CasoPdf[] = [
  caso("vacio", { filas: [], titulo: "Por producto", periodo: "marzo de 2026", filtros: null, emisor: null }),
  caso("sin-costos", { filas: filas(8, 0), titulo: "Por rubro", periodo: "Últimos 30 días", filtros: "Carpintería · Casa Central", emisor: EMISOR }),
  caso("un-renglon", {
    filas: [{ clave: "a", etiqueta: "Machimbre de pino 1/2\" × 4\" — cepillado “primera”", detalle: null, cantidad: 0.4, total: 0, netoVenta: 0, costo: 0, lineasSinCosto: 1 }],
    titulo: "Por cliente",
    periodo: "1/3/2026 al 5/3/2026",
    filtros: "",
    emisor: EMISOR_LARGO,
  }),
  caso("mezcla", { filas: filas(40, 0.6), titulo: "Por vendedor", periodo: "2026", filtros: "Sucursal Aserradero", emisor: EMISOR }),
  caso("larga", { filas: filas(300, 0.8), titulo: "Por producto", periodo: "Del 1/1/2025 al 31/12/2025, todo el año", filtros: "Rubro: Placas y tableros · Lista profesional · Medio de pago: cuenta corriente", emisor: EMISOR }),
];
