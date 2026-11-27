import type { Metadata } from "next";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import {
  avisosManuales,
  type AvisoManualListo,
} from "@/lib/whatsapp/aviso-manual-datos";
import Link from "next/link";
import { Banknote, ChevronDown } from "lucide-react";
import { RotuloDelCircuito } from "@/components/admin/circuito";
import { diasHasta, formatearMonto } from "@/lib/formato";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { GrupoListado } from "@/components/admin/grupo";
import {
  leerPagina,
  Paginador,
  POR_PAGINA,
} from "@/components/admin/paginador";
import { fechaCorta, plural } from "@/components/admin/formato";
import {
  chequesTerminados,
  listarCheques,
  type ChequeListado,
} from "@/lib/dal/admin/cheques";
import { AccionesDeCheque, AltaDeCheque } from "./vista";

export const metadata: Metadata = { title: "Cheques" };

/**
 * Los tramos de vencimiento: «30/60/90 días», como pidió la clienta, con lo
 * vencido y la semana adelante porque son lo que se mueve el lunes. Un tramo
 * sin cheques no se muestra.
 */
const TRAMOS: { titulo: string; hasta: number }[] = [
  { titulo: "Vencidos", hasta: -1 },
  { titulo: "Esta semana", hasta: 7 },
  { titulo: "Hasta 30 días", hasta: 30 },
  { titulo: "Hasta 60 días", hasta: 60 },
  { titulo: "Hasta 90 días", hasta: 90 },
  { titulo: "Más de 90 días", hasta: Number.POSITIVE_INFINITY },
];

/**
 * La cartera de cheques, separada por lo que hay que hacer con cada uno.
 *
 * La pregunta del lunes son dos: qué hay que **depositar** (los de terceros
 * en la cartera o ya depositados esperando acreditarse) y qué hay que
 * **cubrir** (los propios entregados, que debitan de la cuenta). Antes iban
 * mezclados en «En juego» y para saber cuánta plata tenía que haber en el
 * banco había que sumar a mano los que decían «Entregado». Cada lado va por
 * tramo de vencimiento, con su total.
 *
 * Los de terceros ya endosados a un proveedor no son de ninguno de los dos
 * lados: no se depositan ni se cubren, pero pueden rebotar. Van aparte.
 *
 * Los terminados se piden de a páginas: el backend los traía todos, y con los
 * años eran miles debajo de la cartera.
 */
