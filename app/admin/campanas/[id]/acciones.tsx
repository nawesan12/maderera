"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CalendarX, Copy, Trash2 } from "lucide-react";
import { Confirmar } from "@/components/admin/confirmar";
import { cancelarEnvio, desprogramarCampana, duplicarCampana, eliminarBorrador } from "../actions";

/** Las acciones de una campaña según su estado. */
export function AccionesDeCampana({ id, estado }: { id: string; estado: string }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [cancelando, setCancelando] = useState(false);
  const [borrando, setBorrando] = useState(false);

  function correr(accion: () => Promise<{ ok?: string; error?: string; id?: string }>, ir?: (id: string) => string) {
    empezar(async () => {
      const r = await accion();
      setCancelando(false);
      setBorrando(false);
      if (r.error) return void toast.error(r.error);
      toast.success(r.ok);
      if (ir && r.id) router.push(ir(r.id));
      else router.refresh();
    });
  }

  const boton = "inline-flex h-10 items-center gap-1.5 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60";

  return (
    <>
      {estado === "programada" && (
        <button type="button" className={boton} disabled={pendiente} onClick={() => correr(() => desprogramarCampana(id))}>
          <CalendarX className="h-5 w-5" /> Desprogramar
        </button>
      )}
      {estado === "enviando" && (
        <button type="button" className={`${boton} estado-problema`} disabled={pendiente} onClick={() => setCancelando(true)}>
          <Ban className="h-5 w-5" /> Cancelar el envío
        </button>
      )}
      <button type="button" className={boton} disabled={pendiente} onClick={() => correr(() => duplicarCampana(id), (nuevo) => `/admin/campanas/${nuevo}`)}>
        <Copy className="h-5 w-5" /> Duplicar
      </button>
      {estado === "borrador" && (
        <button type="button" className={boton} disabled={pendiente} onClick={() => setBorrando(true)}>
          <Trash2 className="h-5 w-5" /> Eliminar
        </button>
      )}

      <Confirmar
        abierto={cancelando}
        alCerrar={() => setCancelando(false)}
        titulo="¿Cancelar el envío?"
        detalle="Lo que ya salió, salió. Al resto no le va a llegar."
        confirmar="Cancelar el envío"
        cancelar="Seguir enviando"
        peligro
        pendiente={pendiente}
        alConfirmar={() => correr(() => cancelarEnvio(id))}
      />
      <Confirmar
        abierto={borrando}
        alCerrar={() => setBorrando(false)}
        titulo="¿Eliminar el borrador?"
        detalle="No se envió a nadie: se borra y listo."
        confirmar="Eliminar"
        peligro
        pendiente={pendiente}
        alConfirmar={() => correr(() => eliminarBorrador(id), () => "/admin/campanas")}
      />
    </>
  );
}

/** Mientras se envía, la pantalla se actualiza sola cada diez segundos. */
export function RefrescarMientrasEnvia() {
  const router = useRouter();
  useEffect(() => {
    const reloj = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(reloj);
  }, [router]);
  return null;
}
