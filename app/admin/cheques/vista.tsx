"use client";

import {
  useActionState,
  useId,
  useState,
  useTransition,
} from "react";
import {
  AlertTriangle,
  Ellipsis,
  Loader2,
  Plus,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Confirmar } from "@/components/admin/confirmar";
import { DialogoCobro } from "@/components/cobros/dialogo-cobro";
import {
  ElegirCliente,
  type ClienteElegido,
} from "@/components/admin/elegir-cliente";
import { ETIQUETA_CIRCUITO } from "@/lib/circuito";
import {
  cambiarEstadoDeCheque,
  cargarCheque,
  type EstadoCheque,
} from "./actions";

const inicial: EstadoCheque = {};

/**
 * Qué botones ofrece cada estado. El resto de transiciones no existen.
 *
 * `anular` viaja aparte porque no es una operación más: no tiene vuelta —un
 * cheque anulado se queda sin botones para siempre— y estaba pegada a
 * "Depositar" con seis píxeles de por medio, en una pantalla que maneja plata.
 */
const ACCIONES: Record<string, { a: string; texto: string }[]> = {
  // Lo informó el cliente: se acepta cuando está en mano, y ahí se emite el
  // recibo. Es la acción que pidió la clienta: «poder marcar cheques como
  // aceptados o rechazados».
  informado: [
    { a: "cartera", texto: "Aceptar" },
    { a: "rechazado", texto: "Rechazar" },
  ],
  cartera: [
    { a: "depositado", texto: "Depositar" },
    { a: "rechazado", texto: "Rechazado" },
  ],
  depositado: [
    { a: "acreditado", texto: "Se acreditó" },
    { a: "rechazado", texto: "Rebotó" },
  ],
  entregado: [
    { a: "acreditado", texto: "Debitó" },
    { a: "rechazado", texto: "Rebotó" },
  ],
};

/** Desde qué estados se puede anular. Lo dice `TRANSICIONES` en `actions.ts`. */
const SE_PUEDE_ANULAR = ["cartera"];

const pesos = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

/**
 * Lo que se hace con un cheque.
 *
 * La acción que se espera de cada estado va a mano y destacada (aceptar,
 * depositar, se acreditó); el rechazo y la anulación, que no tienen vuelta,
 * van en el menú de al lado (mes simulado, H339: «Rechazado» pesaba lo mismo
 * que «Depositar»).
 *
 * Aceptar uno informado pide confirmar con lo que debe hoy el cliente (H142,
 * H240: con un toque emitía el recibo y bajaba la deuda, también de una
 * cuenta ya saldada). Un diferido no se deposita antes de su fecha (H405).
 */
