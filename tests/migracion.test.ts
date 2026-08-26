import { describe, expect, it } from "vitest";
import {
  decodificarPlanilla,
  detectarSeparador,
  formatoBinario,
  interpretarNumero,
  normalizarEncabezado,
  partirPlanilla,
} from "@/lib/csv";
import {
  automapear,
  definicionDe,
  faltantes,
  normalizarFilas,
} from "@/lib/migracion/entidades";

/**
 * La migración corre una sola vez y contra datos que no volvemos a ver: si lee
 * mal una columna, el error queda adentro del sistema nuevo sin que nadie lo
 * note hasta que un cliente reclama. Por eso se prueba la lectura del archivo y
 * la validación de la fila, que es donde se decide qué entra.
 */

describe("lectura de planillas", () => {
  it("respeta los saltos de línea dentro de comillas", () => {
    // Un domicilio de dos renglones: leído por línea, corre todas las columnas
    // de ahí en adelante.
    const texto = 'Codigo;Nombre;Domicilio\r\n1;Perez;"Alem 3400\r\nPiso 2";\r\n2;Gomez;Colon 1200\r\n';
    const filas = partirPlanilla(texto, ";");

    expect(filas).toHaveLength(3);
    expect(filas[1][2]).toBe("Alem 3400\nPiso 2");
    expect(filas[2][1]).toBe("Gomez");
  });

  it("acepta las comillas dobles escapadas de Excel", () => {
    const filas = partirPlanilla('a;"Tabla de 2"" x 4"""\n', ";");
    expect(filas[0][1]).toBe('Tabla de 2" x 4"');
  });

  it("conserva las comillas de pulgada en el medio de un campo", () => {
    // 2" x 4" x 3.60m es como se escribe una medida acá. Si la comilla se toma
    // como delimitador, el catálogo entero queda sin pulgadas.
    const filas = partirPlanilla('MIG-PIN;Tirante;2" x 4" x 3.60m\n', ";");
    expect(filas[0][2]).toBe('2" x 4" x 3.60m');
  });

  it("sigue tratando como delimitador la comilla que abre el campo", () => {
    const filas = partirPlanilla('a;"Alem 3400; Piso 2";b\n', ";");
    expect(filas[0][1]).toBe("Alem 3400; Piso 2");
    expect(filas[0][2]).toBe("b");
  });

  it("descarta los renglones vacíos del final", () => {
    expect(partirPlanilla("a;b\n1;2\n\n;\n", ";")).toHaveLength(2);
  });

  it("elige el separador que predomina en el encabezado", () => {
    expect(detectarSeparador("Codigo;Nombre;Precio")).toBe(";");
    expect(detectarSeparador("Codigo,Nombre,Precio")).toBe(",");
    expect(detectarSeparador("Codigo\tNombre\tPrecio")).toBe("\t");
  });

  it("no se deja engañar por las comas de un dato", () => {
    // La primera línea es el encabezado justamente porque los datos tienen
    // comas que no separan nada.
    expect(detectarSeparador("Cliente;Domicilio\nPerez;San Martin 1234, Mar del Plata")).toBe(";");
  });

  it("lee Windows-1252 cuando el archivo no es UTF-8", () => {
    // "Cañuelas" tal como lo guarda un sistema de escritorio viejo.
    const bytes = new Uint8Array([0x43, 0x61, 0xf1, 0x75, 0x65, 0x6c, 0x61, 0x73]);
    const { texto, codificacion } = decodificarPlanilla(bytes);

    expect(texto).toBe("Cañuelas");
    expect(codificacion).toBe("windows-1252");
  });

  it("saca el BOM que escribe Excel", () => {
    const bytes = new TextEncoder().encode("﻿Codigo;Nombre");
    expect(decodificarPlanilla(bytes).texto).toBe("Codigo;Nombre");
  });

  it("reconoce un .xlsx antes de intentar leerlo como texto", () => {
    expect(formatoBinario(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("xlsx");
    expect(formatoBinario(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe("xls");
    expect(formatoBinario(new TextEncoder().encode("Codigo;Nombre"))).toBeNull();
  });
});

describe("interpretación de números", () => {
  it("lee los formatos que se escriben acá", () => {
    expect(interpretarNumero("12.345,67")).toBe("12345.67");
    expect(interpretarNumero("$ 96.500")).toBe("96500.00");
    expect(interpretarNumero("1.500.000")).toBe("1500000.00");
    expect(interpretarNumero("12345.67")).toBe("12345.67");
  });

  it("entiende los negativos de la contabilidad", () => {
    // Un saldo a favor sale entre paréntesis de cualquier listado contable.
    expect(interpretarNumero("(1.500,00)")).toBe("-1500.00");
    expect(interpretarNumero("-2500,50")).toBe("-2500.50");
  });

  it("rechaza lo que no es un número", () => {
    expect(interpretarNumero("")).toBeNull();
    expect(interpretarNumero("s/d")).toBeNull();
    expect(interpretarNumero("-")).toBeNull();
    // Un guion en el medio es un dato, no un signo: 20-12345678 no es -20.
    expect(interpretarNumero("20-12345678")).toBeNull();
  });
});

describe("mapeo automático de columnas", () => {
  const clientes = definicionDe("clientes");

  it("reconoce los encabezados con tildes, mayúsculas y guiones bajos", () => {
    const mapeo = automapear(clientes, [
      "Cód. Cliente",
      "Razón Social",
      "C.U.I.T.",
      "Condición IVA",
      "E-Mail",
      "Límite de Crédito",
    ]);

    expect(mapeo.codigo).toBe(0);
    expect(mapeo.nombre).toBe(1);
    expect(mapeo.cuit).toBe(2);
    expect(mapeo.condicionIva).toBe(3);
    expect(mapeo.email).toBe(4);
    expect(mapeo.limiteCredito).toBe(5);
  });

  it("no le da la misma columna a dos campos", () => {
    const mapeo = automapear(clientes, ["Codigo", "Razon Social", "CUIT"]);
    const usadas = Object.values(mapeo).filter((i) => i >= 0);
    expect(new Set(usadas).size).toBe(usadas.length);
  });

  it("deja en -1 lo que no aparece", () => {
    const mapeo = automapear(clientes, ["Codigo", "Nombre"]);
    expect(mapeo.telefono).toBe(-1);
    expect(faltantes(clientes, mapeo)).toEqual([]);
  });

  it("manda «Precio Profesional» al campo profesional y no al de lista", () => {
    // Las dos columnas contienen "precio": si gana la primera de la lista, el
    // catálogo entero queda con el precio de gremio como precio al público.
    const productos = definicionDe("productos");
    const mapeo = automapear(productos, ["Codigo", "Descripcion", "Rubro", "Precio", "Precio Profesional"]);

    expect(mapeo.precioGeneral).toBe(3);
    expect(mapeo.precioProfesional).toBe(4);
  });

  it("avisa cuáles faltan cuando no está lo obligatorio", () => {
    const productos = definicionDe("productos");
    const mapeo = automapear(productos, ["Precio", "Marca"]);
    expect(faltantes(productos, mapeo)).toContain("Nombre del producto");
    expect(faltantes(productos, mapeo)).toContain("Categoría");
  });
});

describe("validación de clientes", () => {
  const clientes = definicionDe("clientes");
  const columnas = ["Codigo", "Razon Social", "CUIT", "Cond IVA", "Limite"];
  const mapeo = automapear(clientes, columnas);

  it("normaliza el CUIT y la condición de IVA", () => {
    const [fila] = normalizarFilas(clientes, mapeo, [
      ["145", "Construcciones del Sur SA", "30-71234567-8", "Resp. Inscripto", "1.500.000"],
    ]);

    expect(fila.errores).toEqual([]);
    expect(fila.datos.cuit).toBe("30712345678");
    expect(fila.datos.condicionIva).toBe("responsable_inscripto");
    // El caso que rompía antes: dos puntos y sin coma es un millón y medio.
    expect(fila.datos.limiteCredito).toBe("1500000.00");
  });

  it("migra igual al cliente con el CUIT mal tipeado, pero lo avisa", () => {
    // Perder una ficha por un dígito verificador es peor que importarla
    // marcada: lo que no se puede es facturarle así.
    const [fila] = normalizarFilas(clientes, mapeo, [
      ["146", "Juan Perez", "20-12345678-0", "CF", ""],
    ]);

    expect(fila.errores).toEqual([]);
    expect(fila.datos.cuit).toBe("20123456780");
    expect(fila.avisos.join(" ")).toContain("no verifica");
  });

  it("rechaza la fila sin nombre", () => {
    const [fila] = normalizarFilas(clientes, mapeo, [["147", "", "", "", ""]]);
    expect(fila.errores.join(" ")).toContain("Falta nombre");
  });

  it("cuenta la línea con el encabezado incluido", () => {
    const filas = normalizarFilas(clientes, mapeo, [
      ["1", "Uno", "", "", ""],
      ["2", "Dos", "", "", ""],
    ]);
    expect(filas.map((f) => f.linea)).toEqual([2, 3]);
  });

  it("cae al valor por defecto cuando la condición de IVA es un código que no conocemos", () => {
    const [fila] = normalizarFilas(clientes, mapeo, [
      ["148", "Comercio SRL", "", "XX9", ""],
    ]);

    expect(fila.datos.condicionIva).toBe("consumidor_final");
    expect(fila.avisos.join(" ")).toContain("no se reconoció");
    expect(fila.errores).toEqual([]);
  });
});

describe("unidad de venta", () => {
  const productos = definicionDe("productos");
  const mapeo = automapear(productos, ["Codigo", "Descripcion", "Rubro", "Unidad"]);

  const unidadDe = (texto: string) =>
    normalizarFilas(productos, mapeo, [["A1", "Tabla", "Maderas", texto]])[0].datos.unidad;

  it("distingue el metro cuadrado del metro lineal", () => {
    // "metros cuadrados" contiene "metro": si gana el sinónimo más corto, la
    // placa se vende por metro lineal y el precio sale mal.
    expect(unidadDe("Metros Cuadrados")).toBe("metro_cuadrado");
    expect(unidadDe("M2")).toBe("metro_cuadrado");
    expect(unidadDe("Metro Lineal")).toBe("metro_lineal");
    expect(unidadDe("ML")).toBe("metro_lineal");
  });

  it("cae en unidad cuando la columna viene vacía", () => {
    expect(unidadDe("")).toBe("unidad");
  });
});

describe("validación de saldos", () => {
  const saldos = definicionDe("saldos");

  it("no acepta una fila sin forma de encontrar al cliente", () => {
    const mapeo = automapear(saldos, ["Nombre", "Saldo"]);
    const [fila] = normalizarFilas(saldos, mapeo, [["Juan Perez", "125000"]]);

    expect(fila.errores.join(" ")).toContain("encontrar al cliente");
  });

  it("conserva el signo del saldo a favor", () => {
    const mapeo = automapear(saldos, ["Cod. Cliente", "Saldo"]);
    const [fila] = normalizarFilas(saldos, mapeo, [["145", "(38.400,00)"]]);

    expect(fila.errores).toEqual([]);
    expect(fila.datos.saldo).toBe("-38400.00");
  });
});

describe("validación de existencias", () => {
  const stock = definicionDe("stock");
  const mapeo = automapear(stock, ["Codigo", "Deposito", "Existencia", "Stock Minimo"]);

  it("redondea la existencia a un entero", () => {
    const [fila] = normalizarFilas(stock, mapeo, [["PIN-2X4", "Casa Central", "12,6", "5"]]);
    expect(fila.datos.cantidad).toBe("13");
    expect(fila.datos.minimo).toBe("5");
  });

  it("rechaza una existencia negativa", () => {
    const [fila] = normalizarFilas(stock, mapeo, [["PIN-2X4", "Aserradero", "-3", ""]]);
    expect(fila.errores.join(" ")).toContain("no puede ser negativa");
  });
});

describe("normalización de encabezados", () => {
  it("iguala las formas de escribir la misma columna", () => {
    for (const variante of ["Razón Social", "razon_social", "RAZON SOCIAL", "Razon-Social"]) {
      expect(normalizarEncabezado(variante)).toBe("razonsocial");
    }
  });
});
