import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { existe } from "@/lib/dal/existencia";
import { Check, PackageCheck } from "lucide-react";
import { remitoPorToken } from "@/lib/dal/admin/entregas";
import { cantidadConUnidad } from "@/lib/formato";
import { fechaHoraDeFirma } from "@/lib/entregas/fecha";
import { Pizarra } from "./pizarra";
import { VolverAlPedido } from "./volver";

export const metadata: Metadata = {
  title: "Firmar la entrega",
  robots: { index: false, follow: false },
};

/**
 * Firma de la entrega, para el celular.
 *
 * Es pública a propósito: la abre quien viene a retirar, que muchas veces no es
 * el titular de la cuenta —es el flete, o un oficial de la obra— y no tiene por
 * qué tener sesión. Lo que la protege es el token del link, que se genera al
 * azar y se invalida apenas se firma.
 *
 * Sin menú, sin navbar y con todo grande: se usa parado en el mostrador, con
 * una mano, y muchas veces con las manos sucias.
 */
export default async function FirmarPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // El 404 antes de mandar nada, desde la caché (ver `lib/dal/existencia.ts`):
  // con el `loading.tsx` que tenía esta carpeta, un enlace inventado respondía
  // 200 con la pantalla de no encontrado.
  if (!(await existe("remito-por-token", token))) notFound();

  return (
    <Suspense fallback={<BuscandoElRemito />}>
      <Firma token={token} />
    </Suspense>
  );
}

/**
 * Un token que no es de nadie, para el build. Sin esta lista, leer el
 * parámetro es un dato por pedido y el 404 quedaría detrás del `<Suspense>`.
 */
export async function generateStaticParams() {
  return [{ token: "sin-remito" }];
}

/** Lo que se ve mientras se trae el remito: el estado de la firma es por pedido. */
function BuscandoElRemito() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8" aria-busy="true">
      <span className="text-base text-muted-foreground">Buscando el remito…</span>
    </div>
  );
}

async function Firma({ token }: { token: string }) {
  const remito = await remitoPorToken(token);

  // Sin remito, el link nunca existió. Un token es aleatorio de 24 bytes: si no
  // corresponde a nada, no hay nada que explicar.
  if (!remito) notFound();

  // El link sigue sirviendo después de firmar, pero ya no para firmar: muestra
  // la constancia. Es lo que el cliente quiere ver cuando lo vuelve a abrir.
  const firmado = remito.estado !== "preparada";
  // En un envío firma quien recibe en la obra, no quien retira (mes
  // simulado: decía «Confirmá lo que retirás» al que recibía el camión).
  const envio = remito.tipo === "envio";
  // Lo que se firma: este remito y los de otros pedidos de la misma visita.
  const grupos = [
    { numero: remito.numero, pedidoNumero: remito.pedidoNumero, lineas: remito.lineas },
    ...remito.visita,
  ];

  // Los colores del tema, no blanco fijo: con el modo oscuro del sistema la
  // tarjeta quedaba blanca con el texto casi blanco y no se leía qué se
  // firmaba (mes simulado). El lienzo de la firma sí es blanco: ahí se dibuja
  // en tinta oscura.
  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-lg space-y-5">
        <header className="text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-orange/10">
            <PackageCheck className="h-6 w-6 text-brand-orange" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">
            {firmado ? "Constancia de entrega" : envio ? "Confirmá lo que recibís" : "Confirmá lo que retirás"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Remito <span className="tabular">{remito.numero}</span> · pedido{" "}
            <span className="tabular">{remito.pedidoNumero}</span>
          </p>
        </header>

        {grupos.map((g, n) => (
          <section key={g.numero} className="tarjeta overflow-hidden">
            <h2 className="flex flex-wrap items-baseline justify-between gap-x-3 border-b px-5 py-3 font-medium">
              {firmado ? (envio ? "Qué se entregó" : "Qué se retiró") : envio ? "Qué recibís" : "Qué te llevás"}
              {grupos.length > 1 && (
                <span className="tabular text-sm font-normal text-muted-foreground">
                  {n === 0 ? "" : `Remito ${g.numero} · `}pedido {g.pedidoNumero}
                </span>
              )}
            </h2>
            <ul className="divide-y">
              {g.lineas.map((linea, i) => (
                <li key={i} className="px-5 py-3">
                  <span className="flex justify-between gap-4">
                    <span className="min-w-0">{linea.descripcion}</span>
                    <span className="tabular shrink-0 font-semibold">{cantidadConUnidad(linea.cantidad, linea.unidad, linea.descripcion)}</span>
                  </span>
                  {/* Lo que sale cortado y según qué corte: si falta una
                      pieza, la firma tiene que servir de constancia. */}
                  {linea.corte && <span className="mt-0.5 block text-sm text-muted-foreground">{linea.corte}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {firmado ? (
          <section className="tarjeta p-6 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-green">
              <Check className="h-6 w-6 text-white" strokeWidth={3} />
            </span>
            <p className="text-lg font-semibold">
              {remito.estado === "anulada"
                ? "Este remito fue anulado"
                : "Entrega confirmada"}
            </p>
            {remito.estado !== "anulada" && (
              <p className="mt-1 text-muted-foreground">
                Firmado
                {remito.firmadoAt
                  ? ` el ${fechaHoraDeFirma.format(remito.firmadoAt)}`
                  : ""}
                {remito.receptorNombre ? ` por ${remito.receptorNombre}` : ""}.
              </p>
            )}

            {remito.firmaUrl && (
              // Sin optimizar: es una firma, tiene que verse tal cual se trazó.
              // Va sobre su papel blanco, como se guardó.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={remito.firmaUrl}
                alt="Firma registrada"
                className="mx-auto mt-4 h-20 rounded-md bg-white object-contain p-1"
              />
            )}
            <VolverAlPedido />
          </section>
        ) : (
          <>
            <section className="tarjeta p-5">
              <Pizarra
                token={token}
                envio={envio}
                nombreSugerido={remito.receptorNombre}
                documentoSugerido={remito.receptorDocumento}
              />
            </section>

            <p className="text-center text-sm text-muted-foreground">
              Al firmar dejás constancia de que recibiste esta mercadería. Queda
              registrada la fecha y la hora.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
