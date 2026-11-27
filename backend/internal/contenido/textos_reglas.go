package contenido

// textoDeRegla es cómo dice cada regla la pantalla /admin/reglas
// (app/admin/reglas/page.tsx): la bitácora usa las mismas palabras y no las
// claves (mes simulado, M2S4-052: «Regla «anular_compra_con_pagos»:
// a_cuenta → bloquear»). Si una regla nueva no está acá, va con su clave.
var textoDeRegla = map[string]struct {
	pregunta string
	opciones map[string]string
}{
	"venta_reconocida":               {"Una venta cuenta…", map[string]string{"entregar_o_facturar": "Al entregar o facturar", "tomar": "Al tomar el pedido", "entregar": "Al entregar", "facturar": "Al facturar"}},
	"ganancia_gastos":                {"Los gastos, ¿con IVA o sin IVA?", map[string]string{"con_iva": "Con el IVA que no da crédito", "sin_iva": "Sin ningún IVA"}},
	"ganancia_descuento":             {"¿Se resta de las ventas el descuento que se le hizo al pedido?", map[string]string{"si": "Sí, se resta", "no": "No"}},
	"cobro_antes_de_facturar":        {"Lo cobrado antes de facturar", map[string]string{"circuito_b": "Al circuito sin factura", "anticipos": "A Anticipos, y se imputa al facturar"}},
	"excedente_cuenta_corriente":     {"Lo que sobra de un cobro a cuenta", map[string]string{"circuito_b": "Al circuito sin factura", "anticipos": "A Anticipos, y se imputa al facturar"}},
	"asiento_sin_cae":                {"El cobro de una factura sin CAE, hasta el CAE", map[string]string{"al_cae": "En Anticipos de clientes", "transitoria": "En una cuenta transitoria"}},
	"deuda_sin_comprobante":          {"La deuda cargada a mano en la cuenta", map[string]string{"circuito_b": "Al circuito sin factura", "saldo_inicial": "Al estudio, contra Saldos iniciales"}},
	"factura_al_monotributista":      {"Al monotributista se le hace", map[string]string{"a": "Factura A", "b": "Factura B"}},
	"etiqueta_del_circuito":          {"El circuito sin factura se llama", map[string]string{"b": "B", "sin_factura": "Sin factura", "interno": "Interno"}},
	"descuento_sin_autorizacion_pct": {"Descuento sin autorización", map[string]string{"0": "Ninguno", "5": "Hasta 5 %", "10": "Hasta 10 %"}},
	"contado_por_lista":              {"La lista que pide contado, ¿cuándo?", map[string]string{"con_ventaja": "Si da mejor precio", "siempre": "Siempre"}},
	"descuento_al_flete":             {"El descuento por medio de pago, ¿alcanza al flete?", map[string]string{"no": "No", "si": "Sí"}},
	"lote_y_cupon":                   {"Lote y cupón de la tarjeta", map[string]string{"obligatorio": "Obligatorios", "opcional": "Opcionales"}},
	"firma_sin_pin":                  {"Sin ningún PIN cargado, ¿firma la contraseña de un admin?", map[string]string{"contrasena": "Sí", "solo_pin": "No, solo el PIN"}},
	"corte_chico_material":           {"El material de un corte de menos de media placa", map[string]string{"sin_cargo": "Sin cargo", "cobrar": "Se cobra"}},
	"sucursal_del_corte_suelto":      {"Dónde se corta un corte suelto", map[string]string{"primera": "La primera sucursal, ya marcada", "preguntar": "Se elige siempre"}},
	"precios_profesional_sin_tienda": {"Con la tienda apagada, el profesional ve sus precios", map[string]string{"no": "No", "si": "Sí"}},
	"aceptar_presupuesto_pendiente":  {"El cliente acepta un presupuesto que no se le envió", map[string]string{"no": "No", "si": "Sí"}},
	"datos_fiscales_del_cliente":     {"CUIT, razón social y condición frente al IVA", map[string]string{"hasta_facturar": "Los cambia hasta su primera factura", "ninguno": "Los cambia solo la casa"}},
	"anular_compra_con_pagos":        {"Al anular una factura de compra que ya se pagó…", map[string]string{"a_cuenta": "Los pagos quedan a cuenta del proveedor", "bloquear": "No se puede: primero se anulan los pagos"}},
	// Las que faltaban y salían con su clave (mes 23, M2S4-052).
	"descuento_con_escala":  {"Un descuento tipeado y el de la forma de pago", map[string]string{"reemplaza": "Vale el tipeado", "suma": "Se suman"}},
	"redondeo_efectivo":     {"El total en efectivo, ¿con centavos?", map[string]string{"no": "Con centavos", "al_peso": "Al peso, a favor del cliente"}},
	"entregar_sin_cobrar":   {"Entregar sin cobrar, ¿quién pide el PIN?", map[string]string{"deposito": "Solo el depósito", "fuera_de_la_cuenta": "También quien vende, fuera de la cuenta corriente"}},
	"retencion_en_el_cobro": {"La retención que trae el cliente con el pago, ¿quién la carga en el cobro?", map[string]string{"admin": "Solo un admin", "quien_cobra": "Quien cobra"}},
	"escala_con_lista":      {"En la tienda, ¿el descuento por medio de pago se suma al precio de profesional?", map[string]string{"si": "Sí", "no": "No, ese precio ya es de contado"}},
	"corte_chico_stock":     {"La placa de la casa de un corte de menos de media placa, en el stock", map[string]string{"no_mueve": "Sigue contada", "descuenta": "Sale al terminar el corte"}},
	"base_retencion_iva":    {"La retención de IVA se calcula sobre…", map[string]string{"neto": "El neto, como Ganancias", "total": "El total con IVA"}},
	"exportar_sicore":       {"Las retenciones del mes también en TXT para SICORE", map[string]string{"no": "No, solo el CSV", "si": "Sí"}},
	"cae_en_compras":        {"La factura A de compra sin CAE", map[string]string{"opcional": "Entra igual", "exigido": "No entra sin CAE"}},
	"alta_de_producto":      {"Un producto nuevo arranca", map[string]string{"activo": "Activo", "inactivo": "Inactivo, hasta prenderlo"}},
	"listo_con_el_corte":    {"Con el último corte terminado, pasa solo a «Listo»", map[string]string{"mostrador": "La venta del mostrador", "todos": "Cualquier pedido"}},
	"endoso_espera_cae":     {"El cheque de una factura sin CAE se endosa", map[string]string{"si": "Sí, como blanco", "al_cae": "Recién con el CAE"}},
}

// DescripcionDeRegla es el renglón de la bitácora del cambio de una regla.
func DescripcionDeRegla(clave, antes, despues string) string {
	t, ok := textoDeRegla[clave]
	if !ok {
		return "Regla «" + clave + "»: " + antes + " → " + despues
	}
	decir := func(v string) string {
		if x, ok := t.opciones[v]; ok {
			return x
		}
		return v
	}
	return t.pregunta + ": " + decir(antes) + " → " + decir(despues)
}
