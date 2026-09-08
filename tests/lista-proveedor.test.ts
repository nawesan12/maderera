import { describe, expect, it } from "vitest";
import {
  leerListaDeProveedor,
  type PerfilDeProveedor,
} from "@/lib/precios/lista-proveedor";

/**
 * Cada proveedor manda su planilla: el perfil dice qué columna es qué, y se
 * guarda una vez para no volver a mapearlo cada semana.
 */
const PERFIL: PerfilDeProveedor = {
  columnaCodigo: "Codigo",
  columnaPrecio: "Precio",
  columnaDescripcion: "Detalle",
  precioEsNeto: false,
  margenPorcentaje: 0,
};

describe("leerListaDeProveedor", () => {
  it("lee las columnas por nombre y no por posición", () => {
    // La columna del precio está tercera y el código, segundo.
    const grilla = [
      ["Rubro", "Codigo", "Precio", "Detalle"],
      ["Herrajes", "BIS-35", "4200", "Bisagra 35mm"],
    ];

    const { filas, problemas } = leerListaDeProveedor(grilla, PERFIL);

    expect(problemas).toHaveLength(0);
    expect(filas).toHaveLength(1);
    expect(filas[0].codigo).toBe("BIS-35");
    expect(filas[0].costo).toBe(4200);
    expect(filas[0].descripcion).toBe("Bisagra 35mm");
  });

  it("no distingue mayúsculas ni tildes en el encabezado", () => {
    const grilla = [
      ["CÓDIGO", "PRECIO"],
      ["A-1", "100"],
    ];

    const { filas } = leerListaDeProveedor(grilla, {
      ...PERFIL,
      columnaCodigo: "codigo",
      columnaPrecio: "precio",
      columnaDescripcion: null,
    });

    expect(filas).toHaveLength(1);
  });

  it("avisa cuando falta la columna que el perfil espera", () => {
    const { filas, problemas } = leerListaDeProveedor(
      [
        ["Articulo", "Importe"],
        ["A-1", "100"],
      ],
      PERFIL,
    );

    expect(filas).toHaveLength(0);
    expect(problemas[0].motivo).toContain("Codigo");
  });

  /*
   * Los precios del sistema se guardan finales con IVA. Cargar un neto como si
   * fuera final deja la lista entera un 21 % barata, y eso no se descubre hasta
   * que alguien mira el margen a fin de mes.
   */
  it("pasa el neto a final cuando la lista viene sin IVA", () => {
    const { filas } = leerListaDeProveedor(
      [
        ["Codigo", "Precio"],
        ["A-1", "1000"],
      ],
      { ...PERFIL, precioEsNeto: true, columnaDescripcion: null },
    );

    expect(filas[0].costo).toBe(1210);
  });

  it("aplica el margen para sugerir el precio de venta", () => {
    const { filas } = leerListaDeProveedor(
      [
        ["Codigo", "Precio"],
        ["A-1", "1000"],
      ],
      { ...PERFIL, margenPorcentaje: 40, columnaDescripcion: null },
    );

    expect(filas[0].costo).toBe(1000);
    expect(filas[0].precioSugerido).toBe(1400);
  });

  /*
   * Una fila que no se pudo leer no se descarta en silencio: una lista donde
   * faltan tres artículos sin que nadie avise es peor que una que no se pudo
   * importar.
   */
  it("señala las filas sin precio con el número de renglón de Excel", () => {
    const { filas, problemas } = leerListaDeProveedor(
      [
        ["Codigo", "Precio"],
        ["A-1", "100"],
        ["A-2", "consultar"],
      ],
      { ...PERFIL, columnaDescripcion: null },
    );

    expect(filas).toHaveLength(1);
    expect(problemas).toHaveLength(1);
    // El encabezado es la fila 1, así que "A-2" es la 3.
    expect(problemas[0].fila).toBe(3);
    expect(problemas[0].motivo).toContain("A-2");
  });

  it("avisa de los códigos repetidos y se queda con el primero", () => {
    const { filas, problemas } = leerListaDeProveedor(
      [
        ["Codigo", "Precio"],
        ["A-1", "100"],
        ["A-1", "200"],
      ],
      { ...PERFIL, columnaDescripcion: null },
    );

    expect(filas).toHaveLength(1);
    expect(filas[0].costo).toBe(100);
    expect(problemas[0].motivo).toContain("más de una vez");
  });

  it("saltea los renglones en blanco del final sin llamarlos problema", () => {
    const { filas, problemas } = leerListaDeProveedor(
      [
        ["Codigo", "Precio"],
        ["A-1", "100"],
        ["", ""],
        ["", ""],
      ],
      { ...PERFIL, columnaDescripcion: null },
    );

    expect(filas).toHaveLength(1);
    expect(problemas).toHaveLength(0);
  });

  it("un archivo sin datos no revienta", () => {
    const { filas, problemas } = leerListaDeProveedor([], PERFIL);
    expect(filas).toHaveLength(0);
    expect(problemas).toHaveLength(1);
  });
});
