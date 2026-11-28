"use client";

import { Suspense, use } from "react";
import Link from "next/link";
import { FileText, Lock } from "lucide-react";
import type { DocumentoTecnico } from "@/lib/dal/profesionales";

/**
 * Los documentos reservados de una ficha.
 *
 * Al visitante, el candado que lleva a pedir la cuenta. Al profesional
 * aprobado, cada documento con su enlace, como en /documentacion: antes el
 * candado lo mandaba a la página de alta (mes simulado, M3S1-022). La ficha
 * sale armada con el candado y, para quien puede bajarlos, el servidor lo
 * reemplaza en la misma respuesta.
 */
export function DocumentosReservados({
  cantidad,
  paraQuienMira,
}: {
  cantidad: number;
  paraQuienMira: Promise<DocumentoTecnico[]>;
}) {
  return (
    <Suspense fallback={<Candado cantidad={cantidad} />}>
      <Vigentes cantidad={cantidad} paraQuienMira={paraQuienMira} />
    </Suspense>
  );
}

function Vigentes({ cantidad, paraQuienMira }: { cantidad: number; paraQuienMira: Promise<DocumentoTecnico[]> }) {
  const docs = use(paraQuienMira);
  if (docs.length === 0) return <Candado cantidad={cantidad} />;
  return (
    <>
      {docs.map((d) => (
        <li key={d.id}>
          <a
            href={d.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-sitio-alt"
          >
            <FileText className="h-5 w-5 shrink-0 text-acento-texto" />
            <span className="min-w-0 flex-1 font-medium">{d.titulo}</span>
            <span className="text-sm uppercase text-texto-3">{d.formato}</span>
          </a>
        </li>
      ))}
    </>
  );
}

function Candado({ cantidad }: { cantidad: number }) {
  return (
    <li>
      <Link
        href="/profesionales"
        className="flex items-center gap-3 px-4 py-3 text-texto-2 transition-colors hover:bg-sitio-alt"
      >
        <Lock className="h-5 w-5 shrink-0" />
        <span className="flex-1">
          {cantidad === 1 ? "1 documento para profesionales" : `${cantidad} documentos para profesionales`}
        </span>
      </Link>
    </li>
  );
}
