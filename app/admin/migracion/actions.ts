"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { migrationRuns, type RechazoMigracion } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import {
  decodificarPlanilla,
  detectarSeparador,
  formatoBinario,
  partirPlanilla,
} from "@/lib/csv";
import {
  automapear,
  definicionDe,
  faltantes,
  normalizarFilas,
  type ClaveEntidad,
  type Mapeo,
} from "@/lib/migracion/entidades";
import {
  aplicarLote,
  informeDeIntegridad,
  type Control,
} from "@/lib/migracion/ejecutar";

/**
 * La migración la corre solo la administración.
 *
 * No es una restricción de comodidad: reescribe la cartera de clientes, el
 * catálogo y los saldos de cuenta corriente de una sola vez. No es una acción
 * que deba estar al alcance de un mostrador con apuro.
 */
const permiso = () => requireStaffRole("admin");

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILAS = 20_000;

const NOMBRE_BINARIO = {
  xlsx: "un archivo de Excel (.xlsx)",
  xls: "un archivo de Excel viejo (.xls)",
  pdf: "un PDF",
} as const;

export interface ArchivoAnalizado {
  error?: string;
  archivo?: string;
  columnas?: string[];
  filas?: string[][];
  codificacion?: string;
  mapeo?: Mapeo;
}

/**
 * Lee el archivo subido y propone el mapeo de columnas.
 *
 * No escribe nada. Devuelve las filas crudas para que la pantalla pueda
 * validar, mostrar y mandar los lotes sin volver a subir el archivo.
 */
export async function analizarArchivo(
  entidad: ClaveEntidad,
  datos: FormData,
): Promise<ArchivoAnalizado> {
  await permiso();

  const archivo = datos.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: "Elegí un archivo." };
  }

  if (archivo.size > MAX_BYTES) {
    return {
      error: "El archivo pasa los 8 MB. Exportalo en partes —por rubro, o por letra— y subilas de a una.",
    };
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());

  const binario = formatoBinario(bytes);
  if (binario) {
    return {
      error: `Esto es ${NOMBRE_BINARIO[binario]} y hace falta un CSV. Abrilo en Excel y usá «Guardar como» eligiendo «CSV UTF-8 (delimitado por comas)».`,
    };
  }

  const { texto, codificacion } = decodificarPlanilla(bytes);
  const separador = detectarSeparador(texto);
  const filas = partirPlanilla(texto, separador);

  if (filas.length < 2) {
    return {
      error: "El archivo no tiene datos: se esperaba una fila de encabezados y al menos un registro.",
    };
  }

  const [columnas, ...cuerpo] = filas;

  if (cuerpo.length > MAX_FILAS) {
    return {
      error: `Son ${cuerpo.length.toLocaleString("es-AR")} filas y el tope por archivo es ${MAX_FILAS.toLocaleString("es-AR")}. Exportalo en partes.`,
    };
  }

  return {
    archivo: archivo.name,
    columnas,
    filas: cuerpo,
    codificacion,
    mapeo: automapear(definicionDe(entidad), columnas),
  };
}

export interface FilaPrevia {
  linea: number;
  identificador: string;
  resumen: string;
  errores: string[];
  avisos: string[];
}

export interface VistaPrevia {
  error?: string;
  validas?: number;
  conAviso?: number;
  conError?: number;
  muestra?: FilaPrevia[];
  rechazos?: RechazoMigracion[];
}

/** Cómo se describe una fila en la vista previa y en el informe. */
function describir(entidad: ClaveEntidad, datos: Record<string, string>) {
  switch (entidad) {
    case "clientes":
      return {
        identificador: datos.codigo || datos.cuit || "—",
        resumen: [datos.nombre, datos.condicionIva.replace(/_/g, " ")]
          .filter(Boolean)
          .join(" · "),
      };
    case "productos":
      return {
        identificador: datos.sku,
        resumen: [datos.nombre, datos.medida, datos.categoria]
          .filter(Boolean)
          .join(" · "),
      };
    case "stock":
      return {
        identificador: datos.sku,
        resumen: `${datos.cantidad} en ${datos.sucursal}`,
      };
    default:
      return {
        identificador: datos.codigo || datos.cuit || datos.email || "—",
        resumen: [datos.nombre, datos.saldo].filter(Boolean).join(" · "),
      };
  }
}

/**
 * Valida el archivo entero sin escribir nada.
 *
 * El paso no es un lujo. Una columna corrida en un archivo de clientes deja la
 * cartera con el teléfono en el campo del CUIT, y eso se descubre facturando.
 */
