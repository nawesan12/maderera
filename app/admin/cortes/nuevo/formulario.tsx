"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Columns2,
  Layers,
  LayoutGrid,
  PackageCheck,
  ListOrdered,
  Loader2,
  Plus,
  Rows2,
  Scissors,
  Search,
  Siren,
  Square,
  Trash2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { crearCorte, type EstadoCorte } from "../actions";
import { buscarClientes, buscarEnMostrador } from "@/app/mostrador/actions";
import { medidaDePlaca, nombreDeLaMitad, type Mitad } from "@/lib/cortes/placa";
import type { PiezaFijada } from "@/lib/cortes/tipos";
import { usePlano } from "@/lib/cortes/en-vivo";
import { PlanoEnVivo } from "@/components/cortes/plano-en-vivo";
import { metrosDeTapacanto } from "@/lib/cortes/tarifa";
import { formatearDecimal } from "@/lib/unidades";
import { formatearSierra, leerAnchoDeSierra } from "@/lib/cortes/sierra";
import {
  BarraGuardar,
  Hoja,
  Opciones,
  Seccion,
  sinReiniciar,
} from "@/components/admin/formulario";
import { CampoFecha } from "@/components/ui/campo-fecha";

/** La placa elegida del catálogo, con lo que el plano necesita saber de ella. */
export interface PlacaElegida {
  variantId: string;
  descripcion: string;
  largoMm: number | null;
  anchoMm: number | null;
  /** Para avisar al partir: en una placa de color el dibujo tiene sentido. */
  color: string | null;
}

export interface Pieza {
  largoMm: number;
  anchoMm: number;
  cantidad: number;
  respetaVeta: boolean;
  /** Cuántos lados de cada medida llevan tapacanto: 0, 1 o 2. */
  cantoLargo: number;
  cantoAncho: number;
  /** Excepción puntual: otro color o espesor de canto para esta pieza. */
  aclaracion: string;
  etiqueta: string;
}

const piezaVacia = (): Pieza => ({
  largoMm: 0,
  anchoMm: 0,
  cantidad: 1,
  respetaVeta: false,
  cantoLargo: 0,
  cantoAncho: 0,
  aclaracion: "",
  etiqueta: "",
});

const estadoInicial: EstadoCorte = {};

/** De qué sale el trabajo. La placa entera viaja como `mitad` vacía. */
const MITADES = [
  { valor: "", texto: "Placa entera", icono: Square },
  { valor: "largo", texto: "Media a lo largo", icono: Rows2 },
  { valor: "ancho", texto: "Media al ancho", icono: Columns2 },
];

/** La placa que vende el pedido, con la mitad si la vende partida. */
export interface PlacaDelPedido extends PlacaElegida {
  mitad: Mitad;
  /** Las que vende el pedido de esta placa, en placas enteras. */
  vendidas?: number;
  /** Las que ya usan los otros cortes vivos del pedido. */
  enOtrosCortes?: number;
}

/** «1 placa», «media placa», «2,5 placas», como lo dice Go. */
function placasEnTexto(n: number): string {
  if (n === 0.5) return "media placa";
  if (n === 1) return "1 placa";
  return `${String(n).replace(".", ",")} placas`;
}

