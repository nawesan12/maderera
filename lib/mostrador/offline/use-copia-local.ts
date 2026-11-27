"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buscarVariantes, buscarClientesLocal } from "./busqueda-local";
import type { ClienteLocal, VarianteLocal } from "./busqueda-local";
import { anteriorLocal, precioLocal, type OfertasLocales, type PreciosLocales } from "./precio-local";
import {
  cargarIndices,
  sincronizarCatalogo,
  CADA_CUANTO_MS,
  retardoDeAviso,
} from "./sincronizar";
import { hayAlmacenLocal, pedirPersistencia } from "./db";
import { useEnVivo } from "@/lib/vivo/use-en-vivo";

/**
 * La copia local, lista para usar en la pantalla.
 *
 * Hace tres cosas: carga los índices de IndexedDB apenas monta —para que la
 * pantalla se dibuje sin esperar a nadie—, sincroniza por detrás, y expone una
 * búsqueda que **no necesita servidor**.
 *
 * El estado `listo` distingue "todavía no cargué" de "cargué y no hay nada".
 * La diferencia importa: con la copia vacía hay que buscar contra el servidor,
 * con la copia cargada no.
 */

export interface CopiaLista {
  listo: boolean;
  /** Cuántas variantes hay en la copia. Cero significa que no se puede buscar offline. */
  variantes: number;
  ultimaSincronizacion: Date | null;
  /** El navegador negó la persistencia: la cola podría desalojarse. */
  fragil: boolean;
  buscar: (texto: string, customerId: string | null, listaDelCliente: string | null) => ResultadoLocal[];
  buscarCliente: (texto: string) => ClienteLocal[];
  sincronizar: (forzarTodo?: boolean) => Promise<void>;
  /**
   * Lo que se acaba de vender o acopiar en esta caja, para que el buscador lo
   * dé por apartado ya. `enLaCola` es la venta cobrada sin conexión.
   */
  apartar: (lineas: LineaApartada[], enLaCola: boolean) => void;
  /** La cola terminó de subir: sus apartados pasan a esperar al servidor. */
  subioLaCola: () => void;
}

export interface LineaApartada {
  variantId: string | null;
  cantidad: number;
  presentacion?: "media_largo" | "media_ancho" | null;
}

/*
 * Un apartado vive hasta que una sincronización que **empezó después** de que
 * el servidor lo tuvo trae el stock nuevo (H023). Los de la cola no tienen
 * fecha hasta que suben: una sincronización en el medio trae el stock sin
 * ellos, y descontarlos sigue siendo lo correcto.
 */
interface Apartado {
  variantId: string;
  cantidad: number;
  enElServidorDesde: number | null;
}

export interface ResultadoLocal {
  variantId: string;
  sku: string;
  producto: string;
  medida: string;
  unidad: string;
  precio: number;
  stock: number;
  /** La medida de la placa, para poder ofrecer cortarla. */
  largoMm?: number | null;
  anchoMm?: number | null;
  /** La familia del producto. Por acá se busca la tarifa de corte. */
  categoria?: string | null;
  /**
   * Cómo se vende la placa y cuánto vale la media. Opcionales porque una
   * copia local bajada antes del 1/10/2026 no los trae: sin ellos la placa se
   * vende entera, que es lo que pasaba hasta entonces.
   */
  formaDeVenta?: "entera" | "entera_o_media" | "metro_cuadrado";
  precioMediaPct?: number;
  /** El de antes de una oferta vigente, para tacharlo. */
  precioAnterior?: number | null;
}

/*
 * El nombre arranca con `use` y no con `usar` porque React lo exige: la regla
 * `rules-of-hooks` identifica los hooks por el prefijo, y con un nombre en
 * castellano deja de verificar que no se llamen dentro de un `if`. Es de las
 * pocas veces que conviene el inglés.
 */
