"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  Package,
  PencilLine,
  Plus,
  Scissors,
  Search,
  Store,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { crearPresupuesto, editarPresupuesto } from "@/app/admin/ventas-actions";
import { buscarClientes, buscarEnMostrador } from "@/app/mostrador/actions";
import { formatearMonto } from "@/components/admin/formato";
import { importeDelCampo, importeIlegible, importeParaElCampo } from "@/lib/formato";
import { formatearCantidad, formatearUnidadLarga, formatearUnidadPlural } from "@/lib/unidades";
import { unidadDeVenta } from "@/lib/formato";
import type { TarifaDeCorte } from "@/lib/cortes/tipos";
import {
  BarraGuardar,
  Hoja,
  Opciones,
  Seccion,
  sinReiniciar,
} from "@/components/admin/formulario";
import { CampoFecha } from "@/components/ui/campo-fecha";

export interface Linea {
  variantId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
  /** Lo que se está tipeando en el precio («15.000»); no viaja al servidor. */
  precioTexto?: string;
  /**
   * El precio final que apenas cubre el costo (Go: precios.PisoDeCosto); no
   * viaja al servidor. Por debajo, el renglón se marca y guardar pide
   * confirmar (mes simulado: el Fenólico a $100 con costo de $75.000).
   */
  piso?: number | null;
}

export interface ClienteElegido {
  id: string;
  nombre: string;
  razonSocial: string | null;
  telefono?: string | null;
  email?: string | null;
  priceListId?: string | null;
}

/** Lo que trae el formulario al corregir o duplicar un presupuesto. */
export interface PresupuestoInicial {
  lineas: Linea[];
  contactoNombre: string;
  contactoTelefono: string | null;
  contactoEmail: string | null;
  branchId: string | null;
  notas: string | null;
}

const estadoInicial = {} as { error?: string; ok?: string };

const bajoCosto = (l: Linea) => l.piso != null && l.piso > 0 && l.precioUnitario > 0 && l.precioUnitario < l.piso - 0.005;

/**
 * Alta de presupuesto (y su corrección, con `editar`).
 *
 * La búsqueda de productos y la de clientes son las **mismas** que usa el
 * mostrador: devuelven variantes con el precio de la lista que le toca a ese
 * cliente, que es lo que hay que presupuestar. Duplicarlas acá habría sido
 * inventar una segunda verdad sobre los precios.
 *
 * Las líneas viajan como JSON en campos `linea` repetidos, para que el precio
 * quede exactamente en el que se vio en pantalla: un presupuesto es una oferta
 * con fecha, y recalcularlo del lado del servidor lo cambiaría en silencio si
 * alguien tocó la lista en el medio.
 */
type PropsFormulario = Parameters<typeof Formulario>[0];

/*
 * Con Cache Components, Next esconde la página en vez de desmontarla y el
 * formulario de /presupuestos/nuevo conservaba los renglones de la vez
 * anterior: «Corregir» justo después de guardar abría el formulario vacío o
 * con los renglones de otro presupuesto (mes simulado). La clave arma uno
 * nuevo en cada navegación y en cada presupuesto de origen; atrás y adelante
 * siguen devolviendo el borrador.
 */
export function FormularioPresupuesto(props: PropsFormulario & { origen?: string }) {
  const { bfcacheId } = useRouter();
  const { origen, ...resto } = props;
  return (
    <Formulario
      key={`${bfcacheId}|${origen ?? ""}|${props.clienteInicial?.id ?? ""}`}
      {...resto}
    />
  );
}

