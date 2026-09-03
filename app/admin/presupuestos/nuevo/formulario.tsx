"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, Plus, Search, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { crearPresupuesto } from "@/app/admin/ventas-actions";
import { buscarClientes, buscarEnMostrador } from "@/app/mostrador/actions";
import { formatearMonto } from "@/components/admin/formato";

interface Linea {
  variantId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
}

interface ClienteElegido {
  id: string;
  nombre: string;
  razonSocial: string | null;
}

const estadoInicial = {} as { error?: string; ok?: string };

/**
 * Alta de presupuesto.
 *
 * La búsqueda de productos y la de clientes son las **mismas** que usa el
 * mostrador: devuelven variantes con el precio de la lista que le toca a ese
 * cliente, que es lo que hay que presupuestar. Duplicarlas acá habría sido
 * inventar una segunda verdad sobre los precios.
 *
 * Las líneas viajan como JSON en campos `linea` repetidos, para que el precio
 * quede exactamente en el que se vio en pantalla: un presupuesto es una oferta
 * con fecha, y recalcularlo del lado del servidor lo cambiaría en silencio si
 * alguien tocó la lista en el medio.
 */
export function FormularioPresupuesto({
  sucursales,
  asesor,
}: {
  sucursales: { id: string; nombre: string }[];
  asesor: string;
}) {
  const [estado, accion, pendiente] = useActionState(
    crearPresupuesto,
    estadoInicial,
  );

  const [sucursal, setSucursal] = useState(sucursales[0]?.id ?? "");
  const [cliente, setCliente] = useState<ClienteElegido | null>(null);
  const [nombre, setNombre] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);

  const total = lineas.reduce(
    (suma, l) => suma + l.cantidad * l.precioUnitario,
    0,
  );

  function agregar(linea: Linea) {
    setLineas((previas) => {
      // Si ya está la misma variante, suma cantidad en vez de repetir renglón.
      const i = previas.findIndex(
        (p) => p.variantId !== null && p.variantId === linea.variantId,
      );
      if (i === -1) return [...previas, linea];
      const copia = [...previas];
      copia[i] = { ...copia[i], cantidad: copia[i].cantidad + linea.cantidad };
      return copia;
    });
  }

  function actualizar(indice: number, campo: keyof Linea, valor: string) {
    setLineas((previas) =>
      previas.map((l, i) =>
        i === indice
          ? {
              ...l,
              [campo]:
                campo === "cantidad" || campo === "precioUnitario"
                  ? Number(valor)
                  : valor,
            }
          : l,
      ),
    );
  }

  return (
    <form action={accion} className="space-y-5">
      <input type="hidden" name="branchId" value={sucursal} />
      {cliente && <input type="hidden" name="customerId" value={cliente.id} />}
      {lineas.map((linea, i) => (
        <input key={i} type="hidden" name="linea" value={JSON.stringify(linea)} />
      ))}

      <Card className="border-border bg-card">
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold">Para quién</h2>

          <BuscadorDeCliente
            elegido={cliente}
            onElegir={(c) => {
              setCliente(c);
              if (c) setNombre(c.razonSocial ?? c.nombre);
            }}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contactoNombre">Nombre</Label>
              <Input
                id="contactoNombre"
                name="contactoNombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="A nombre de quién va"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactoTelefono">Teléfono</Label>
              <Input
                id="contactoTelefono"
                name="contactoTelefono"
                placeholder="223 555-1234"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactoEmail">Correo</Label>
              <Input id="contactoEmail" name="contactoEmail" type="email" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="branch">Sucursal</Label>
              <select
                id="branch"
                value={sucursal}
                onChange={(e) => setSucursal(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-base"
              >
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold">Qué lleva</h2>

          <BuscadorDeProductos
            branchId={sucursal}
            customerId={cliente?.id ?? null}
            onAgregar={agregar}
          />

          {lineas.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
              Buscá un producto arriba para empezar.
            </p>
          ) : (
            <div className="space-y-2">
              {lineas.map((linea, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3"
                >
                  <div className="min-w-48 flex-1">
                    <p className="font-medium">{linea.descripcion}</p>
                    <p className="text-sm text-muted-foreground">
                      {linea.unidad}
                    </p>
                  </div>

                  <div className="w-24 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Cantidad
                    </Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={linea.cantidad}
                      onChange={(e) => actualizar(i, "cantidad", e.target.value)}
                    />
                  </div>

                  <div className="w-32 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Precio
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={linea.precioUnitario}
                      onChange={(e) =>
                        actualizar(i, "precioUnitario", e.target.value)
                      }
                    />
                  </div>

                  <div className="w-28 text-right">
                    <p className="text-xs text-muted-foreground">Subtotal</p>
                    <p className="tabular font-semibold">
                      {formatearMonto(linea.cantidad * linea.precioUnitario)}
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setLineas((p) => p.filter((_, j) => j !== i))
                    }
                    aria-label={`Quitar ${linea.descripcion}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-base font-semibold">Total</span>
                <span className="tabular text-2xl font-bold">
                  {formatearMonto(total)}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="diasValidez">Validez (días)</Label>
              <Input
                id="diasValidez"
                name="diasValidez"
                type="number"
                min="1"
                max="180"
                defaultValue={15}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notas">Notas</Label>
              <Textarea
                id="notas"
                name="notas"
                rows={3}
                placeholder="Lo que haya que aclarar: plazos, medidas especiales, quién retira."
              />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Queda a tu nombre ({asesor}) y con origen &laquo;por teléfono&raquo;.
          </p>
        </CardContent>
      </Card>

      {estado.error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive"
        >
          {estado.error}
        </p>
      )}

      {estado.ok && (
        <p className="rounded-lg border border-brand-green/40 bg-brand-green/10 px-4 py-3 text-brand-green">
          {estado.ok}
        </p>
      )}

      <Button
        type="submit"
        disabled={pendiente || lineas.length === 0}
        className="h-11 px-6"
      >
        {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar presupuesto
      </Button>
    </form>
  );
}

function BuscadorDeCliente({
  elegido,
  onElegir,
}: {
  elegido: ClienteElegido | null;
  onElegir: (cliente: ClienteElegido | null) => void;
}) {
  const [texto, setTexto] = useState("");
  // Se guarda junto con el texto que los produjo, y se muestran solo si siguen
  // correspondiendo a lo que hay tipeado. Así el efecto nunca limpia estado en
  // el render, que es lo que la regla de hooks no quiere.
  const [traidos, setTraidos] = useState<{ texto: string; items: ClienteElegido[] }>(
    { texto: "", items: [] },
  );

  const consulta = texto.trim();
  const resultados =
    consulta.length >= 2 && traidos.texto === consulta ? traidos.items : [];

  useEffect(() => {
    if (consulta.length < 2) return;

    let vigente = true;
    const id = setTimeout(async () => {
      const encontrados = await buscarClientes(consulta);
      if (vigente) setTraidos({ texto: consulta, items: encontrados });
    }, 250);

    return () => {
      vigente = false;
      clearTimeout(id);
    };
  }, [consulta]);

  if (elegido) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
        <UserRound className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 font-medium">
          {elegido.razonSocial ?? elegido.nombre}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onElegir(null);
            setTexto("");
          }}
        >
          <X className="h-4 w-4" />
          Quitar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="buscarCliente">Cliente (opcional)</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="buscarCliente"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nombre, razón social o CUIT"
          className="pl-9"
        />
      </div>

      {resultados.length > 0 && (
        <ul className="rounded-lg border border-border">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onElegir(c);
                  setTexto("");
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted"
              >
                <span className="font-medium">{c.razonSocial ?? c.nombre}</span>
                {c.razonSocial && (
                  <span className="text-sm text-muted-foreground">
                    {c.nombre}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-muted-foreground">
        Si lo elegís, los precios salen de su lista. Sin cliente, la general.
      </p>
    </div>
  );
}

function BuscadorDeProductos({
  branchId,
  customerId,
  onAgregar,
}: {
  branchId: string;
  customerId: string | null;
  onAgregar: (linea: Linea) => void;
}) {
  type Encontrado = {
    variantId: string;
    sku: string;
    producto: string;
    medida: string;
    unidad: string;
    precio: number;
  };

  const [texto, setTexto] = useState("");
  const [traidos, setTraidos] = useState<{ clave: string; items: Encontrado[] }>(
    { clave: "", items: [] },
  );

  const consulta = texto.trim();
  // El cliente entra en la clave: cambiar de cliente cambia los precios, y los
  // resultados de antes ya no valen.
  const clave = `${consulta}|${branchId}|${customerId ?? ""}`;
  const resultados =
    consulta.length >= 2 && traidos.clave === clave ? traidos.items : [];
  const buscando = consulta.length >= 2 && traidos.clave !== clave;

  useEffect(() => {
    if (consulta.length < 2 || !branchId) return;

    let vigente = true;
    const id = setTimeout(async () => {
      const encontrados = await buscarEnMostrador(consulta, branchId, customerId);
      if (vigente) setTraidos({ clave, items: encontrados });
    }, 250);

    return () => {
      vigente = false;
      clearTimeout(id);
    };
  }, [consulta, branchId, customerId, clave]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por nombre, medida o código"
          className="pl-9"
        />
        {buscando && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {resultados.length > 0 && (
        <ul className="rounded-lg border border-border">
          {resultados.map((r) => (
            <li key={r.variantId}>
              <button
                type="button"
                onClick={() => {
                  onAgregar({
                    variantId: r.variantId,
                    descripcion: `${r.producto} — ${r.medida}`,
                    unidad: r.unidad,
                    cantidad: 1,
                    precioUnitario: r.precio,
                  });
                  setTexto("");
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted"
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">
                  <span className="font-medium">{r.producto}</span>{" "}
                  <span className="text-muted-foreground">{r.medida}</span>
                </span>
                <span className="tabular font-semibold">{formatearMonto(r.precio)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
