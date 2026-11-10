"use client";

import { useActionState, useState, useTransition } from "react";
import { Bot, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Hoja, Interruptor, Seccion, sinReiniciar } from "@/components/admin/formulario";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cambiarBot, guardarNumeroHumano, type EstadoAviso } from "./acciones";

/**
 * El bot de WhatsApp (backend/internal/whatsapp/bot.go): contesta solo lo que
 * se resuelve con datos y deriva el resto a una persona, en el número de acá.
 * Sin número, la persona contesta desde esta bandeja.
 */
export function ConfiguracionDelBot({ encendido, numero }: { encendido: boolean; numero: string }) {
  const [prendido, setPrendido] = useState(encendido);
  const [, empezar] = useTransition();
  const [estado, guardar, guardando] = useActionState<EstadoAviso, FormData>(guardarNumeroHumano, {});

  function cambiar(v: boolean) {
    setPrendido(v);
    empezar(async () => {
      const r = await cambiarBot(v);
      if (r.error) {
        setPrendido(!v);
        toast.error(r.error);
      } else toast.success(v ? "El bot contesta los mensajes nuevos." : "El bot dejó de contestar.");
    });
  }

  return (
    <Hoja>
      <Seccion titulo="Respuestas automáticas" icono={Bot} columnas={1}>
        <Interruptor etiqueta="Contesta el bot" icono={Bot} marcado={prendido} alCambiar={cambiar} />
      </Seccion>
      <Seccion titulo="Pasa a una persona" icono={UserRound} columnas={1}>
        <form {...sinReiniciar(guardar)} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1 space-y-2">
            <Label htmlFor="numero-humano">WhatsApp de la persona</Label>
            <Input key={numero} id="numero-humano" name="numero" defaultValue={numero} inputMode="tel" placeholder="549 223 590 3118" />
          </div>
          <button
            type="submit"
            disabled={guardando}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
          {estado.error && <p className="w-full text-base text-destructive">{estado.error}</p>}
          {estado.ok && <p className="w-full text-base text-muted-foreground">{estado.ok}</p>}
        </form>
      </Seccion>
    </Hoja>
  );
}
