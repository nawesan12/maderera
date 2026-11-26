"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { CobroMultimedio } from "@/components/cobros/cobro-multimedio";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatearMonto } from "@/lib/formato";
import {
  cobrarCuentaEnMostrador,
  cuentaDelCliente,
  type EstadoCobroDeCuenta,
} from "./actions";
import { enfocar } from "./atajos";
import type { Cliente } from "./tipos";

/**
 * Lo que debe el cliente elegido, y cobrárselo ahí mismo.
 *
 * El cliente que viene a pagar su cuenta no viene a comprar: hasta acá había
 * que mandarlo a esperar a que alguien abriera la ficha en el panel. Con el
 * cliente elegido aparece lo que debe y el cobro con su recibo (`Alt + R`).
 */
export function SaldoDelCliente({
  cliente,
  branchId,
  enLinea,
  aCuenta = 0,
}: {
  cliente: Cliente;
  branchId: string;
  enLinea: boolean;
  /** Lo que la venta de ahora carga a cuenta corriente (0 si no carga). */
  aCuenta?: number;
}) {
  const [saldo, setSaldo] = useState<{
    de: string;
    monto: number;
    sinCobrar: { id: string; numero: string; monto: number }[];
  } | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!enLinea) return;
    let vigente = true;
    cuentaDelCliente(cliente.id).then((c) => {
      if (vigente) setSaldo({ de: cliente.id, monto: c.saldo, sinCobrar: c.sinCobrar });
    });
    return () => {
      vigente = false;
    };
  }, [cliente.id, enLinea, abierto]);

  // El saldo es del cliente que se pidió: si se cambió en el medio, no se muestra.
  const monto = saldo?.de === cliente.id ? saldo.monto : null;
  /*
   * El límite y lo que queda, junto al «Debe», antes de armar la venta: el
   * PIN aparecía recién al cobrar, con la venta hecha (mes simulado, H026).
   * Lo que la venta de ahora pasa del límite se marca en el acto.
   */
  const limite = cliente.limiteCredito ?? 0;
  const quedan = monto !== null && limite > 0 ? Math.round((limite - Math.max(monto, 0)) * 100) / 100 : null;
  const pasa = quedan !== null && aCuenta > 0 ? Math.round((aCuenta - quedan) * 100) / 100 : 0;
  const lineaDelLimite =
    quedan !== null ? (
      <span className={`tabular block ${pasa > 0 || quedan <= 0 ? "estado-problema font-semibold" : "text-muted-foreground"}`}>
        límite {formatearMonto(limite)} · {quedan > 0 ? `quedan ${formatearMonto(quedan)}` : "sin margen"}
        {pasa > 0 && ` · pasa ${formatearMonto(pasa)} · PIN admin`}
      </span>
    ) : null;
  if (monto === null) return null;
  /*
   * Los pedidos entregados sin cobrar no están en la cuenta: se ven acá, con
   * el enlace a su ficha, que es donde se cobran. Antes el pedido
   * desaparecía para el vendedor (mes simulado, H367).
   */
  const pendientes = saldo?.de === cliente.id ? saldo.sinCobrar : [];
  const sinCobrar =
    pendientes.length > 0 ? (
      <ul className="space-y-1 px-1">
        {pendientes.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="estado-problema">
              <span className="codigo">{p.numero}</span> sin cobrar{" "}
              <strong className="tabular">{formatearMonto(p.monto)}</strong>
            </span>
            <a
              href={`/admin/pedidos/${p.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center rounded-lg border border-linea px-3 text-sm font-medium transition-colors hover:bg-hundida"
            >
              Cobrar
            </a>
          </li>
        ))}
      </ul>
    ) : null;
  if (Math.abs(monto) < 0.01) {
    if (!sinCobrar && !(quedan !== null && aCuenta > 0)) return null;
    return (
      <div className="space-y-1.5">
        {quedan !== null && aCuenta > 0 && <p className="px-1 text-sm">Sin deuda{lineaDelLimite}</p>}
        {sinCobrar}
      </div>
    );
  }

  if (monto < 0) {
    return (
      <div className="space-y-1.5">
        <p className="px-1 text-sm text-muted-foreground">
          Tiene <strong className="tabular text-saldo-favor">{formatearMonto(-monto)}</strong> a
          favor: se usa cobrando con «Cuenta corriente».
        </p>
        {sinCobrar}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
    {/* El límite va en su renglón y el botón, sin partirse: con los dos en
        uno, el botón quedaba apretado en tres renglones y el texto se le
        salía. Si no entran juntos, el botón baja. */}
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1">
      <p className="min-w-0 flex-1 basis-56 text-sm">
        Debe <strong className="tabular text-saldo-debe">{formatearMonto(monto)}</strong>
        {lineaDelLimite}
      </p>
      <button
        type="button"
        data-foco="recibo"
        onClick={() => setAbierto(true)}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-linea px-3 text-sm font-medium transition-colors hover:bg-hundida"
      >
        Cobrar su cuenta
        <kbd className="rounded border border-linea px-1 text-xs text-muted-foreground">Alt + R</kbd>
      </button>
      {abierto && (
        <CobroDeCuenta
          cliente={cliente}
          branchId={branchId}
          debe={monto}
          onCerrar={() => {
            setAbierto(false);
            enfocar("buscador");
          }}
        />
      )}
    </div>
    {sinCobrar}
    </div>
  );
}

export function CobroDeCuenta({
  cliente,
  branchId,
  debe,
  onCerrar,
}: {
  cliente: Cliente;
  branchId: string;
  debe: number;
  onCerrar: () => void;
}) {
  // Una por cobro (el diálogo nace al abrirse): si se pierde la respuesta y
  // se aprieta otra vez, Go devuelve el mismo recibo.
  const [clave] = useState(() => crypto.randomUUID());
  /*
   * Cobrar más de lo que debe pide un segundo toque: la única señal era una
   * leyenda chica en ámbar, cobraba al primer clic y el cliente quedaba con
   * plata a favor tomada de más (mes simulado, H368).
   */
  const [suma, setSuma] = useState(debe);
  const excede = Math.round((suma - debe) * 100) / 100;
  const [confirmaExceso, setConfirmaExceso] = useState<number | null>(null);
  const [estado, accion, pendiente] = useActionState(
    async (previo: EstadoCobroDeCuenta, formData: FormData) => {
      // La acción es la del último render: ve la suma y la confirmación de ahora.
      if (excede > 0.005 && confirmaExceso !== excede) {
        setConfirmaExceso(excede);
        return previo;
      }
      const r = await cobrarCuentaEnMostrador(previo, formData);
      if (r.ok && r.receiptId) {
        toast.success(r.ok);
        // El recibo se imprime en el acto: el cliente está esperando el papel.
        window.open(`/api/recibos/${r.receiptId}/pdf`, "_blank");
        onCerrar();
      }
      return r;
    },
    {} as EstadoCobroDeCuenta,
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight">
            Cobro de cuenta — {cliente.nombre}
          </DialogTitle>
        </DialogHeader>
        <p className="text-base text-muted-foreground">
          Debe <strong className="tabular text-foreground">{formatearMonto(debe)}</strong>. Si paga
          una parte, cargá solo lo que paga.
        </p>
        <form
          action={accion}
          onKeyDown={(e) => {
            // Enter avanza de campo en campo; en el último, cobra.
            if (e.key !== "Enter" || e.target instanceof HTMLButtonElement) return;
            const campos = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]), select"),
            );
            const i = campos.indexOf(e.target as HTMLElement);
            if (i < 0) return;
            e.preventDefault();
            if (i < campos.length - 1) campos[i + 1]!.focus();
            else e.currentTarget.requestSubmit();
          }}
          className="space-y-4"
        >
          <input type="hidden" name="customerId" value={cliente.id} />
          <input type="hidden" name="branchId" value={branchId} />
          <input type="hidden" name="clave" value={clave} />
          <CobroMultimedio aCobrar={debe} onTotal={setSuma} />
          {estado.error && (
            <p role="alert" className="estado-problema rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base">
              {estado.error}
            </p>
          )}
          <button
            type="submit"
            disabled={pendiente}
            className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold disabled:opacity-60 ${
              excede > 0.005 && confirmaExceso === excede
                ? "bg-destructive text-white hover:bg-destructive/90"
                : "boton-accion"
            }`}
          >
            {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
            {excede > 0.005 && confirmaExceso === excede
              ? `Cobrar igual: quedan ${formatearMonto(excede)} a favor`
              : "Cobrar e imprimir el recibo"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
