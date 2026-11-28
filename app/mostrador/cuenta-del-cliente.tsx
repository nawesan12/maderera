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
  onSaldo,
}: {
  cliente: Cliente;
  branchId: string;
  enLinea: boolean;
  /** Lo que la venta de ahora carga a cuenta corriente (0 si no carga). */
  aCuenta?: number;
  /** El saldo leído (negativo: a favor), para saber si se le puede anotar. */
  onSaldo?: (de: string, monto: number) => void;
}) {
  const [saldo, setSaldo] = useState<{
    de: string;
    monto: number;
    sinCobrar: { id: string; numero: string; monto: number }[];
    informados: { cantidad: number; total: number };
  } | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!enLinea) return;
    let vigente = true;
    cuentaDelCliente(cliente.id).then((c) => {
      if (!vigente) return;
      setSaldo({ de: cliente.id, monto: c.saldo, sinCobrar: c.sinCobrar, informados: c.informados });
      onSaldo?.(cliente.id, c.saldo);
    });
    return () => {
      vigente = false;
    };
    // onSaldo es de la pantalla y cambia en cada render: no vuelve a pedir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  /*
   * El límite en gris, en su renglón, y lo que la venta pasa destacado al
   * lado del «Debe»: todo junto quedaba apretado en cuatro renglones rojos al
   * lado del botón (mes simulado, M2S3-101).
   */
  const lineaDelLimite =
    quedan !== null ? (
      <span className={`tabular block text-sm ${quedan <= 0 ? "estado-problema font-semibold" : "text-muted-foreground"}`}>
        límite {formatearMonto(limite)} · {quedan > 0 ? `quedan ${formatearMonto(quedan)}` : "sin margen"}
      </span>
    ) : null;
  const pasaElLimite =
    pasa > 0 ? (
      <span className="tabular estado-problema whitespace-nowrap font-semibold">pasa {formatearMonto(pasa)} · PIN</span>
    ) : null;
  // La cuenta bloqueada se ve al elegir al cliente, no recién al cobrar
  // (M3S3-050); la que no tiene cuenta, también (M2S4-061).
  const estadoDeLaCuenta = cliente.cuentaBloqueada ? (
    <span className="estado-problema whitespace-nowrap rounded-md bg-[var(--estado-fondo)] px-1.5 py-0.5 text-sm font-semibold text-[var(--estado-tinta)]">
      Cuenta bloqueada
    </span>
  ) : cliente.limiteCredito === 0 && !(monto !== null && monto < 0) ? (
    <span className="whitespace-nowrap rounded-md bg-hundida px-1.5 py-0.5 text-sm text-muted-foreground">Sin cuenta corriente</span>
  ) : null;
  if (monto === null) return estadoDeLaCuenta ? <p className="px-1">{estadoDeLaCuenta}</p> : null;
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
    if (!sinCobrar && !(quedan !== null && aCuenta > 0) && !estadoDeLaCuenta) return null;
    return (
      <div className="space-y-1.5">
        {(estadoDeLaCuenta || (quedan !== null && aCuenta > 0)) && (
          <div className="px-1 text-sm">
            <p className="flex flex-wrap items-baseline gap-x-2">
              {quedan !== null && aCuenta > 0 && <span>Sin deuda</span>}
              {pasaElLimite}
              {estadoDeLaCuenta}
            </p>
            {aCuenta > 0 && lineaDelLimite}
          </div>
        )}
        {sinCobrar}
      </div>
    );
  }

  if (monto < 0) {
    return (
      <div className="space-y-1.5">
        <p className="px-1 text-sm text-muted-foreground">
          Tiene <strong className="tabular text-saldo-favor">{formatearMonto(-monto)}</strong> a
          favor{cliente.cuentaBloqueada ? " " : ": se usa cobrando con «Cuenta corriente»."}
          {estadoDeLaCuenta}
        </p>
        {sinCobrar}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
    {/* Lo que debe y lo que la venta pasa del límite, juntos y destacados; el
        límite en gris abajo, y el cobro de la cuenta en su propia fila. */}
    <div className="space-y-1.5 px-1">
      <div className="text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span>
            Debe <strong className="tabular text-saldo-debe">{formatearMonto(monto)}</strong>
          </span>
          {pasaElLimite}
          {estadoDeLaCuenta}
        </p>
        {lineaDelLimite}
      </div>
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
          informados={saldo?.informados}
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
  informados,
  onCerrar,
}: {
  cliente: Cliente;
  branchId: string;
  debe: number;
  /**
   * Los cheques informados desde el portal: a la vista antes de cobrar la
   * misma deuda por otro lado, como en el panel (M4-065, recorrido 2).
   */
  informados?: { cantidad: number; total: number };
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
          {informados && informados.cantidad > 0 && (
            <span className="estado-espera mt-1 inline-flex w-fit items-center rounded-full bg-[var(--estado-fondo)] px-2.5 py-0.5 text-sm font-medium text-[var(--estado-tinta)]">
              {informados.cantidad === 1 ? "1 cheque informado" : `${informados.cantidad} cheques informados`} ·{" "}
              <span className="tabular ml-1">{formatearMonto(informados.total)}</span>
            </span>
          )}
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