export function FormularioCorte({
  sucursales,
  desdePedido,
  desdeConsulta,
  anchoSierra: anchoSierraGeneral,
  clienteInicial,
  sierraEditable = false,
  puedeReponer = false,
  preguntarSucursal = false,
  corregir,
}: {
  /** Regla «Dónde se corta un corte suelto» en «Se elige siempre» (H045). */
  preguntarSucursal?: boolean;
  /**
   * Una reposición sin cargo (la pieza que faltó en una entrega) sale del
   * pedido que la originó. La decide el mostrador.
   */
  puedeReponer?: boolean;
  /** El corte que este reemplaza, con lo suyo para arrancar (H185). */
  corregir?: {
    id: string;
    numero: string;
    placa: PlacaElegida | null;
    material: string;
    largoMm: number | null;
    anchoMm: number | null;
    mitad: Mitad;
    cantoDescripcion: string;
    notas: string;
    urgente: boolean;
    contactoNombre: string;
    telefono: string;
    retiraEl: string;
    cliente: { id: string; nombre: string; razonSocial: string | null } | null;
    branchId: string | null;
    sinCargo: boolean;
    piezas: Pieza[];
    /** El disco y el acomodo a mano del corte: corregir los perdía (M2S1-090, M2S2-071). */
    anchoSierraMm: number;
    fijadas: PiezaFijada[];
  };
  /** Desde la ficha del cliente: llega con el cliente ya elegido. */
  clienteInicial?: { id: string; nombre: string; razonSocial: string | null; telefono: string | null };
  /**
   * La sierra es un dato del taller: la cambia el admin. A quien vende le
   * sobraba un campo técnico que no sabe completar.
   */
  sierraEditable?: boolean;
  sucursales: { id: string; nombre: string }[];
  /**
   * Lo que se lleva el disco en cada pasada, de /admin/cortes/tarifas.
   *
   * Viaja como prop porque esta pantalla es de cliente —el plano se rehace con
   * cada tecla— y el valor vive en la base. Antes el motor usaba su constante
   * de 5 mm y el número configurable no lo leía nadie: dos verdades para lo
   * mismo.
   */
  anchoSierra: number;
  /**
   * El pedido del que sale este corte, cuando se entra desde su ficha.
   *
   * Viene resuelto del servidor y no como un id suelto en el URL: el cliente y
   * la sucursal ya están decididos por el pedido, y volver a pedirlos sería
   * hacer tipear de nuevo algo que el sistema ya sabe —y arriesgar que quede
   * un corte a nombre de otro—.
   */
  desdePedido?: {
    id: string;
    numero: string;
    branchId: string | null;
    cliente: { id: string; nombre: string; razonSocial: string | null } | null;
    contactoNombre: string;
    /** El de la ficha del cliente, para el aviso de «corte listo». */
    telefono?: string | null;
    /** El día que el pedido prometió (AAAA-MM-DD). */
    entregarEl?: string | null;
    /** Las placas que vende: el corte arranca con la primera. */
    placas?: PlacaDelPedido[];
  };
  /**
   * El corte que alguien mandó por WhatsApp desde el sitio (`?consulta=`):
   * arranca cargado con su placa, su mitad, su canto y sus piezas.
   */
  desdeConsulta?: {
    token: string;
    /** Cuál de las placas de la consulta; 0 es la primera. */
    grupo: number;
    placa: PlacaElegida | null;
    mitad: Mitad;
    cantoDescripcion: string;
    piezas: Pieza[];
  };
}) {
  const router = useRouter();
  // Guardado: a la ficha del corte nuevo, con el aviso a la vista (H044).
  // Quedarse con el formulario lleno y el aviso al pie invitaba a apretar de
  // nuevo y duplicar el trabajo. Se navega desde la acción misma y no desde
  // un efecto: al corregir, la revalidación vuelve a armar esta página con
  // el corte viejo ya cancelado, el formulario se desmontaba antes de que
  // corriera el efecto y la persona quedaba ahí creyendo que había fallado
  // (mes simulado, H185).
  const [estado, accion, pendiente] = useActionState(async (previo: EstadoCorte, datos: FormData) => {
    const r = await crearCorte(previo, datos);
    if (r.ok && r.id) {
      toast.success(r.ok);
      // Arriba de todo a mano: el desplazamiento de Next llevaba la ficha
      // hasta su primer elemento y el título quedaba debajo del encabezado
      // fijo (tercera prueba del mes).
      window.scrollTo({ top: 0 });
      router.push(`/admin/cortes/${r.id}`, { scroll: false });
    }
    return r;
  }, estadoInicial);

  /*
   * Dónde se corta.
   *
   * La clienta pidió que no se preguntara: el corte se hace donde está la
   * máquina y quien carga el trabajo ya está parado ahí. Pero quien toma un
   * corte por teléfono no está al lado de la máquina (mes simulado, H045):
   * el corte suelto deja elegir el taller, con la primera sucursal ya
   * elegida para que nadie tenga que contestar. Con pedido, la del pedido.
   */
  const [sucursal, setSucursal] = useState(
    desdePedido?.branchId ??
      corregir?.branchId ??
      (preguntarSucursal && sucursales.length > 1 ? "" : (sucursales[0]?.id ?? "")),
  );
  const [cliente, setCliente] = useState<{
    id: string;
    nombre: string;
    razonSocial: string | null;
  } | null>(desdePedido?.cliente ?? corregir?.cliente ?? clienteInicial ?? null);
  const [nombre, setNombre] = useState(
    corregir?.contactoNombre ??
      desdePedido?.contactoNombre ??
      (clienteInicial ? (clienteInicial.razonSocial ?? clienteInicial.nombre) : ""),
  );
  const [telefono, setTelefono] = useState(
    corregir?.telefono || clienteInicial?.telefono || desdePedido?.telefono || "",
  );
  // La placa del pedido de entrada: arrancar con una medida supuesta armaba
  // el plano sobre una placa que no era (H188).
  const placaDelPedido = corregir ? undefined : desdePedido?.placas?.[0];
  const [placa, setPlaca] = useState<PlacaElegida | null>(
    desdeConsulta?.placa ?? corregir?.placa ?? placaDelPedido ?? null,
  );
  /** La medida de la placa, en milímetros, como está en pantalla. */
  const [largoPlaca, setLargoPlaca] = useState(
    String(corregir?.largoMm ?? (placaDelPedido?.largoMm || "")),
  );
  const [anchoPlaca, setAnchoPlaca] = useState(
    String(corregir?.anchoMm ?? (placaDelPedido?.anchoMm || "")),
  );
  /** Si sale de media placa, y en qué sentido se parte. */
  const [mitad, setMitad] = useState<Mitad>(
    desdeConsulta?.mitad ?? corregir?.mitad ?? placaDelPedido?.mitad ?? null,
  );
  const [material, setMaterial] = useState(
    desdeConsulta?.placa?.descripcion ?? corregir?.material ?? placaDelPedido?.descripcion ?? "",
  );
  const [piezas, setPiezas] = useState<Pieza[]>(
    desdeConsulta?.piezas.length ? desdeConsulta.piezas : corregir?.piezas.length ? corregir.piezas : [piezaVacia()],
  );
  /** Las piezas que alguien mandó a mano a una placa. */
  const [fijadas, setFijadas] = useState<PiezaFijada[]>(corregir?.fijadas ?? []);
  const [sinCargo, setSinCargo] = useState(corregir?.sinCargo ?? false);
  /** Confirmado que el corte del pedido va en otra placa (H280). */
  const [otraPlaca, setOtraPlaca] = useState(false);
  const placasDelPedidoLista = desdePedido?.placas ?? [];
  const esOtraPlaca =
    placasDelPedidoLista.length > 0 &&
    placa !== null &&
    !placasDelPedidoLista.some((p) => p.variantId === placa.variantId);

  const validas = piezas.filter(
    (p) => p.largoMm > 0 && p.anchoMm > 0 && p.cantidad > 0,
  );
  const totalPiezas = validas.reduce((s, p) => s + p.cantidad, 0);
  // Los metros cuadrados del despiece: no reemplazan al optimizador, pero
  // permiten ver de un vistazo si el número de placas tiene sentido.
  const m2 = validas.reduce(
    (s, p) => s + (p.largoMm / 1000) * (p.anchoMm / 1000) * p.cantidad,
    0,
  );
  // Los metros de tapacanto, con la misma cuenta que la ficha y la planilla
  // del taller. Verlos mientras se carga es lo que atrapa el canto olvidado.
  const metrosCanto = metrosDeTapacanto(validas);

  /*
   * La medida de la placa sobre la que se acomoda.
   *
   * Manda lo que está escrito en los dos campos —que se autocompletan con la
   * variante del catálogo—, y encima se aplica la mitad si el trabajo sale de
   * media placa. Cuando no hay nada de dónde sacarla se usa la de plaza más
   * común y **se avisa en pantalla**: un plano hecho sobre una medida supuesta
   * no sirve para cobrar. Ver `lib/cortes/placa.ts`.
   */
  const claveDeLasPiezas = JSON.stringify(validas);
  const paraElPlano = useMemo(
    () =>
      validas.map((p) => ({
        largoMm: p.largoMm,
        anchoMm: p.anchoMm,
        cantidad: p.cantidad,
        respetaVeta: p.respetaVeta ? 1 : 0,
        etiqueta: p.etiqueta || null,
        cantoLargo: p.cantoLargo,
        cantoAncho: p.cantoAncho,
      })),
    // `validas` se deriva de `piezas` en cada render; la dependencia real es
    // esa, y compararla por JSON evita rehacer el plano por una identidad nueva
    // del array cuando los números no cambiaron.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [claveDeLasPiezas],
  );

  // El disco de este trabajo: arranca con el general y se puede cambiar. El
  // trabajo lo guarda, así su plano no cambia si después se toca el general.
  const [sierraTexto, setSierraTexto] = useState(
    String(corregir?.anchoSierraMm ?? anchoSierraGeneral).replace(".", ","),
  );
  const anchoSierra = leerAnchoDeSierra(sierraTexto) ?? anchoSierraGeneral;

  const medidaPlaca = medidaDePlaca({
    propiaLargo: Number(largoPlaca) || null,
    propiaAncho: Number(anchoPlaca) || null,
    varianteLargo: placa?.largoMm,
    varianteAncho: placa?.anchoMm,
    mitad,
    // La media placa sale de partirla con este disco.
    sierra: anchoSierra,
  });

  /*
   * El plano se pide acá y no adentro del dibujo porque el formulario lo
   * necesita para dos cosas: mostrarlo y proponer cuántas placas. Lo calcula
   * Go mientras se tipea (ver `lib/cortes/en-vivo.ts`).
   */
  const { plano } = usePlano({
    piezas: paraElPlano,
    placaLargo: medidaPlaca.largo,
    placaAncho: medidaPlaca.ancho,
    anchoSierra,
    fijadas,
  });

  // Las placas son las del plano: el campo para pisarlas dejaba la tarjeta
  // del taller con 3 placas y el plano con 2 (H113). Go guarda las suyas.
  const placasDelPlano = Math.max(1, plano.placas.length);

  // Lo que vende el pedido contra lo que usan sus cortes, con el mismo texto
  // que después muestra la ficha: el aviso solo aparecía al guardar (mes
  // simulado, H184).
  const delPedidoElegida = placa ? placasDelPedidoLista.find((p) => p.variantId === placa.variantId) : undefined;
  const avisoDelPedido = (() => {
    if (!desdePedido || !delPedidoElegida?.vendidas || sinCargo || plano.placas.length === 0) return null;
    const usadas = plano.placas.length / (mitad ? 2 : 1);
    const otras = delPedidoElegida.enOtrosCortes ?? 0;
    const total = usadas + otras;
    if (Math.abs(total - delPedidoElegida.vendidas) < 1e-6) return null;
    return otras > 0
      ? `Los cortes de ${desdePedido.numero} usan ${placasEnTexto(total)} y el pedido vende ${placasEnTexto(delPedidoElegida.vendidas)}.`
      : `El plano usa ${placasEnTexto(usadas)} y el pedido ${desdePedido.numero} vende ${placasEnTexto(delPedidoElegida.vendidas)}.`;
  })();

  // El pedido vende todas las placas que usan sus cortes: se venden enteras
  // y el corte va sin cargo, como lo va a decir la ficha (H184).
  const todasDelPedido =
    !sinCargo &&
    Boolean(delPedidoElegida?.vendidas) &&
    plano.placas.length > 0 &&
    (delPedidoElegida?.vendidas ?? 0) + 1e-6 >=
      plano.placas.length / (mitad ? 2 : 1) + (delPedidoElegida?.enOtrosCortes ?? 0);

  // Lo que frena el envío, dicho al lado del botón (H043, H188).
  const motivoParaNoEnviar =
    plano.noEntran.length > 0
      ? plano.noEntran.length === 1
        ? "Una pieza no entra en la placa."
        : `${plano.noEntran.length} piezas no entran en la placa.`
      : !material.trim()
        ? "Falta elegir la placa."
        : esOtraPlaca && !otraPlaca
          ? "Confirmá que va en otra placa."
          : !sucursal && !desdePedido && sucursales.length > 1
            ? "Falta elegir dónde se corta."
            : // Con la placa elegida y sin piezas el botón quedaba apagado
            // sin decir por qué (tercera prueba del mes).
            validas.length === 0
            ? "Faltan las piezas."
            : null;

  function actualizar(
    indice: number,
    campo: keyof Pieza,
    valor: string | boolean,
  ) {
    setPiezas((previas) =>
      previas.map((p, i) =>
        i === indice
          ? {
              ...p,
              [campo]:
                typeof valor === "boolean"
                  ? valor
                  : campo === "etiqueta" || campo === "aclaracion"
                    ? valor
                    : Number(valor),
            }
          : p,
      ),
    );
  }

  return (
    <form {...sinReiniciar(accion)} className="space-y-5">
      <input type="hidden" name="branchId" value={sucursal} />
      <input type="hidden" name="placas" value={placasDelPlano} />
      {corregir && <input type="hidden" name="reemplaza" value={corregir.id} />}
      {sinCargo && desdePedido && <input type="hidden" name="sinCargo" value="si" />}
      {esOtraPlaca && otraPlaca && <input type="hidden" name="otraPlaca" value="si" />}
      {desdePedido && (
        <input type="hidden" name="orderId" value={desdePedido.id} />
      )}
      {desdeConsulta && (
        <input type="hidden" name="consulta" value={desdeConsulta.token} />
      )}
      {desdeConsulta && desdeConsulta.grupo > 0 && (
        <input type="hidden" name="consultaGrupo" value={desdeConsulta.grupo} />
      )}
      {cliente && <input type="hidden" name="customerId" value={cliente.id} />}
      {placa && (
        <input type="hidden" name="variantId" value={placa.variantId} />
      )}
      {/* El acomodo corregido a mano viaja con el formulario: sin esto, mover
          una pieza y apretar Guardar la devolvía al automático sin avisar. */}
      {fijadas.length > 0 && (
        <input
          type="hidden"
          name="acomodoManual"
          value={JSON.stringify(fijadas)}
        />
      )}
      {validas.map((p, i) => (
        <input key={i} type="hidden" name="pieza" value={JSON.stringify(p)} />
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
                  // El de la ficha, como en el presupuesto (H046).
                  if (c.telefono) setTelefono(c.telefono);
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
              required
            />
          </div>
          {/* Sin ficha de cliente, es el único lugar del que sale a quién
              avisarle que el corte está listo. */}
          <div className="space-y-2">
            <Label htmlFor="contactoTelefono">Teléfono</Label>
            <Input
              id="contactoTelefono"
              name="contactoTelefono"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              inputMode="tel"
              maxLength={40}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="retiraEl">Lo retira el</Label>
            {/* El día del pedido, si ya se prometió (H289). */}
            <CampoFecha
              Entrada={Input}
              id="retiraEl"
              name="retiraEl"
              defaultValue={corregir?.retiraEl || desdePedido?.entregarEl || ""}
            />
          </div>
        </Seccion>

        <Seccion titulo="La placa" icono={Layers}>
          <div className="md:col-span-2">
            <BuscadorDePlaca
              branchId={sucursal || sucursales[0]?.id || ""}
              elegida={placa}
              delPedido={placasDelPedidoLista}
              onElegir={(p) => {
                setPlaca(p);
                if (p) {
                  setMaterial(p.descripcion);
                  // La medida de la variante entra en los campos, donde se
                  // puede corregir: la placa que hay en el depósito no siempre
                  // mide lo que dice el catálogo.
                  setLargoPlaca(p.largoMm ? String(p.largoMm) : "");
                  setAnchoPlaca(p.anchoMm ? String(p.anchoMm) : "");
                  const delPedido = placasDelPedidoLista.find((x) => x.variantId === p.variantId);
                  if (delPedido) setMitad(delPedido.mitad);
                  setOtraPlaca(false);
                }
              }}
            />
          </div>

          {/* El pedido vende otra placa: se confirma, no se guarda callado
              (H280: el pedido vendía MDF 18 y el corte quedó en MDF 3 mm). */}
          {esOtraPlaca && desdePedido && (
            <label className="tarjeta-atencion flex cursor-pointer items-center gap-3 px-4 py-3 text-base md:col-span-2">
              <Checkbox checked={otraPlaca} onCheckedChange={(v) => setOtraPlaca(v === true)} />
              <span>
                {desdePedido.numero} vende{" "}
                <strong>{placasDelPedidoLista.map((p) => p.descripcion).join(", ")}</strong>. Va en otra placa.
              </span>
            </label>
          )}

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="materialDescripcion">Placa</Label>
            <Input
              id="materialDescripcion"
              name="materialDescripcion"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              placeholder="Melamina blanca 18mm"
              required
            />
          </div>

          {/* La medida de la placa y de qué sale.

              Antes esto no se podía tocar: la medida salía de la variante y,
              si no había, el plano se armaba sobre 1830 × 2750 avisando
              «medida supuesta» sin dejar corregirla. Con material del cliente
              —que es la mitad de los trabajos— eso volvía inútil el plano. */}
          <div className="space-y-2">
            <Label htmlFor="placaLargoMm">Largo de la placa (mm)</Label>
            <Input
              id="placaLargoMm"
              name="placaLargoMm"
              type="number"
              min="1"
              inputMode="numeric"
              value={largoPlaca}
              onChange={(e) => setLargoPlaca(e.target.value)}
              placeholder={String(medidaPlaca.largo)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="placaAnchoMm">Ancho de la placa (mm)</Label>
            <Input
              id="placaAnchoMm"
              name="placaAnchoMm"
              type="number"
              min="1"
              inputMode="numeric"
              value={anchoPlaca}
              onChange={(e) => setAnchoPlaca(e.target.value)}
              placeholder={String(medidaPlaca.ancho)}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>De qué sale</Label>
            <input type="hidden" name="mitad" value={mitad ?? ""} />
            <Opciones
              nombre="mitad-opcion"
              opciones={MITADES}
              valor={mitad ?? ""}
              alCambiar={(v) => setMitad(v === "" ? null : (v as Mitad))}
              columnas={3}
            />
            {/* La medida con la que se arma el plano. Si es supuesta se avisa:
                un plano sobre una medida inventada no sirve para cobrar. */}
            <p className="text-sm text-muted-foreground">
              {nombreDeLaMitad(mitad)} de {medidaPlaca.largo} ×{" "}
              {medidaPlaca.ancho} mm
              {medidaPlaca.supuesta
                ? " · medida supuesta: elegí la placa del catálogo o escribí la medida"
                : ""}
            </p>
          </div>

          {/* Partir una placa de color no es lo mismo que partir una blanca:
              el dibujo corre en un sentido y la mitad cortada al ancho puede
              quedar con la veta cruzada. No se bloquea —quien atiende sabe qué
              placa tiene en la mano—, se avisa. */}
          {mitad && placa?.color && (
            <p className="tarjeta-atencion px-4 py-3 text-base md:col-span-2">
              La placa es <strong>{placa.color}</strong>: fijate cómo corre el
              dibujo antes de partirla.
            </p>
          )}
        </Seccion>

        <Seccion titulo="Corte" icono={Scissors}>
          <div className="space-y-2">
            <Label htmlFor="cantoDescripcion">Tapacanto del trabajo</Label>
            <Input
              id="cantoDescripcion"
              name="cantoDescripcion"
              defaultValue={desdeConsulta?.cantoDescripcion ?? corregir?.cantoDescripcion}
              placeholder="Blanco 0,45 mm — vacío si no lleva"
            />
          </div>

          {sierraEditable ? (
          <div className="space-y-2">
            <Label htmlFor="anchoSierraMm">Sierra (mm por corte)</Label>
            <Input
              id="anchoSierraMm"
              name="anchoSierraMm"
              value={sierraTexto}
              onChange={(e) => setSierraTexto(e.target.value)}
              inputMode="decimal"
              aria-invalid={leerAnchoDeSierra(sierraTexto) === null}
              className="tabular"
            />
            {leerAnchoDeSierra(sierraTexto) === null && (
              <p className="estado-espera text-sm font-medium">
                Entre 0,5 y 10 mm: mientras tanto se usa{" "}
                {formatearSierra(anchoSierraGeneral)}.
              </p>
            )}
          </div>
          ) : (
            <input type="hidden" name="anchoSierraMm" value={sierraTexto} />
          )}
        </Seccion>
      </Hoja>

      <Hoja>
        <Seccion titulo="Despiece" icono={ListOrdered} columnas={1}>
          {totalPiezas > 0 && (
            <p className="text-sm text-muted-foreground">
              {totalPiezas} {totalPiezas === 1 ? "pieza" : "piezas"} ·{" "}
              {formatearDecimal(m2)} m²
              {metrosCanto > 0 && ` · ${formatearDecimal(metrosCanto)} m de tapacanto`}
            </p>
          )}

          <div className="space-y-3">
            {piezas.map((p, i) => (
              <div
                key={i}
                className="space-y-3 rounded-lg border border-border p-4"
              >
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-28 space-y-1">
                    <Label htmlFor={`largo-${i}`} className="text-base">
                      Largo (mm)
                    </Label>
                    <Input
                      id={`largo-${i}`}
                      type="number"
                      min="1"
                      value={p.largoMm || ""}
                      onChange={(e) => actualizar(i, "largoMm", e.target.value)}
                    />
                  </div>

                  <div className="w-28 space-y-1">
                    <Label htmlFor={`ancho-${i}`} className="text-base">
                      Ancho (mm)
                    </Label>
                    <Input
                      id={`ancho-${i}`}
                      type="number"
                      min="1"
                      value={p.anchoMm || ""}
                      onChange={(e) => actualizar(i, "anchoMm", e.target.value)}
                    />
                  </div>

                  <div className="w-24 space-y-1">
                    <Label htmlFor={`cantidad-${i}`} className="text-base">
                      Cantidad
                    </Label>
                    <Input
                      id={`cantidad-${i}`}
                      type="number"
                      min="1"
                      value={p.cantidad}
                      onChange={(e) =>
                        actualizar(i, "cantidad", e.target.value)
                      }
                    />
                  </div>

                  <div className="min-w-40 flex-1 space-y-1">
                    <Label htmlFor={`etiqueta-${i}`} className="text-base">
                      Etiqueta
                    </Label>
                    <Input
                      id={`etiqueta-${i}`}
                      value={p.etiqueta}
                      onChange={(e) =>
                        actualizar(i, "etiqueta", e.target.value)
                      }
                      placeholder="Puerta, estante…"
                    />
                  </div>

                  {piezas.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setPiezas((previas) =>
                          previas.filter((_, j) => j !== i),
                        )
                      }
                      className="h-11 gap-1.5 text-base text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      Quitar
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={p.respetaVeta}
                      onCheckedChange={(v) =>
                        actualizar(i, "respetaVeta", v === true)
                      }
                    />
                    Respeta la veta
                  </label>

                  {/* Los cantos van 0/1/2 por medida, como la planilla del
                      taller: "2" es canto en los dos lados de esa medida. */}
                  <label className="flex items-center gap-2 text-base">
                    Canto en el largo
                    <select
                      value={p.cantoLargo}
                      onChange={(e) =>
                        actualizar(i, "cantoLargo", e.target.value)
                      }
                      className="h-11 rounded-md border border-input bg-transparent px-2.5 text-base"
                      aria-label="Lados con canto en el largo"
                    >
                      <option value={0}>No</option>
                      <option value={1}>1 lado</option>
                      <option value={2}>2 lados</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-base">
                    Canto en el ancho
                    <select
                      value={p.cantoAncho}
                      onChange={(e) =>
                        actualizar(i, "cantoAncho", e.target.value)
                      }
                      className="h-11 rounded-md border border-input bg-transparent px-2.5 text-base"
                      aria-label="Lados con canto en el ancho"
                    >
                      <option value={0}>No</option>
                      <option value={1}>1 lado</option>
                      <option value={2}>2 lados</option>
                    </select>
                  </label>

                  {(p.cantoLargo > 0 || p.cantoAncho > 0) && (
                    <div className="min-w-44 flex-1 space-y-1">
                      <Label htmlFor={`aclaracion-${i}`} className="text-base">
                        Aclaración del canto
                      </Label>
                      <Input
                        id={`aclaracion-${i}`}
                        value={p.aclaracion}
                        onChange={(e) =>
                          actualizar(i, "aclaracion", e.target.value)
                        }
                        placeholder="Otro color o espesor, solo si difiere"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPiezas((previas) => [...previas, piezaVacia()])}
            >
              <Plus className="h-4 w-4" />
              Agregar pieza
            </Button>
          </div>
        </Seccion>
      </Hoja>

      {/* El plano, acá y no después de guardar.
          No se puede vender un corte sin ver cómo queda adentro de la placa: de
          este acomodo salen las placas que hacen falta, si conviene vender la
          placa entera y cuántas pasadas se cobran. Se recalcula con cada medida
          que se tipea porque el cálculo corre en el navegador. */}
      <section className="tarjeta space-y-5 px-5 py-8 sm:px-8">
        <h2 className="flex items-center gap-3 text-[19px] font-bold tracking-tight">
          <span className="ficha-icono flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
            <LayoutGrid className="h-6 w-6" />
          </span>
          Cómo entra en la placa
        </h2>

        {avisoDelPedido && (
          <p className="estado-problema rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2 text-base font-medium">
            {avisoDelPedido}
          </p>
        )}
        <PlanoEnVivo
          plano={plano}
          medidaSupuesta={medidaPlaca.supuesta}
          fijadas={fijadas}
          onFijadas={setFijadas}
          quien={{ sinCargo: sinCargo && Boolean(desdePedido), media: Boolean(mitad), todasDelCliente: todasDelPedido }}
        />
      </section>

      <Hoja>
        <Seccion titulo="Para el taller" icono={Wrench}>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notas">Notas para el taller</Label>
            <Textarea
              id="notas"
              name="notas"
              rows={2}
              defaultValue={corregir?.notas}
              placeholder="Cuándo lo retiran, si hay que avisar, medidas críticas."
            />
          </div>

          {/* Como el `Interruptor` del molde, pero el valor es «si»: es lo que
              lee `crearCorte` (el del molde manda «on»). */}
          <label className="ficha-interruptor flex cursor-pointer items-center gap-3 rounded-xl p-3.5">
            <span className="ficha-icono flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
              <Siren className="h-5 w-5" />
            </span>
            <span className="flex-1 text-[15px] font-semibold leading-tight">
              Urgente
            </span>
            <Switch name="urgente" value="si" defaultChecked={corregir?.urgente} />
          </label>

          {/* La pieza que faltó en una entrega se repone sin cobrar, atada al
              pedido que la originó (H283). */}
          {desdePedido && puedeReponer && (
            <label className="ficha-interruptor flex cursor-pointer items-center gap-3 rounded-xl p-3.5">
              <span className="ficha-icono flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <PackageCheck className="h-5 w-5" />
              </span>
              <span className="flex-1 text-[15px] font-semibold leading-tight">
                Reposición sin cargo
              </span>
              <Switch checked={sinCargo} onCheckedChange={(v) => setSinCargo(v === true)} />
            </label>
          )}

          {/* Dónde se corta: el corte suelto (H045). */}
          {!desdePedido && sucursales.length > 1 && (
            <div className="space-y-2 md:col-span-2">
              <Label>Dónde se corta</Label>
              <Opciones
                nombre="sucursal-opcion"
                opciones={sucursales.map((x) => ({ valor: x.id, texto: x.nombre }))}
                valor={sucursal}
                alCambiar={setSucursal}
                columnas={2}
              />
            </div>
          )}
        </Seccion>
      </Hoja>

      {/* El error y lo que falta, en la barra fija, al lado del botón: al
          pie de una página larga no se veía en el teléfono. */}
      <BarraGuardar error={estado.error ?? motivoParaNoEnviar}>
        <Button
          type="submit"
          disabled={pendiente || motivoParaNoEnviar !== null || Boolean(estado.ok)}
          className="h-11 px-6"
        >
          {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
          {corregir ? `Reemplazar ${corregir.numero}` : "Mandar a la cola del taller"}
        </Button>
      </BarraGuardar>
    </form>
  );
}

function BuscadorDeCliente({
  elegido,
  onElegir,
}: {
  elegido: { id: string; nombre: string; razonSocial: string | null } | null;
  onElegir: (
    c: { id: string; nombre: string; razonSocial: string | null; telefono?: string | null } | null,
  ) => void;
}) {
  const [texto, setTexto] = useState("");
  const [traidos, setTraidos] = useState<{
    texto: string;
    items: { id: string; nombre: string; razonSocial: string | null; telefono?: string | null }[];
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
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
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
        <ul className="rounded-lg border border-border">
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
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BuscadorDePlaca({
  branchId,
  elegida,
  delPedido = [],
  onElegir,
}: {
  branchId: string;
  elegida: PlacaElegida | null;
  /** Las placas del pedido, a un toque. */
  delPedido?: PlacaElegida[];
  onElegir: (p: PlacaElegida | null) => void;
}) {
  const [texto, setTexto] = useState("");
  const [traidos, setTraidos] = useState<{
    clave: string;
    items: {
      variantId: string;
      producto: string;
      medida: string;
      largoMm?: number | null;
      anchoMm?: number | null;
      color?: string | null;
    }[];
  }>({ clave: "", items: [] });

  const consulta = texto.trim();
  const clave = `${consulta}|${branchId}`;
  const resultados =
    consulta.length >= 2 && traidos.clave === clave ? traidos.items : [];

  useEffect(() => {
    if (consulta.length < 2 || !branchId) return;

    let vigente = true;
    const id = setTimeout(async () => {
      const encontrados = await buscarEnMostrador(consulta, branchId, null);
      if (vigente) setTraidos({ clave, items: encontrados });
    }, 250);

    return () => {
      vigente = false;
      clearTimeout(id);
    };
  }, [consulta, branchId, clave]);

  if (elegida) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <span className="flex-1 font-medium">{elegida.descripcion}</span>
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
      {delPedido.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {delPedido.map((p) => (
            <button
              key={p.variantId}
              type="button"
              onClick={() => onElegir(p)}
              className="tarjeta-hundida inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-left text-base font-medium hover:bg-muted"
            >
              <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
              {p.descripcion}
            </button>
          ))}
        </div>
      )}
      <Label htmlFor="buscarPlaca">Buscar la placa en el catálogo</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="buscarPlaca"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Melamina, fenólico, MDF…"
          className="pl-9"
        />
      </div>

      {resultados.length > 0 && (
        <ul className="rounded-lg border border-border">
          {resultados.map((r) => (
            <li key={r.variantId}>
              <button
                type="button"
                onClick={() => {
                  onElegir({
                    variantId: r.variantId,
                    largoMm: r.largoMm ?? null,
                    anchoMm: r.anchoMm ?? null,
                    color: r.color ?? null,
                    descripcion: `${r.producto} — ${r.medida}`,
                  });
                  setTexto("");
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted"
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{r.producto}</span>
                <span className="text-muted-foreground">{r.medida}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