function Formulario({
  sucursales,
  clienteInicial,
  inicial,
  editar,
  tarifas = [],
}: {
  sucursales: { id: string; nombre: string }[];
  /** Quien lo carga: el presupuesto queda a su nombre, con origen «por teléfono». */
  asesor: string;
  /**
   * Con quién arranca, cuando se llega desde la ficha o la lista de clientes.
   *
   * Viene resuelto del servidor y no como un id suelto: el formulario no tiene
   * por qué saber buscarlo, y así el nombre ya está escrito en el primer
   * pintado en vez de aparecer medio segundo después. Trae el teléfono y el
   * correo de la ficha (mes simulado: desde el chat llegaba sin teléfono).
   */
  clienteInicial?: ClienteElegido;
  /** Los renglones y datos de uno que se corrige o se duplica. */
  inicial?: PresupuestoInicial;
  /** El id del presupuesto que se corrige (mismo número). */
  editar?: string;
  /** Las tarifas de corte activas: el corte y el canto van como renglones. */
  tarifas?: TarifaDeCorte[];
}) {
  const [estado, accion, pendiente] = useActionState(
    editar ? editarPresupuesto : crearPresupuesto,
    estadoInicial,
  );

  const [sucursal, setSucursal] = useState(inicial?.branchId ?? sucursales[0]?.id ?? "");
  const [cliente, setCliente] = useState<ClienteElegido | null>(
    clienteInicial ?? null,
  );
  const [nombre, setNombre] = useState(
    inicial?.contactoNombre ?? (clienteInicial ? (clienteInicial.razonSocial ?? clienteInicial.nombre) : ""),
  );
  // Al elegir al cliente se completan con lo de su ficha: había que volver a
  // tipear el teléfono que el sistema ya tenía.
  const [telefono, setTelefono] = useState(inicial?.contactoTelefono ?? clienteInicial?.telefono ?? "");
  const [email, setEmail] = useState(inicial?.contactoEmail ?? clienteInicial?.email ?? "");
  const [lineas, setLineas] = useState<Linea[]>(inicial?.lineas ?? []);

  const total = lineas.reduce(
    (suma, l) => suma + l.cantidad * l.precioUnitario,
    0,
  );

  function agregar(linea: Linea) {
    setLineas((previas) => {
      // Si ya está la misma variante, suma cantidad en vez de repetir renglón.
      const i = previas.findIndex(
        (p) => p.variantId !== null && p.variantId === linea.variantId,
      );
      if (i === -1) return [...previas, linea];
      const copia = [...previas];
      copia[i] = { ...copia[i], cantidad: copia[i].cantidad + linea.cantidad };
      return copia;
    });
  }

  const precioIlegible = lineas.some((l) => importeIlegible(l.precioTexto));
  // Un renglón a $0 no se guarda (mes simulado: la escalera «a medida —
  // consultar» quedaba a $0 con el botón activo). Go lo frena igual.
  const sinPrecio = lineas.some((l) => !(l.precioUnitario > 0));
  const bajos = lineas.filter(bajoCosto);

  function cambiarPrecio(indice: number, texto: string) {
    setLineas((previas) =>
      previas.map((l, i) =>
        i === indice
          ? { ...l, precioTexto: texto, precioUnitario: importeDelCampo(texto) }
          : l,
      ),
    );
  }

  function actualizar(indice: number, campo: keyof Linea, valor: string) {
    setLineas((previas) =>
      previas.map((l, i) =>
        i === indice
          ? {
              ...l,
              [campo]:
                campo === "cantidad" || campo === "precioUnitario"
                  ? Number(valor)
                  : valor,
            }
          : l,
      ),
    );
  }

  /*
   * Con renglones por debajo del costo, guardar pide confirmar una vez, en
   * una línea al lado del botón: es un error caro y se ve antes de mandárselo
   * al cliente. Se recuerda si se había pedido pasar a pedido y, al confirmar,
   * el formulario se manda armando los datos a mano: reenviarlo con el botón
   * original fallaba porque ese botón ya no está montado (mes simulado: «Guardar
   * igual» no guardaba nada). La barra de confirmación queda puesta mientras se
   * guarda, para que un segundo clic no caiga en «Guardar y pasar a pedido».
   */
  const formulario = useRef<HTMLFormElement>(null);
  // Atada a la respuesta vigente: si el servidor rechaza, la barra vuelve a la
  // normal con el error a la vista.
  const [confirmacion, setPideConfirmar] = useState<{ convertir: boolean; estado: typeof estado } | null>(null);
  const pideConfirmar = confirmacion?.estado === estado ? confirmacion : null;
  const enviar = sinReiniciar(accion);
  function alEnviar(e: FormEvent<HTMLFormElement>) {
    if (bajos.length > 0) {
      e.preventDefault();
      const boton = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      setPideConfirmar({ convertir: boton?.name === "convertir", estado });
      return;
    }
    enviar.onSubmit(e);
  }
  function guardarIgual() {
    if (!formulario.current || !pideConfirmar || pendiente) return;
    const datos = new FormData(formulario.current);
    if (pideConfirmar.convertir) datos.set("convertir", "si");
    startTransition(() => accion(datos));
  }
  const bloqueado = pendiente || precioIlegible || sinPrecio || lineas.length === 0;

  return (
    <form ref={formulario} onSubmit={alEnviar} className="space-y-5">
      {editar && <input type="hidden" name="id" value={editar} />}
      <input type="hidden" name="branchId" value={sucursal} />
      {cliente && <input type="hidden" name="customerId" value={cliente.id} />}
      {lineas.map((linea, i) => (
        <input
          key={i}
          type="hidden"
          name="linea"
          value={JSON.stringify({ ...linea, precioTexto: undefined, piso: undefined })}
        />
      ))}

      <Hoja>
        <Seccion titulo="Para quién" icono={UserRound}>
          <div className="md:col-span-2">
            <BuscadorDeCliente
              elegido={cliente}
              onElegir={(c) => {
                setCliente(c);
                if (c) {
                  setNombre(c.razonSocial ?? c.nombre);
                  if (c.telefono) setTelefono(c.telefono);
                  if (c.email) setEmail(c.email);
                }
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contactoNombre">Nombre</Label>
            <Input
              id="contactoNombre"
              name="contactoNombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="A nombre de quién va"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="contactoTelefono">Teléfono</Label>
            <Input
              id="contactoTelefono"
              name="contactoTelefono"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              inputMode="tel"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="contactoEmail">Correo</Label>
            <Input
              id="contactoEmail"
              name="contactoEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* La sucursal viaja en el oculto `branchId`; las fichas solo la
              eligen. Cambiarla cambia los precios y el stock del buscador. */}
          <div className="space-y-2 md:col-span-2">
            <Label>Sucursal</Label>
            <Opciones
              nombre="branch-opcion"
              opciones={sucursales.map((s) => ({
                valor: s.id,
                texto: s.nombre,
                icono: Store,
              }))}
              valor={sucursal}
              alCambiar={setSucursal}
              columnas={sucursales.length > 2 ? 3 : 2}
            />
          </div>
        </Seccion>

        <Seccion titulo="Qué lleva" icono={Package} columnas={1}>
          <BuscadorDeProductos
            branchId={sucursal}
            customerId={cliente?.id ?? null}
            onAgregar={agregar}
          />

          <AgregarCorte
            tarifas={tarifas}
            priceListId={cliente?.priceListId ?? null}
            onAgregar={(l) => setLineas((p) => [...p, l])}
          />

          {lineas.length === 0 ? (
            <p className="rounded-lg bg-hundida px-4 py-6 text-center text-muted-foreground">
              Buscá un producto arriba para empezar.
            </p>
          ) : (
            <div className="space-y-2">
              {lineas.map((linea, i) => {
                const bajo = bajoCosto(linea);
                const cero = !(linea.precioUnitario > 0) && !importeIlegible(linea.precioTexto);
                return (
                  <div
                    key={i}
                    className={`flex flex-wrap items-end gap-3 rounded-lg px-4 py-3 ${
                      bajo || cero ? "tarjeta-atencion" : "bg-hundida"
                    }`}
                  >
                    <div className="min-w-0 basis-full sm:min-w-48 sm:flex-1 sm:basis-auto">
                      <p className="font-medium">{linea.descripcion}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                        {/* La misma unidad que el presupuesto guardado: la lata
                            de 4 litros es «u.», no «litros» (M2S2-136). */}
                        {(() => {
                          const u = unidadDeVenta(linea.unidad, linea.descripcion) ?? linea.unidad;
                          return linea.cantidad === 1 ? formatearUnidadLarga(u) : formatearUnidadPlural(u);
                        })()}
                        {/* Sin precio no se guarda: el motivo junto al campo
                            (M2S3-026: los botones quedaban grises sin decir
                            por qué). */}
                        {cero && (
                          <span className="estado-problema inline-flex items-center gap-1 font-medium text-[var(--estado-tinta)]">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                            Sin precio
                          </span>
                        )}
                        {bajo && (
                          <span className="estado-problema inline-flex items-center gap-1 font-medium text-[var(--estado-tinta)]">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                            Bajo costo · cubre desde {formatearMonto(linea.piso ?? 0)}
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="w-24 space-y-1">
                      <Label htmlFor={`cantidad-${i}`} className="text-base">
                        Cantidad
                      </Label>
                      <Input
                        id={`cantidad-${i}`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={linea.cantidad}
                        onChange={(e) =>
                          actualizar(i, "cantidad", e.target.value)
                        }
                      />
                    </div>

                    <div className="w-32 space-y-1">
                      <Label htmlFor={`precio-${i}`} className="text-base">
                        Precio
                      </Label>
                      {/* Texto y no number: «15.000» son quince mil, no 15. */}
                      <Input
                        id={`precio-${i}`}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        className="text-right tabular"
                        value={linea.precioTexto ?? (linea.precioUnitario > 0 ? importeParaElCampo(linea.precioUnitario) : "")}
                        aria-invalid={importeIlegible(linea.precioTexto) || cero || bajo || undefined}
                        autoFocus={cero && i === lineas.length - 1}
                        onChange={(e) => cambiarPrecio(i, e.target.value)}
                      />
                    </div>

                    <div className="ml-auto w-28 text-right">
                      <p className="text-base text-muted-foreground">Subtotal</p>
                      <p className="tabular font-semibold">
                        {formatearMonto(linea.cantidad * linea.precioUnitario)}
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setLineas((p) => p.filter((_, j) => j !== i))
                      }
                      aria-label={`Quitar ${linea.descripcion}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}

              <div className="flex items-baseline justify-between border-t border-linea pt-3">
                <span className="text-base font-semibold">Total</span>
                <span className="tabular text-2xl font-bold">
                  {formatearMonto(total)}
                </span>
              </div>
            </div>
          )}
        </Seccion>

        <Seccion titulo="Condiciones" icono={CalendarClock}>
          <div className="space-y-2">
            <Label htmlFor="diasValidez">Validez (días)</Label>
            <Input
              id="diasValidez"
              name="diasValidez"
              type="number"
              min="1"
              max="180"
              defaultValue={15}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="necesitaPara">Lo necesita para el</Label>
            <CampoFecha Entrada={Input} id="necesitaPara" name="necesitaPara" />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notas">Observaciones para el cliente</Label>
            <Textarea
              id="notas"
              name="notas"
              rows={3}
              defaultValue={inicial?.notas ?? ""}
              placeholder="Medidas especiales, quién retira…"
            />
          </div>
        </Seccion>
      </Hoja>

      {estado.error && (
        <p
          role="alert"
          className="estado-problema rounded-lg bg-[var(--estado-fondo)] px-4 py-3 text-[var(--estado-tinta)]"
        >
          {estado.error}
        </p>
      )}

      <BarraGuardar>
        {pideConfirmar ? (
          <div role="alert" className="flex w-full flex-wrap items-center gap-3">
            <p className="estado-problema flex items-center gap-2 font-medium text-[var(--estado-tinta)]">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
              {bajos.length === 1 ? "Un renglón queda" : `${bajos.length} renglones quedan`} por debajo del costo
            </p>
            <Button type="button" onClick={guardarIgual} disabled={pendiente} className="h-11 px-5">
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar igual
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pendiente}
              onClick={() => setPideConfirmar(null)}
              className="h-11 px-5"
            >
              Revisar
            </Button>
          </div>
        ) : (
          <>
            <Button type="submit" disabled={bloqueado} className="h-11 px-6">
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              {editar ? "Guardar los cambios" : "Guardar presupuesto"}
            </Button>

            {/* Quien llama muchas veces no pide un presupuesto: está comprando.
                Guarda y abre en la ficha el paso a pedido, que pregunta la
                entrega y el pago (pasarlo de una dejaba el pedido como retiro y
                sin forma de pago). */}
            {!editar && (
              <Button
                type="submit"
                name="convertir"
                value="si"
                variant="outline"
                disabled={bloqueado}
                className="h-11 px-6"
              >
                Guardar y pasar a pedido
              </Button>
            )}
          </>
        )}
      </BarraGuardar>
    </form>
  );
}

/**
 * El corte y el canto como renglones del presupuesto (mes simulado: el
 * formulario solo buscaba productos, el corte se cargaba después desde el
 * pedido y el cliente recibía el precio de las placas sin el trabajo). Con
 * la tarifa activa del material —la de la lista del cliente, o la general—
 * se suman las pasadas y los metros de canto.
 */
function AgregarCorte({
  tarifas,
  priceListId,
  onAgregar,
}: {
  tarifas: TarifaDeCorte[];
  priceListId: string | null;
  onAgregar: (linea: Linea) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const materiales = [...new Set(tarifas.map((t) => t.material))];
  const [material, setMaterial] = useState(materiales[0] ?? "");
  const [pasadas, setPasadas] = useState("");
  const [metros, setMetros] = useState("");
  const [libre, setLibre] = useState({ descripcion: "", precio: "" });

  const tarifa =
    tarifas.find((t) => t.material === material && t.priceListId === priceListId) ??
    tarifas.find((t) => t.material === material && t.priceListId === null);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-10 items-center gap-2 self-start rounded-lg bg-hundida px-3.5 text-base font-medium transition-colors hover:bg-muted"
      >
        <Scissors className="h-4 w-4" aria-hidden="true" />
        Corte, canto u otro renglón
      </button>
    );
  }

  const nPasadas = Number(pasadas.replace(",", "."));
  const nMetros = Number(metros.replace(",", "."));

  function sumarCorte() {
    if (!tarifa) return;
    if (nPasadas > 0) {
      // En pasadas y sin «(pasadas)» en el nombre: se lee «12 cortes» como
      // el corte del mostrador, y no entra en Entregas como mercadería (Go,
      // entregas.sinServicios). Decía «Corte de Placas (pasadas) 12 u.».
      onAgregar({
        variantId: null,
        descripcion: `Corte de ${material}`,
        unidad: "pasada",
        cantidad: nPasadas,
        precioUnitario: tarifa.precioPorPasada,
      });
    }
    if (nMetros > 0) {
      onAgregar({
        variantId: null,
        descripcion: `Canto de ${material}`,
        unidad: "metro_lineal",
        cantidad: nMetros,
        precioUnitario: tarifa.precioPorMetroCanto,
      });
    }
    setPasadas("");
    setMetros("");
  }

  function sumarLibre() {
    const precio = importeDelCampo(libre.precio);
    if (libre.descripcion.trim().length < 2 || !(precio > 0)) return;
    onAgregar({ variantId: null, descripcion: libre.descripcion.trim(), unidad: "unidad", cantidad: 1, precioUnitario: precio });
    setLibre({ descripcion: "", precio: "" });
  }

  return (
    <div className="tarjeta-hundida space-y-3 rounded-xl p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-base font-medium">
          <Scissors className="h-4 w-4" aria-hidden="true" />
          Corte y canto
        </p>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          aria-label="Cerrar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {materiales.length > 0 && (
        <div className="flex flex-wrap items-end gap-2.5">
          <label className="min-w-36 flex-1 text-sm text-muted-foreground">
            Material
            <select
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              className="mt-1 block h-10 w-full rounded-lg bg-background px-2.5 text-base text-foreground"
            >
              {materiales.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="w-24 text-sm text-muted-foreground">
            Pasadas
            <input
              inputMode="numeric"
              value={pasadas}
              onChange={(e) => setPasadas(e.target.value)}
              className="tabular mt-1 block h-10 w-full rounded-lg bg-background px-2.5 text-right text-base text-foreground"
            />
          </label>
          <label className="w-28 text-sm text-muted-foreground">
            Canto (m)
            <input
              inputMode="decimal"
              value={metros}
              onChange={(e) => setMetros(e.target.value)}
              className="tabular mt-1 block h-10 w-full rounded-lg bg-background px-2.5 text-right text-base text-foreground"
            />
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={sumarCorte}
            disabled={!tarifa || !(nPasadas > 0 || nMetros > 0)}
            className="h-10"
          >
            <Plus className="h-4 w-4" />
            Sumar
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2.5 border-t border-linea-suave pt-3">
        <label className="min-w-40 flex-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
            Otro renglón
          </span>
          <input
            value={libre.descripcion}
            onChange={(e) => setLibre((l) => ({ ...l, descripcion: e.target.value }))}
            maxLength={300}
            className="mt-1 block h-10 w-full rounded-lg bg-background px-2.5 text-base text-foreground"
          />
        </label>
        <label className="w-32 text-sm text-muted-foreground">
          Precio
          <input
            inputMode="decimal"
            value={libre.precio}
            onChange={(e) => setLibre((l) => ({ ...l, precio: e.target.value }))}
            className="tabular mt-1 block h-10 w-full rounded-lg bg-background px-2.5 text-right text-base text-foreground"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          onClick={sumarLibre}
          disabled={libre.descripcion.trim().length < 2 || !(importeDelCampo(libre.precio) > 0)}
          className="h-10"
        >
          <Plus className="h-4 w-4" />
          Sumar
        </Button>
      </div>
    </div>
  );
}

function BuscadorDeCliente({
  elegido,
  onElegir,
}: {
  elegido: ClienteElegido | null;
  onElegir: (cliente: ClienteElegido | null) => void;
}) {
  const [texto, setTexto] = useState("");
  // Se guarda junto con el texto que los produjo, y se muestran solo si siguen
  // correspondiendo a lo que hay tipeado. Así el efecto nunca limpia estado en
  // el render, que es lo que la regla de hooks no quiere.
  const [traidos, setTraidos] = useState<{
    texto: string;
    items: ClienteElegido[];
  }>({ texto: "", items: [] });

  const consulta = texto.trim();
  const resultados =
    consulta.length >= 2 && traidos.texto === consulta ? traidos.items : [];

  useEffect(() => {
    if (consulta.length < 2) return;

    let vigente = true;
    const id = setTimeout(async () => {
      const encontrados = await buscarClientes(consulta);
      if (vigente) setTraidos({ texto: consulta, items: encontrados });
    }, 250);

    return () => {
      vigente = false;
      clearTimeout(id);
    };
  }, [consulta]);

  if (elegido) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-hundida px-4 py-3">
        <UserRound className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 font-medium">
          {elegido.razonSocial ?? elegido.nombre}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onElegir(null);
            setTexto("");
          }}
        >
          <X className="h-4 w-4" />
          Quitar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="buscarCliente">Cliente (opcional)</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="buscarCliente"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nombre, razón social o CUIT"
          className="pl-9"
        />
      </div>

      {resultados.length > 0 && (
        <ul className="tarjeta overflow-hidden">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onElegir(c);
                  setTexto("");
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted"
              >
                <span className="font-medium">{c.razonSocial ?? c.nombre}</span>
                {c.razonSocial && c.razonSocial !== c.nombre && (
                  <span className="text-sm text-muted-foreground">
                    {c.nombre}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BuscadorDeProductos({
  branchId,
  customerId,
  onAgregar,
}: {
  branchId: string;
  customerId: string | null;
  onAgregar: (linea: Linea) => void;
}) {
  type Encontrado = {
    variantId: string;
    sku: string;
    producto: string;
    medida: string;
    unidad: string;
    precio: number;
    stock: number;
    piso?: number | null;
  };

  const [texto, setTexto] = useState("");
  const [traidos, setTraidos] = useState<{
    clave: string;
    items: Encontrado[];
  }>({ clave: "", items: [] });

  const consulta = texto.trim();
  // El cliente entra en la clave: cambiar de cliente cambia los precios, y los
  // resultados de antes ya no valen.
  const clave = `${consulta}|${branchId}|${customerId ?? ""}`;
  // Lo que hay en la sucursal primero; lo que no, al final (M2S3-029: el
  // Fenólico de 18 sin stock salía primero y se cargaba sin aviso).
  const resultados = (consulta.length >= 2 && traidos.clave === clave ? traidos.items : [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Number(!(a.r.stock > 0)) - Number(!(b.r.stock > 0)) || a.i - b.i)
    .map((x) => x.r);
  const buscando = consulta.length >= 2 && traidos.clave !== clave;
  // Uno sin stock se agrega con un segundo toque.
  const [confirmar, setConfirmar] = useState<string | null>(null);

  useEffect(() => {
    if (consulta.length < 2 || !branchId) return;

    let vigente = true;
    const id = setTimeout(async () => {
      const encontrados = await buscarEnMostrador(
        consulta,
        branchId,
        customerId,
      );
      if (vigente) setTraidos({ clave, items: encontrados });
    }, 250);

    return () => {
      vigente = false;
      clearTimeout(id);
    };
  }, [consulta, branchId, customerId, clave]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nombre, medida o código"
          className="pl-9"
        />
        {buscando && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {resultados.length > 0 && (
        <ul className="tarjeta overflow-hidden">
          {resultados.map((r) => {
            // Lo que hay en la sucursal elegida (mes simulado: se
            // presupuestaba desde una sucursal sin la mercadería, sin
            // enterarse).
            const sinStock = !(r.stock > 0);
            const bajo = r.piso != null && r.piso > 0 && r.precio > 0 && r.precio < r.piso;
            return (
              <li key={r.variantId}>
                <button
                  type="button"
                  onClick={() => {
                    if (sinStock && confirmar !== r.variantId) {
                      setConfirmar(r.variantId);
                      return;
                    }
                    setConfirmar(null);
                    onAgregar({
                      variantId: r.variantId,
                      descripcion: `${r.producto} — ${r.medida}`,
                      unidad: r.unidad,
                      cantidad: 1,
                      precioUnitario: r.precio,
                      piso: r.piso ?? null,
                    });
                    setTexto("");
                  }}
                  aria-pressed={sinStock ? confirmar === r.variantId : undefined}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted ${
                    sinStock && confirmar !== r.variantId ? "opacity-70" : ""
                  }`}
                >
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{r.producto}</span>{" "}
                    <span className="text-muted-foreground">{r.medida}</span>
                    <span
                      className={`block text-sm ${sinStock ? "estado-problema font-medium text-[var(--estado-tinta)]" : "text-muted-foreground"}`}
                    >
                      {sinStock ? "Sin stock acá" : `${formatearCantidad(r.stock)} acá`}
                      {bajo && " · bajo costo"}
                    </span>
                  </span>
                  {sinStock && confirmar === r.variantId ? (
                    <span className="boton-accion shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold">Agregar igual</span>
                  ) : (
                    <span className="tabular shrink-0 font-semibold">
                      {r.precio > 0 ? formatearMonto(r.precio) : "A cotizar"}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {/* Sin nada que mostrar, se dice (M2S3-028: la lista quedaba vacía y no
          se sabía si estaba buscando). */}
      {consulta.length >= 2 && !buscando && resultados.length === 0 && (
        <p className="tarjeta-hundida rounded-lg px-4 py-3 text-base text-muted-foreground">Sin resultados</p>
      )}
    </div>
  );
}
