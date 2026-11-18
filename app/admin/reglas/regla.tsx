"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Opciones } from "@/components/admin/opciones";
import { guardarRegla, type ClaveDeRegla } from "./actions";

/** Una regla: su pregunta y sus opciones, que se guardan al tocarlas. */
export function Regla({
  clave,
  pregunta,
  valor,
  opciones,
}: {
  clave: ClaveDeRegla;
  pregunta: string;
  valor: string;
  opciones: { valor: string; texto: string }[];
}) {
  const [actual, setActual] = useState(valor);
  const [, empezar] = useTransition();

  return (
    <div className="space-y-3 px-5 py-5">
      <p className="text-base font-medium">{pregunta}</p>
      <Opciones
        etiqueta={pregunta}
        valor={actual}
        opciones={opciones}
        alCambiar={(v) => {
          const antes = actual;
          setActual(v);
          empezar(async () => {
            const r = await guardarRegla(clave, v);
            if (r.error) {
              setActual(antes);
              toast.error(r.error);
            } else toast.success(r.ok ?? "Guardado.");
          });
        }}
      />
    </div>
  );
}
