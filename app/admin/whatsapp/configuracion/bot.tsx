"use client";

import { useActionState, useState, useTransition } from "react";
import { Bot, Gauge, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Hoja, Interruptor, Seccion, sinReiniciar } from "@/components/admin/formulario";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cambiarBot, guardarNumeroHumano, guardarTopeMensajes, type EstadoAviso } from "./acciones";

type UsoMensajes = { usados: number; tope: number; proporcion: number; ahorro: boolean; alcanzado: boolean };

/**
 * El bot de WhatsApp (backend/internal/whatsapp/bot.go): contesta solo lo que
 * se resuelve con datos y deriva el resto a una persona, en el número de acá.
 * Sin número, la persona contesta desde esta bandeja.
 *
 * Abajo, los mensajes del mes contra el tope (backend/internal/whatsapp/uso.go):
 * al 80 % el bot ahorra —no saluda, deriva a la primera que no entiende— y al
 * 100 % no manda nada automático.
 */
export function ConfiguracionDelBot({
  encendido,
  numero,
  mensajes,
}: {
  encendido: boolean;
  numero: string;
  mensajes: UsoMensajes;
}) {
  const [prendido, setPrendido] = useState(encendido);
  const [, empezar] = useTransition();
  const [estado, guardar, guardando] = useActionState<EstadoAviso, FormData>(guardarNumeroHumano, {});
  const [estadoTope, guardarTope, guardandoTope] = useActionState<EstadoAviso, FormData>(guardarTopeMensajes, {});
  const porcentaje = Math.round(mensajes.proporcion * 100);

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
      <Seccion titulo="Mensajes del mes" icono={Gauge} columnas={1}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-base">
              <span className="tabular text-2xl font-semibold">{mensajes.usados}</span>{" "}
              <span className="text-muted-foreground">de {mensajes.tope}</span>
            </p>
            <p
              className={`text-base ${mensajes.alcanzado ? "estado-problema font-medium text-[var(--estado-tinta)]" : mensajes.ahorro ? "estado-espera font-medium text-[var(--estado-tinta)]" : "text-muted-foreground"}`}
            >
              {mensajes.alcanzado ? "Tope: el bot no contesta" : mensajes.ahorro ? "Bot en ahorro" : <span className="tabular">{porcentaje} %</span>}
            </p>
          </div>
          <div
            role="meter"
            aria-label="Mensajes del mes contra el tope"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(porcentaje, 100)}
            className="h-3 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={`h-full rounded-full ${mensajes.alcanzado ? "bg-red-600" : mensajes.ahorro ? "bg-amber-500" : "bg-brand-green"}`}
              style={{ width: `${Math.min(porcentaje, 100)}%` }}
            />
          </div>
          <form {...sinReiniciar(guardarTope)} className="flex flex-wrap items-end gap-3">
            <div className="w-40 space-y-2">
              <Label htmlFor="tope-mensajes">Tope</Label>
              <Input key={mensajes.tope} id="tope-mensajes" name="tope" defaultValue={mensajes.tope} inputMode="numeric" />
            </div>
            <button
              type="submit"
              disabled={guardandoTope}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white disabled:opacity-60"
            >
              {guardandoTope && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </button>
            {estadoTope.error && <p className="w-full text-base text-destructive">{estadoTope.error}</p>}
            {estadoTope.ok && <p className="w-full text-base text-muted-foreground">{estadoTope.ok}</p>}
          </form>
        </div>
      </Seccion>
    </Hoja>
  );
}
