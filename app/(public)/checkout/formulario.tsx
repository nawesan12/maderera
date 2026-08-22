"use client";

import { useActionState, useState } from "react";
import {
  AlertCircle,
  Banknote,
  CreditCard,
  Loader2,
  MapPin,
  Plus,
  Store,
  Truck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatearPrecio } from "@/lib/formato";
import { confirmarCompra, type EstadoCheckout } from "./actions";
import type { ZonaEnvio } from "@/lib/dal/envios";

interface ItemResumen {
  id: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
  subtotal: number;
}

export interface DireccionElegible {
  id: string;
  etiqueta: string;
  calle: string;
  localidad: string;
  notas: string | null;
  predeterminada: boolean;
}

const MEDIOS = [
  {
    valor: "mercado_pago",
    titulo: "Mercado Pago",
    detalle: "Tarjeta, dinero en cuenta o cuotas",
    icono: CreditCard,
  },
  {
    valor: "transferencia",
    titulo: "Transferencia bancaria",
    detalle: "Te pasamos los datos al confirmar",
    icono: Banknote,
  },
  {
    valor: "efectivo",
    titulo: "Efectivo",
    detalle: "Al retirar o contra entrega",
    icono: Wallet,
  },
] as const;

export function FormularioCheckout({
  items,
  subtotal,
  zonas,
  sucursales,
  datosIniciales,
  cuentaCorriente,
  direcciones,
}: {
  items: ItemResumen[];
  subtotal: number;
  zonas: ZonaEnvio[];
  sucursales: { id: string; nombre: string; direccion: string; horario: string | null }[];
  datosIniciales: { nombre: string; email: string; telefono: string };
  cuentaCorriente: {
    habilitado: boolean;
    disponible: number;
    motivo: string | null;
  };
  direcciones: DireccionElegible[];
}) {
  const [estado, accion, pendiente] = useActionState(
    confirmarCompra,
    {} as EstadoCheckout,
  );

  const [entrega, setEntrega] = useState<"retiro" | "envio">("retiro");
  const [sucursalId, setSucursalId] = useState(sucursales[0]?.id ?? "");
  const [zonaId, setZonaId] = useState(zonas[0]?.id ?? "");
  const [medioPago, setMedioPago] = useState("mercado_pago");

  // Dirección guardada elegida. Arranca en la predeterminada, que es el caso
  // habitual: se compra para el mismo lugar de siempre.
  const [direccionId, setDireccionId] = useState(
    direcciones.find((d) => d.predeterminada)?.id ?? direcciones[0]?.id ?? "",
  );
  const guardada = direcciones.find((d) => d.id === direccionId);

  const zona = zonas.find((z) => z.id === zonaId);
  const envioGratis =
    zona !== undefined &&
    zona.envioGratisDesde > 0 &&
    subtotal >= zona.envioGratisDesde;
  const costoEnvio =
    entrega === "envio" && zona ? (envioGratis ? 0 : zona.costo) : 0;
  const total = subtotal + costoEnvio;

  return (
    <form action={accion} className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <input type="hidden" name="entrega" value={entrega} />
      <input type="hidden" name="sucursalId" value={sucursalId} />
      <input type="hidden" name="zonaId" value={entrega === "envio" ? zonaId : ""} />
      <input type="hidden" name="medioPago" value={medioPago} />

      <div className="space-y-4">
        {estado.error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {estado.error}
          </p>
        )}

        {/* Datos */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <h2 className="mb-4 font-semibold">Tus datos</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="nombre">Nombre y apellido</Label>
                <Input
                  id="nombre"
                  name="nombre"
                  defaultValue={datosIniciales.nombre}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="telefono">Teléfono</Label>
                <Input
                  id="telefono"
                  name="telefono"
                  inputMode="tel"
                  defaultValue={datosIniciales.telefono}
                  placeholder="223 555-1234"
                  required
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="email">Correo</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={datosIniciales.email}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Te mandamos ahí la confirmación del pedido.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Entrega */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <h2 className="mb-4 font-semibold">Cómo lo recibís</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              <OpcionGrande
                activa={entrega === "retiro"}
                onClick={() => setEntrega("retiro")}
                icono={Store}
                titulo="Retiro en sucursal"
                detalle="Sin costo"
              />
              <OpcionGrande
                activa={entrega === "envio"}
                onClick={() => setEntrega("envio")}
                icono={Truck}
                titulo="Envío a domicilio"
                detalle="Según la zona"
              />
            </div>

            {entrega === "retiro" ? (
              <div className="mt-4 space-y-2">
                {sucursales.map((s) => (
                  <OpcionLista
                    key={s.id}
                    activa={sucursalId === s.id}
                    onClick={() => setSucursalId(s.id)}
                    titulo={s.nombre}
                    detalle={s.direccion}
                    extra={s.horario ?? undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="space-y-2">
                  {zonas.map((z) => {
                    const gratis =
                      z.envioGratisDesde > 0 && subtotal >= z.envioGratisDesde;
                    return (
                      <OpcionLista
                        key={z.id}
                        activa={zonaId === z.id}
                        onClick={() => setZonaId(z.id)}
                        titulo={z.nombre}
                        detalle={z.demoraEstimada ?? ""}
                        valor={
                          gratis ? "Sin cargo" : formatearPrecio(String(z.costo))
                        }
                        nota={
                          !gratis && z.envioGratisDesde > 0
                            ? `Gratis desde ${formatearPrecio(String(z.envioGratisDesde))}`
                            : undefined
                        }
                      />
                    );
                  })}
                </div>

                {/* Direcciones guardadas: para quien ya compró, elegir una es
                    un click en vez de volver a escribir la obra entera. */}
                {direcciones.length > 0 && (
                  <div className="space-y-2">
                    <Label>Tus direcciones</Label>
                    <div className="space-y-2">
                      {direcciones.map((d) => (
                        <OpcionLista
                          key={d.id}
                          activa={direccionId === d.id}
                          onClick={() => setDireccionId(d.id)}
                          titulo={d.etiqueta}
                          detalle={`${d.calle}, ${d.localidad}`}
                          icono={MapPin}
                        />
                      ))}
                      <OpcionLista
                        activa={direccionId === ""}
                        onClick={() => setDireccionId("")}
                        titulo="Otra dirección"
                        detalle="La escribo abajo"
                        icono={Plus}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="direccion">Dirección de entrega</Label>
                  <Input
                    id="direccion"
                    name="direccion"
                    // `key` fuerza a React a rehacer el campo cuando cambia la
                    // dirección elegida: sin eso, el `defaultValue` nuevo no se
                    // refleja y el pedido sale con la dirección anterior.
                    key={direccionId}
                    defaultValue={
                      guardada
                        ? `${guardada.calle}, ${guardada.localidad}${
                            guardada.notas ? ` (${guardada.notas})` : ""
                          }`
                        : ""
                    }
                    placeholder="Calle, número, piso y depto"
                    required={entrega === "envio"}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pago */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <h2 className="mb-4 font-semibold">Cómo pagás</h2>
            <div className="space-y-2">
              {MEDIOS.map((m) => (
                <OpcionLista
                  key={m.valor}
                  activa={medioPago === m.valor}
                  onClick={() => setMedioPago(m.valor)}
                  titulo={m.titulo}
                  detalle={m.detalle}
                  icono={m.icono}
                />
              ))}
              {/* La cuenta corriente se ofrece solo a quien la tiene
                  habilitada, y con el margen que le queda a la vista. La
                  acción lo vuelve a verificar al confirmar. */}
              {cuentaCorriente.habilitado && (
                <OpcionLista
                  activa={medioPago === "cuenta_corriente"}
                  onClick={() => setMedioPago("cuenta_corriente")}
                  titulo="Cuenta corriente"
                  detalle={`Tenés ${formatearPrecio(cuentaCorriente.disponible)} disponibles`}
                  icono={Wallet}
                />
              )}
            </div>

            {medioPago === "cuenta_corriente" &&
              cuentaCorriente.habilitado &&
              total > cuentaCorriente.disponible && (
                <p
                  role="alert"
                  className="mt-3 rounded-lg bg-brand-red/10 px-3.5 py-2.5 text-sm text-brand-red"
                >
                  Este pedido supera tu crédito disponible por{" "}
                  {formatearPrecio(total - cuentaCorriente.disponible)}. Elegí
                  otro medio de pago o escribinos para ampliarlo.
                </p>
              )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <div className="space-y-2">
              <Label htmlFor="notas">Algo que tengamos que saber</Label>
              <Textarea
                id="notas"
                name="notas"
                rows={2}
                placeholder="Horarios de entrega, referencias del lugar, medidas especiales…"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resumen */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <h2 className="mb-4 font-semibold">Tu pedido</h2>

            <ul className="space-y-2.5 border-b pb-4">
              {items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="tabular text-muted-foreground">
                      {item.cantidad}×
                    </span>{" "}
                    {item.descripcion}
                  </span>
                  <span className="tabular shrink-0">
                    {formatearPrecio(String(item.subtotal))}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="space-y-2 py-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular">{formatearPrecio(String(subtotal))}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Envío</dt>
                <dd className="tabular">
                  {entrega === "retiro"
                    ? "Retirás vos"
                    : envioGratis
                      ? "Sin cargo"
                      : formatearPrecio(String(costoEnvio))}
                </dd>
              </div>
            </dl>

            <div className="flex items-baseline justify-between border-t pt-4">
              <span className="font-semibold">Total</span>
              <span className="tabular text-2xl font-bold">
                {formatearPrecio(String(total))}
              </span>
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={pendiente}
              className="mt-6 w-full boton-accion"
            >
              {pendiente ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirmando…
                </>
              ) : (
                "Confirmar pedido"
              )}
            </Button>

            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Al confirmar te contactamos para coordinar el pago y la entrega. No
              se cobra nada en este paso.
            </p>
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}

function OpcionGrande({
  activa,
  onClick,
  icono: Icono,
  titulo,
  detalle,
}: {
  activa: boolean;
  onClick: () => void;
  icono: React.ElementType;
  titulo: string;
  detalle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
        activa
          ? "border-brand-orange bg-brand-orange/5"
          : "hover:border-brand-orange/40"
      }`}
    >
      <Icono
        className={`h-6 w-6 shrink-0 ${activa ? "text-brand-orange" : "text-muted-foreground"}`}
      />
      <span>
        <span className="block font-medium">{titulo}</span>
        <span className="block text-sm text-muted-foreground">{detalle}</span>
      </span>
    </button>
  );
}

function OpcionLista({
  activa,
  onClick,
  titulo,
  detalle,
  valor,
  nota,
  extra,
  icono: Icono,
}: {
  activa: boolean;
  onClick: () => void;
  titulo: string;
  detalle: string;
  valor?: string;
  nota?: string;
  extra?: string;
  icono?: React.ElementType;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
        activa
          ? "border-brand-orange bg-brand-orange/5"
          : "hover:border-brand-orange/40"
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          activa ? "border-brand-orange" : "border-muted-foreground/40"
        }`}
        aria-hidden="true"
      >
        {activa && <span className="h-2 w-2 rounded-full bg-brand-orange" />}
      </span>

      {Icono && <Icono className="h-5 w-5 shrink-0 text-muted-foreground" />}

      <span className="min-w-0 flex-1">
        <span className="block font-medium">{titulo}</span>
        {detalle && (
          <span className="block text-sm text-muted-foreground">{detalle}</span>
        )}
        {extra && (
          <span className="block text-sm text-muted-foreground">{extra}</span>
        )}
        {nota && (
          <span className="block text-sm text-brand-orange">{nota}</span>
        )}
      </span>

      {valor && (
        <span className="tabular shrink-0 text-sm font-medium">{valor}</span>
      )}
    </button>
  );
}
