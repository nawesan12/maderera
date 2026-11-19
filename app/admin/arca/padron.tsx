"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { formatearCuit } from "@/lib/formato";
import type { FilaDelPadron } from "@/lib/dal/admin/facturacion";

/** «2026-11-30» → «30/11». */
function dia(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/**
 * El padrón de ARBA: se sube el archivo del mes tal como lo baja ARBA (el
 * .txt o el .zip) y se guarda entero; la lista muestra a los clientes.
 *
 * La subida va directo a Go (/api/v1, mismo origen y misma cookie): el
 * archivo anda por los 200 MB, una server action corta en 1 MB y el proxy de
 * Next guardaba solo los primeros 10 MB y se los pasaba a Go cortados, sin
 * error. Go mira que quien sube sea admin.
 */
export function PadronIibb({ filas }: { filas: FilaDelPadron[] }) {
  const router = useRouter();
  const entrada = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [estado, setEstado] = useState<{ error?: string; ok?: string }>({});
  const [, refrescar] = useTransition();

  async function subir(archivo: File) {
    setSubiendo(true);
    setEstado({});
    try {
      const r = await fetch("/api/v1/admin/facturacion/padron-iibb", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: archivo,
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        const errores = d?.errores as Record<string, string> | undefined;
        setEstado({
          error:
            (errores && Object.values(errores)[0]) ??
            (r.status === 413 ? "El archivo es demasiado grande." : null) ??
            "No se pudo cargar el padrón.",
        });
        return;
      }
      setEstado({ ok: `${d.cargados} de tus clientes · del ${dia(d.desde)} al ${dia(d.hasta)}` });
      refrescar(() => router.refresh());
    } catch {
      setEstado({ error: "Se cortó la subida. Probá de nuevo." });
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <label
        className={`tarjeta inline-flex h-11 cursor-pointer items-center gap-2 px-4 text-base font-medium transition-colors hover:text-acento-texto ${
          subiendo ? "pointer-events-none opacity-60" : ""
        }`}
      >
        {subiendo ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        {subiendo ? "Cargando el padrón…" : "Subir el padrón del mes"}
        <input
          ref={entrada}
          type="file"
          accept=".txt,.zip,text/plain,application/zip"
          className="sr-only"
          disabled={subiendo}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void subir(f);
          }}
        />
      </label>
      {estado.error && (
        <p role="alert" className="text-base text-saldo-debe">
          {estado.error}
        </p>
      )}
      {estado.ok && <p className="text-base text-saldo-favor">{estado.ok}</p>}

      {filas.length > 0 && (
        <ul className="tarjeta divide-y divide-linea-suave">
          {filas.map((f) => (
            <li key={`${f.cuit}-${f.desde}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5">
              <span className="min-w-0 flex-1 basis-40 truncate text-base">{f.cliente ?? formatearCuit(f.cuit)}</span>
              <span className="tabular text-sm text-muted-foreground">{formatearCuit(f.cuit)}</span>
              <span className="tabular w-16 text-right text-base font-semibold">
                {f.alicuota.toLocaleString("es-AR")} %
              </span>
              <span className="tabular text-sm text-muted-foreground">
                {dia(f.desde)}–{dia(f.hasta)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
