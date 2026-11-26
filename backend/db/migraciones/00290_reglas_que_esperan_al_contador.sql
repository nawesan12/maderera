-- +goose Up
-- Las políticas contables y de negocio que esperan la respuesta del contador
-- o de la clienta (mes simulado, «hacé todo y construí todo»). Cada una se
-- cambia desde /admin/reglas, solo el admin, y el cambio queda en la
-- bitácora. El valor de arranque es el comportamiento que el sistema tenía
-- hasta hoy: desplegar esto no cambia nada.
INSERT INTO site_settings (clave, valor, descripcion) VALUES
  ('venta_reconocida', 'entregar_o_facturar', 'Cuándo cuenta una venta: entregar_o_facturar, tomar, entregar o facturar (H162)'),
  ('cobro_antes_de_facturar', 'circuito_b', 'Lo cobrado de un pedido antes de facturarlo: circuito_b o anticipos (H374)'),
  ('excedente_cuenta_corriente', 'circuito_b', 'Lo que sobra de un cobro a cuenta sin nada pendiente: circuito_b o anticipos (H407)'),
  ('asiento_sin_cae', 'al_cae', 'El cobro de una factura sin CAE en los asientos: al_cae o transitoria (H160)'),
  ('corte_chico_material', 'sin_cargo', 'El material de un corte por debajo de la media placa: sin_cargo o cobrar (H019)'),
  ('contado_por_lista', 'con_ventaja', 'La lista que exige contado: con_ventaja (solo si da mejor precio) o siempre (H037)'),
  ('descuento_al_flete', 'no', 'El descuento por medio de pago alcanza al flete: no o si (H168)'),
  ('factura_al_monotributista', 'a', 'Comprobante del responsable inscripto al monotributista: a o b (H207)'),
  ('precios_profesional_sin_tienda', 'no', 'El profesional ve sus precios con la tienda apagada: no o si (H086)'),
  ('sucursal_del_corte_suelto', 'primera', 'El corte suelto: primera (la primera sucursal marcada) o preguntar (H045)'),
  ('firma_sin_pin', 'contrasena', 'Sin ningún PIN cargado firma la contraseña de un admin: contrasena o solo_pin (H016)'),
  ('aceptar_presupuesto_pendiente', 'no', 'El cliente acepta desde el portal un presupuesto pendiente: no o si (H085)'),
  ('etiqueta_del_circuito', 'b', 'Cómo se nombra el circuito sin factura: b, sin_factura o interno (H167)'),
  ('datos_fiscales_del_cliente', 'hasta_facturar', 'Datos fiscales que cambia el cliente: hasta_facturar o ninguno (H079)'),
  ('lote_y_cupon', 'obligatorio', 'La tarjeta en línea pide lote y cupón: obligatorio u opcional (H032)')
ON CONFLICT (clave) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE clave IN ('venta_reconocida', 'cobro_antes_de_facturar',
  'excedente_cuenta_corriente', 'asiento_sin_cae', 'corte_chico_material', 'contado_por_lista',
  'descuento_al_flete', 'factura_al_monotributista', 'precios_profesional_sin_tienda',
  'sucursal_del_corte_suelto', 'firma_sin_pin', 'aceptar_presupuesto_pendiente',
  'etiqueta_del_circuito', 'datos_fiscales_del_cliente', 'lote_y_cupon');
