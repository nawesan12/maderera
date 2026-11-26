"use client";

import { useState } from "react";
import {
  BadgeCheck,
  Briefcase,
  Building2,
  CircleSlash,
  Loader2,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  ShoppingBag,
  StickyNote,
  UserRound,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
import { buscarClientes } from "@/app/mostrador/actions";
import Link from "next/link";
import { RUBROS_CLIENTE } from "@/lib/rubros-cliente";
import { cuitValido, soloDigitos } from "@/lib/cuit";
import { Opciones, Seccion, sinReiniciar } from "@/components/admin/formulario";

const CONDICIONES = [
  { valor: "consumidor_final", texto: "Consumidor final", icono: UserRound },
  {
    valor: "responsable_inscripto",
    texto: "Responsable inscripto",
    icono: BadgeCheck,
  },
  { valor: "monotributista", texto: "Monotributista", icono: Briefcase },
  { valor: "exento", texto: "Exento", icono: ShieldCheck },
  { valor: "no_categorizado", texto: "No categorizado", icono: CircleSlash },
];

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

/** Lo que ya tiene cargado el cliente, para editarlo. */
export interface ClienteParaEditar {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: string;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  rubro: string | null;
  tipo: string;
  priceListId: string | null;
  sellerId: string | null;
  limiteCredito: string;
  asesor: string | null;
  notas: string | null;
}

export function DialogoCliente({
  listas,
  vendedores = [],
  abrirDeEntrada = false,
  cliente,
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
  /**
   * Con un cliente, el mismo diálogo corrige sus datos. Antes no había cómo:
   * un CUIT o un teléfono mal cargado quedaba así para siempre.
   */
  cliente?: ClienteParaEditar;
}) {
  const [abierto, setAbierto] = useState(abrirDeEntrada);
  const [, accion, pendiente] = useAccionDeDialogo(
    guardarCliente,
    {} as EstadoCliente,
    () => setAbierto(false),
  );

  /*
   * ¿Ya existe? Al salir del teléfono o del CUIT se busca por los dígitos.
   * Con tres fichas del mismo cliente, la deuda queda repartida y nadie la
   * ve entera.
   */
  const [parecido, setParecido] = useState<{ id: string; nombre: string } | null>(null);
  async function revisarSiExiste(valor: string) {
    if (cliente || valor.replace(/\D/g, "").length < 6) return;
    const encontrados = await buscarClientes(valor);
    const otro = encontrados[0];
    setParecido(otro ? { id: otro.id, nombre: otro.razonSocial ?? otro.nombre } : null);
  }

  // El verificador se revisa al salir del campo: con un CUIT mal tipeado la
  // factura A la rechaza ARCA en el mostrador (Go lo frena igual al guardar).
  const [cuitMal, setCuitMal] = useState(false);

  const [tipo, setTipo] = useState(cliente?.tipo ?? "particular");
  const [rubro, setRubro] = useState(cliente?.rubro ?? "particular");
  const [condicion, setCondicion] = useState(cliente?.condicionIva ?? "consumidor_final");
  const [lista, setLista] = useState(cliente?.priceListId ?? "");
  const [vendedor, setVendedor] = useState(cliente?.sellerId ?? "");

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
      {cliente ? (
        <DialogTrigger className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted">
          <Pencil className="h-5 w-5" />
          Editar datos
        </DialogTrigger>
      ) : (
        <DialogTrigger className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg boton-accion px-3 text-base font-medium transition-colors">
          <Plus className="h-5 w-5" />
          Nuevo cliente
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cliente ? cliente.nombre : "Nuevo cliente"}</DialogTitle>
        </DialogHeader>

        <form {...sinReiniciar(accion)} className="space-y-4">
          {cliente && <input type="hidden" name="id" value={cliente.id} />}
          {/* El asesor del sistema viejo no se edita acá, pero guardar sin él lo borraba. */}
          {cliente?.asesor && <input type="hidden" name="asesor" value={cliente.asesor} />}
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="condicionIva" value={condicion} />
          <input type="hidden" name="priceListId" value={lista} />
          <input type="hidden" name="sellerId" value={vendedor} />

          <div className="divide-y divide-linea-suave">
            <Seccion titulo="Quién es" icono={UserRound}>
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre y apellido</Label>
                <Input id="nombre" name="nombre" required autoFocus defaultValue={cliente?.nombre} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="razonSocial">Empresa</Label>
                <Input id="razonSocial" name="razonSocial" defaultValue={cliente?.razonSocial ?? ""} />
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="cuit">CUIT</Label>
                <Input
                  id="cuit"
                  name="cuit"
                  placeholder="20-12345678-9"
                  inputMode="numeric"
                  defaultValue={cliente?.cuit ?? ""}
                  aria-invalid={cuitMal || undefined}
                  aria-describedby={cuitMal ? "cuit-mal" : undefined}
                  onChange={() => cuitMal && setCuitMal(false)}
                  onBlur={(e) => {
                    const d = soloDigitos(e.target.value);
                    setCuitMal(d.length > 0 && !cuitValido(d));
                    revisarSiExiste(e.target.value);
                  }}
                />
                {cuitMal && (
                  <p id="cuit-mal" role="alert" className="text-sm text-destructive">
                    El CUIT no es válido: revisá los números.
                  </p>
                )}
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Condición frente al IVA</Label>
                <Opciones
                  nombre="condicionIva-opcion"
                  opciones={CONDICIONES}
                  valor={condicion}
                  alCambiar={setCondicion}
                  columnas={3}
                />
              </div>
            </Seccion>

            <Seccion titulo="Contacto" icono={Phone}>
              <div className="space-y-2">
                <Label htmlFor="email">Correo</Label>
                <Input id="email" name="email" type="email" defaultValue={cliente?.email ?? ""} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">Teléfono</Label>
                <Input
                  id="telefono"
                  name="telefono"
                  inputMode="tel"
                  defaultValue={cliente?.telefono ?? ""}
                  onBlur={(e) => revisarSiExiste(e.target.value)}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="direccion">Domicilio</Label>
                <Input id="direccion" name="direccion" defaultValue={cliente?.direccion ?? ""} />
              </div>
            </Seccion>

            <Seccion titulo="Cómo compra" icono={ShoppingBag}>
              {/* Controlado: el rubro la propone y se puede desmarcar, así que
                  no es el `Interruptor` del molde (que va sin estado). El tipo
                  viaja en el campo oculto `tipo`. */}
              <label className="ficha-interruptor flex cursor-pointer items-center gap-3 rounded-xl p-3.5 md:col-span-2">
                <span className="ficha-icono flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                  <Building2 className="h-5 w-5" />
                </span>
                <span className="flex-1 text-[15px] font-semibold leading-tight">
                  Cuenta profesional
                </span>
                <Switch
                  id="cliente-profesional"
                  checked={tipo === "profesional"}
                  onCheckedChange={(marcado) =>
                    setTipo(marcado ? "profesional" : "particular")
                  }
                />
              </label>
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
                    {Object.entries(opcionesDeVendedor).map(
                      ([valor, texto]) => (
                        <SelectItem key={valor} value={valor}>
                          {texto}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="limiteCredito">
                  Límite de cuenta corriente
                </Label>
                <Input
                  id="limiteCredito"
                  name="limiteCredito"
                  defaultValue={cliente ? String(Number(cliente.limiteCredito)) : "0"}
                  inputMode="decimal"
                />
              </div>
            </Seccion>

            <Seccion titulo="Notas" icono={StickyNote} columnas={1}>
              <Textarea id="notas" name="notas" rows={2} aria-label="Notas" defaultValue={cliente?.notas ?? ""} />
            </Seccion>
          </div>

          {parecido && (
            <p role="status" className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base text-[var(--estado-tinta)]">
              Ya hay una ficha con ese dato:{" "}
              <Link href={`/admin/clientes/${parecido.id}`} className="font-semibold underline underline-offset-4">
                {parecido.nombre}
              </Link>
            </p>
          )}

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
              cliente ? "Guardar los cambios" : "Guardar cliente"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
