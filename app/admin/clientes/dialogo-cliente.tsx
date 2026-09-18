"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccionDeDialogo } from "@/components/admin/usar-accion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { guardarCliente, type EstadoCliente } from "./actions";
import { RUBROS_CLIENTE } from "@/lib/rubros-cliente";

const CONDICIONES = {
  consumidor_final: "Consumidor final",
  responsable_inscripto: "Responsable inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
  no_categorizado: "No categorizado",
};

/**
 * El rubro reemplazó al «tipo de cliente» como campo principal.
 *
 * Lo pidió la clienta, y el argumento era bueno: «consumidor final o particular
 * no tendría rubro». El tipo sigue existiendo —es lo que decide qué lista de
 * precios y qué crédito tiene— pero pasó a ser una casilla explícita en vez del
 * primer desplegable de la ficha, porque es una decisión comercial y no una
 * descripción de a qué se dedica la persona.
 */
const RUBROS = Object.fromEntries(
  RUBROS_CLIENTE.map((r) => [r.valor, r.etiqueta]),
);

export function DialogoCliente({
  listas,
  vendedores = [],
  abrirDeEntrada = false,
}: {
  listas: { id: string; name: string; isDefault: boolean }[];
  vendedores?: { id: string; nombre: string; tipo: "salon" | "calle" }[];
  /**
   * Abrirlo con la pantalla, sin que nadie toque el botón.
   *
   * Lo usa el atajo «Nuevo cliente» del resumen: si llevara nada más a la
   * lista, el botón prometería un alta y entregaría una búsqueda.
   */
  abrirDeEntrada?: boolean;
}) {
  const [abierto, setAbierto] = useState(abrirDeEntrada);
  const [, accion, pendiente] = useAccionDeDialogo(
    guardarCliente,
    {} as EstadoCliente,
    () => setAbierto(false),
  );

  const [tipo, setTipo] = useState("particular");
  const [rubro, setRubro] = useState("particular");
  const [condicion, setCondicion] = useState("consumidor_final");
  const [lista, setLista] = useState("");
  const [vendedor, setVendedor] = useState("");

  // El vendedor asignado dejó de ser texto libre: "Gabriela" y "GABRIELA" eran
  // dos personas para el reporte. La opción vacía es "sin asignar".
  const opcionesDeVendedor: Record<string, string> = {
    "": "Sin asignar",
    ...Object.fromEntries(
      vendedores.map((v) => [
        v.id,
        v.tipo === "calle" ? `${v.nombre} (calle)` : v.nombre,
      ]),
    ),
  };


  // La lista de precios se elegía en ningún lado: el diálogo ya recibía
  // `listas` y nunca las mostraba, así que un cliente con precio especial había
  // que corregirlo por consola. La opción vacía es "la general".
  const opcionesDeLista: Record<string, string> = {
    "": "Lista general",
    ...Object.fromEntries(
      listas.filter((l) => !l.isDefault).map((l) => [l.id, l.name]),
    ),
  };

  /*
   * Elegir un rubro de gremio propone la cuenta profesional, sin imponerla.
   *
   * Un carpintero casi siempre va a tener su lista y su cuenta corriente, y
   * casi siempre factura A. Pero puede no tenerla —el que compra una vez por
   * año— así que las dos cosas quedan marcadas y se pueden desmarcar: es el
   * mismo criterio con el que ya se proponía la condición frente al IVA.
   */
  function cambiarRubro(valor: string) {
    setRubro(valor);

    const delGremio = RUBROS_CLIENTE.find(
      (r) => r.valor === valor,
    )?.esProfesional;

    if (delGremio) {
      setTipo("profesional");
      if (condicion === "consumidor_final") {
        setCondicion("responsable_inscripto");
      }
    } else {
      setTipo("particular");
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium transition-colors">
        <Plus className="h-5 w-5" />
        Nuevo cliente
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
        </DialogHeader>

        <form action={accion} className="space-y-4">
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="condicionIva" value={condicion} />
          <input type="hidden" name="priceListId" value={lista} />
          <input type="hidden" name="sellerId" value={vendedor} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre y apellido</Label>
              <Input id="nombre" name="nombre" required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="razonSocial">Empresa</Label>
              <Input id="razonSocial" name="razonSocial" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliente-rubro">A qué se dedica</Label>
              <input type="hidden" name="rubro" value={rubro} />
              <Select
                value={rubro}
                onValueChange={(v) => v && cambiarRubro(v)}
                items={RUBROS}
              >
                <SelectTrigger id="cliente-rubro" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(RUBROS).map(([valor, texto]) => (
                    <SelectItem key={valor} value={valor}>
                      {texto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Es por donde se corta la lista y los reportes.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliente-profesional">Cuenta profesional</Label>
              <label
                htmlFor="cliente-profesional"
                className="flex h-10 items-center gap-2.5 text-base"
              >
                <input
                  id="cliente-profesional"
                  type="checkbox"
                  checked={tipo === "profesional"}
                  onChange={(e) =>
                    setTipo(e.target.checked ? "profesional" : "particular")
                  }
                  className="h-4 w-4 accent-brand-orange"
                />
                Tiene precio y cuenta corriente propios
              </label>
              <p className="text-sm text-muted-foreground">
                Es lo que decide qué paga. Se propone solo al elegir un rubro
                del gremio.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cuit">CUIT</Label>
              <Input id="cuit" name="cuit" placeholder="20-12345678-9" inputMode="numeric" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliente-condicion">Condición frente al IVA</Label>
              <Select
                value={condicion}
                onValueChange={(v) => v && setCondicion(v)}
                items={CONDICIONES}
              >
                <SelectTrigger id="cliente-condicion" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CONDICIONES).map(([valor, texto]) => (
                    <SelectItem key={valor} value={valor}>
                      {texto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                ARCA la exige en cada factura, así que conviene cargarla ahora.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Correo</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input id="telefono" name="telefono" inputMode="tel" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="direccion">Domicilio</Label>
              <Input id="direccion" name="direccion" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliente-vendedor">Vendedor asignado</Label>
              <Select
                value={vendedor}
                onValueChange={(v) => setVendedor(v ?? "")}
                items={opcionesDeVendedor}
              >
                <SelectTrigger id="cliente-vendedor" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(opcionesDeVendedor).map(([valor, texto]) => (
                    <SelectItem key={valor} value={valor}>
                      {texto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Quién lo atiende. Se administran en Clientes → Vendedores.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cliente-lista">Lista de precios</Label>
              <Select
                value={lista}
                onValueChange={(v) => setLista(v ?? "")}
                items={opcionesDeLista}
              >
                <SelectTrigger id="cliente-lista" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(opcionesDeLista).map(([valor, texto]) => (
                    <SelectItem key={valor} value={valor}>
                      {texto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Sin elegir, paga la lista general.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="limiteCredito">Límite de cuenta corriente</Label>
              <Input
                id="limiteCredito"
                name="limiteCredito"
                defaultValue="0"
                inputMode="decimal"
              />
              <p className="text-sm text-muted-foreground">
                Cero significa que no opera a cuenta.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notas">Notas</Label>
            <Textarea id="notas" name="notas" rows={2} />
          </div>

          <Button
            type="submit"
            disabled={pendiente}
            className="w-full boton-accion"
          >
            {pendiente ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Guardando…
              </>
            ) : (
              "Guardar cliente"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
