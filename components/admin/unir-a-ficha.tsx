"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { unirAFicha } from "@/app/admin/ventas-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatearMonto } from "@/lib/formato";

/**
 * Un pedido o presupuesto sin cliente cuyo correo es el de una ficha: la
 * tienda ya no lo ata sola sin la sesión de ese correo (cualquiera que lo
 * supiera le metía pedidos en el historial). Acá lo une una persona.
 *
 * Unir a mano no puede repetir a ciegas lo que hacía la unión automática
 * (comité del 25/11): el aviso dice por qué aparece —llegó con ese correo
 * sin entrar a la cuenta, y el correo no está verificado— y, antes de unir,
 * se ven lado a lado el contacto del pedido y la ficha, con el total. Go solo
 * ofrece la ficha si es la única con ese correo y no tiene cuenta web.
 *
 * Con recibos o comprobantes ya emitidos sin cliente no se une (Go lo
 * rechaza igual): se dice por qué y queda el enlace a la ficha para verla.
 */
export function UnirAFicha({
  que,
  id,
  numero,
  total,
  contacto,
  ficha,
}: {
  que: "pedido" | "presupuesto";
  id: string;
  numero: string;
  total: number;
  contacto: { nombre: string; telefono: string | null };
  ficha: { id: string; nombre: string; telefono?: string | null; unible: boolean };
}) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [abierto, setAbierto] = useState(false);

  function unir() {
    empezar(async () => {
      const r = await unirAFicha(que, id, ficha.id);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      setAbierto(false);
      toast.success(r.ok ?? "Unido.");
      router.refresh();
    });
  }

  const elPedido = que === "pedido" ? "El pedido" : "El presupuesto";

  return (
    <div className="estado-espera mt-3 space-y-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2.5 text-base">
      <p className="text-sm">
        Llegó con el correo de{" "}
        <Link href={`/admin/clientes/${ficha.id}`} className="font-semibold underline-offset-2 hover:underline">
          {ficha.nombre}
        </Link>
        , sin entrar a su cuenta. El correo no está verificado.
      </p>
      {ficha.unible ? (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="boton-accion inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold"
        >
          <Link2 className="h-4 w-4" />
          Unir a su ficha
        </button>
      ) : (
        <p className="text-sm">Ya tiene recibo o factura: no se puede unir desde acá.</p>
      )}

      <Dialog open={abierto} onOpenChange={(v) => !pendiente && setAbierto(v)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Unir <span className="tabular whitespace-nowrap">{numero}</span> a {ficha.nombre}
            </DialogTitle>
            <DialogDescription className="text-base">
              {elPedido} de {formatearMonto(total)} pasa a su ficha
              {que === "pedido" ? ", con sus pagos y sus cortes" : ""}. Fijate que sea la misma persona: no
              se puede deshacer desde acá.
            </DialogDescription>
          </DialogHeader>

          <table className="w-full table-fixed text-left text-base">
            <thead>
              <tr className="text-sm text-muted-foreground">
                <th className="w-20 pb-1 font-normal">
                  <span className="sr-only">Dato</span>
                </th>
                <th className="pb-1 font-semibold">En {que === "pedido" ? "el pedido" : "el presupuesto"}</th>
                <th className="pb-1 font-semibold">En la ficha</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="py-1 pr-2 text-sm font-normal text-muted-foreground">Nombre</th>
                <td className="py-1 pr-2 break-words">{contacto.nombre || "—"}</td>
                <td className="py-1 break-words">{ficha.nombre}</td>
              </tr>
              <tr>
                <th className="py-1 pr-2 text-sm font-normal text-muted-foreground">Teléfono</th>
                <td className="tabular py-1 pr-2 break-words">{contacto.telefono || "—"}</td>
                <td className="tabular py-1 break-words">{ficha.telefono || "—"}</td>
              </tr>
            </tbody>
          </table>

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="h-11 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
            >
              Mejor no
            </button>
            <button
              type="button"
              disabled={pendiente}
              onClick={unir}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
            >
              {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Unir a su ficha
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
