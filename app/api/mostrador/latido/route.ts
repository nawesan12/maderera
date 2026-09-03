import { turnoAbierto } from "@/lib/mostrador/caja";
import { conStaff } from "../guardia";

/**
 * ¿Hay internet de verdad, quién soy y sigue abierta la caja?
 *
 * Es el latido que decide si el mostrador está en línea. **`navigator.onLine`
 * no alcanza**: el modo de falla real de una maderera no es "sin red", es wifi
 * asociado sin salida a internet, donde el navegador dice `true` y miente. Lo
 * único que prueba que hay servidor es una respuesta del servidor.
 *
 * Devuelve también la hora del servidor, para que la pantalla pueda avisar
 * cuando el reloj de la máquina está corrido: de ese reloj sale la hora de las
 * ventas hechas sin conexión.
 */
export async function POST(request: Request) {
  return conStaff(async (usuario) => {
    const cuerpo = await request.json().catch(() => ({}));
    const branchId = typeof cuerpo?.branchId === "string" ? cuerpo.branchId : null;

    const turno = branchId ? await turnoAbierto(branchId) : null;

    return {
      sesion: {
        userId: usuario.userId,
        nombre: usuario.name,
        staffRole: usuario.staffRole,
      },
      turno: turno ? { id: turno.id, abiertaAt: turno.abiertaAt } : null,
      servidorAt: new Date().toISOString(),
    };
  });
}
