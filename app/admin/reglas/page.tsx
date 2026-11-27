import { EncabezadoPanel } from "@/components/admin/encabezado";
import { requireStaffRole } from "@/lib/dal/session";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { valorDeRegla, type ReglaPendiente } from "@/lib/reglas";
import { Regla } from "./regla";
import type { ClaveDeRegla } from "./actions";

export const metadata = { title: "Reglas del negocio" };

type Pregunta = {
  clave: ClaveDeRegla;
  pregunta: string;
  opciones: { valor: string; texto: string }[];
};

/**
 * Las reglas que decide el dueño (o el contador) y no el sistema: 00104,
 * 00141 y las que esperan respuesta (00290). Cada una arranca como
 * funcionaba antes de existir, la cambia solo el admin y el cambio queda en
 * la bitácora.
 */
const SECCIONES: { titulo: string; reglas: Pregunta[] }[] = [
  {
    titulo: "Ganancia del mes",
    reglas: [
      {
        clave: "venta_reconocida",
        pregunta: "Una venta cuenta…",
        opciones: [
          { valor: "entregar_o_facturar", texto: "Al entregar o facturar" },
          { valor: "tomar", texto: "Al tomar el pedido" },
          { valor: "entregar", texto: "Al entregar" },
          { valor: "facturar", texto: "Al facturar" },
        ],
      },
      {
        clave: "ganancia_gastos",
        pregunta: "Los gastos, ¿con IVA o sin IVA?",
        opciones: [
          { valor: "con_iva", texto: "Con el IVA que no da crédito" },
          { valor: "sin_iva", texto: "Sin ningún IVA" },
        ],
      },
      {
        clave: "ganancia_descuento",
        pregunta: "¿Se resta de las ventas el descuento que se le hizo al pedido?",
        opciones: [
          { valor: "si", texto: "Sí, se resta" },
          { valor: "no", texto: "No" },
        ],
      },
    ],
  },
  {
    titulo: "Cobros y asientos",
    reglas: [
      {
        clave: "cobro_antes_de_facturar",
        pregunta: "Lo cobrado antes de facturar",
        opciones: [
          { valor: "circuito_b", texto: "Al circuito sin factura" },
          { valor: "anticipos", texto: "A Anticipos, y se imputa al facturar" },
        ],
      },
      {
        clave: "excedente_cuenta_corriente",
        pregunta: "Lo que sobra de un cobro a cuenta",
        opciones: [
          { valor: "circuito_b", texto: "Al circuito sin factura" },
          { valor: "anticipos", texto: "A Anticipos, y se imputa al facturar" },
        ],
      },
      {
        clave: "asiento_sin_cae",
        pregunta: "El cobro de una factura sin CAE, hasta el CAE",
        opciones: [
          { valor: "al_cae", texto: "En Anticipos de clientes" },
          { valor: "transitoria", texto: "En una cuenta transitoria" },
        ],
      },
      {
        clave: "deuda_sin_comprobante",
        pregunta: "La deuda cargada a mano en la cuenta",
        opciones: [
          { valor: "circuito_b", texto: "Al circuito sin factura" },
          { valor: "saldo_inicial", texto: "Al estudio, contra Saldos iniciales" },
        ],
      },
    ],
  },
  {
    titulo: "Facturación",
    reglas: [
      {
        clave: "factura_al_monotributista",
        pregunta: "Al monotributista se le hace",
        opciones: [
          { valor: "a", texto: "Factura A" },
          { valor: "b", texto: "Factura B" },
        ],
      },
      {
        clave: "etiqueta_del_circuito",
        pregunta: "El circuito sin factura se llama",
        opciones: [
          { valor: "b", texto: "B" },
          { valor: "sin_factura", texto: "Sin factura" },
          { valor: "interno", texto: "Interno" },
        ],
      },
    ],
  },
  {
    titulo: "Mostrador",
    reglas: [
      {
        clave: "descuento_sin_autorizacion_pct",
        pregunta: "Descuento sin autorización",
        opciones: [
          { valor: "0", texto: "Ninguno" },
          { valor: "5", texto: "Hasta 5 %" },
          { valor: "10", texto: "Hasta 10 %" },
        ],
      },
      {
        clave: "contado_por_lista",
        pregunta: "La lista que pide contado, ¿cuándo?",
        opciones: [
          { valor: "con_ventaja", texto: "Si da mejor precio" },
          { valor: "siempre", texto: "Siempre" },
        ],
      },
      {
        clave: "descuento_al_flete",
        pregunta: "El descuento por medio de pago, ¿alcanza al flete?",
        opciones: [
          { valor: "no", texto: "No" },
          { valor: "si", texto: "Sí" },
        ],
      },
      {
        clave: "descuento_con_escala",
        pregunta: "Un descuento tipeado y el de la forma de pago",
        opciones: [
          { valor: "reemplaza", texto: "Vale el tipeado" },
          { valor: "suma", texto: "Se suman" },
        ],
      },
      {
        clave: "redondeo_efectivo",
        pregunta: "El total en efectivo, ¿con centavos?",
        opciones: [
          { valor: "no", texto: "Con centavos" },
          { valor: "al_peso", texto: "Al peso, a favor del cliente" },
        ],
      },

      {
        clave: "lote_y_cupon",
        pregunta: "Lote y cupón de la tarjeta",
        opciones: [
          { valor: "obligatorio", texto: "Obligatorios" },
          { valor: "opcional", texto: "Opcionales" },
        ],
      },
      {
        clave: "entregar_sin_cobrar",
        pregunta: "Entregar sin cobrar, ¿quién pide el PIN?",
        opciones: [
          { valor: "deposito", texto: "Solo el depósito" },
          { valor: "fuera_de_la_cuenta", texto: "También quien vende, fuera de la cuenta corriente" },
        ],
      },
      {
        clave: "firma_sin_pin",
        pregunta: "Sin ningún PIN cargado, ¿firma la contraseña de un admin?",
        opciones: [
          { valor: "contrasena", texto: "Sí" },
          { valor: "solo_pin", texto: "No, solo el PIN" },
        ],
      },
    ],
  },
  {
    titulo: "Cortes",
    reglas: [
      {
        clave: "corte_chico_material",
        pregunta: "El material de un corte de menos de media placa",
        opciones: [
          { valor: "sin_cargo", texto: "Sin cargo" },
          { valor: "cobrar", texto: "Se cobra" },
        ],
      },
      {
        clave: "corte_chico_stock",
        pregunta: "La placa de la casa de ese corte, en el stock",
        opciones: [
          { valor: "no_mueve", texto: "Sigue contada" },
          { valor: "descuenta", texto: "Sale al terminar el corte" },
        ],
      },
      {
        clave: "sucursal_del_corte_suelto",
        pregunta: "Dónde se corta un corte suelto",
        opciones: [
          { valor: "primera", texto: "La primera sucursal, ya marcada" },
          { valor: "preguntar", texto: "Se elige siempre" },
        ],
      },
    ],
  },
  {
    titulo: "Mi cuenta",
    reglas: [
      {
        clave: "precios_profesional_sin_tienda",
        pregunta: "Con la tienda apagada, el profesional ve sus precios",
        opciones: [
          { valor: "no", texto: "No" },
          { valor: "si", texto: "Sí" },
        ],
      },
      {
        clave: "aceptar_presupuesto_pendiente",
        pregunta: "El cliente acepta un presupuesto que no se le envió",
        opciones: [
          { valor: "no", texto: "No" },
          { valor: "si", texto: "Sí" },
        ],
      },
      {
        clave: "datos_fiscales_del_cliente",
        pregunta: "CUIT, razón social y condición frente al IVA",
        opciones: [
          { valor: "hasta_facturar", texto: "Los cambia hasta su primera factura" },
          { valor: "ninguno", texto: "Los cambia solo la casa" },
        ],
      },
    ],
  },
  {
    titulo: "Compras",
    reglas: [
      {
        clave: "base_retencion_iva",
        pregunta: "La retención de IVA se calcula sobre…",
        opciones: [
          { valor: "neto", texto: "El neto, como Ganancias" },
          { valor: "total", texto: "El total con IVA" },
        ],
      },
      {
        clave: "exportar_sicore",
        pregunta: "Las retenciones del mes también en TXT para SICORE",
        opciones: [
          { valor: "no", texto: "No, solo el CSV" },
          { valor: "si", texto: "Sí" },
        ],
      },
      {
        clave: "anular_compra_con_pagos",
        pregunta: "Al anular una factura de compra que ya se pagó…",
        opciones: [
          { valor: "a_cuenta", texto: "Los pagos quedan a cuenta del proveedor" },
          { valor: "bloquear", texto: "No se puede: primero se anulan los pagos" },
        ],
      },
      {
        clave: "cae_en_compras",
        pregunta: "La factura A de compra sin CAE",
        opciones: [
          { valor: "opcional", texto: "Entra igual" },
          { valor: "exigido", texto: "No entra sin CAE" },
        ],
      },
    ],
  },
];

/** Lo de arranque de las reglas viejas (00104 y 00141). */
const ARRANQUE: Record<string, string> = {
  ganancia_gastos: "con_iva",
  ganancia_descuento: "no",
  anular_compra_con_pagos: "a_cuenta",
  descuento_sin_autorizacion_pct: "5",
};

export default async function ReglasPage() {
  await requireStaffRole("admin");
  const ajustes = await ajustesDelSitio();
  const valor = (clave: ClaveDeRegla) =>
    clave in ARRANQUE ? ajustes[clave] || ARRANQUE[clave] : valorDeRegla(ajustes, clave as ReglaPendiente);

  return (
    <div className="space-y-6">
      <EncabezadoPanel titulo="Reglas del negocio" />
      {SECCIONES.map((s) => (
        <section key={s.titulo}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">{s.titulo}</h2>
          <div className="tarjeta divide-y">
            {s.reglas.map((r) => (
              <Regla key={r.clave} clave={r.clave} pregunta={r.pregunta} valor={valor(r.clave)} opciones={r.opciones} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
