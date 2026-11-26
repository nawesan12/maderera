"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Loader2 } from "lucide-react";
import { cambiarEntrega } from "@/app/admin/ventas-actions";
import { CampoFecha } from "@/components/ui/campo-fecha";

/**
 * El día comprometido de entrega, editable. Es lo que dice si el pedido está
 * atrasado en «Para hoy»; antes salía solo del presupuesto de origen, y un
 * pedido del mostrador o de la tienda no tenía ninguno.
 */
export function DiaDeEntrega({
  id,
  dia,
  editable,
  retiro,
}: {
  id: string;
  dia: string | null;
  editable: boolean;
  retiro: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(dia ?? "");
  const [pendiente, empezar] = useTransition();
  const etiqueta = retiro ? "Lo retira el" : "Se entrega el";
  const vencido = dia !== null && dia < new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

  if (!editable) {
    return dia ? (
      <p className="mt-2 flex items-center gap-2 text-base">
        <CalendarClock className="h-5 w-5 shrink-0 text-muted-foreground" />
        {etiqueta} <strong className="tabular">{dia.split("-").reverse().join("/")}</strong>
      </p>
    ) : null;
  }

  return (
    <label className="mt-3 block">
      <span className={`flex items-center gap-2 text-base ${vencido ? "font-medium text-saldo-debe" : "text-muted-foreground"}`}>
        <CalendarClock className="h-5 w-5 shrink-0" />
        {etiqueta}
        {vencido && " · atrasado"}
        {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
      </span>
      <CampoFecha
        soloCompleta
        value={valor}
        onChange={(e) => {
          const nuevo = e.target.value;
          setValor(nuevo);
          empezar(async () => {
            const r = await cambiarEntrega(id, nuevo);
            if (r.error) {
              toast.error(r.error);
              setValor(dia ?? "");
            } else {
              toast.success(r.ok ?? "Guardado.");
              router.refresh();
            }
          });
        }}
        className="tabular mt-1 h-11 w-full rounded-lg bg-hundida px-3 text-base"
      />
    </label>
  );
}
