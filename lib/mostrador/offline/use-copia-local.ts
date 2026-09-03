"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buscarVariantes, buscarClientesLocal } from "./busqueda-local";
import type { ClienteLocal, VarianteLocal } from "./busqueda-local";
import { precioLocal, type PreciosLocales } from "./precio-local";
import { cargarIndices, sincronizarCatalogo, CADA_CUANTO_MS } from "./sincronizar";
import { hayAlmacenLocal, pedirPersistencia } from "./db";

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
}

export interface ResultadoLocal {
  variantId: string;
  sku: string;
  producto: string;
  medida: string;
  unidad: string;
  precio: number;
  stock: number;
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
    stock: Map<string, number>;
    listaGeneralId: string | null;
  }>({
    variantes: [],
    clientes: [],
    precios: new Map(),
    stock: new Map(),
    listaGeneralId: null,
  });

  const recargar = useCallback(async () => {
    indices.current = await cargarIndices();
    setCuantas(indices.current.variantes.length);
    setListo(true);
  }, []);

  const sincronizar = useCallback(
    async (forzarTodo = false) => {
      try {
        const r = await sincronizarCatalogo({ forzarTodo });
        if (r) {
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

  const buscar = useCallback(
    (texto: string, _customerId: string | null, listaDelCliente: string | null) => {
      const { variantes, precios, stock, listaGeneralId } = indices.current;

      return buscarVariantes(variantes, texto).map((v) => ({
        variantId: v.variantId,
        sku: v.sku,
        producto: v.producto,
        medida: v.medida,
        unidad: v.unidad,
        precio: precioLocal(precios, v.variantId, listaDelCliente, listaGeneralId),
        stock: stock.get(`${branchId}:${v.variantId}`) ?? 0,
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
  };
}