export function useCopiaLocal(branchId: string): CopiaLista {
  const [listo, setListo] = useState(false);
  /*
   * Cuántas variantes hay, en estado y no derivado del ref.
   *
   * Los índices viven en un `useRef` porque son grandes y no queremos que cada
   * sincronización redibuje la pantalla entera. Pero un ref **no se puede leer
   * durante el render**, así que el único dato que la pantalla necesita mirar
   * —si hay copia o no— va aparte.
   */
  const [cuantas, setCuantas] = useState(0);
  const [fragil, setFragil] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);

  const indices = useRef<{
    variantes: VarianteLocal[];
    clientes: ClienteLocal[];
    precios: PreciosLocales;
    ofertas: OfertasLocales;
    stock: Map<string, number>;
    listaGeneralId: string | null;
  }>({
    variantes: [],
    clientes: [],
    precios: new Map(),
    ofertas: new Map(),
    stock: new Map(),
    listaGeneralId: null,
  });

  const apartados = useRef<Apartado[]>([]);
  const [, setApartadosVersion] = useState(0);

  const recargar = useCallback(async () => {
    indices.current = await cargarIndices();
    setCuantas(indices.current.variantes.length);
    setListo(true);
  }, []);

  const sincronizar = useCallback(
    async (forzarTodo = false) => {
      const inicio = Date.now();
      try {
        const r = await sincronizarCatalogo({ forzarTodo });
        if (r) {
          apartados.current = apartados.current.filter(
            (a) => a.enElServidorDesde === null || a.enElServidorDesde >= inicio,
          );
          await recargar();
          setUltima(new Date());
        }
      } catch {
        // Sin conexión no es un error: se sigue con lo que hay guardado, que es
        // exactamente para lo que está.
      }
    },
    [recargar],
  );

  useEffect(() => {
    let vivo = true;

    // Sin IndexedDB —modo privado viejo, alguna WebView— no hay copia posible:
    // se marca listo igual, con cero variantes, y la pantalla busca contra el
    // servidor como siempre. El `setListo` va adentro del asíncrono para no
    // disparar un render en cascada desde el efecto.
    if (!hayAlmacenLocal()) {
      void Promise.resolve().then(() => {
        if (vivo) setListo(true);
      });
      return () => {
        vivo = false;
      };
    }

    void (async () => {
      // Primero lo local: la pantalla tiene que dibujarse ya.
      await recargar();
      if (!vivo) return;

      const persistente = await pedirPersistencia();
      if (vivo) setFragil(!persistente);

      void sincronizar();
    })();

    const cada = setInterval(() => void sincronizar(), CADA_CUANTO_MS);

    return () => {
      vivo = false;
      clearInterval(cada);
    };
  }, [recargar, sincronizar]);

  /*
   * Un precio que cambia en el panel llega acá enseguida (ver `lib/vivo`):
   * antes el mostrador podía cobrar hasta diez minutos con el precio viejo.
   * La espera es de menos de un segundo y medio (`retardoDeAviso`): junta la
   * ráfaga de un cambio masivo sin dejar a la caja cobrando con el precio
   * viejo. La sincronización periódica sigue: es la red cuando no hay tiempo
   * real.
   */
  const pendiente = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEnVivo(["precios"], () => {
    // Una sola espera a la vez: dos avisos seguidos no son dos pedidos.
    if (pendiente.current) return;
    pendiente.current = setTimeout(() => {
      pendiente.current = null;
      void sincronizar();
    }, retardoDeAviso());
  });
  useEffect(
    () => () => {
      if (pendiente.current) clearTimeout(pendiente.current);
    },
    [],
  );

  /*
   * Después de una venta se sincroniza enseguida: el delta trae lo físico y
   * las reservas que cambiaron (`copia.go`). Antes la copia esperaba los diez
   * minutos del ciclo, o un cambio de precio, y el buscador seguía ofreciendo
   * como libres las placas recién vendidas o acopiadas en esta misma caja.
   */
  const despues = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sincronizarPronto = useCallback(() => {
    if (despues.current) clearTimeout(despues.current);
    despues.current = setTimeout(() => {
      despues.current = null;
      void sincronizar();
    }, 300);
  }, [sincronizar]);
  useEffect(
    () => () => {
      if (despues.current) clearTimeout(despues.current);
    },
    [],
  );

  const apartar = useCallback(
    (lineas: LineaApartada[], enLaCola: boolean) => {
      const ahora = Date.now();
      const nuevos: Apartado[] = [];
      for (const l of lineas) {
        if (!l.variantId || !(l.cantidad > 0)) continue;
        nuevos.push({
          variantId: l.variantId,
          // La media placa descuenta media: es una aproximación hasta que el
          // servidor, que lee el producto (`factoresDeStock`), diga lo exacto.
          cantidad: l.presentacion ? l.cantidad / 2 : l.cantidad,
          enElServidorDesde: enLaCola ? null : ahora,
        });
      }
      apartados.current = [...apartados.current, ...nuevos];
      setApartadosVersion((v) => v + 1);
      if (!enLaCola) sincronizarPronto();
    },
    [sincronizarPronto],
  );

  const subioLaCola = useCallback(() => {
    const ahora = Date.now();
    if (!apartados.current.some((a) => a.enElServidorDesde === null)) return;
    apartados.current = apartados.current.map((a) =>
      a.enElServidorDesde === null ? { ...a, enElServidorDesde: ahora } : a,
    );
    sincronizarPronto();
  }, [sincronizarPronto]);

  const buscar = useCallback(
    (texto: string, _customerId: string | null, listaDelCliente: string | null) => {
      const { variantes, precios, ofertas, stock, listaGeneralId } = indices.current;
      const ahora = Date.now();
      const apartado = new Map<string, number>();
      for (const a of apartados.current) {
        apartado.set(a.variantId, (apartado.get(a.variantId) ?? 0) + a.cantidad);
      }

      return buscarVariantes(variantes, texto).map((v) => ({
        variantId: v.variantId,
        sku: v.sku,
        producto: v.producto,
        medida: v.medida,
        unidad: v.unidad,
        precio: precioLocal(precios, v.variantId, listaDelCliente, listaGeneralId),
        precioAnterior: anteriorLocal(precios, ofertas, v.variantId, listaDelCliente, listaGeneralId, ahora),
        stock: Math.max(
          (stock.get(`${branchId}:${v.variantId}`) ?? 0) - (apartado.get(v.variantId) ?? 0),
          0,
        ),
        largoMm: v.largoMm ?? null,
        anchoMm: v.anchoMm ?? null,
        categoria: v.categoria ?? null,
        formaDeVenta: v.formaDeVenta ?? "entera",
        precioMediaPct: v.precioMediaPct ?? 50,
      }));
    },
    [branchId],
  );

  const buscarCliente = useCallback(
    (texto: string) => buscarClientesLocal(indices.current.clientes, texto),
    [],
  );

  return {
    listo,
    variantes: cuantas,
    ultimaSincronizacion: ultima,
    fragil,
    buscar,
    buscarCliente,
    sincronizar,
    apartar,
    subioLaCola,
  };
}