export async function previsualizar(
  entidad: ClaveEntidad,
  mapeo: Mapeo,
  filas: string[][],
): Promise<VistaPrevia> {
  await permiso();

  const definicion = definicionDe(entidad);
  const sinMapear = faltantes(definicion, mapeo);

  if (sinMapear.length > 0) {
    return {
      error: `Falta indicar qué columna es ${sinMapear.join(", ")}.`,
    };
  }

  const normalizadas = normalizarFilas(definicion, mapeo, filas);

  const conError = normalizadas.filter((f) => f.errores.length > 0);
  const conAviso = normalizadas.filter(
    (f) => f.errores.length === 0 && f.avisos.length > 0,
  );

  // La muestra prioriza lo que hay que mirar: primero lo que no va a entrar,
  // después lo que entra con reparos, y recién al final lo que está bien.
  const orden = [
    ...conError,
    ...conAviso,
    ...normalizadas.filter((f) => f.errores.length === 0 && f.avisos.length === 0),
  ];

  return {
    validas: normalizadas.length - conError.length,
    conAviso: conAviso.length,
    conError: conError.length,
    muestra: orden.slice(0, 60).map((fila) => ({
      linea: fila.linea,
      ...describir(entidad, fila.datos),
      errores: fila.errores,
      avisos: fila.avisos,
    })),
    rechazos: conError.map((fila) => ({
      linea: fila.linea,
      identificador: describir(entidad, fila.datos).identificador,
      motivo: fila.errores.join(" "),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Ejecución                                                                   */
/* -------------------------------------------------------------------------- */

export interface CorridaIniciada {
  error?: string;
  runId?: string;
}

/** Abre la corrida. A partir de acá cada lote se acumula sobre esta fila. */
export async function iniciarCorrida(
  entidad: ClaveEntidad,
  datos: { archivo: string; codificacion: string; mapeo: Mapeo; filasTotales: number },
): Promise<CorridaIniciada> {
  const usuario = await permiso();

  const [corrida] = await db
    .insert(migrationRuns)
    .values({
      entidad,
      archivo: datos.archivo,
      codificacion: datos.codificacion,
      mapeo: datos.mapeo,
      filasTotales: datos.filasTotales,
      createdByUserId: usuario.userId,
    })
    .returning({ id: migrationRuns.id });

  return { runId: corrida.id };
}

export interface LoteAplicado {
  error?: string;
  creados?: number;
  actualizados?: number;
  omitidos?: number;
  conError?: number;
  rechazos?: RechazoMigracion[];
}

/**
 * Aplica un lote y lo suma a la corrida.
 *
 * Los contadores se suman en la base con `+`, no se recalculan desde el
 * cliente: si el navegador se cierra a la mitad, lo que quedó escrito sigue
 * siendo cierto.
 */
export async function ejecutarLote(
  runId: string,
  entidad: ClaveEntidad,
  mapeo: Mapeo,
  filas: string[][],
): Promise<LoteAplicado> {
  const usuario = await permiso();

  const definicion = definicionDe(entidad);
  if (faltantes(definicion, mapeo).length > 0) {
    return { error: "El mapeo de columnas quedó incompleto." };
  }

  const normalizadas = normalizarFilas(definicion, mapeo, filas);

  let resultado;
  try {
    resultado = await aplicarLote(entidad, normalizadas, {
      loteId: runId,
      userId: usuario.userId,
    });
  } catch (error) {
    const motivo = error instanceof Error ? error.message : "Error desconocido";
    await db
      .update(migrationRuns)
      .set({ estado: "interrumpida", finishedAt: new Date() })
      .where(eq(migrationRuns.id, runId));

    return { error: `El lote no se pudo aplicar y se dejó sin efecto: ${motivo}` };
  }

  await db
    .update(migrationRuns)
    .set({
      creados: sql`${migrationRuns.creados} + ${resultado.creados}`,
      actualizados: sql`${migrationRuns.actualizados} + ${resultado.actualizados}`,
      omitidos: sql`${migrationRuns.omitidos} + ${resultado.omitidos}`,
      conError: sql`${migrationRuns.conError} + ${resultado.conError}`,
      rechazos: sql`${migrationRuns.rechazos} || ${JSON.stringify(resultado.rechazos)}::jsonb`,
    })
    .where(eq(migrationRuns.id, runId));

  return resultado;
}

export interface CorridaCerrada {
  error?: string;
  controles?: Control[];
}

/** Cierra la corrida y contrasta el archivo contra lo que quedó en la base. */
export async function cerrarCorrida(
  runId: string,
  entidad: ClaveEntidad,
  mapeo: Mapeo,
  filas: string[][],
): Promise<CorridaCerrada> {
  const usuario = await permiso();

  await db
    .update(migrationRuns)
    .set({ estado: "completada", finishedAt: new Date() })
    .where(eq(migrationRuns.id, runId));

  const normalizadas = normalizarFilas(definicionDe(entidad), mapeo, filas);
  const controles = await informeDeIntegridad(entidad, normalizadas);

  // La importación de productos crea categorías, y las categorías están
  // cacheadas entre visitas porque las lee el menú del sitio. Sin esto, importar
  // el catálogo viejo dejaba rubros nuevos invisibles hasta que venciera.
  updateTag(ETIQUETAS.catalogo);

  revalidatePath("/admin/migracion");
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/stock");
  revalidatePath("/admin/precios");
  revalidatePath("/catalogo");

  // Se registra al cerrar y no lote por lote: una importación de diez mil filas
  // llenaría la bitácora de cien renglones que dicen lo mismo. Lo que importa
  // es que hubo una corrida de migración, de qué entidad y quién la corrió.
  await registrarEnBitacora({
    sesion: usuario,
    accion: "importar",
    entidad: "migracion",
    entidadId: runId,
    descripcion: `Cerró una corrida de migración de ${entidad}`,
    detalle: { runId, entidad, filas: filas.length },
  });

  return { controles };
}
