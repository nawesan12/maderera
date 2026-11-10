"use client";

import { useActionState, useEffect, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Briefcase,
  CircleSlash,
  Loader2,
  Plus,
  ReceiptText,
  Search,
  ShieldCheck,
  StickyNote,
  Trash2,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { emitirManual, type EstadoFactura } from "../actions";
import { buscarClientes } from "@/app/mostrador/actions";
import { calcularTotales } from "@/lib/fiscal/impuestos";
import {
  letraQueCorresponde,
  type CondicionIva,
} from "@/lib/fiscal/comprobantes";
import { moneda } from "@/lib/formato";
import {
  BarraGuardar,
  Hoja,
  Interruptor,
  Opciones,
  Seccion,
  sinReiniciar,
} from "@/components/admin/formulario";

const inicial: EstadoFactura = {};

const CONDICIONES = [
  { valor: "consumidor_final", texto: "Consumidor final", icono: UserRound },
  {
    valor: "responsable_inscripto",
    texto: "Responsable inscripto",
    icono: BadgeCheck,
  },
  { valor: "monotributista", texto: "Monotributista", icono: Briefcase },
  { valor: "exento", texto: "Exento", icono: ShieldCheck },
  { valor: "no_categorizado", texto: "No categorizado", icono: CircleSlash },
];

interface Linea {
  descripcion: string;
  cantidad: string;
  precio: string;
  alicuota: string;
}

const LINEA_VACIA: Linea = {
  descripcion: "",
  cantidad: "1",
  precio: "",
  alicuota: "21",
};

/**
 * Alta manual de comprobante, para la venta de mostrador.
 *
 * Los precios se cargan **finales, con IVA incluido**, igual que en el
 * catálogo: es el número que se le dice al cliente y el que se cobra. La
 * desagregación se calcula sola y se muestra abajo, para que quien factura vea
 * el neto antes de emitir.
 *
 * La letra tampoco se elige: se deduce de la condición frente al IVA del
 * receptor y se muestra a la vista, así no hay forma de emitir una A a un
 * consumidor final por descuido.
 */
export function FormularioFacturaManual({
  condicionEmisor,
}: {
  condicionEmisor: CondicionIva;
}) {
  const [estado, accion, pendiente] = useActionState(emitirManual, inicial);

  const [condicion, setCondicion] = useState<CondicionIva>("consumidor_final");
  const [lineas, setLineas] = useState<Linea[]>([{ ...LINEA_VACIA }]);

  /*
   * A quién se le factura.
   *
   * Antes esto se tipeaba entero, siempre, aunque el cliente estuviera cargado
   * hace años: el servidor ya aceptaba `customerId` —y con él generaba el
   * movimiento de cuenta corriente— pero no había forma de mandarlo desde la
   * pantalla. Ahora se busca, y si no está, se crea con estos mismos datos.
   */
  const [cliente, setCliente] = useState<ClienteElegido | null>(null);
  const [receptor, setReceptor] = useState({
    nombre: "",
    cuit: "",
    domicilio: "",
  });

  const letra = letraQueCorresponde(condicionEmisor, condicion);

  const totales = calcularTotales(
    lineas
      .filter((l) => l.descripcion.trim() && Number(l.precio) > 0)
      .map((l) => ({
        descripcion: l.descripcion,
        cantidad: Number(l.cantidad) || 0,
        precioFinalUnitario: Number(l.precio) || 0,
        alicuota: Number(l.alicuota),
      })),
  );

  function cambiar(indice: number, campo: keyof Linea, valor: string) {
    setLineas((previas) =>
      previas.map((linea, i) =>
        i === indice ? { ...linea, [campo]: valor } : linea,
      ),
    );
  }

  return (
    <form {...sinReiniciar(accion)} className="space-y-4">
      <Hoja>
        <Seccion titulo="Receptor" icono={UserRound}>
          <div className="md:col-span-2">
            <BuscadorDeCliente
              elegido={cliente}
              onElegir={(c) => {
                setCliente(c);
                if (c) {
                  setCondicion(c.condicionIva as CondicionIva);
                  setReceptor({
                    nombre: c.razonSocial || c.nombre,
                    cuit: c.cuit ?? "",
                    domicilio: c.direccion ?? "",
                  });
                }
              }}
            />
          </div>

          {cliente && (
            <input type="hidden" name="customerId" value={cliente.id} />
          )}

          <div>
            <label
              htmlFor="receptorNombre"
              className="mb-1.5 block text-base font-medium"
            >
              Nombre o razón social
            </label>
            <input
              id="receptorNombre"
              name="receptorNombre"
              required
              value={receptor.nombre}
              onChange={(e) =>
                setReceptor((r) => ({ ...r, nombre: e.target.value }))
              }
              className="h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <div>
            <label
              htmlFor="receptorCuit"
              className="mb-1.5 block text-base font-medium"
            >
              CUIT
            </label>
            <input
              id="receptorCuit"
              name="receptorCuit"
              placeholder="30-12345678-9"
              value={receptor.cuit}
              onChange={(e) =>
                setReceptor((r) => ({ ...r, cuit: e.target.value }))
              }
              className="tabular h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <div className="md:col-span-2">
            <label
              htmlFor="receptorDomicilio"
              className="mb-1.5 block text-base font-medium"
            >
              Domicilio
            </label>
            <input
              id="receptorDomicilio"
              name="receptorDomicilio"
              value={receptor.domicilio}
              onChange={(e) =>
                setReceptor((r) => ({ ...r, domicilio: e.target.value }))
              }
              className="h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          {/* La condición decide la letra: la letra queda a la vista al lado,
              así no se emite una A a un consumidor final por descuido. */}
          <div className="space-y-2 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-base font-medium">
                Condición frente al IVA
              </span>
              <p className="flex items-center gap-2 text-base">
                <span className="text-muted-foreground">Comprobante</span>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-foreground text-lg font-bold">
                  {letra}
                </span>
              </p>
            </div>
            <input
              type="hidden"
              name="receptorCondicionIva"
              value={condicion}
            />
            <Opciones
              nombre="receptorCondicionIva-opcion"
              opciones={CONDICIONES}
              valor={condicion}
              alCambiar={(v) => setCondicion(v as CondicionIva)}
              columnas={3}
            />
          </div>

          {/* Dar de alta la ficha con lo que se está tipeando.
              Es el pedido de «poder crear clientes desde facturación» sin otra
              pantalla: los datos del receptor son los de la ficha. Con cliente
              elegido no aparece, porque ya existe. Queda la ficha y la factura
              se le carga a su cuenta corriente. */}
          {!cliente && (
            <div className="md:col-span-2">
              <Interruptor
                nombre="guardarComoCliente"
                etiqueta="Guardarlo como cliente nuevo"
                icono={UserPlus}
              />
            </div>
          )}
        </Seccion>

        {/* Ítems */}
        <Seccion titulo="Qué se factura" icono={ReceiptText} columnas={1}>
          <div className="space-y-2">
            {lineas.map((linea, i) => (
              <div
                key={i}
                className="grid gap-2 sm:grid-cols-[1fr_5rem_8rem_6rem_2.5rem]"
              >
                <input
                  name="descripcion"
                  value={linea.descripcion}
                  onChange={(e) => cambiar(i, "descripcion", e.target.value)}
                  placeholder="Descripción"
                  className="h-10 rounded-lg border bg-background px-3 text-base"
                  aria-label={`Descripción del renglón ${i + 1}`}
                />
                <input
                  name="cantidad"
                  value={linea.cantidad}
                  onChange={(e) => cambiar(i, "cantidad", e.target.value)}
                  inputMode="decimal"
                  className="tabular h-10 rounded-lg border bg-background px-3 text-base"
                  aria-label={`Cantidad del renglón ${i + 1}`}
                />
                <input
                  name="precio"
                  value={linea.precio}
                  onChange={(e) => cambiar(i, "precio", e.target.value)}
                  inputMode="decimal"
                  placeholder="Precio final"
                  className="tabular h-10 rounded-lg border bg-background px-3 text-base"
                  aria-label={`Precio del renglón ${i + 1}`}
                />
                <select
                  name="alicuota"
                  value={linea.alicuota}
                  onChange={(e) => cambiar(i, "alicuota", e.target.value)}
                  className="h-10 rounded-lg border bg-background px-2 text-base"
                  aria-label={`IVA del renglón ${i + 1}`}
                >
                  <option value="21">21%</option>
                  <option value="10.5">10,5%</option>
                  <option value="0">Exento</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setLineas((previas) =>
                      previas.length === 1
                        ? [{ ...LINEA_VACIA }]
                        : previas.filter((_, indice) => indice !== i),
                    )
                  }
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Quitar el renglón ${i + 1}`}
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setLineas((previas) => [...previas, { ...LINEA_VACIA }])
            }
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg border border-dashed px-3.5 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-5 w-5" />
            Agregar renglón
          </button>

          {/* Desagregación en vivo */}
          {totales.total > 0 && (
            <dl className="mt-5 space-y-1.5 border-t pt-4 text-base">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Neto gravado</dt>
                {/* calcularTotales del TS suma lo exento al neto; la factura
                  (Go) deja en el neto solo lo gravado. */}
                <dd className="tabular">
                  {moneda.format(
                    Math.round((totales.neto - totales.exento) * 100) / 100,
                  )}
                </dd>
              </div>
              {[...totales.ivaPorAlicuota.entries()].map(
                ([alicuota, valores]) => (
                  <div key={alicuota} className="flex justify-between">
                    <dt className="text-muted-foreground">
                      IVA {String(alicuota).replace(".", ",")}%
                    </dt>
                    <dd className="tabular">
                      {moneda.format(valores.importe)}
                    </dd>
                  </div>
                ),
              )}
              {totales.exento > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Exento</dt>
                  <dd className="tabular">{moneda.format(totales.exento)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t pt-2">
                <dt className="font-semibold">Total</dt>
                <dd className="tabular text-2xl font-bold">
                  {moneda.format(totales.total)}
                </dd>
              </div>
            </dl>
          )}
        </Seccion>

        <Seccion titulo="Observaciones" icono={StickyNote} columnas={1}>
          <textarea
            id="observaciones"
            name="observaciones"
            rows={2}
            maxLength={600}
            aria-label="Observaciones"
            className="w-full rounded-lg border bg-background px-3 py-2.5 text-base"
          />
        </Seccion>
      </Hoja>

      {estado.error && (
        <p
          role="alert"
          className="estado-problema flex items-center gap-2 rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base text-[var(--estado-tinta)]"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          {estado.error}
        </p>
      )}

      <BarraGuardar>
        <button
          type="submit"
          disabled={pendiente || totales.total <= 0}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-5 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-50"
        >
          {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
          Emitir{" "}
          {letra === "A"
            ? "factura A"
            : letra === "B"
              ? "factura B"
              : "factura C"}
        </button>
      </BarraGuardar>
    </form>
  );
}

/** El cliente elegido, con lo que la factura necesita de él. */
interface ClienteElegido {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: string;
  direccion: string | null;
}

/**
 * Buscar al cliente antes de tipear el receptor.
 *
 * Reusa el mismo buscador del mostrador —nombre, razón social o CUIT— porque es
 * el mismo padrón y la misma forma de buscar: quien factura escribe las tres
 * primeras letras del apellido, igual que quien cobra.
 *
 * Elegir a alguien **no bloquea los campos**: la factura puede salir a nombre
 * de la empresa aunque la ficha esté a nombre de la persona, y esa corrección
 * hay que poder hacerla sin desvincular la ficha.
 */
function BuscadorDeCliente({
  elegido,
  onElegir,
}: {
  elegido: ClienteElegido | null;
  onElegir: (c: ClienteElegido | null) => void;
}) {
  const [texto, setTexto] = useState("");
  /*
   * Los resultados se guardan con la consulta que los trajo.
   *
   * Así no hace falta limpiarlos desde el efecto cuando alguien borra lo que
   * escribió: si la consulta cambió, los resultados guardados simplemente no
   * corresponden y no se muestran. Es la misma forma que usa el buscador de
   * placas del alta de cortes.
   */
  const [traidos, setTraidos] = useState<{
    clave: string;
    items: ClienteElegido[];
  }>({ clave: "", items: [] });

  const consulta = texto.trim();
  const resultados = traidos.clave === consulta ? traidos.items : [];
  const buscando = consulta.length >= 2 && traidos.clave !== consulta;

  useEffect(() => {
    if (consulta.length < 2) return;

    let vigente = true;

    const id = setTimeout(async () => {
      const encontrados = await buscarClientes(consulta);
      if (!vigente) return;
      setTraidos({ clave: consulta, items: encontrados as ClienteElegido[] });
    }, 250);

    return () => {
      vigente = false;
      clearTimeout(id);
    };
  }, [consulta]);

  if (elegido) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-linea bg-hundida px-4 py-3">
        <UserRound className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-base font-medium">
          {elegido.razonSocial || elegido.nombre}
          {elegido.cuit && (
            <span className="tabular ml-2 text-sm font-normal text-muted-foreground">
              {elegido.cuit}
            </span>
          )}
        </span>
        <span className="text-sm text-muted-foreground">
          La factura se carga a su cuenta corriente
        </span>
        <button
          type="button"
          onClick={() => {
            onElegir(null);
            setTexto("");
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-linea px-3 text-sm font-medium transition-colors hover:bg-background"
        >
          <X className="h-4 w-4" />
          Quitar
        </button>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor="buscarCliente"
        className="mb-1.5 block text-base font-medium"
      >
        Buscar un cliente cargado
      </label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="buscarCliente"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Nombre, razón social o CUIT"
          // Enter no avanza acá: la lista se elige con el mouse o bajando.
          data-enter="enviar"
          className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-base"
        />
      </div>

      {consulta.length >= 2 && (
        <ul className="mt-1.5 overflow-hidden rounded-lg border border-linea">
          {buscando && resultados.length === 0 && (
            <li className="px-3.5 py-2.5 text-base text-muted-foreground">
              Buscando…
            </li>
          )}
          {!buscando && resultados.length === 0 && (
            <li className="px-3.5 py-2.5 text-base text-muted-foreground">
              No hay ninguno con ese nombre. Tipeá los datos y marcá «Guardarlo
              como cliente nuevo».
            </li>
          )}
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onElegir(c);
                  setTexto("");
                }}
                className="flex w-full flex-col items-start px-3.5 py-2.5 text-left transition-colors hover:bg-hundida"
              >
                <span className="text-base font-medium">
                  {c.razonSocial || c.nombre}
                </span>
                {c.cuit && (
                  <span className="tabular text-sm text-muted-foreground">
                    {c.cuit}
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
