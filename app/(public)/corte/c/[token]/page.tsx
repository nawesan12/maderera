import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Scissors } from "lucide-react";
import { PlanoSimple } from "@/components/cortes/plano-simple";
import { consultaDeCorte, type GrupoDeConsulta } from "@/lib/dal/consultas-corte";
import { staffOrNull } from "@/lib/dal/session";
import { sucursalPublicada } from "@/lib/sucursales";
import { fechaHora } from "@/lib/formato";

export const metadata: Metadata = {
  title: "Pedido de corte",
  robots: { index: false, follow: false },
};

/**
 * El enlace que viaja en el mensaje de WhatsApp del armador: el corte tal
 * como lo vio quien lo mandó, con el mismo plano (Go lo rehace con la medida
 * y la sierra guardadas). Quien atiende, si entró al panel, lo pasa a orden de
 * corte sin volver a tipearlo: una orden por placa, porque una orden de corte
 * es de un solo material.
 */
export default function ConsultaDeCortePage({ params }: { params: Promise<{ token: string }> }) {
  // Todo es por pedido —el token, la sesión—: va detrás del Suspense para que
  // el marco del sitio salga armado.
  return (
    <Suspense fallback={<div className="min-h-[60vh] bg-sitio-alt" aria-busy="true" />}>
      <Consulta params={params} />
    </Suspense>
  );
}

async function Consulta({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [consulta, staff] = await Promise.all([consultaDeCorte(token), staffOrNull()]);
  if (!consulta) notFound();

  const sucursal = consulta.sucursal ? sucursalPublicada(consulta.sucursal) : undefined;
  // Una consulta guardada antes de la 00118 puede llegar sin grupos: su única
  // placa es la de arriba.
  const grupos: GrupoDeConsulta[] = consulta.grupos?.length
    ? consulta.grupos
    : [{ ...consulta, orden: 0 }];
  const varios = grupos.length > 1;
  const unidades = grupos.reduce((s, g) => s + g.piezas.reduce((n, p) => n + p.cantidad, 0), 0);
  const placas = grupos.reduce((s, g) => s + g.plano.placas.length, 0);
  const metros = grupos.reduce((s, g) => s + g.metrosCanto, 0);

  return (
    <div className="bg-sitio-alt">
      <div className="contenedor space-y-5 py-10">
        <div>
          <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em]">
            {varios ? "Pedido de corte" : consulta.material}
          </h1>
          <p className="tabular mt-1 text-base text-texto-2">
            {varios ? `${grupos.length} placas` : medidaDelGrupo(grupos[0]!)}
            {sucursal ? ` · ${sucursal.nombre}` : ""} · {fechaHora.format(new Date(consulta.createdAt))}
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-3 rounded-xl superficie p-5 text-center sm:max-w-md">
          <Cifra valor={placas} nombre={placas === 1 ? "placa" : "placas"} />
          <Cifra valor={unidades} nombre={unidades === 1 ? "pieza" : "piezas"} />
          <Cifra valor={Math.round(metros * 100) / 100} nombre="m de canto" />
        </dl>

        {grupos.map((g) => (
          <div key={g.orden} className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              {varios ? (
                <div>
                  <h2 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">{g.material}</h2>
                  <p className="tabular mt-1 text-base text-texto-2">{medidaDelGrupo(g)}</p>
                </div>
              ) : (
                <span />
              )}
              {staff &&
                (g.corteId ? (
                  <Link
                    href={`/admin/cortes/${g.corteId}`}
                    className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea bg-card px-4 font-semibold"
                  >
                    Ver el corte
                  </Link>
                ) : (
                  <Link
                    href={`/admin/cortes/nuevo?consulta=${consulta.token}${g.orden ? `&grupo=${g.orden}` : ""}`}
                    className="inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-4 font-semibold text-white hover:bg-accion-hover"
                  >
                    <Scissors className="h-4 w-4" />
                    Pasar a corte
                  </Link>
                ))}
            </div>

            <section className="rounded-xl superficie p-5">
              <table className="w-full text-left text-base">
                <thead className="text-sm text-texto-2">
                  <tr>
                    <th className="pb-2 font-medium">Cant.</th>
                    <th className="pb-2 font-medium">Medida (mm)</th>
                    <th className="pb-2 font-medium">Canto</th>
                    <th className="pb-2 font-medium">Veta</th>
                  </tr>
                </thead>
                <tbody className="tabular divide-y divide-linea-tenue">
                  {g.piezas.map((p, i) => (
                    <tr key={i}>
                      <td className="py-2">{p.cantidad}</td>
                      <td className="py-2">
                        {p.etiqueta ? `${p.etiqueta}: ` : ""}
                        {p.largoMm} × {p.anchoMm}
                      </td>
                      <td className="py-2">{canto(p.cantoLargo ?? 0, p.cantoAncho ?? 0)}</td>
                      <td className="py-2">{p.respetaVeta ? "Sí" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {g.cantoDescripcion && <p className="mt-3 text-base">Tapacanto: {g.cantoDescripcion}</p>}
            </section>

            <section className="rounded-xl superficie p-5">
              <PlanoSimple plano={g.plano} />
            </section>
          </div>
        ))}
      </div>
    </div>
  );
}

function medidaDelGrupo(g: GrupoDeConsulta): string {
  return `${g.placaLargoMm} × ${g.placaAnchoMm} mm${g.mitad ? ` · media, al ${g.mitad}` : ""}`;
}

function canto(largo: number, ancho: number): string {
  const partes = [largo ? `${largo} L` : "", ancho ? `${ancho} A` : ""].filter(Boolean);
  return partes.length ? partes.join(" + ") : "—";
}

function Cifra({ valor, nombre }: { valor: number; nombre: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1 text-sm text-texto-2">{nombre}</dt>
      <dd className="tabular text-[28px] font-bold leading-none">{String(valor).replace(".", ",")}</dd>
    </div>
  );
}
