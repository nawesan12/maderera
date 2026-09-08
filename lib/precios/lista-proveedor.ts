/**
 * Lectura de la lista de precios de un proveedor.
 *
 * De las notas de la clienta: *"siempre los proveedores les envían PDFs
 * dispersos, Excels, todos distintos, etc. eso rompería el flujo al subir los
 * cambios de precios al sistema"*.
 *
 * La importación que ya existía espera **una** planilla con columnas fijas y
 * hace el match por el SKU propio, que el proveedor no conoce. Esto lee la
 * planilla que el proveedor mande: el perfil dice qué columna es el código y
 * cuál el precio, y esa definición se guarda para no repetirla cada semana.
 *
 * Es lógica pura y con tests. Leer el archivo lo hace `lib/planilla.ts` —el
 * mismo camino que la migración y la importación de precios—, y buscar a qué
 * variante corresponde cada código lo hace el DAL.
 */

import { interpretarNumero, normalizarEncabezado } from "@/lib/csv";

/** El IVA con el que se pasa de neto a final cuando la lista viene sin él. */
const IVA_POR_DEFECTO = 21;

export interface PerfilDeProveedor {
  columnaCodigo: string;
  columnaPrecio: string;
  columnaDescripcion: string | null;
  /** La planilla trae el precio sin IVA. */
  precioEsNeto: boolean;
  /** Cuánto se le suma al costo para llegar al precio de venta. */
  margenPorcentaje: number;
}

export interface FilaDeProveedor {
  /** Tal cual lo escribió el proveedor. */
  codigo: string;
  descripcion: string;
  /** Lo que cobra el proveedor, final con IVA. Es el costo. */
  costo: number;
  /** El precio de venta que sale de aplicarle el margen. */
  precioSugerido: number;
  /** En qué renglón del archivo estaba, para poder señalar el problema. */
  fila: number;
}

export interface ProblemaDeFila {
  fila: number;
  motivo: string;
}

export interface LecturaDeLista {
  filas: FilaDeProveedor[];
  problemas: ProblemaDeFila[];
}

/**
 * Ubica una columna por su nombre, sin distinguir mayúsculas ni tildes.
 *
 * Se busca por nombre y no por posición porque el proveedor agrega una columna
 * en el medio y el número deja de servir; el encabezado, en cambio, sigue
 * llamándose igual.
 */
function indiceDe(encabezados: string[], buscado: string): number {
  const objetivo = normalizarEncabezado(buscado);
  return encabezados.findIndex((e) => normalizarEncabezado(e) === objetivo);
}

/**
 * Convierte la grilla del archivo en filas de precio.
 *
 * Las filas con problemas **no se descartan en silencio**: vuelven en
 * `problemas` con el número de renglón, porque una lista de precios donde
 * faltan tres artículos sin que nadie avise es peor que una que no se pudo
 * importar.
 */
export function leerListaDeProveedor(
  grilla: string[][],
  perfil: PerfilDeProveedor,
): LecturaDeLista {
  if (grilla.length < 2) {
    return {
      filas: [],
      problemas: [{ fila: 0, motivo: "El archivo no tiene datos." }],
    };
  }

  const [encabezados, ...cuerpo] = grilla;

  const iCodigo = indiceDe(encabezados, perfil.columnaCodigo);
  const iPrecio = indiceDe(encabezados, perfil.columnaPrecio);
  const iDescripcion = perfil.columnaDescripcion
    ? indiceDe(encabezados, perfil.columnaDescripcion)
    : -1;

  if (iCodigo === -1 || iPrecio === -1) {
    const falta = iCodigo === -1 ? perfil.columnaCodigo : perfil.columnaPrecio;
    return {
      filas: [],
      problemas: [
        {
          fila: 1,
          motivo: `El archivo no tiene la columna "${falta}". Revisá el perfil del proveedor.`,
        },
      ],
    };
  }

  const filas: FilaDeProveedor[] = [];
  const problemas: ProblemaDeFila[] = [];
  const vistos = new Set<string>();

  cuerpo.forEach((fila, i) => {
    // +2: la primera fila del archivo es el encabezado y la gente cuenta
    // desde uno. Así el número coincide con lo que ve en Excel.
    const numero = i + 2;

    const codigo = (fila[iCodigo] ?? "").trim();
    if (!codigo) return; // Renglón en blanco al final: no es un problema.

    const crudo = (fila[iPrecio] ?? "").trim();
    // `interpretarNumero` devuelve el número como texto —lo mismo que guarda la
    // base para los importes— así que acá se pasa a número para poder operar.
    const texto = interpretarNumero(crudo);
    const valor = texto !== null ? Number(texto) : null;

    if (valor === null || !Number.isFinite(valor) || valor <= 0) {
      problemas.push({
        fila: numero,
        motivo: `"${codigo}" no tiene un precio válido (${crudo || "vacío"}).`,
      });
      return;
    }

    if (vistos.has(codigo)) {
      problemas.push({
        fila: numero,
        motivo: `"${codigo}" aparece más de una vez. Se toma el primero.`,
      });
      return;
    }
    vistos.add(codigo);

    // El costo se guarda siempre final con IVA, que es como los maneja el resto
    // del sistema. Cargar un neto como si fuera final deja la lista entera un
    // 21 % barata.
    const costo = perfil.precioEsNeto
      ? valor * (1 + IVA_POR_DEFECTO / 100)
      : valor;

    filas.push({
      codigo,
      descripcion:
        iDescripcion !== -1 ? (fila[iDescripcion] ?? "").trim() : "",
      costo: Math.round(costo * 100) / 100,
      precioSugerido:
        Math.round(costo * (1 + perfil.margenPorcentaje / 100) * 100) / 100,
      fila: numero,
    });
  });

  return { filas, problemas };
}
