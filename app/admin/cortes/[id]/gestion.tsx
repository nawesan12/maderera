"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Ellipsis, FileCode2, Loader2, PencilLine, ReceiptText, Tags } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnularConMotivo } from "@/app/admin/compras/anular-con-motivo";
import { anularCorte, pasarCorteAPedido } from "../actions";

/**
 * Cobrar un corte suelto: nace como pedido, con la mercadería reservada, y
 * se cobra y se entrega por ahí (mes simulado, H348). Lleva a la ficha del
 * pedido, que es donde se cobra.
 */
export function CobrarCorte({ id }: { id: string }) {
  const router = useRouter();
  const [enCurso, empezar] = useTransition();
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
