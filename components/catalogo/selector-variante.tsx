"use client";

import { Suspense, use, useState, type ComponentProps } from "react";
import { useMedidaElegida } from "@/components/catalogo/medida-elegida";
import { Check, Loader2, Plus, Scissors, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DisponibilidadPorSucursal } from "@/components/catalogo/disponibilidad";
import { useCarrito } from "@/lib/carrito-context";
import { useTienda } from "@/lib/tienda-context";
import { formatearPrecio, formatearUnidad, unidadDeVenta } from "@/lib/formato";
import { PrecioSecundario } from "@/components/precio";
import { BotonWhatsapp } from "@/components/whatsapp/boton";
import { useEstado } from "@/lib/estado-context";
import { mensajeDeConsulta, quienConsulta } from "@/lib/cuenta/portal";
import { cantidadDeConsulta, enlaceDeConsulta, problemaDeCantidad, textoDeConsulta } from "@/lib/catalogo/consulta";
import { presentarComparado, presentarPrecio, type VistaDePrecio } from "@/lib/precios/vista";
import type { PreciosDeFicha } from "@/lib/dal/visitante";
import type { VarianteDetalle } from "@/lib/dal/catalog";
import {
  admiteMedia,
  areaDePlacaM2,
  nombreDePresentacion,
  precioDeLinea,
  seVendePorM2,
  unidadDeLinea,
  type FormaDeVenta,
  type Presentacion,
} from "@/lib/ventas/forma-de-venta";
import {
  admiteDecimales,
  formatearCantidad,
  formatearUnidadLarga,
  formatearUnidadPlural,
  leerCantidad,
  pasoDeCantidad,
} from "@/lib/unidades";

/**
 * Elección de medida y compra.
 *
 * Cada medida tiene su precio y su stock, así que la elección cambia lo que se
 * paga y si está disponible. Por eso el precio y la disponibilidad se muestran
 * junto al selector y se actualizan al elegir, en vez de mostrar un "desde" que
 * después no coincide con lo que se cobra.
 */
