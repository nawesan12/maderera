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
 * El padrón de ARBA de los clientes: se sube el archivo del mes tal como lo
 * baja ARBA (el .txt o el .zip) y queda la alícuota de cada CUIT que es
 * cliente. La subida va por app/admin/arca/padron (un stream, no una server
 * action: el archivo es grande).
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
      const r = await fetch("/admin/arca/padron", { method: "POST", body: archivo });
      const d = await r.json().catch(() => ({ error: "No se pudo cargar el padrón." }));
      if (!r.ok) {
        setEstado({ error: d.error ?? "No se pudo cargar el padrón." });
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
