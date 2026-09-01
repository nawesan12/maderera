"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Una acción de diálogo: avisa, cierra y refresca.
 *
 * Los cuatro diálogos del panel hacían lo mismo con un `useEffect` que miraba
 * el resultado y llamaba a `setAbierto(false)`. React 19 marca eso como error
 * —un `setState` sincrónico dentro de un efecto encadena renders— y además era
 * frágil: el efecto se dispara con cada cambio del objeto de estado, no cuando
 * termina la acción.
 *
 * Acá el aviso y el cierre pasan en el propio flujo de la acción, que es donde
 * corresponde: son consecuencias de haber guardado, no de haber renderizado.
 */
export interface ResultadoDeAccion {
  ok?: string;
  error?: string;
}

export function useAccionDeDialogo(
  accion: (
    previo: ResultadoDeAccion,
    formData: FormData,
  ) => Promise<ResultadoDeAccion>,
  inicial: ResultadoDeAccion,
  alTerminarBien: () => void,
) {
  const router = useRouter();

  return useActionState(async (previo: ResultadoDeAccion, formData: FormData) => {
    const resultado = await accion(previo, formData);

    if (resultado.ok) {
      toast.success(resultado.ok);
      alTerminarBien();
      // El refresco vuelve a pedir los Server Components de la pantalla: sin
      // esto, la fila recién creada no aparece hasta recargar a mano.
      router.refresh();
    } else if (resultado.error) {
      toast.error(resultado.error);
    }

    return resultado;
  }, inicial);
}
