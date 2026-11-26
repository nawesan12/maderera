"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Ellipsis, FileCode2, FilePlus2, Loader2, PencilLine, PenLine, Plus, ReceiptText, Tags } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnularConMotivo } from "@/app/admin/compras/anular-con-motivo";
import { Confirmar } from "@/components/admin/confirmar";
import { formatearMonto } from "@/lib/formato";
import { anularCorte, pasarCorteAPedido, remitoDeLaReposicion, sumarCorteAlPedido } from "../actions";

/**
 * Cobrar un corte suelto. Con su placa del catálogo se cobra en el
 * mostrador, como desde la cola del taller: la ficha armaba un pedido y
 * llevaba a Pedidos, la lista llevaba al mostrador (tercera prueba). Sin
 * placa del catálogo el mostrador no lo puede cargar: nace como pedido y se
 * cobra en su ficha (mes simulado, H348).
 */
export function CobrarCorte({ id, conPlaca }: { id: string; conPlaca: boolean }) {
  const router = useRouter();
  const [enCurso, empezar] = useTransition();
  if (conPlaca) {
    return (
      <Link
        href={`/mostrador?corte=${id}`}
        className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-base font-medium sm:w-auto"
      >
        <ReceiptText className="h-5 w-5" aria-hidden="true" />
        Cobrar
      </Link>
    );
  }
  return (
    <button
      type="button"
      disabled={enCurso}
      onClick={() =>
        empezar(async () => {
          const r = await pasarCorteAPedido(id);
          if (r.error || !r.id) {
            toast.error(r.error ?? "No se pudo pasar a pedido.");
            return;
          }
          toast.success(r.ok ?? "Listo.");
          router.push(`/admin/pedidos/${r.id}`);
        })
      }
      className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50 sm:w-auto"
    >
      {enCurso ? <Loader2 className="h-5 w-5 animate-spin" /> : <ReceiptText className="h-5 w-5" />}
      Cobrar
    </button>
  );
}

/** Corregir o anular un corte cargado mal (H185, H228). */
export function CorregirOAnular({ id, numero, cliente }: { id: string; numero: string; cliente: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href={`/admin/cortes/nuevo?corregir=${id}`}
        className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
      >
        <PencilLine className="h-4 w-4" aria-hidden="true" />
        Corregir
      </Link>
      <AnularConMotivo
        titulo={`Anular ${numero} de ${cliente}`}
        detalle="Sale de la cola del taller y no vuelve."
        confirmar="Anular el corte"
        anular={(motivo) => anularCorte(id, motivo)}
        // Sin aviso, anular parecía no haber hecho nada (mes simulado).
        alTerminar={(ok) => toast.success(ok || `${numero} quedó anulado.`)}
      />
    </div>
  );
}

/**
 * Los otros archivos del trabajo, en un menú: el de la máquina, el programa
 * en prueba, las etiquetas y el reporte. En la ficha había tres botones con
 * casi el mismo nombre («Programa para la máquina», «Para la máquina»,
 * «Formato del archivo…») y cada uno ocupaba un renglón en el teléfono
 * (H327, H330).
 */
export function MasArchivos({ id }: { id: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Más archivos"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-muted"
      >
        <Ellipsis className="h-5 w-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem className="min-h-11 text-base" render={<a href={`/api/cortes/${id}/lista`} />}>
          <Download className="h-5 w-5" />
          Archivo para la máquina
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 text-base" render={<a href={`/api/cortes/${id}/ptx`} />}>
          <FileCode2 className="h-5 w-5" />
          Programa .PTX (en prueba)
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 text-base" render={<Link href={`/etiquetas/${id}`} target="_blank" />}>
          <Tags className="h-5 w-5" />
          Etiquetas de las piezas
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11 text-base" render={<a href={`/api/cortes/${id}/pdf`} />}>
          <Download className="h-5 w-5" />
          Reporte en PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * «Sumar al pedido» lo que el corte cobra fuera de él (H184). La
 * confirmación dice cuánto y dónde: si el pedido ya está facturado, cobrado
 * o a cuenta, va a un pedido aparte, y el título lo nombra.
 */
export function SumarAlPedido({
  id,
  numero,
  total,
  aparte,
  motivo,
}: {
  id: string;
  numero: string;
  total: number;
  aparte: boolean;
  motivo: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [enCurso, empezar] = useTransition();
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="boton-accion inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-base font-medium sm:w-auto"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
        {aparte ? "Cobrar aparte" : "Sumar al pedido"}
      </button>
      <Confirmar
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={aparte ? `${formatearMonto(total)} en un pedido aparte` : `Sumar ${formatearMonto(total)} a ${numero}`}
        detalle={aparte ? motivo : `${numero} queda con eso por cobrar.`}
        confirmar={aparte ? "Hacer el pedido" : "Sumar"}
        pendiente={enCurso}
        alConfirmar={() =>
          empezar(async () => {
            const r = await sumarCorteAlPedido(id);
            setAbierto(false);
            if (r.error) {
              toast.error(r.error);
              return;
            }
            toast.success(r.ok ?? "Listo.");
            router.refresh();
          })
        }
      />
    </>
  );
}

/**
 * El remito de una reposición sin cargo (H321): «Firmar» si está por
 * firmar, el papel si ya se firmó, y «Hacer el remito» si se anuló.
 */
export function RemitoDeLaReposicion({
  id,
  remito,
}: {
  id: string;
  remito: { id: string; numero: string; firmaToken: string | null; firmado: boolean } | null;
}) {
  const router = useRouter();
  const [enCurso, empezar] = useTransition();
  if (!remito) {
    return (
      <button
        type="button"
        disabled={enCurso}
        onClick={() =>
          empezar(async () => {
            const r = await remitoDeLaReposicion(id);
            if (r.error) {
              toast.error(r.error);
              return;
            }
            router.refresh();
          })
        }
        className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium disabled:opacity-50"
      >
        {enCurso ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" aria-hidden="true" />}
        Hacer el remito
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!remito.firmado && remito.firmaToken && (
        <Link
          href={`/firmar/${remito.firmaToken}?volver=${encodeURIComponent(`/admin/cortes/${id}`)}`}
          className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium"
        >
          <PenLine className="h-4 w-4" aria-hidden="true" />
          Firmar <span className="codigo">{remito.numero}</span>
        </Link>
      )}
      <Link
        href={`/remito/${remito.id}`}
        target="_blank"
        className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
      >
        <ReceiptText className="h-4 w-4" aria-hidden="true" />
        {remito.firmado ? (
          <>
            <span className="codigo">{remito.numero}</span> firmado
          </>
        ) : (
          "Ver el remito"
        )}
      </Link>
    </div>
  );
}