export function SelectorVariante({
  productName,
  unit,
  variantes,
  whatsapp,
  numeroWhatsapp,
  cortables = [],
  alicuota = 21,
  vista = "final",
  aPedido = false,
  formaDeVenta = "entera",
  precioMediaPct = 50,
  precios,
}: {
  productName: string;
  unit: string;
  variantes: VarianteDetalle[];
  whatsapp: string;
  /**
   * El número del negocio, en dígitos. Con la tienda apagada la consulta sale
   * con la medida elegida escrita, y para eso hay que armar el enlace acá.
   */
  numeroWhatsapp?: string;
  /** Las medidas que son placas cortables: llevan «Pedila cortada». */
  cortables?: string[];
  /** La del producto. Sin esto el neto informado se calcula siempre al 21 %. */
  alicuota?: number;
  /**
   * Con IVA o sin IVA, la del público. Si quien mira tiene otra, viene en
   * `precios`.
   */
  vista?: VistaDePrecio;
  /**
   * Se fabrica a pedido: no falta, se hace.
   *
   * Son los maquinados especiales del brief —escaleras a medida, tirantes en
   * medidas que no vienen de origen—. Sin esto la ficha solo podía decir "no
   * tenemos stock", que para este producto es directamente falso y espanta a
   * quien justamente venía a encargarlo.
   */
  aPedido?: boolean;
  /** Cómo se vende la placa (nota de la clienta del 30/9/2026). */
  formaDeVenta?: FormaDeVenta;
  precioMediaPct?: number;
  /**
   * Los precios de quien mira, por medida. Sin esto se muestra el de público,
   * que es lo que queda en la ficha armada de antemano. Ver
   * `SelectorVarianteDeQuienMira`.
   */
  precios?: PreciosDeFicha;
}) {
  const { agregar, guardando } = useCarrito();
  const tienda = useTienda();
  const [medida, setMedida] = useState(variantes[0]);
  const [cantidad, setCantidad] = useState(1);
  /** Lo que se está tipeando en la cantidad, para dejar escribir «2,» a medias. */
  const [cantidadTexto, setCantidadTexto] = useState("1");
  const [presentacion, setPresentacion] = useState<Presentacion>(null);

  const producto = { unit, formaDeVenta, precioMediaPct };
  const conMedia = admiteMedia(producto);
  const porM2 = seVendePorM2(producto);
  const unidadVendida = unidadDeLinea(producto);
  // La lata de 4 L se vende y se cuenta por lata: la ficha decía «por l» y el
  // contador «l», y el carrito ya decía «u.» (mes 23). La misma regla del
  // carrito, el remito y el stock.
  const unidadMostrada = unidadDeVenta(unidadVendida, `${productName} ${medida?.label ?? ""}`) ?? unidadVendida;
  // Metros y m² se piden con decimales; placas, tablas, latas y bisagras, enteras.
  const fraccionable = admiteDecimales(unidadMostrada) && unidadMostrada !== "placa";
  const paso = fraccionable ? pasoDeCantidad(unidadMostrada) : 1;

  function fijarCantidad(n: number) {
    const valor = Math.max(paso, Math.round(n * 100) / 100);
    setCantidad(valor);
    setCantidadTexto(formatearCantidad(valor));
  }

  /*
   * El precio del profesional pisa al de público, medida por medida.
   *
   * La ficha sale armada con el precio de público y el de quien mira llega
   * en la misma respuesta (`SelectorVarianteDeQuienMira`). Para el público el
   * mapa está vacío y no cambia nada.
   *
   * **Es solo lo que se ve.** Lo que se cobra lo recalcula el servidor con la
   * lista real al agregar al carrito; acá viaja el id de la variante, nunca un
   * precio.
   */
  const propios = precios?.porVariante ?? {};
  const vistaVigente = precios?.vista ?? vista;

  const conPrecioPropio = (v: VarianteDetalle): VarianteDetalle =>
    // La oferta tachada es de la lista de público: con precio propio no va.
    propios[v.id] ? { ...v, precio: propios[v.id], precioAnterior: null } : v;

  const elegida = medida ? conPrecioPropio(medida) : medida;
  // La galería de la ficha pasa a la foto de la medida elegida.
  const medidaDeLaFicha = useMedidaElegida();
  const setElegida = (v: VarianteDetalle) => {
    setMedida(v);
    medidaDeLaFicha?.elegir(v.id);
  };

  // El precio de lo que se está eligiendo: la media placa vale su porcentaje.
  const precioElegido = precioDeLinea(
    Number(elegida?.precio ?? 0),
    producto,
    conMedia ? presentacion : null,
  );
  const mostrado = presentarPrecio(precioElegido, alicuota, vistaVigente);
  const anterior =
    elegida?.precioAnterior && Number(elegida.precioAnterior) > precioElegido
      ? presentarComparado(
          precioDeLinea(Number(elegida.precioAnterior), producto, conMedia ? presentacion : null),
          alicuota,
          vistaVigente,
        )
      : null;
  const area = porM2 ? areaDePlacaM2(elegida?.largoMm, elegida?.anchoMm) : null;

  if (!elegida) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Este producto todavía no tiene medidas cargadas.
        </p>
        <BotonWhatsapp enlace={whatsapp} variante="secundario" className="mt-3">
          Consultar por WhatsApp
        </BotonWhatsapp>
      </div>
    );
  }

  const sinPrecio = !elegida.precio || Number(elegida.precio) <= 0;
  // Con el stock oculto (todavía sin cargar) nada cuenta como agotado: diría
  // «sin existencia» de todo y frenaría ventas que sí se pueden hacer.
  const agotadaLaMedida = (v: VarianteDetalle) =>
    tienda.stockVisible && v.stock.every((s) => s.nivel === "sin-stock");
  const sinStock = agotadaLaMedida(elegida);
  const subtotal = sinPrecio ? 0 : precioElegido * cantidad;

  return (
    <div className="space-y-5">
      {variantes.length > 1 && (
        <div>
          <p className="mb-2.5 text-[15px] font-semibold">
            Medida
            <span className="ml-1.5 font-normal text-texto-3">
              ({variantes.length} opciones)
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {variantes.map((v) => {
              const activa = v.id === elegida.id;
              const agotada = agotadaLaMedida(v);

              return (
                <button
                  key={v.id}
                  onClick={() => setElegida(v)}
                  aria-pressed={activa}
                  className={`rounded-[10px] px-3.5 py-2.5 text-left transition-colors ${
                    activa
                      ? "border-[1.5px] border-accion bg-naranja-claro font-semibold text-acento-sobre-claro"
                      : agotada
                        ? "border border-linea bg-chip text-texto-3"
                        : "superficie hover:border-accion/40"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[14.5px] tabular-nums">
                    {activa && <Check className="h-3.5 w-3.5" />}
                    {v.label}
                  </span>
                  {agotada && (
                    <span className="mt-0.5 block text-[11.5px] text-texto-3">
                      sin existencia
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Entera o media: dos precios distintos sobre la misma medida, así que
          se elige antes de ver el precio, igual que la medida. */}
      {conMedia && (
        <div>
          <p className="mb-2.5 text-[15px] font-semibold">Cómo la querés</p>
          <div className="flex flex-wrap gap-2">
            {([null, "media_largo", "media_ancho"] as const).map((p) => {
              const activa = presentacion === p;
              return (
                <button
                  key={p ?? "entera"}
                  onClick={() => setPresentacion(p)}
                  aria-pressed={activa}
                  className={`rounded-[10px] px-3.5 py-2.5 text-left text-[14.5px] transition-colors ${
                    activa
                      ? "border-[1.5px] border-accion bg-naranja-claro font-semibold text-acento-sobre-claro"
                      : "superficie hover:border-accion/40"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {activa && <Check className="h-3.5 w-3.5" />}
                    {p === null
                      ? "Placa entera"
                      : p === "media_largo"
                        ? "Media, al largo"
                        : "Media, al ancho"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!tienda.activa ? (
        <ConsultaDeLaMedida
          productName={productName}
          medida={elegida}
          presentacion={conMedia ? presentacion : null}
          unidad={unidadMostrada}
          area={area}
          aPedido={aPedido}
          stockVisible={tienda.stockVisible}
          enlace={(texto) => (numeroWhatsapp ? enlaceDeConsulta(numeroWhatsapp, texto) : whatsapp)}
          // Con la tienda apagada el precio solo llega si es el propio del
          // profesional y la regla lo deja (H086): Go no manda otro.
          precio={sinPrecio ? null : mostrado}
        />
      ) : (
        <>
          {/* Precio de la medida elegida */}
          <div className="rounded-[14px] superficie px-[22px] py-5 shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className={`tabular text-4xl font-bold leading-none tracking-[-0.03em] ${
                  anterior ? "text-rojo-oferta" : ""
                }`}
              >
                {formatearPrecio(String(mostrado.principal))}
              </span>
              {mostrado.sufijo && (
                <span className="text-base font-semibold text-texto-2">
                  {mostrado.sufijo}
                </span>
              )}
              {anterior !== null && (
                <s className="tabular text-lg leading-none text-texto-3">
                  {formatearPrecio(String(anterior))}
                </s>
              )}
            </p>
            <p className="mt-1.5 text-[14.5px] text-texto-2">
              {conMedia && presentacion
                ? nombreDePresentacion(presentacion)?.toLowerCase()
                : `por ${formatearUnidad(unidadMostrada)}`}
              {vistaVigente === "final" && " · IVA incluido"}
              {elegida.material && ` · ${elegida.material}`}
              {elegida.color && ` · ${elegida.color}`}
              {elegida.terminacion && ` · ${elegida.terminacion}`}
              {elegida.calidad && ` · ${elegida.calidad}`}
            </p>
            {/* Por m², la cuenta que el cliente hace de cabeza: cuánto es una
                placa. Sin esto «$9.800 el m²» no dice cuánto sale la placa. */}
            {porM2 && area && (
              <p className="mt-1 text-[14.5px] text-texto-2 tabular-nums">
                Placa de {formatearCantidad((elegida.largoMm ?? 0) / 1000)} ×{" "}
                {formatearCantidad((elegida.anchoMm ?? 0) / 1000)} m ={" "}
                {formatearCantidad(Math.round(area * 100) / 100)} m² ·{" "}
                {formatearPrecio(String(Math.round(precioElegido * area)))} la placa
              </p>
            )}
            <PrecioSecundario
              precioFinal={precioElegido}
              alicuota={alicuota}
              vista={vistaVigente}
              className="mt-1"
            />

            {tienda.stockVisible && (
              <div className="mt-3.5 border-t border-linea-tenue pt-3.5">
                <DisponibilidadPorSucursal stock={elegida.stock} />
              </div>
            )}
          </div>

          {sinPrecio || sinStock ? (
            <div className="rounded-xl border border-dashed p-4 text-center">
              <p className="text-sm text-muted-foreground">
                {aPedido
                  ? "Se fabrica a pedido, en nuestra planta. Escribinos con la medida y te pasamos el plazo."
                  : sinPrecio
                    ? "Este producto se cotiza según la medida y el trabajo."
                    : "Ahora mismo no tenemos stock de esta medida."}
              </p>
              {/* El mismo texto que con la tienda apagada: producto, medida y
                  código, para que quien atiende no tenga que preguntar cuál. */}
              <BotonWhatsapp
                className="mt-3"
                enlace={
                  numeroWhatsapp
                    ? enlaceDeConsulta(
                        numeroWhatsapp,
                        textoDeConsulta({
                          producto: productName,
                          medida: elegida.label,
                          como: conMedia && presentacion ? nombreDePresentacion(presentacion)?.toLowerCase() : null,
                          unidad: unidadMostrada,
                          codigo: elegida.sku,
                        }),
                      )
                    : whatsapp
                }
              >
                {sinPrecio ? "Pedir cotización" : "Consultar disponibilidad"}
              </BotonWhatsapp>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <div className="flex h-[50px] items-center overflow-hidden rounded-[10px] border border-linea bg-card">
                  <button
                    onClick={() => fijarCantidad(cantidad - 1)}
                    className="h-full w-[46px] text-xl leading-none transition-colors hover:bg-chip"
                    aria-label="Quitar uno"
                  >
                    −
                  </button>
                  {/* Lo que se mide se puede tipear: 3,7 metros de zócalo no se
                      arman apretando «+». */}
                  {fraccionable ? (
                    <input
                      value={cantidadTexto}
                      inputMode="decimal"
                      aria-label={`Cantidad, en ${formatearUnidad(unidadMostrada)}`}
                      onChange={(e) => {
                        setCantidadTexto(e.target.value);
                        const n = leerCantidad(e.target.value);
                        if (Number.isFinite(n) && n > 0) setCantidad(Math.round(n * 100) / 100);
                      }}
                      onBlur={() => fijarCantidad(cantidad)}
                      className="tabular h-full w-[64px] bg-transparent text-center text-[17px] font-semibold outline-none"
                    />
                  ) : (
                    <span className="tabular w-[52px] text-center text-[17px] font-semibold">
                      {cantidad}
                    </span>
                  )}
                  <button
                    onClick={() => fijarCantidad(cantidad + 1)}
                    className="h-full w-[46px] text-xl leading-none transition-colors hover:bg-chip"
                    aria-label="Agregar uno"
                  >
                    +
                  </button>
                  {fraccionable && (
                    <span className="pr-3 text-[14.5px] text-texto-2">
                      {formatearUnidad(unidadMostrada)}
                    </span>
                  )}
                </div>

                <Button
                  disabled={guardando}
                  className="h-[50px] flex-1 rounded-[10px] bg-accion text-base font-semibold text-white hover:bg-accion-hover"
                  onClick={() =>
                    agregar({
                      variantId: elegida.id,
                      descripcion: `${productName} — ${elegida.label}`,
                      unidad: unidadVendida,
                      cantidad,
                      presentacion: conMedia ? presentacion : null,
                      origen: "catalogo",
                    })
                  }
                >
                  {guardando ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {/* Con la tienda prendida se compra: es el carrito, no un
                      presupuesto (M2S2-140). */}
                  Agregar al carrito
                </Button>
              </div>

              {cantidad !== 1 && (
                <p className="text-center text-sm text-muted-foreground">
                  {formatearCantidad(cantidad)} × {formatearPrecio(String(precioElegido))} ={" "}
                  <span className="tabular font-semibold text-foreground">
                    {formatearPrecio(String(subtotal))}
                  </span>
                </p>
              )}

              {/* La consulta lleva la medida, la forma y el código elegidos,
                  como con la tienda apagada: quedaba fijo en «Me interesa:
                  MDF» aunque se cambiara la medida (M2S4-028). */}
              <BotonWhatsapp
                variante="secundario"
                tamano="grande"
                className="w-full"
                enlace={
                  numeroWhatsapp
                    ? enlaceDeConsulta(
                        numeroWhatsapp,
                        textoDeConsulta({
                          producto: productName,
                          medida: elegida.label,
                          como: conMedia && presentacion ? nombreDePresentacion(presentacion)?.toLowerCase() : null,
                          unidad: unidadMostrada,
                          codigo: elegida.sku,
                        }),
                      )
                    : whatsapp
                }
              >
                Consultar por WhatsApp
              </BotonWhatsapp>
            </>
          )}
        </>
      )}

      {cortables.includes(elegida.id) && (
        <Link
          href={`/corte#placa=${elegida.id}`}
          className="flex h-[50px] w-full items-center justify-center gap-2.5 rounded-[10px] border border-linea bg-card text-base font-semibold transition-colors hover:bg-sitio-alt"
        >
          <Scissors className="h-[18px] w-[18px] text-acento-texto" />
          Pedila cortada
        </Link>
      )}

      <p className="tabular text-center text-xs text-texto-3">
        Código {elegida.sku}
      </p>
    </div>
  );
}

/**
 * La medida elegida, sin precio: lo que muestra la ficha con la tienda
 * apagada (la primera entrega, ver `lib/tienda.ts`).
 *
 * El lugar del precio lo ocupa lo que define la medida —material, color,
 * terminación, calidad, la superficie de la placa— y el botón va a WhatsApp
 * con el producto y la medida ya escritos: quien atiende contesta el precio
 * sin tener que preguntar cuál.
 */
function ConsultaDeLaMedida({
  productName,
  medida,
  presentacion,
  unidad,
  area,
  aPedido,
  stockVisible,
  enlace,
  precio,
}: {
  precio: { principal: number; sufijo?: string | null } | null;
  productName: string;
  medida: VarianteDetalle;
  presentacion: Presentacion;
  unidad: string;
  area: number | null;
  aPedido: boolean;
  stockVisible: boolean;
  enlace: (texto: string) => string;
}) {
  /*
   * La cantidad, opcional y vacía al empezar (hallazgo 45, 18/11/2026): el
   * precio de 1 placa y el de 40 no son el mismo mensaje, y era lo primero
   * que preguntaba el vendedor. Si queda vacía el texto sale como antes.
   * Lleva la unidad adentro, a la derecha: «12» solo puede ser placas,
   * metros o m², y no es texto explicativo, es parte del dato.
   */
  const [cantidadTexto, setCantidadTexto] = useState("");
  const cantidad = cantidadDeConsulta(cantidadTexto, unidad);
  const detalles = [medida.material, medida.color, medida.terminacion, medida.calidad].filter(Boolean);
  const como = presentacion ? nombreDePresentacion(presentacion)?.toLowerCase() : null;
  const texto = textoDeConsulta({
    producto: productName,
    medida: medida.label,
    como,
    cantidad,
    unidad,
    codigo: medida.sku,
  });
  // Con media placa se cuentan medias: el sufijo lo dice, para que «12» no
  // se lea como doce placas enteras.
  const sufijo = presentacion ? "medias" : formatearUnidad(unidad);
  // Lo inválido se marca y no se manda (comité final, M19): antes «15000»
  // salía como 9999 y «2,5» placas salía sin cantidad, sin que nadie lo viera.
  const problema = problemaDeCantidad(cantidadTexto, unidad);
  const invalida = problema !== null;

  return (
    <>
      <div className="rounded-[14px] superficie px-[22px] py-5 shadow-[0_1px_2px_rgb(60_50_40_/_0.05)]">
        {/* Medidas en la sans con cifras tabulares (comité final, M21): la mono
            es para importes y códigos. */}
        <p className="text-2xl font-bold leading-tight tracking-[-0.02em] tabular-nums">{medida.label}</p>
        {precio && (
          <p className="mt-2 flex items-baseline gap-2">
            <span className="tabular text-3xl font-bold leading-none tracking-[-0.03em]">
              {formatearPrecio(String(precio.principal))}
            </span>
            {precio.sufijo && <span className="text-base font-semibold text-texto-2">{precio.sufijo}</span>}
          </p>
        )}
        <p className="mt-1.5 text-[14.5px] text-texto-2">
          {como ?? `Se vende por ${formatearUnidadLarga(unidad)}`}
          {detalles.map((d) => ` · ${d}`)}
        </p>
        {area && (
          <p className="mt-1 text-[14.5px] text-texto-2 tabular-nums">
            Placa de {formatearCantidad((medida.largoMm ?? 0) / 1000)} ×{" "}
            {formatearCantidad((medida.anchoMm ?? 0) / 1000)} m ={" "}
            {formatearCantidad(Math.round(area * 100) / 100)} m²
          </p>
        )}
        {aPedido && (
          <p className="mt-1 text-[14.5px] text-texto-2">Se fabrica a pedido, en nuestra planta.</p>
        )}
        {stockVisible && (
          <div className="mt-3.5 border-t border-linea-tenue pt-3.5">
            <DisponibilidadPorSucursal stock={medida.stock} />
          </div>
        )}
      </div>

      <div className="flex items-stretch gap-2.5">
        <label
          className={`flex h-[50px] w-[124px] flex-none items-center rounded-[10px] border bg-card pr-3 ${
            // El error con el rojo y el aro de los campos inválidos del resto
            // (components/ui/input.tsx): el naranja era casi el del foco.
            invalida ? "border-destructive ring-3 ring-destructive/20" : "border-linea focus-within:border-accion"
          }`}
        >
          <input
            value={cantidadTexto}
            onChange={(e) => setCantidadTexto(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="Cant."
            aria-label={`Cantidad, en ${presentacion ? "medias placas" : formatearUnidadPlural(unidad)}`}
            aria-invalid={invalida || undefined}
            aria-describedby={invalida ? "problema-de-cantidad" : undefined}
            className="tabular h-full w-full min-w-0 bg-transparent pl-3.5 text-[17px] font-semibold outline-none placeholder:text-[15px] placeholder:font-normal placeholder:text-texto-3"
          />
          <span aria-hidden className="text-[14.5px] text-texto-2">
            {sufijo}
          </span>
        </label>
        {/* Con sesión, el mensaje dice quién consulta: el vendedor cotiza con
            su lista sin preguntar (mes simulado, H087). La sesión se resuelve
            aparte; mientras tanto, el botón con el mensaje de siempre. */}
        <Suspense fallback={<BotonConsultarPrecio enlace={enlace(texto)} deshabilitado={invalida} />}>
          <BotonConsultarPrecioDeQuienMira texto={texto} enlace={enlace} deshabilitado={invalida} />
        </Suspense>
      </div>
      {problema && (
        <p id="problema-de-cantidad" role="alert" className="-mt-1 flex items-center gap-1.5 text-[14.5px] text-destructive">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          {problema}
        </p>
      )}
    </>
  );
}

/**
 * El selector con los precios de quien mira.
 *
 * El respaldo es el selector con el precio de público, que es lo que queda en
 * la ficha armada de antemano; el de quien mira lo reemplaza en la misma
 * respuesta, antes de que se pueda tocar nada. La promesa trae solo las medidas
 * de este producto: el mapa completo de la lista no sale del servidor.
 */
export function SelectorVarianteDeQuienMira({
  precios,
  ...props
}: Omit<ComponentProps<typeof SelectorVariante>, "precios"> & {
  precios: Promise<PreciosDeFicha>;
}) {
  return (
    <Suspense fallback={<SelectorVariante {...props} />}>
      <SelectorConPrecios promesa={precios} {...props} />
    </Suspense>
  );
}

function SelectorConPrecios({
  promesa,
  ...props
}: Omit<ComponentProps<typeof SelectorVariante>, "precios"> & {
  promesa: Promise<PreciosDeFicha>;
}) {
  return <SelectorVariante {...props} precios={use(promesa)} />;
}

function BotonConsultarPrecio({ enlace, deshabilitado }: { enlace: string; deshabilitado: boolean }) {
  return (
    <BotonWhatsapp enlace={enlace} tamano="grande" deshabilitado={deshabilitado} className="min-w-0 flex-1 px-3">
      <span className="truncate">Consultar precio</span>
    </BotonWhatsapp>
  );
}

function BotonConsultarPrecioDeQuienMira({
  texto,
  enlace,
  deshabilitado,
}: {
  texto: string;
  enlace: (texto: string) => string;
  deshabilitado: boolean;
}) {
  const { sesion } = useEstado();
  const quien = quienConsulta(sesion);
  return <BotonConsultarPrecio enlace={enlace(mensajeDeConsulta(texto, quien))} deshabilitado={deshabilitado} />;
}
