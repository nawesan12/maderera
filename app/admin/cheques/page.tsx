import type { Metadata } from "next";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import {
  avisosManuales,
  type AvisoManualListo,
} from "@/lib/whatsapp/aviso-manual-datos";
import Link from "next/link";
import { Banknote } from "lucide-react";
import { etiquetaDeCircuito } from "@/lib/circuito";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { GrupoListado } from "@/components/admin/grupo";
import {
  leerPagina,
  Paginador,
  POR_PAGINA,
} from "@/components/admin/paginador";
import { fechaCorta, moneda, plural } from "@/components/admin/formato";
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

  const ahora = new Date();
  const enDias = (fecha: Date) =>
    Math.ceil((fecha.getTime() - ahora.getTime()) / 86_400_000);

  /*
   * Lo que informaron los clientes desde Mi cuenta y todavía no se tiene en
   * mano. Va primero y aparte: hasta que alguien lo acepta, el cliente ve su
   * pago «en revisión» y la deuda no le baja.
   */
  const porRecibir = vivos.filter((c) => c.estado === "informado");
  const paraDepositar = vivos.filter(
    (c) =>
      c.sentido === "recibido" && ["cartera", "depositado"].includes(c.estado),
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
              {porRecibir.map((c) => (
                <Tarjeta key={c.id} cheque={c} dias={enDias(c.fechaPago)} />
              ))}
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
          <Lado titulo="Para cubrir" cheques={paraCubrir} enDias={enDias} />

          {endosados.length > 0 && (
            <GrupoListado
              titulo="Endosados a proveedores"
              cantidad={endosados.length}
            >
              {endosados.map((c) => (
                <Tarjeta key={c.id} cheque={c} dias={enDias(c.fechaPago)} />
              ))}
            </GrupoListado>
          )}

          <GrupoListado
            titulo="Terminados"
            cantidad={terminados.total}
            vacio={
              <p className="px-1 text-base text-texto-2">Ninguno todavía.</p>
            }
          >
            {terminados.filas.map((c) => (
              <Tarjeta
                key={c.id}
                cheque={c}
                dias={null}
                apagado={!avisos[c.id]}
                aviso={avisos[c.id] ?? null}
              />
            ))}
            <Paginador pagina={pagina} total={terminados.total} params={{}} />
          </GrupoListado>
        </>
      )}
    </div>
  );
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
        {moneda.format(total)}
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
          titulo={`${t.titulo} · ${moneda.format(t.lista.reduce((s, c) => s + c.importe, 0))}`}
          cantidad={t.lista.length}
          destacado={t.hasta <= 7}
        >
          {t.lista.map((c) => (
            <Tarjeta key={c.id} cheque={c} dias={enDias(c.fechaPago)} />
          ))}
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

  return (
    <article
      className={`tarjeta flex flex-wrap items-center gap-4 px-5 py-4 ${
        apagado ? "opacity-75" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* El banco y el número juntos: es como se lo encuentra en el
              banco, que es lo que pidió la clienta. */}
          <h3 className="text-lg font-medium">
            {c.banco ?? "Sin banco"}{" "}
            <span className="tabular">N° {c.numero}</span>
          </h3>
          <span
            className={`rounded-full px-2.5 py-1 text-sm font-medium ${
              c.sentido === "recibido"
                ? "bg-naranja-claro text-acento-sobre-claro"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {c.sentido === "recibido" ? "De tercero" : "Propio"}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-medium text-muted-foreground">
            {ESTADOS[c.estado] ?? c.estado}
            {c.tipo === "echeq" && " · e-Cheq"}
          </span>
          {/* El circuito, porque la cartera tiene que poder contestar "cuánto
              hay que cubrir esta semana" para cada uno por separado. */}
          <span className="rounded-full bg-chip px-2.5 py-1 text-sm font-medium text-texto-2">
            {etiquetaDeCircuito(c.circuito)}
          </span>
        </div>
        {/*
          De quién vino y a quién fue, enlazados: el cliente con su ficha, el
          proveedor con la suya y el cheque con el recibo con que entró. El
          momento en que hace falta es el peor posible: un cheque rebotado y
          alguien preguntando de quién era.
        */}
        <p className="mt-1 text-base text-muted-foreground">
          {c.librador
            ? `Librado por ${c.librador}`
            : c.cliente
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
              {" · entregado a "}
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
          {c.notas && ` · ${c.notas}`}
          {c.receiptId && c.recibo && (
            <>
              {" · "}
              <a
                href={`/api/recibos/${c.receiptId}/pdf`}
                target="_blank"
                rel="noopener"
                className="tabular hover:text-brand-orange hover:underline"
              >
                recibo {c.recibo}
              </a>
            </>
          )}
        </p>
        {c.estado === "rechazado" && c.motivoRechazo && (
          <p className="estado-problema mt-1 text-sm font-medium">
            Rechazado: {c.motivoRechazo}
          </p>
        )}
        {aviso && (
          <div className="mt-2.5">
            <AvisarPorWhatsapp aviso={aviso} compacto />
          </div>
        )}
      </div>

      <div className="text-right">
        <p className="tabular text-xl font-semibold">
          {moneda.format(c.importe)}
        </p>
        <p
          className={`text-base ${
            vencido
              ? "font-semibold text-brand-orange-dark"
              : dias !== null && dias <= 7
                ? "font-medium text-brand-orange-dark"
                : "text-muted-foreground"
          }`}
        >
          {fechaCorta.format(c.fechaPago)}
          {dias !== null &&
            (vencido
              ? ` · ${yaVencido(c)}`
              : dias === 0
                ? " · hoy"
                : ` · en ${plural(dias, "día")}`)}
        </p>
      </div>

      {!apagado && (
        <AccionesDeCheque
          id={c.id}
          estado={c.estado}
          sentido={c.sentido}
          numero={c.numero}
          importe={c.importe}
        />
      )}
    </article>
  );
}
