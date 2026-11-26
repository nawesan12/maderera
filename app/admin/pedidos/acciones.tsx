"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Ban, FileText, Loader2, PenLine, Scissors } from "lucide-react";
import { avanzarPedido, cancelarPedido } from "@/app/admin/ventas-actions";
import { DialogoCobro } from "@/components/cobros/dialogo-cobro";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { moneda } from "@/components/admin/formato";

const SIGUIENTE: Record<string, string> = {
  pendiente: "Preparar",
  preparando: "Marcar listo",
  listo: "Despachar",
  "en-camino": "Marcar entregado",
};

export function AccionesPedido({
  id,
  estado,
  estadoPago,
  tipoEntrega,
  compacto = false,
  cobro,
  sinCobrar,
  pedido,
  cortesSinTerminar = [],
  acopio = false,
  enLaFicha = false,
  porLlevar = false,
  firmar = null,
}: {
  id: string;
  estado: string;
  estadoPago: string;
  tipoEntrega: string;
  /** En una tarjeta de tablero los botones ocupan el ancho disponible. */
  compacto?: boolean;
  /**
   * Para cobrar: con recibo, tenga o no cliente, y el efectivo a la caja de su
   * sucursal (cobros.CobrarPedido). Antes «Cobrar» marcaba el pedido pagado
   * sin recibo ni caja. Sin esto (el depósito, que no mueve plata), el botón
   * no aparece.
   */
  cobro?: { numero: string; aCobrar: number; customerId: string | null; nombre: string } | null;
  /**
   * Lo que falta cobrar fuera de la cuenta corriente (`sinCobrar` del
   * pedido, la misma regla que «Me deben»). Con algo, «Marcar entregado»
   * pregunta antes, en el tablero y en el reparto por igual: lo fuerte es
   * «Cobrar y entregar» (el pago contra entrega es lo normal), y entregar sin
   * cobrar queda al lado, sin bloquearse. El servidor deja la firma en el
   * historial igual.
   */
  sinCobrar?: { numero: string; monto: number } | null;
  /**
   * El número (para el título de la confirmación) y quién figura como
   * contacto: precarga «quién retira», que casi siempre es el mismo.
   */
  pedido?: { numero: string; nombre?: string | null };
  /**
   * Los cortes del pedido que todavía no salieron de la máquina: el pedido
   * no se marca listo ni sale (Go lo rechaza). En el lugar del botón va el
   * corte que espera (mes simulado: se marcaba listo con el corte en cola).
   */
  cortesSinTerminar?: string[];
  /**
   * Un acopio en curso: lo que se hace en cada visita es un remito con lo
   * que se lleva, no «Marcar entregado», que se lleva todo lo que queda.
   */
  acopio?: boolean;
  /** En la ficha, «Preparar remito» abre el formulario sin salir de la página. */
  enLaFicha?: boolean;
  /**
   * Queda algo que no salió en ningún remito. Un envío en camino así no se
   * marca entregado (Go lo rechaza: «tiene productos por llevar»): lo que
   * sigue es la firma del remito que va en el camión.
   */
  porLlevar?: boolean;
  /** La firma del remito de envío que está en la calle (la ficha la tiene). */
  firmar?: string | null;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  // «Cobrar y entregar» abre el cobro y, cobrado, entrega.
  const [cobrandoParaEntregar, setCobrandoParaEntregar] = useState(false);
  // Quién retira: el remito que sale al entregar un retiro lo lleva, y el
  // documento es obligatorio como en el remito a mano.
  const [receptorNombre, setReceptorNombre] = useState(pedido?.nombre ?? "");
  const [receptorDocumento, setReceptorDocumento] = useState("");

  // Un pedido de retiro no se despacha: el cliente lo busca.
  const etiqueta =
    estado === "listo" && tipoEntrega === "retiro"
      ? "Marcar entregado"
      : SIGUIENTE[estado];

  function accion(fn: () => Promise<{ ok?: string; error?: string }>) {
    startTransition(async () => {
      const resultado = await fn();
      if (resultado.error) toast.error(resultado.error);
      else {
        setConfirmando(false);
        toast.success(resultado.ok ?? "Listo.");
      }
      // También con error: si fue un 409 («ya estaba en la máquina»), la
      // pantalla tiene que mostrar el estado de verdad.
      router.refresh();
    });
  }

  const entregaUnRetiro = estado === "listo" && tipoEntrega === "retiro";
  const esperaCorte =
    cortesSinTerminar.length > 0 && ["Marcar listo", "Despachar", "Marcar entregado"].includes(etiqueta ?? "");
  // Un acopio que ya empezó a salir se atiende de a remitos, esté como esté
  // el pedido: «Preparar» o «Marcar entregado» se llevaban todo lo que
  // queda (mes simulado, H104).
  const preparaRemito = acopio && tipoEntrega === "retiro" && ["pendiente", "preparando", "listo"].includes(estado);
  // El envío en camino con algo por llevar: se firma el remito del camión.
  const esperaFirma = estado === "en-camino" && porLlevar;
  const debe = etiqueta === "Marcar entregado" && sinCobrar != null && sinCobrar.monto > 0;
  // «Marcar entregado» emite el remito y no tiene vuelta: siempre pregunta,
  // también cuando no hay nada que cobrar ni documento que pedir.
  const preguntar = debe || entregaUnRetiro || etiqueta === "Marcar entregado";
  const numero = pedido?.numero ?? sinCobrar?.numero ?? cobro?.numero;
  const faltaDocumento = entregaUnRetiro && receptorDocumento.trim() === "";

  function avanzar() {
    return avanzarPedido(
      id,
      estado,
      entregaUnRetiro ? { receptorNombre: receptorNombre.trim(), receptorDocumento: receptorDocumento.trim() } : undefined,
    );
  }

  return (
    <div className={`flex items-center gap-2 ${compacto ? "w-full" : ""}`}>
      {estadoPago !== "pagado" && estado !== "cancelado" && cobro && cobro.aCobrar > 0 && (
        <DialogoCobro
          customerId={cobro.customerId}
          nombre={cobro.nombre}
          aCobrar={cobro.aCobrar}
          pedido={{ id, numero: cobro.numero }}
          etiqueta="Cobrar"
          claseBoton={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
        />
      )}

      {preparaRemito ? (
        <Link
          href={enLaFicha ? "?remito=1#remito" : `/admin/pedidos/${id}?remito=1#remito`}
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
        >
          <FileText className="h-5 w-5" />
          Preparar remito
        </Link>
      ) : esperaFirma ? (
        firmar || !enLaFicha ? (
          <Link
            href={firmar ?? `/admin/pedidos/${id}#remito`}
            className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
          >
            <PenLine className="h-5 w-5" aria-hidden="true" />
            Firmar
          </Link>
        ) : null
      ) : esperaCorte ? (
        <span
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-hundida px-3 text-base font-medium text-muted-foreground ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
        >
          <Scissors className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="truncate">{cortesSinTerminar.join(", ")}</span>
        </span>
      ) : etiqueta && (
        <button
          onClick={() => (preguntar ? setConfirmando(true) : accion(avanzar))}
          disabled={pendiente}
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium transition-colors disabled:opacity-50 ${compacto ? "min-w-0 flex-1 basis-0" : ""}`}
        >
          {pendiente ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <ArrowRight className="h-5 w-5" />
          )}
          {etiqueta}
        </button>
      )}

      {preguntar && !esperaCorte && !preparaRemito && !esperaFirma && (
        <Dialog open={confirmando} onOpenChange={(abierto) => !pendiente && setConfirmando(abierto)}>
          <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>
                {debe && sinCobrar ? (
                  <>
                    {sinCobrar.numero} sin cobrar · <span className="tabular">{moneda.format(sinCobrar.monto)}</span>
                  </>
                ) : entregaUnRetiro ? (
                  "Quién retira"
                ) : (
                  <>Entregar {numero && <span className="tabular whitespace-nowrap">{numero}</span>}</>
                )}
              </DialogTitle>
            </DialogHeader>
            {/* En camino, el remito ya salió con el camión. */}
            {!debe && !entregaUnRetiro && estado !== "en-camino" && (
              <p className="text-base text-muted-foreground">Sale el remito. No se puede deshacer.</p>
            )}
            {/* Un <form>: Enter hace lo principal (entregar, o cobrar y
                entregar si se debe). */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (pendiente || faltaDocumento) return;
                if (debe && sinCobrar && cobro) {
                  setConfirmando(false);
                  setCobrandoParaEntregar(true);
                } else accion(avanzar);
              }}
              className="space-y-3"
            >
            {entregaUnRetiro && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-base font-medium">
                  Nombre
                  <Input
                    name="receptorNombre"
                    value={receptorNombre}
                    onChange={(e) => setReceptorNombre(e.target.value)}
                    maxLength={120}
                    autoComplete="off"
                    // Vacío, se empieza por el nombre; precargado con el del
                    // contacto, lo que falta es el documento.
                    autoFocus={!receptorNombre}
                  />
                </label>
                <label className="grid gap-1.5 text-base font-medium">
                  Documento
                  {/* Texto y sin teclado numérico: un pasaporte o una cédula
                      extranjera llevan letras. */}
                  <Input
                    name="receptorDocumento"
                    value={receptorDocumento}
                    onChange={(e) => setReceptorDocumento(e.target.value)}
                    maxLength={30}
                    required
                    autoFocus={Boolean(receptorNombre)}
                    autoComplete="off"
                    aria-describedby="falta-documento"
                  />
                </label>
                {faltaDocumento && (
                  <p id="falta-documento" className="text-sm text-muted-foreground sm:col-span-2">
                    Falta el documento de quien retira.
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {/* Quien no cobra (el depósito) tiene dos caminos con peso: no
                  soltar la mercadería, que es lo que queda a mano, o
                  entregarla igual, que deja su nombre en el historial (mes
                  simulado: era un solo botón de texto, sin jerarquía). */}
              {debe && !cobro && (
                <button
                  type="button"
                  autoFocus={!entregaUnRetiro}
                  onClick={() => setConfirmando(false)}
                  className="inline-flex h-11 items-center rounded-lg px-4 text-base font-medium hover:bg-hundida"
                >
                  Mejor no
                </button>
              )}
              {debe ? (
                <button
                  type={cobro ? "button" : "submit"}
                  disabled={pendiente || faltaDocumento}
                  onClick={cobro ? () => accion(avanzar) : undefined}
                  className={`inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50 ${
                    cobro ? "hover:bg-hundida" : "estado-problema border"
                  }`}
                >
                  {pendiente && !cobro && <Loader2 className="h-4 w-4 animate-spin" />}
                  Entregar sin cobrar
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={pendiente || faltaDocumento}
                  className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
                >
                  {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
                  Entregar
                </button>
              )}
              {/* Cobrar ahí mismo, con recibo: antes había que cerrar, buscar
                  «Cobrar» en la tarjeta y volver a entregar. Quien no cobra no
                  ve el cobro. */}
              {debe && sinCobrar && cobro && (
                <button
                  type="submit"
                  autoFocus={!entregaUnRetiro}
                  disabled={pendiente || faltaDocumento}
                  className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
                >
                  Cobrar <span className="tabular">{moneda.format(sinCobrar.monto)}</span> y entregar
                </button>
              )}
            </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {debe && sinCobrar && cobro && !esperaFirma && !preparaRemito && (
        <DialogoCobro
          sinBoton
          abierto={cobrandoParaEntregar}
          alCambiarAbierto={setCobrandoParaEntregar}
          customerId={cobro.customerId}
          nombre={cobro.nombre}
          aCobrar={sinCobrar.monto}
          pedido={{ id, numero: cobro.numero }}
          alCobrar={() => accion(avanzar)}
        />
      )}
    </div>
  );
}

/**
 * Cancelar el pedido, con el motivo. Libera lo reservado y, si cargó deuda,
 * la devuelve. La acción existía en el servidor y no tenía botón: un pedido
 * que el cliente no quería más quedaba en el tablero para siempre.
 */
export function CancelarPedido({ id, numero, cobrado }: { id: string; numero: string; cobrado: boolean }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pendiente, startTransition] = useTransition();

  function cancelar() {
    startTransition(async () => {
      const r = await cancelarPedido(id, motivo.trim() || undefined);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.ok ?? "Pedido cancelado.");
        setAbierto(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Ban className="h-5 w-5" />
        Cancelar pedido
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar el pedido {numero}</DialogTitle>
          </DialogHeader>
          {cobrado && (
            <p className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base text-[var(--estado-tinta)]">
              Ya está cobrado: la plata no vuelve sola, hay que devolvérsela.
            </p>
          )}
          <label htmlFor="motivo-cancelacion" className="text-base font-medium">
            Por qué
          </label>
          <Textarea
            id="motivo-cancelacion"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            rows={3}
          />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="h-11 rounded-lg px-4 text-base font-medium hover:bg-hundida"
            >
              Mejor no
            </button>
            <button
              type="button"
              disabled={pendiente}
              onClick={cancelar}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-destructive px-4 text-base font-medium text-white disabled:opacity-50"
            >
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancelar el pedido
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
