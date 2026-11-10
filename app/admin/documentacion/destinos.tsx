"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buscarProductosParaDocumento, guardarDestinos } from "./actions";

type Destino = { id: string; nombre: string };

/**
 * En qué fichas aparece el documento: categorías enteras o productos sueltos
 * (migración 00095). Una categoría alcanza a todos sus productos.
 */
export function DestinosDocumento({
  id,
  titulo,
  productos: iniciales,
  categorias: elegidasIniciales,
  todasLasCategorias,
}: {
  id: string;
  titulo: string;
  productos: Destino[];
  categorias: Destino[];
  todasLasCategorias: Destino[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [productos, setProductos] = useState(iniciales);
  const [categorias, setCategorias] = useState(new Set(elegidasIniciales.map((c) => c.id)));
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<Destino[]>([]);
  const [buscando, empezarBusqueda] = useTransition();
  const [guardando, empezar] = useTransition();

  const total = iniciales.length + elegidasIniciales.length;

  function buscar(texto: string) {
    setConsulta(texto);
    empezarBusqueda(async () => setResultados(await buscarProductosParaDocumento(texto)));
  }

  function guardar() {
    empezar(async () => {
      const r = await guardarDestinos(id, productos.map((p) => p.id), [...categorias]);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.ok ?? "Guardado.");
      setAbierto(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
      >
        <MapPin className="h-4 w-4" />
        {total > 0 ? `En ${total} ${total === 1 ? "ficha" : "fichas"}` : "Mostrar en fichas"}
      </button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
          </DialogHeader>

          <fieldset>
            <legend className="mb-2 text-base font-medium">Categorías</legend>
            <div className="flex flex-wrap gap-2">
              {todasLasCategorias.map((c) => {
                const activa = categorias.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={activa}
                    onClick={() =>
                      setCategorias((previas) => {
                        const nuevas = new Set(previas);
                        if (activa) nuevas.delete(c.id);
                        else nuevas.add(c.id);
                        return nuevas;
                      })
                    }
                    className={`h-10 rounded-lg px-3 text-base transition-colors ${
                      activa ? "bg-accion text-white" : "border hover:bg-muted"
                    }`}
                  >
                    {c.nombre}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <label htmlFor={`buscar-${id}`} className="mb-2 block text-base font-medium">
              Productos
            </label>
            {productos.length > 0 && (
              <ul className="mb-2 flex flex-wrap gap-2">
                {productos.map((p) => (
                  <li key={p.id} className="flex h-9 items-center gap-1 rounded-lg bg-muted pl-3 text-base">
                    {p.nombre}
                    <button
                      type="button"
                      aria-label={`Sacar ${p.nombre}`}
                      onClick={() => setProductos((previos) => previos.filter((x) => x.id !== p.id))}
                      className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-hundida"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              id={`buscar-${id}`}
              value={consulta}
              onChange={(e) => buscar(e.target.value)}
              placeholder="Buscar por nombre"
              className="h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
            {(buscando || resultados.length > 0) && (
              <ul className="mt-1 max-h-56 overflow-y-auto rounded-lg border">
                {buscando && resultados.length === 0 && (
                  <li className="px-3 py-2 text-base text-muted-foreground">Buscando…</li>
                )}
                {resultados
                  .filter((r) => !productos.some((p) => p.id === r.id))
                  .map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setProductos((previos) => [...previos, r]);
                          setConsulta("");
                          setResultados([]);
                        }}
                        className="w-full px-3 py-2 text-left text-base hover:bg-muted"
                      >
                        {r.nombre}
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={guardar}
              disabled={guardando}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-5 text-base font-medium disabled:opacity-50"
            >
              {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
