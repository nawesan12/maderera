import { redirect } from "next/navigation";

/** Compras no tiene pantalla propia: la entrada son las órdenes. */
export default function ComprasPage() {
  redirect("/admin/compras/ordenes");
}