export default async function ChequesPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  const pagina = leerPagina((await searchParams).pagina);
  const [vivos, terminados] = await Promise.all([
    listarCheques({ estado: "vivos" }),
    chequesTerminados(pagina, POR_PAGINA),
  ]);

  // Por día argentino, como la fecha que se muestra (diasHasta).
  const ahora = new Date();
  const enDias = (fecha: Date) => diasHasta(fecha, ahora) ?? 0;

  /*
   * Lo que informaron los clientes desde Mi cuenta y todavía no se tiene en
   * mano. Va primero y aparte: hasta que alguien lo acepta, el cliente ve su
   * pago «en revisión» y la deuda no le baja.
   */
  const porRecibir = vivos.filter((c) => c.estado === "informado");
  // Lo depositado ya no está «para depositar»: va aparte, en el banco,
  // esperando que se acredite (M2S2-097, M3S2-041).
  const paraDepositar = vivos.filter(
    (c) => c.sentido === "recibido" && c.estado === "cartera",
  );
  const enElBanco = vivos.filter(
    (c) => c.sentido === "recibido" && c.estado === "depositado",
  );
  const paraCubrir = vivos.filter(
    (c) => c.sentido === "entregado" && c.estado === "entregado",
  );
  const endosados = vivos.filter(
    (c) => c.sentido === "recibido" && c.estado === "entregado",
  );

  // Un cheque del cliente que rebotó: hay que avisarle, y desde el teléfono es
  // gratis. Solo los recibidos de un cliente cargado de esta página.
  const avisos = await avisosManuales(
    "cheque_rechazado",
    "cheque",
    terminados.filas
      .filter(
        (c) =>
          c.estado === "rechazado" && c.sentido === "recibido" && c.customerId,
      )
      .map((c) => c.id),
  );

  const total = (lista: ChequeListado[]) =>
    lista.reduce((s, c) => s + c.importe, 0);
  const vacio = vivos.length === 0 && terminados.total === 0;

  return (
    <div className="space-y-6">
      <EncabezadoPanel titulo="Cheques">
        <AltaDeCheque />
      </EncabezadoPanel>

      {vacio ? (
        <div className="tarjeta-hundida py-16 text-center">
          <Banknote className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">La cartera está vacía</p>
        </div>
      ) : (
        <>
          {porRecibir.length > 0 && (
            <GrupoListado
              titulo="Por recibir"
              cantidad={porRecibir.length}
              destacado
            >
              <Grilla>
                {porRecibir.map((c) => (
                  <Tarjeta key={c.id} cheque={c} dias={enDias(c.fechaPago)} />
                ))}
              </Grilla>
            </GrupoListado>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Total
              titulo="Para depositar"
              cheques={paraDepositar}
              total={total(paraDepositar)}
            />
            <Total
              titulo="Para cubrir"
              cheques={paraCubrir}
              total={total(paraCubrir)}
            />
          </div>

          <Lado
            titulo="Para depositar"
            cheques={paraDepositar}
            enDias={enDias}
          />
          {enElBanco.length > 0 && (
            <GrupoListado
              titulo={`En el banco · ${formatearMonto(total(enElBanco))}`}
              cantidad={enElBanco.length}
            >
              <Grilla>
                {enElBanco.map((c) => (
                  <Tarjeta key={c.id} cheque={c} dias={enDias(c.fechaPago)} />
                ))}
              </Grilla>
            </GrupoListado>
          )}
          <Lado titulo="Para cubrir" cheques={paraCubrir} enDias={enDias} />

          {endosados.length > 0 && (
            <GrupoListado
              titulo="Endosados a proveedores"
              cantidad={endosados.length}
            >
              <Grilla>
                {endosados.map((c) => (
                  <Tarjeta key={c.id} cheque={c} dias={enDias(c.fechaPago)} />
                ))}
              </Grilla>
            </GrupoListado>
          )}

          {/* Los terminados, plegados: abiertos, la página llegaba a 9.000
              px en el teléfono y 14.000 en la computadora (M2S4-037,
              M3S4-019). Se abren solos al cambiar de página. */}
          {terminados.total > 0 && (
            <details className="group mt-[22px]" open={pagina > 1 || undefined}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5">
                <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-texto-2">Terminados</h2>
                <span className="tabular rounded-full bg-chip px-2.5 py-0.5 text-[13px] font-semibold text-texto-2">
                  {terminados.total}
                </span>
                <ChevronDown className="h-5 w-5 text-texto-2 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-[11px] space-y-3">
                <Grilla>
                  {terminados.filas.map((c) => (
                    <Tarjeta
                      key={c.id}
                      cheque={c}
                      dias={null}
                      apagado={!avisos[c.id]}
                      aviso={avisos[c.id] ?? null}
                    />
                  ))}
                </Grilla>
                <Paginador pagina={pagina} total={terminados.total} params={{}} />
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Las tarjetas en columnas donde entran: a 1280, una por renglón dejaba la
 * mitad de la pantalla vacía (M3S4-019).
 */
function Grilla({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">{children}</div>;
}

/** El total de un lado, grande: es el número que se busca al abrir. */
function Total({
  titulo,
  cheques,
  total,
}: {
  titulo: string;
  cheques: ChequeListado[];
  total: number;
}) {
  return (
    <div className="tarjeta p-5">
      <p className="text-base font-semibold text-texto-2">{titulo}</p>
      <p className="tabular mt-1 text-[34px] font-bold leading-none tracking-[-0.03em]">
        {formatearMonto(total)}
      </p>
      <p className="mt-2 text-base text-texto-2">
        {plural(cheques.length, "cheque")}
      </p>
    </div>
  );
}

/** Un lado de la cartera, por tramo de vencimiento. */
function Lado({
  titulo,
  cheques,
  enDias,
}: {
  titulo: string;
  cheques: ChequeListado[];
  enDias: (fecha: Date) => number;
}) {
  if (cheques.length === 0) return null;
  const tramos = TRAMOS.map((t, i) => {
    const desde = i === 0 ? Number.NEGATIVE_INFINITY : TRAMOS[i - 1].hasta;
    const lista = cheques.filter((c) => {
      const d = enDias(c.fechaPago);
      return d > desde && d <= t.hasta;
    });
    return { ...t, lista };
  }).filter((t) => t.lista.length > 0);

  return (
    <section className="space-y-2">
      <h2 className="text-xl font-bold tracking-tight">{titulo}</h2>
      {tramos.map((t) => (
        <GrupoListado
          key={t.titulo}
          titulo={`${t.titulo} · ${formatearMonto(t.lista.reduce((s, c) => s + c.importe, 0))}`}
          cantidad={t.lista.length}
          destacado={t.hasta <= 7}
        >
          <Grilla>
            {t.lista.map((c) => (
              <Tarjeta key={c.id} cheque={c} dias={enDias(c.fechaPago)} />
            ))}
          </Grilla>
        </GrupoListado>
      ))}
    </section>
  );
}

const ESTADOS: Record<string, string> = {
  informado: "Por recibir",
  cartera: "En cartera",
  depositado: "Depositado",
  entregado: "Entregado",
  acreditado: "Acreditado",
  rechazado: "Rechazado",
  anulado: "Anulado",
};

/**
 * Qué dice la fecha de un cheque vencido. Antes era siempre «ya se puede
 * cobrar», también en un cheque propio, donde lo que pasa es lo contrario:
 * puede debitar en cualquier momento y tiene que estar la plata.
 */
function yaVencido(c: ChequeListado): string {
  if (c.sentido === "entregado") return "puede debitar ya";
  if (c.estado === "depositado") return "esperando acreditación";
  if (c.estado === "entregado") return "en manos del proveedor";
  return "ya se puede depositar";
}


/**
 * El chip de origen. Un cheque que el cliente libró y entregó él mismo es
 * «Del cliente»: «De tercero» es el que firmó otro (mes simulado: los del
 * cobro, sin librador, salían como de tercero).
 */
function deQuien(c: { sentido: string; librador: string | null; cliente: string | null }) {
  if (c.sentido !== "recibido") return "Propio";
  if (c.cliente && (!c.librador || mismoNombre(c.librador, c.cliente))) return "Del cliente";
  return c.librador ? "De tercero" : "Recibido";
}

/**
 * Si dos nombres son la misma persona o empresa: sin tildes, mayúsculas,
 * puntuación ni la forma societaria. «Sim Wood Frame Mar SRL» librado por
 * el cliente «Sim Wood Frame Mar» salía «De tercero» (M3S3-043).
 */
function mismoNombre(a: string, b: string): boolean {
  const limpio = (t: string) =>
    t
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLocaleLowerCase("es-AR")
      .replace(/[.,]/g, " ")
      .replace(/\b(s\s*r\s*l|s\s*a\s*s|s\s*a|s\s*a\s*u|s\s*h|s\s*c\s*a)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const x = limpio(a);
  const y = limpio(b);
  return x !== "" && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `));
}

/** Cómo terminó un rechazado: no se aceptó, se devolvió o lo rechazó el banco. */
function estadoDelCheque(c: ChequeListado): string {
  if (c.estado === "rechazado" && c.noAceptado) return "No aceptado";
  if (c.estado === "rechazado" && c.devuelto) return "Devuelto";
  return ESTADOS[c.estado] ?? c.estado;
}

function Tarjeta({
  cheque: c,
  dias,
  apagado = false,
  aviso = null,
}: {
  cheque: ChequeListado;
  dias: number | null;
  apagado?: boolean;
  aviso?: AvisoManualListo | null;
}) {
  const vencido = dias !== null && dias < 0;

  /*
   * En el teléfono la tarjeta usaba media columna para el banco y el número
   * en tres renglones, con el importe flotando a la derecha (mes simulado,
   * H339). Ahora: el importe y la fecha de pago arriba, a todo el ancho; el
   * banco y el número en una línea; los chips en una fila; y la acción
   * principal a mano.
   */
  return (
    <article className={`tarjeta space-y-2 px-4 py-3.5 sm:px-5 ${apagado ? "opacity-75" : ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="tabular text-xl font-semibold">{formatearMonto(c.importe)}</p>
        <p
          className={`tabular text-right text-base ${
            vencido
              ? "font-semibold text-brand-orange-dark"
              : dias !== null && dias <= 7
                ? "font-medium text-brand-orange-dark"
                : "text-muted-foreground"
          }`}
        >
          {fechaCorta.format(c.fechaPago)}
          {/* «en 23 días» entero: se partía en dos renglones (M2S4-037). */}
          {dias !== null && (
            <span className="whitespace-nowrap">
              {vencido ? ` · ${yaVencido(c)}` : dias === 0 ? " · hoy" : ` · en ${plural(dias, "día")}`}
            </span>
          )}
        </p>
      </div>
      {/* El banco y el número juntos: es como se lo encuentra en el banco.
          Si no entran, se corta el banco: el número no se pierde. */}
      <h3 className="flex min-w-0 items-baseline gap-2 text-base font-medium">
        <span className="min-w-0 truncate">{c.banco ?? "Sin banco"}</span>
        <span className="codigo shrink-0 whitespace-nowrap">N° {c.numero}</span>
      </h3>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-medium ${
            c.sentido === "recibido" ? "bg-naranja-claro text-acento-sobre-claro" : "bg-muted text-muted-foreground"
          }`}
        >
          {deQuien(c)}
        </span>
        <span className="whitespace-nowrap rounded-full bg-muted px-2.5 py-0.5 text-sm font-medium text-muted-foreground">
          {estadoDelCheque(c)}
          {c.tipo === "echeq" && " · e-Cheq"}
        </span>
        {/* Solo el circuito B se marca, y como «Circuito B»: una «B» suelta
            se leía como Factura B (mes simulado, H167/H262). El de una venta
            con su factura esperando el CAE no es del B: dice eso (M2S1-061,
            M2S3-035). */}
        {c.circuito === "negro" && c.esperaCae && (
          <span className="whitespace-nowrap rounded-full bg-chip px-2.5 py-0.5 text-sm font-medium text-texto-2">
            Espera CAE
          </span>
        )}
        {c.circuito === "negro" && !c.esperaCae && (
          <span className="whitespace-nowrap rounded-full bg-chip px-2.5 py-0.5 text-sm font-medium text-texto-2">
            <RotuloDelCircuito />
          </span>
        )}
        {c.estado === "informado" && c.saldoCliente !== null && (
          <span
            className={`tabular whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-medium ${
              c.saldoCliente <= 0.005 ? "estado-problema bg-[var(--estado-fondo)]" : "bg-muted text-muted-foreground"
            }`}
          >
            {c.saldoCliente <= 0.005 ? "Sin deuda" : `Debe ${formatearMonto(c.saldoCliente)}`}
          </span>
        )}
      </div>
      <div className="min-w-0">
        {/*
          De quién vino y a quién fue, enlazados: el cliente con su ficha, el
          proveedor con la suya y el cheque con el recibo con que entró. El
          momento en que hace falta es el peor posible: un cheque rebotado y
          alguien preguntando de quién era.
        */}
        <p className="mt-1 text-base text-muted-foreground">
          {/* El propio lo libra la maderera: «Sin librador» no tenía sentido
              ahí, y la nota «Pago a X» repetía al proveedor que ya dice
              «entregado a» (mes simulado, tercera prueba). */}
          {c.librador
            ? `Librado por ${c.librador}`
            : c.cliente || c.sentido !== "recibido"
              ? ""
              : "Sin librador"}
          {c.cliente && (
            <>
              {c.librador ? " · de " : "De "}
              {c.customerId ? (
                <Link
                  href={`/admin/clientes/${c.customerId}`}
                  className="hover:text-brand-orange hover:underline"
                >
                  {c.cliente}
                </Link>
              ) : (
                c.cliente
              )}
            </>
          )}
          {c.proveedor && (
            <>
              {c.librador || c.cliente || c.sentido === "recibido" ? " · entregado a " : "Entregado a "}
              {c.proveedorId ? (
                <Link
                  href={`/admin/proveedores/${c.proveedorId}`}
                  className="hover:text-brand-orange hover:underline"
                >
                  {c.proveedor}
                </Link>
              ) : (
                c.proveedor
              )}
            </>
          )}
          {c.notas && c.notas !== `Pago a ${c.proveedor}` && ` · ${c.notas}`}
          {c.receiptId && c.recibo && (
            <>
              {" · "}
              <a
                href={`/api/recibos/${c.receiptId}/pdf`}
                target="_blank"
                rel="noopener"
                className="tabular whitespace-nowrap hover:text-brand-orange hover:underline"
              >
                recibo {c.recibo}
              </a>
            </>
          )}
        </p>
        {c.estado === "rechazado" && c.motivoRechazo && (
          <p className="estado-problema mt-1 text-sm font-medium">
            {estadoDelCheque(c)}: {c.motivoRechazo}
          </p>
        )}
        {aviso && (
          <div className="mt-2.5">
            <AvisarPorWhatsapp aviso={aviso} compacto />
          </div>
        )}
      </div>

      {!apagado && (
        <AccionesDeCheque
          id={c.id}
          estado={c.estado}
          sentido={c.sentido}
          numero={c.numero}
          banco={c.banco}
          fechaPago={c.fechaPago}
          importe={c.importe}
          diasParaCobrar={diasHasta(c.fechaPago) ?? 0}
          cliente={c.cliente}
          saldoCliente={c.saldoCliente}
          proveedor={c.proveedor}
        />
      )}
    </article>
  );
}