export function AccionesDeCheque({
  id,
  estado,
  sentido,
  numero,
  importe,
  diasParaCobrar = null,
  cliente = null,
  saldoCliente = null,
  proveedor = null,
}: {
  id: string;
  estado: string;
  sentido: string;
  numero: string;
  importe: number;
  /** Cuántos días faltan para la fecha de pago: antes no se deposita. */
  diasParaCobrar?: number | null;
  cliente?: string | null;
  /** Lo que debe hoy el cliente que lo informó. */
  saldoCliente?: number | null;
  /** A quién se le endosó: si rebota, se le vuelve a deber. */
  proveedor?: string | null;
}) {
  const [pendiente, empezar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [aceptando, setAceptando] = useState(false);
  /** El rechazo pide motivo: lo lee el cliente en el correo y en Mi cuenta. */
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const idMotivo = useId();

  const acciones = (ACCIONES[estado] ?? []).filter(
    // Depositar solo tiene sentido para los recibidos: un cheque propio ya
    // entregado lo deposita el proveedor, no nosotros.
    (a) => !(sentido === "entregado" && a.a === "depositado"),
  );
  const puedeAnular = SE_PUEDE_ANULAR.includes(estado);
  const principal = acciones.find((a) => a.a !== "rechazado");
  const secundarias = acciones.filter((a) => a !== principal);
  const antesDeTiempo = principal?.a === "depositado" && diasParaCobrar !== null && diasParaCobrar > 0;

  if (acciones.length === 0 && !puedeAnular) return null;

  function cambiar(a: string, conMotivo?: string, confirmado = false) {
    if (a === "rechazado" && conMotivo === undefined) {
      setRechazando(true);
      return;
    }
    if (estado === "informado" && a === "cartera" && !confirmado) {
      setAceptando(true);
      return;
    }
    empezar(async () => {
      const r = await cambiarEstadoDeCheque(id, a, conMotivo);
      setConfirmando(false);
      setAceptando(false);
      if (!r.error) {
        setRechazando(false);
        setMotivo("");
      }
      if (r.error) {
        setAviso(r.error);
        return;
      }
      // El éxito va por aviso global: un cheque que se acredita o se anula se
      // muda a "Terminados", el componente se vuelve a montar y un mensaje
      // propio desaparece antes de que nadie lo lea. El error sí queda acá,
      // porque en ese caso la fila no se mueve.
      if (r.ok) {
        toast.success(r.ok, {
          action: r.receiptId
            ? {
                label: "Ver recibo",
                onClick: () =>
                  window.open(`/api/recibos/${r.receiptId}/pdf`, "_blank"),
              }
            : undefined,
        });
      }
    });
  }

  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:items-end">
      <div className="flex items-center gap-2">
        {principal && (
          <button
            type="button"
            disabled={pendiente || antesDeTiempo}
            onClick={() => cambiar(principal.a)}
            className="boton-accion inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold disabled:opacity-50 sm:flex-none"
          >
            {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
            {principal.texto}
          </button>
        )}
        {(secundarias.length > 0 || puedeAnular) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Más acciones del cheque ${numero}`}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-linea hover:bg-muted"
            >
              <Ellipsis className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {secundarias.map((a) => (
                <DropdownMenuItem key={a.a} onClick={() => cambiar(a.a)} className="h-10 text-base">
                  {a.texto}
                </DropdownMenuItem>
              ))}
              {puedeAnular && (
                <DropdownMenuItem variant="destructive" onClick={() => setConfirmando(true)} className="h-10 text-base">
                  Anular
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {aviso && (
        <p className="estado-problema flex max-w-72 items-start gap-1.5 text-right text-base font-medium">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{aviso}</span>
        </p>
      )}

      <Dialog
        open={rechazando}
        onOpenChange={(v) => !v && setRechazando(false)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {estado === "informado" ? "Rechazar" : "El banco rechazó"} el
              cheque {numero}
            </DialogTitle>
          </DialogHeader>
          <p className="text-base text-muted-foreground">
            {estado === "informado"
              ? "La cuenta del cliente no cambia: el cheque nunca bajó la deuda. Se le avisa con este motivo."
              : sentido === "recibido"
                ? estado === "entregado"
                  ? // Endosado: rebota en las dos cuentas (cobros.reabrirDeudaConElProveedor).
                    `Los ${pesos(importe)} vuelven a la cuenta del cliente con una nota de débito, y ${proveedor ? `a ${proveedor}` : "al proveedor"} se le vuelven a deber.`
                  : `Los ${pesos(importe)} vuelven a la cuenta del cliente con una nota de débito, y se le avisa con este motivo.`
                : "Es un cheque nuestro: hay que reponérselo al proveedor."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              cambiar("rechazado", motivo);
            }}
            className="space-y-3"
          >
            {/* Lo lee el cliente en el correo y en Mi cuenta: una nota de la
                casa («Los Pinos avisa…») le llegaba textual (mes simulado,
                H304). Los motivos del banco, a un toque. */}
            <label htmlFor={idMotivo} className="block text-base font-medium">
              Motivo que lee el cliente
            </label>
            {estado !== "informado" && sentido === "recibido" && (
              <div role="group" aria-label="Motivos del banco" className="flex flex-wrap gap-2">
                {["Sin fondos", "Firma no coincide", "Cuenta cerrada", "Defecto de forma"].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMotivo(m)}
                    aria-pressed={motivo === m}
                    className="h-11 rounded-lg border border-linea px-3.5 text-base font-medium transition-colors hover:bg-hundida aria-pressed:border-foreground aria-pressed:bg-hundida"
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
            <input
              id={idMotivo}
              autoFocus
              // Un solo dato: Enter rechaza, no pasa al botón.
              data-enter="enviar"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={
                estado === "informado"
                  ? "La fecha está mal, falta la firma…"
                  : "Sin fondos, firma no coincide…"
              }
              className="h-11 w-full rounded-lg border border-linea bg-background px-3 text-base"
            />
            {aviso && (
              <p className="estado-problema text-base font-medium">{aviso}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRechazando(false)}
                className="h-11 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
              >
                Volver
              </button>
              <button
                type="submit"
                disabled={pendiente || !motivo.trim()}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-destructive px-4 text-base font-medium text-white disabled:opacity-50"
              >
                {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
                Rechazar
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Confirmar
        abierto={aceptando}
        alCerrar={() => setAceptando(false)}
        titulo={`Aceptar el cheque ${numero} por ${pesos(importe)}`}
        detalle={
          saldoCliente === null
            ? "Se emite el recibo y baja la deuda del cliente."
            : saldoCliente <= 0.005
              ? `${cliente ?? "El cliente"} no tiene deuda: aceptarlo le deja ${pesos(importe)} a favor.`
              : `${cliente ?? "El cliente"} debe ${pesos(saldoCliente)}. Se emite el recibo y la deuda baja ${pesos(Math.min(importe, saldoCliente))}.`
        }
        confirmar="Sí, aceptarlo"
        cancelar="Todavía no"
        peligro={saldoCliente !== null && saldoCliente <= 0.005}
        pendiente={pendiente}
        alConfirmar={() => cambiar("cartera", undefined, true)}
      />

      <Confirmar
        abierto={confirmando}
        alCerrar={() => setConfirmando(false)}
        titulo={`Anular el cheque ${numero}`}
        detalle={`Son ${importe.toLocaleString("es-AR", {
          style: "currency",
          currency: "ARS",
          maximumFractionDigits: 0,
        })}. Un cheque anulado no vuelve a la cartera ni se puede depositar después: queda así para siempre.`}
        confirmar="Sí, anularlo"
        cancelar="No, dejarlo como está"
        peligro
        pendiente={pendiente}
        alConfirmar={() => cambiar("anulado")}
      />
    </div>
  );
}

/**
 * Cargar un cheque a mano.
 *
 * **Un cheque que trae un cliente no se carga acá: se le cobra.** El alta
 * manual no emitía recibo ni le bajaba la deuda, pero dejaba el cheque a su
 * nombre; si después rebotaba, el rechazo le sumaba una nota de débito por
 * plata que nunca había debido. Elegir al cliente abre el cobro
 * (`DialogoCobro`), que pide el cheque con banco, número y fecha, emite el
 * recibo y baja la deuda: el cheque entra a la cartera igual. El alta queda
 * para los cheques de terceros sin cliente y los propios.
 *
 * El cliente se busca (nombre, razón social o CUIT, el mismo buscador del
 * mostrador): antes era un desplegable con la cartera entera.
 *
 * El e-Cheq va siempre por el circuito de facturas: queda registrado en el
 * banco a nombre de la empresa.
 */
export function AltaDeCheque() {
  const [abierto, setAbierto] = useState(false);
  const [estado, guardar, guardando] = useActionState(
    async (previo: EstadoCheque, formData: FormData) => {
      const r = await cargarCheque(previo, formData);
      if (r.ok) setAbierto(false);
      return r;
    },
    inicial,
  );
  const [sentido, setSentido] = useState("recibido");
  const [tipo, setTipo] = useState("fisico");
  const [circuito, setCircuito] = useState("blanco");
  const [cliente, setCliente] = useState<ClienteElegido | null>(null);
  const id = useId();

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium transition-colors">
        <Plus className="h-5 w-5" />
        Cargar cheque
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Cargar un cheque</DialogTitle>
        </DialogHeader>

        <label className="block">
          <span className="text-base font-medium">Sentido</span>
          <select
            value={sentido}
            onChange={(e) => {
              setSentido(e.target.value);
              setCliente(null);
            }}
            className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
          >
            <option value="recibido">Recibido — nos lo dieron</option>
            <option value="entregado">Entregado — salió de acá</option>
          </select>
        </label>

        {sentido === "recibido" && (
          <ElegirCliente elegido={cliente} onElegir={setCliente} />
        )}

        {cliente && sentido === "recibido" ? (
          <DialogoCobro
            customerId={cliente.id}
            nombre={cliente.razonSocial || cliente.nombre}
            aCobrar={0}
            etiqueta={`Cobrarle a ${cliente.razonSocial || cliente.nombre}`}
            claseBoton="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg text-base font-semibold"
            alCobrar={() => {
              setCliente(null);
              setAbierto(false);
            }}
          />
        ) : (
          <form action={guardar} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="sentido" value={sentido} />

              <label className="block">
                <span className="text-base font-medium">Tipo</span>
                <select
                  name="tipo"
                  value={tipo}
                  onChange={(e) => {
                    setTipo(e.target.value);
                    // El e-Cheq solo va por el circuito de facturas.
                    if (e.target.value === "echeq") setCircuito("blanco");
                  }}
                  className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
                >
                  <option value="fisico">Físico</option>
                  <option value="echeq">e-Cheq</option>
                </select>
              </label>

              {/* Por qué circuito va. Antes no se preguntaba y todo lo cargado a
                mano quedaba en «Facturas», así que los dos totales de la
                cartera no eran los de nadie. */}
              <label className="block">
                <span className="text-base font-medium">Circuito</span>
                <select
                  name="circuito"
                  value={circuito}
                  onChange={(e) => setCircuito(e.target.value)}
                  disabled={tipo === "echeq"}
                  className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base disabled:opacity-60"
                >
                  <option value="blanco">{ETIQUETA_CIRCUITO.blanco}</option>
                  <option value="negro">{ETIQUETA_CIRCUITO.negro}</option>
                </select>
              </label>

              <label className="block">
                <span className="text-base font-medium">Número</span>
                <input
                  name="numero"
                  required
                  className="tabular mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
                />
              </label>

              <label className="block">
                <span className="text-base font-medium">Banco</span>
                <input
                  name="banco"
                  className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
                />
              </label>

              <label className="block">
                <span className="text-base font-medium">Fecha de pago</span>
                <input
                  id={`${id}-fecha`}
                  name="fechaPago"
                  type="date"
                  required
                  className="tabular mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
                />
              </label>

              <label className="block">
                <span className="text-base font-medium">Importe</span>
                <input
                  name="importe"
                  required
                  inputMode="decimal"
                  className="tabular mt-1 h-11 w-full rounded-lg border bg-background px-3 text-right text-base"
                />
              </label>

              {sentido === "recibido" && (
                <>
                  <label className="block">
                    <span className="text-base font-medium">Librador</span>
                    <input
                      name="librador"
                      placeholder="Quién lo firmó, si es de un tercero"
                      className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
                    />
                  </label>
                </>
              )}
            </div>

            <label className="block">
              <span className="text-base font-medium">Notas</span>
              <input
                name="notas"
                className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
              />
            </label>

            {estado.error && (
              <p className="text-base text-destructive">{estado.error}</p>
            )}

            <button
              type="submit"
              disabled={guardando}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg boton-accion text-base font-medium"
            >
              {guardando && <Loader2 className="h-5 w-5 animate-spin" />}
              Guardar en la cartera
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

