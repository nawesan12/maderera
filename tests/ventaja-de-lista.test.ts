import { describe, expect, it } from "vitest";
import { hayVentaja } from "@/lib/mostrador/ventaja";

describe("hayVentaja", () => {
  it("con un renglón más barato en su lista, hay ventaja", () => {
    expect(hayVentaja(["a", "b"], { a: 100, b: 90 }, { a: 100, b: 100 })).toBe(true);
  });
  it("con su lista igual o más cara, no hay ventaja", () => {
    expect(hayVentaja(["a"], { a: 100 }, { a: 100 })).toBe(false);
    expect(hayVentaja(["a"], { a: 13000 }, { a: 12345 })).toBe(false);
  });
  it("lo que solo está en su lista cuenta como ventaja", () => {
    expect(hayVentaja(["a"], { a: 50 }, {})).toBe(true);
  });
  it("sin precio en su lista, no", () => {
    expect(hayVentaja(["a"], {}, { a: 50 })).toBe(false);
  });
});
