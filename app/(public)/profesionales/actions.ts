"use server";

import { revalidatePath } from "next/cache";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";

export interface EstadoSolicitud {
  error?: string;
  ok?: string;
  /**
   * Lo que la persona había escrito, para devolvérselo si algo falló.
   *
   * React vacía el formulario después de ejecutar la acción. Sin esto, alguien
   * que se equivoca en un dígito del documento pierde los otros seis campos y
   * tiene que volver a tipear todo: es la forma más segura de que abandone a
   * mitad, que es justamente lo que este formulario corto trata de evitar.
   */
  valores?: Record<string, string>;
  /**
   * Cuántas veces se rechazó.
   *
   * Es lo que le da al formulario una `key` distinta en cada intento. Con la
   * sola presencia del error no alcanza: equivocarse dos veces en lo mismo da
   * el mismo mensaje, React no rehace los campos y lo tipeado no se repinta.
   */
  intento?: number;
}

/** Los campos del formulario. */
const CAMPOS = [
  "nombre",
  "razonSocial",
  "documentoTipo",
  "documentoNumero",
  "email",
  "telefono",
  "rubro",
  "volumenEstimado",
  "redSocial",
  "mensaje",
];

/** Lo tipeado, para poder repintarlo si la validación rechaza. */
function loEscrito(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    CAMPOS.map((c) => [c, String(formData.get(c) ?? "")]),
  );
}

/**
 * Solicitud de acceso al portal de profesionales.
 *
 * **La solicitud no habilita nada.** Crea una fila pendiente que alguien de la
 * casa aprueba desde el panel. Habilitarla sola sería regalar precios
 * diferenciados y cuenta corriente a quien complete un formulario, que es
 * exactamente el mismo error que ya se evitó con el registro de clientes: sin
 * verificación, un formulario no prueba nada sobre quién lo llenó.
 *
 * Lo único que se valida acá es la forma del documento —el dígito verificador
 * si es CUIT, la cantidad de dígitos si es DNI—, que atrapa los errores de
 * tipeo. Si el número existe y de quién es lo resuelve el vendedor antes de
 * aprobar.
 *
 * El CUIT dejó de ser obligatorio por pedido de la clienta. Vale la pena tener
 * presente que quien se anota con DNI no puede recibir factura A ni ver precios
 * netos: entra al portal igual, pero fiscalmente es consumidor final.
 */
export async function solicitarAcceso(
  previo: EstadoSolicitud,
  formData: FormData,
): Promise<EstadoSolicitud> {
  // Lo valida y lo guarda la API de Go (backend/internal/profesionales): el
  // esquema de antes, el freno por IP y una pendiente por documento.
  const r = await (await api()).POST("/api/v1/profesionales/solicitud", {
    body: Object.fromEntries(CAMPOS.map((c) => [c, formData.get(c)])),
  });

  if (!r.data) {
    return {
      error: mensajeDe(r.error as Problema | undefined, "Revisá los datos."),
      valores: loEscrito(formData),
      intento: (previo.intento ?? 0) + 1,
    };
  }

  revalidatePath("/admin/profesionales");
  return { ok: r.data.ok };
}
