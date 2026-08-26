import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, PackageCheck } from "lucide-react";
import { remitoPorToken } from "@/lib/dal/admin/entregas";
import { fechaHora, formatearUnidad } from "@/lib/formato";
import { Pizarra } from "./pizarra";

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
  const remito = await remitoPorToken(token);

  // Sin remito, el link nunca existió. Un token es aleatorio de 24 bytes: si no
  // corresponde a nada, no hay nada que explicar.
  if (!remito) notFound();

  // El link sigue sirviendo después de firmar, pero ya no para firmar: muestra
  // la constancia. Es lo que el cliente quiere ver cuando lo vuelve a abrir.
  const firmado = remito.estado !== "preparada";

  return (
    <div className="min-h-screen bg-brand-cream/40 px-4 py-8">
      <div className="mx-auto max-w-lg space-y-5">
        <header className="text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-orange/10">
            <PackageCheck className="h-6 w-6 text-brand-orange" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">
            {firmado ? "Constancia de entrega" : "Confirmá lo que retirás"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Remito <span className="tabular">{remito.numero}</span> · pedido{" "}
            <span className="tabular">{remito.pedidoNumero}</span>
          </p>
        </header>

        <section className="overflow-hidden rounded-xl border bg-white">
          <h2 className="border-b px-5 py-3 font-medium">
            {firmado ? "Qué se retiró" : "Qué te llevás"}
          </h2>
          <ul className="divide-y">
            {remito.lineas.map((linea, i) => (
              <li key={i} className="flex justify-between gap-4 px-5 py-3">
                <span className="min-w-0">{linea.descripcion}</span>
                <span className="tabular shrink-0 font-medium">
                  {linea.cantidad} {formatearUnidad(linea.unidad)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {firmado ? (
          <section className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-6 text-center">
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
                  ? ` el ${fechaHora.format(remito.firmadoAt)}`
                  : ""}
                {remito.receptorNombre ? ` por ${remito.receptorNombre}` : ""}.
              </p>
            )}

            {remito.firmaUrl && (
              // Sin optimizar: es una firma, tiene que verse tal cual se trazó.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={remito.firmaUrl}
                alt="Firma registrada"
                className="mx-auto mt-4 h-20 object-contain"
              />
            )}
          </section>
        ) : (
          <>
            <section className="rounded-xl border bg-white p-5">
              <Pizarra token={token} nombreSugerido={remito.receptorNombre} />
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
