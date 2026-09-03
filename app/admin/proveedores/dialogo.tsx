"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormularioProveedor } from "./formulario";

/**
 * Alta de proveedor sin salir del listado.
 *
 * Al guardar lleva directo a la ficha: quien acaba de dar de alta a alguien es
 * casi siempre porque tiene una factura suya en la mano, y el paso siguiente es
 * anotarla.
 */
export function DialogoProveedor() {
  const [abierto, setAbierto] = useState(false);
  const router = useRouter();

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg boton-accion px-4 text-base font-medium transition-colors">
        <Plus className="h-4 w-4" />
        Nuevo proveedor
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo proveedor</DialogTitle>
        </DialogHeader>

        <FormularioProveedor
          onListo={(id) => {
            setAbierto(false);
            router.push(`/admin/proveedores/${id}`);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
