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
import { formatearMonto } from "@/components/admin/formato";
import type { MedioDeCobro } from "@/lib/cobros/partes";
import { CampoPin, type Autorizacion } from "@/components/autorizacion/campo-pin";
import { revisarDocumentoDeRetiro } from "@/lib/entregas/documento";

type ResultadoDeAvance = { ok?: string; error?: string; autorizacion?: Autorizacion; firmaToken?: string; campo?: string };

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
  secundario = false,
  cobro,
  sinCobrar,
  pedido,
  cortesSinTerminar = [],
  acopio = false,
  enLaFicha = false,
  porLlevar = false,
  firmar = null,
  remitoAFirmar = null,
  sinAvance = false,
}: {
  id: string;
  estado: string;
  estadoPago: string;
  tipoEntrega: string;
  /** En una tarjeta de tablero los botones ocupan el ancho disponible. */
  compacto?: boolean;
  /**
   * El botón de avanzar sin el naranja de acción: en una lista de cuatro
   * pedidos por preparar, cuatro llamados principales iguales no dicen por
   * dónde empezar (mes simulado, M2S4-047).
   */
  secundario?: boolean;
  /**
   * Para cobrar: con recibo, tenga o no cliente, y el efectivo a la caja de su
   * sucursal (cobros.CobrarPedido). Antes «Cobrar» marcaba el pedido pagado
   * sin recibo ni caja. Sin esto (el depósito, que no mueve plata), el botón
   * no aparece.
   */
  cobro?: { numero: string; aCobrar: number; customerId: string | null; nombre: string; medio?: MedioDeCobro } | null;
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
  /**
   * El número de ese remito: el diálogo de entregar lo nombra en el botón
   * de firmar (venía sin decir qué remito faltaba, mes 23).
   */
  remitoAFirmar?: string | null;
  /**
   * En la ficha, cuando lo que sigue es el remito (que va arriba con su
   * «Preparar remito»): el encabezado deja solo el cobro.
   */
  sinAvance?: boolean;
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
  // El error del documento, recién después de intentar (mes simulado 2: se
  // veía apenas se abría el diálogo, antes de tipear nada).
  const [intento, setIntento] = useState(false);
  const [errorDocumento, setErrorDocumento] = useState<string | null>(null);
  // El PIN de un admin para soltar lo que no se cobró, cuando Go lo pide.
  const [pidePin, setPidePin] = useState<Autorizacion | null>(null);

  // Un pedido de retiro no se despacha: el cliente lo busca.
  const etiqueta =
    estado === "listo" && tipoEntrega === "retiro"
      ? "Marcar entregado"
      : SIGUIENTE[estado];

  const entregaUnRetiro = estado === "listo" && tipoEntrega === "retiro";
  const despacha = etiqueta === "Despachar";

  function accion(fn: () => Promise<ResultadoDeAvance>) {
    startTransition(async () => {
      const resultado = await fn();
      if (resultado.autorizacion) {
        setPidePin(resultado.autorizacion);
        setConfirmando(true);
        return;
      }
      if (resultado.campo === "receptorDocumento") {
        setErrorDocumento(resultado.error ?? null);
        setConfirmando(true);
        return;
      }
      if (resultado.error) toast.error(resultado.error);
      else {
        setConfirmando(false);
        setPidePin(null);
        toast.success(resultado.ok ?? "Listo.");
        // En un retiro el cliente está ahí: lo que sigue es la firma, en la
        // misma pantalla (mes simulado 2: quedaba «Sin firmar» y se olvidaba).
        if (entregaUnRetiro && resultado.firmaToken) {
          router.push(`/firmar/${resultado.firmaToken}?volver=${encodeURIComponent(`/admin/pedidos/${id}`)}`);
          return;
        }
      }
      // También con error: si fue un 409 («ya estaba en la máquina»), la
      // pantalla tiene que mostrar el estado de verdad.
      router.refresh();
    });
  }

  const esperaCorte =
    cortesSinTerminar.length > 0 && ["Marcar listo", "Despachar", "Marcar entregado"].includes(etiqueta ?? "");
  // Un acopio que ya empezó a salir se atiende de a remitos, esté como esté
  // el pedido: «Preparar» o «Marcar entregado» se llevaban todo lo que
  // queda (mes simulado, H104). Preparando, no: «Marcar listo» no se lleva
  // nada, y sin él el acopio con un remito parcial quedaba «Preparando» para
  // siempre (mes 23, PED-1153).
  const preparaRemito = acopio && tipoEntrega === "retiro" && ["pendiente", "listo"].includes(estado);
  // El envío en camino con algo por llevar: se firma el remito del camión.
  const esperaFirma = estado === "en-camino" && porLlevar;
  // Lo que falta cobrar se pregunta cuando la mercadería sale: al entregar
  // un retiro y al despachar un envío (mes simulado 2: despachar no
  // preguntaba nada). En camino ya salió.
  const debe = (entregaUnRetiro || despacha) && sinCobrar != null && sinCobrar.monto > 0;
  // El envío en camino con el remito sin firmar: firmarlo es lo principal y
  // entregar sin firma queda al lado (el diálogo venía vacío). Sin remito
  // pendiente, se confirma en el lugar.
  const firmaDelCamion = estado === "en-camino" && !porLlevar && firmar ? firmar : null;
  const preguntar = debe || entregaUnRetiro || firmaDelCamion != null;
  const numero = pedido?.numero ?? sinCobrar?.numero ?? cobro?.numero;
  // El documento entero se revisa antes de cobrar o entregar, como Go
  // (entregas.RevisarDocumento): uno mal escrito se avisaba recién después
  // de cobrar o de la pregunta «sin cobrar».
  const problemaDocumento = entregaUnRetiro ? revisarDocumentoDeRetiro(receptorDocumento) : null;
  const faltaDocumento = problemaDocumento != null;

  function avanzar(pin?: string) {
    return avanzarPedido(id, estado, {
      ...(entregaUnRetiro ? { receptorNombre: receptorNombre.trim(), receptorDocumento: receptorDocumento.trim() } : {}),
      ...(pin ? { pin } : {}),
    });
  }

  const sinCobrarEtiqueta = despacha ? "Despachar sin cobrar" : "Entregar sin cobrar";
  const cobrarEtiqueta = despacha ? "y despachar" : "y entregar";
  const ancho = compacto ? "min-w-0 flex-1 basis-0" : "";

  return (
    <div className={`flex items-center gap-2 ${compacto ? "w-full" : ""}`}>
      {estadoPago !== "pagado" && estado !== "cancelado" && cobro && cobro.aCobrar > 0 && (
        <DialogoCobro
          customerId={cobro.customerId}
          nombre={cobro.nombre}
          aCobrar={cobro.aCobrar}
          medio={cobro.medio}
          pedido={{ id, numero: cobro.numero }}
          etiqueta="Cobrar"
          claseBoton={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted ${ancho}`}
        />
      )}

      {sinAvance ? null : preparaRemito ? (
        <Link
          href={enLaFicha ? "?remito=1#remito" : `/admin/pedidos/${id}?remito=1#remito`}
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium ${ancho}`}
        >
          <FileText className="h-5 w-5" />
          Preparar remito
        </Link>
      ) : esperaFirma ? (
        firmar || !enLaFicha ? (
          <Link
            href={firmar ?? `/admin/pedidos/${id}#remito`}
            className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium ${ancho}`}
          >
            <PenLine className="h-5 w-5" aria-hidden="true" />
            Firmar
          </Link>
        ) : null
      ) : esperaCorte ? (
        <span
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-hundida px-3 text-base font-medium text-muted-foreground ${ancho}`}
        >
          <Scissors className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="truncate">{cortesSinTerminar.join(", ")}</span>
        </span>
      ) : etiqueta && (
        <button
          onClick={() => {
            if (!preguntar) return accion(() => avanzar());
            setIntento(false);
            setErrorDocumento(null);
            setPidePin(null);
            setConfirmando(true);
          }}
          disabled={pendiente}
          className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg ${secundario ? "border bg-card" : "boton-accion"} px-3 text-base font-medium transition-colors disabled:opacity-50 ${ancho}`}
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
                    {sinCobrar.numero} sin cobrar · <span className="tabular">{formatearMonto(sinCobrar.monto)}</span>
                  </>
                ) : entregaUnRetiro ? (
                  "Quién retira"
                ) : (
                  <>Entregar {numero && <span className="tabular whitespace-nowrap">{numero}</span>}</>
                )}
              </DialogTitle>
            </DialogHeader>
            {pidePin ? (
              <CampoPin
                autorizacion={pidePin}
                enviando={pendiente}
                onEnviar={(pin) => accion(() => avanzar(pin))}
                onCancelar={() => {
                  setPidePin(null);
                  setConfirmando(false);
                }}
              />
            ) : firmaDelCamion ? (
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={pendiente}
                  onClick={() => accion(() => avanzar())}
                  className="inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium hover:bg-hundida disabled:opacity-50"
                >
                  {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
                  Entregar sin firma
                </button>
                <Link
                  href={firmaDelCamion}
                  autoFocus
                  className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium"
                >
                  <PenLine className="h-5 w-5" aria-hidden="true" />
                  {remitoAFirmar ? (
                    <>
                      Firmar <span className="tabular whitespace-nowrap">{remitoAFirmar}</span>
                    </>
                  ) : (
                    "Firmar el remito"
                  )}
                </Link>
              </div>
            ) : (
              /* Un <form>: Enter hace lo principal (entregar, o cobrar y
                 entregar si se debe). */
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setIntento(true);
                  if (pendiente || faltaDocumento) return;
                  if (debe && sinCobrar && cobro) {
                    setConfirmando(false);
                    setCobrandoParaEntregar(true);
                  } else accion(() => avanzar());
                }}
                className="space-y-3"
                noValidate
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
                        // Vacío, se empieza por el nombre; precargado con el
                        // del contacto, lo que falta es el documento.
                        autoFocus={!receptorNombre}
                      />
                    </label>
                    <label className="grid gap-1.5 text-base font-medium">
                      Documento
                      {/* Texto y sin teclado numérico: un pasaporte o una
                          cédula extranjera llevan letras. */}
                      <Input
                        name="receptorDocumento"
                        value={receptorDocumento}
                        onChange={(e) => {
                          setReceptorDocumento(e.target.value);
                          setErrorDocumento(null);
                        }}
                        maxLength={30}
                        autoFocus={Boolean(receptorNombre)}
                        autoComplete="off"
                        aria-invalid={(intento && faltaDocumento) || Boolean(errorDocumento) || undefined}
                        aria-describedby="falta-documento"
                      />
                    </label>
                    {((intento && faltaDocumento) || errorDocumento) && (
                      <p id="falta-documento" role="alert" className="estado-problema text-sm font-medium sm:col-span-2">
                        {errorDocumento ?? problemaDocumento}
                      </p>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap justify-end gap-2 pt-2">
                  {/* Quien no cobra (el depósito) tiene dos caminos con peso:
                      no soltar la mercadería, que es lo que queda a mano, o
                      soltarla con el PIN de un admin. */}
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
                      disabled={pendiente}
                      onClick={
                        cobro
                          ? () => {
                              setIntento(true);
                              if (!faltaDocumento) accion(() => avanzar());
                            }
                          : undefined
                      }
                      className={`inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50 ${
                        cobro ? "hover:bg-hundida" : "estado-problema border"
                      }`}
                    >
                      {pendiente && !cobro && <Loader2 className="h-4 w-4 animate-spin" />}
                      {sinCobrarEtiqueta}
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={pendiente}
                      className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
                    >
                      {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
                      Entregar y firmar
                    </button>
                  )}
                  {/* Cobrar ahí mismo, con recibo. Quien no cobra no ve el
                      cobro. */}
                  {debe && sinCobrar && cobro && (
                    <button
                      type="submit"
                      autoFocus={!entregaUnRetiro}
                      disabled={pendiente}
                      className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
                    >
                      Cobrar <span className="tabular">{formatearMonto(sinCobrar.monto)}</span> {cobrarEtiqueta}
                    </button>
                  )}
                </div>
              </form>
            )}
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
          medio={cobro.medio}
          pedido={{ id, numero: cobro.numero }}
          alCobrar={() => accion(() => avanzar())}
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
