"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { PARAMETRO_SIN_ACCESO, nombreDeSeccion } from "@/components/admin/secciones";

/**
 * El aviso del rebote de permisos: el panel manda a quien no puede entrar al
 * inicio de su rol con `?sin-acceso=<ruta>` (app/admin/layout.tsx), y acá se
 * dice a qué no tiene acceso, una vez y en un aviso que se va solo. El
 * parámetro se saca de la dirección enseguida: recargar no lo repite.
 */
export function AvisoSinAcceso() {
  const parametros = useSearchParams();
  const ruta = parametros.get(PARAMETRO_SIN_ACCESO);
  const router = useRouter();
  const donde = usePathname();

  useEffect(() => {
    if (ruta === null) return;
    const seccion = nombreDeSeccion(ruta);
    toast.error(seccion ? `No tenés acceso a ${seccion}` : "No tenés acceso a esa pantalla", {
      id: "sin-acceso",
      duration: 4000,
    });
    const resto = new URLSearchParams(parametros.toString());
    resto.delete(PARAMETRO_SIN_ACCESO);
    const consulta = resto.toString();
    router.replace(consulta ? `${donde}?${consulta}` : donde, { scroll: false });
  }, [ruta, parametros, router, donde]);

  return null;
}
