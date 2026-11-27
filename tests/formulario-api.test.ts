import { describe, expect, it } from "vitest";
import { soloCampos } from "@/lib/api/formulario";

describe("soloCampos", () => {
  it("saca los campos de Next y los que van en la ruta", () => {
    const f = new FormData();
    f.append("$ACTION_REF_1", "");
    f.append("id", "8bdfd275-e181-4d76-9c4b-0b90077ebe9d");
    f.append("titulo", "Sim aviso");
    const limpio = soloCampos(f, "id");
    expect([...limpio.keys()]).toEqual(["titulo"]);
  });

  it("sin exclusiones deja todo menos lo de Next", () => {
    const f = new FormData();
    f.append("$ACTION_1:0", "{}");
    f.append("id", "x");
    expect([...soloCampos(f).keys()]).toEqual(["id"]);
  });
});
