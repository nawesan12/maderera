// Package api tiene los contratos OpenAPI de la API, uno por dominio. Cada
// uno genera su paquete en internal/api/<dominio>api.
//
//	go generate ./api
package api

//go:generate go tool oapi-codegen -config sesion.gen.yaml sesion.yaml
//go:generate go tool oapi-codegen -config catalogo.gen.yaml catalogo.yaml
//go:generate go tool oapi-codegen -config contenido.gen.yaml contenido.yaml
//go:generate go tool oapi-codegen -config productos.gen.yaml productos.yaml
//go:generate go tool oapi-codegen -config precios.gen.yaml precios.yaml
//go:generate go tool oapi-codegen -config stock.gen.yaml stock.yaml
//go:generate go tool oapi-codegen -config cuentas.gen.yaml cuentas.yaml
//go:generate go tool oapi-codegen -config documentos.gen.yaml documentos.yaml
//go:generate go tool oapi-codegen -config cortes.gen.yaml cortes.yaml
//go:generate go tool oapi-codegen -config compras.gen.yaml compras.yaml
//go:generate go tool oapi-codegen -config whatsapp.gen.yaml whatsapp.yaml
//go:generate go tool oapi-codegen -config mostrador.gen.yaml mostrador.yaml
//go:generate go tool oapi-codegen -config ventas.gen.yaml ventas.yaml
