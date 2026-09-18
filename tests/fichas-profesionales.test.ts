import { describe, expect, it } from "vitest";
import { decidirFicha } from "@/lib/profesionales/fichas";

/**
 * Se prueba porque el defecto que esto arregla no se veía en el código y sí en
 * la pantalla: la clienta aprobaba una cuenta profesional, la pantalla se caía
 * con el error genérico del panel y el cliente no aparecía en Clientes. La
 * causa era que la aprobación buscaba la ficha **solo por CUIT** y después
 * insertaba una nueva con la misma cuenta web, contra el índice único
 * `customers_user_idx`, lo que abortaba la transacción completa: ni ficha, ni
 * solicitud aprobada, ni aviso.
 */
describe("qué ficha se marca al aprobar un profesional", () => {
  it("usa la ficha de la cuenta web cuando el CUIT no encuentra ninguna", () => {
    // El caso del defecto: se registró en el sitio (ficha con usuario y sin
    // CUIT) y después pidió acceso profesional.
    expect(
      decidirFicha({
        porCuit: null,
        porUsuario: { id: "web", userId: "u1" },
        userId: "u1",
      }),
    ).toEqual({ destino: "web", liberar: null, vincularCuentaWeb: false });
  });

  it("crea ficha nueva cuando no hay ninguna", () => {
    expect(decidirFicha({ userId: "u1" })).toEqual({
      destino: null,
      liberar: null,
      vincularCuentaWeb: false,
    });
  });

  it("le cuelga la cuenta web a la ficha del mostrador", () => {
    expect(
      decidirFicha({ porCuit: { id: "mostrador" }, userId: "u1" }),
    ).toEqual({
      destino: "mostrador",
      liberar: null,
      vincularCuentaWeb: true,
    });
  });

  it("con dos fichas gana la del CUIT y suelta la del sitio", () => {
    // Las dos existen: la del mostrador tiene la historia comercial, así que
    // es la que queda, y la del sitio tiene que soltar el usuario antes de que
    // se lo lleve la otra.
    expect(
      decidirFicha({
        porCuit: { id: "mostrador" },
        porUsuario: { id: "web", userId: "u1" },
        userId: "u1",
      }),
    ).toEqual({
      destino: "mostrador",
      liberar: "web",
      vincularCuentaWeb: true,
    });
  });

  it("no le roba la cuenta web a la ficha del CUIT si ya tiene una", () => {
    // Dos personas de la misma empresa: la ficha con CUIT ya está atada a otra
    // cuenta. Pisarla le daría a esta persona la cuenta corriente de la otra.
    expect(
      decidirFicha({
        porCuit: { id: "empresa", userId: "otro" },
        porUsuario: { id: "web", userId: "u1" },
        userId: "u1",
      }),
    ).toEqual({
      destino: "empresa",
      liberar: "web",
      vincularCuentaWeb: false,
    });
  });

  it("no toca nada cuando la ficha es la misma por los dos caminos", () => {
    expect(
      decidirFicha({
        porCuit: { id: "una", userId: "u1" },
        porUsuario: { id: "una", userId: "u1" },
        userId: "u1",
      }),
    ).toEqual({ destino: "una", liberar: null, vincularCuentaWeb: false });
  });

  it("sin cuenta web no hay nada que vincular", () => {
    // Solicitud cargada por el mostrador, sin que la persona se haya
    // registrado en el sitio.
    expect(decidirFicha({ porCuit: { id: "mostrador" } })).toEqual({
      destino: "mostrador",
      liberar: null,
      vincularCuentaWeb: false,
    });
  });
});
