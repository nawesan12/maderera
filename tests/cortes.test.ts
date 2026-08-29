import { describe, expect, it } from "vitest";
import {
  armarArchivoDeCorte,
  convertirMedida,
  nombreDeArchivo,
  PERFIL_GENERICO,
  type CorteParaExportar,
} from "@/lib/cortes/formatos";

/**
 * El archivo que sale de acá lo lee una máquina que corta madera. Un número mal
 * convertido no da un error en pantalla: da una placa cortada de menos, que no
 * se puede deshacer y que hay que reponer.
 */

const corte: CorteParaExportar = {
  numero: "C-1042",
  cliente: "Carpintería Pérez",
  material: "Melamina blanca 18mm",
  piezas: [
    {
      largoMm: 1229,
      anchoMm: 600,
      cantidad: 4,
      respetaVeta: 1,
      cantoLargo: 1,
      cantoAncho: 0,
      etiqueta: "Lateral",
    },
  ],
};

describe("conversión de medidas", () => {
  it("en milímetros no toca el número", () => {
    expect(convertirMedida(1229, "mm", ",")).toBe("1229");
  });

  it("no arrastra el error del punto flotante", () => {
    // 1229 / 10 da 122.89999999999999. Una décima de menos en una pieza de
    // melamina es una pieza que no entra.
    expect(convertirMedida(1229, "cm", ",")).toBe("122,9");
    expect(convertirMedida(1229, "m", ",")).toBe("1,229");
  });

  it("respeta el separador decimal del importador", () => {
    expect(convertirMedida(1229, "cm", ".")).toBe("122.9");
  });

  it("completa los decimales con ceros", () => {
    // "1,2" en vez de "1,200" hace que algunos importadores lean 1,2 m.
    expect(convertirMedida(1200, "m", ",")).toBe("1,200");
    expect(convertirMedida(2005, "m", ",")).toBe("2,005");
  });
});

describe("armado del archivo", () => {
  it("saca una fila por pieza, con encabezado", () => {
    const salida = armarArchivoDeCorte(corte, PERFIL_GENERICO);
    const filas = salida.trimEnd().split("\r\n");

    expect(filas).toHaveLength(2);
    expect(filas[0]).toBe(
      "Largo;Ancho;Cantidad;Material;Etiqueta;Veta;Canto largo;Canto ancho",
    );
    expect(filas[1]).toBe("1229;600;4;Melamina blanca 18mm;Lateral;Sí;Sí;No");
  });

  it("escapa un material que trae el separador adentro", () => {
    // "Melamina 18mm; blanca" partía la fila en dos y corría todas las
    // columnas siguientes. Se escribe así en el mostrador.
    const salida = armarArchivoDeCorte(
      { ...corte, material: "Melamina 18mm; blanca" },
      PERFIL_GENERICO,
    );

    expect(salida).toContain('"Melamina 18mm; blanca"');
    expect(salida.trimEnd().split("\r\n")[1].split(";")).toHaveLength(9);
  });

  it("escapa las comillas duplicándolas", () => {
    const salida = armarArchivoDeCorte(
      { ...corte, material: 'Placa de 3/4"' },
      PERFIL_GENERICO,
    );
    expect(salida).toContain('Placa de 3/4""');
  });

  it("puede salir sin encabezado", () => {
    const salida = armarArchivoDeCorte(corte, {
      ...PERFIL_GENERICO,
      conEncabezado: false,
    });
    expect(salida.trimEnd().split("\r\n")).toHaveLength(1);
  });

  it("respeta el orden de columnas que se configuró", () => {
    const salida = armarArchivoDeCorte(corte, {
      ...PERFIL_GENERICO,
      conEncabezado: false,
      columnas: [
        { clave: "cantidad", encabezado: "C" },
        { clave: "largo", encabezado: "L" },
        { clave: "ancho", encabezado: "A" },
      ],
    });
    expect(salida.trimEnd()).toBe("4;1229;600");
  });

  it("no deja una etiqueta vacía como hueco raro", () => {
    const salida = armarArchivoDeCorte(
      { ...corte, piezas: [{ ...corte.piezas[0], etiqueta: null }] },
      PERFIL_GENERICO,
    );
    expect(salida).toContain(";;");
  });
});

describe("nombre del archivo", () => {
  it("usa el número del corte", () => {
    expect(nombreDeArchivo("C-1042", ";")).toBe("C-1042.csv");
  });

  it("cambia la extensión cuando el separador es tabulación", () => {
    expect(nombreDeArchivo("C-1042", "\t")).toBe("C-1042.txt");
  });

  it("no deja que un número raro arme una ruta", () => {
    expect(nombreDeArchivo("../C 1042", ";")).toBe("C_1042.csv");
  });
});
