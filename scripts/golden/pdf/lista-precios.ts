import { pdfDeListaDePrecios, type FilaDeLista } from "@/lib/pdf/lista-precios";
import type { CasoPdf } from "../pdf";
import { EMISOR, EMISOR_LARGO, azarCon } from "./_azar";

const { entero, elegir, palabras, azar } = azarCon(1201);

type Datos = Parameters<typeof pdfDeListaDePrecios>[0];

function caso(nombre: string, datos: Datos): CasoPdf {
  return { nombre, datos, generar: () => pdfDeListaDePrecios(datos) };
}

const CATEGORIAS = ["Machimbres", "Placas y tableros", "Tirantes", "Molduras", "Ferretería", "Pisos de madera", "Ñandubay & cía", "straße"];

function filasAlAzar(n: number): FilaDeLista[] {
  const filas: FilaDeLista[] = [];
  let categoria = elegir(CATEGORIAS);
  for (let i = 0; i < n; i++) {
    if (azar() < 0.08) categoria = elegir(CATEGORIAS);
    const r = azar();
    filas.push({
      sku: `${elegir(["MAD", "PLA", "FER", "MOL"])}-${String(entero(100000)).padStart(5, "0")}`,
      producto: palabras(1 + entero(9)),
      medida: palabras(entero(3)),
      categoria,
      precio:
        r < 0.1 ? null
          : r < 0.13 ? ""
            : r < 0.2 ? (azar() * 1e9).toFixed(2)
              : r < 0.25 ? String(entero(1000) + 0.5)
                : (azar() * 200000).toFixed(entero(5)),
    });
  }
  return filas;
}

export const casos: CasoPdf[] = [
  caso("vacia", { titulo: "Lista de precios", filas: [], emisor: null, leyendaIva: "Precios finales con IVA incluido" }),
  caso("corta", {
    titulo: "Lista profesional",
    emisor: EMISOR,
    leyendaIva: "Precios finales con IVA incluido",
    filas: [
      { sku: "MAD-00001", producto: "Machimbre de pino 1/2\" × 4\" — cepillado", medida: "3,05 m", categoria: "Machimbres", precio: "8450.50" },
      { sku: "MAD-00002", producto: "Machimbre de eucalipto “grandis”", medida: "2,75 m", categoria: "Machimbres", precio: "9999999999.99" },
      { sku: "PLA-01000", producto: "Fenólico 18 mm", medida: "1,22 × 2,44", categoria: "Placas", precio: null },
      { sku: "", producto: "", medida: "", categoria: "Placas", precio: "0" },
      { sku: "PLA-01001", producto: "Melamina blanca 😀 con emoji", medida: "", categoria: "", precio: "-150" },
    ],
  }),
  caso("larga", { titulo: "Lista de precios", emisor: EMISOR, leyendaIva: "Precios netos, sin IVA", filas: filasAlAzar(260) }),
  caso("muy-larga", { titulo: "Lista profesional — Arq. Méndez", emisor: EMISOR_LARGO, leyendaIva: "Precios finales con IVA incluido", filas: filasAlAzar(900) }),
];
