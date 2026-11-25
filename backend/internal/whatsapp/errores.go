package whatsapp

// Los errores de Meta, dichos para quien está atendiendo
// (lib/whatsapp/errores.ts): qué le pasó al mensaje y qué hacer.

// Las acciones que propone la bandeja ante un error.
const (
	AccionPlantilla  = "plantilla"
	AccionReintentar = "reintentar"
	AccionSistema    = "sistema"
	AccionOtroMedio  = "otro-medio"
	AccionRevisar    = "revisar"
	AccionTope       = "tope"
)

// ErrorExplicado es un error de Meta para mostrar.
type ErrorExplicado struct {
	Codigo *float64 `json:"codigo"`
	Texto  string   `json:"texto"`
	Accion string   `json:"accion"`
}

type explicacion struct{ texto, accion string }

const textoFueraDeVentana = "Pasaron más de 24 horas desde su último mensaje. Para retomar la conversación hay que mandar un mensaje preparado."

var explicaciones = map[float64]explicacion{
	131047: {textoFueraDeVentana, AccionPlantilla},
	470:    {textoFueraDeVentana, AccionPlantilla},
	131026: {"WhatsApp no lo pudo entregar: el número puede no tener WhatsApp, tener la aplicación desactualizada o habernos bloqueado. Conviene llamarlo.", AccionOtroMedio},
	131049: {"WhatsApp frenó este mensaje porque esa persona ya recibió muchos mensajes de empresas. Probá en unos días o avisale por otro medio.", AccionOtroMedio},
	131050: {"Esa persona pidió no recibir mensajes de promoción de la maderera.", AccionOtroMedio},
	131056: {"Se le mandaron demasiados mensajes seguidos a este número. Esperá un minuto y volvé a probar.", AccionReintentar},
	130429: {"WhatsApp está limitando la cantidad de mensajes por segundo. Volvé a probar en un momento.", AccionReintentar},
	131048: {"WhatsApp limitó los envíos porque muchos mensajes del número fueron marcados como no deseados. Hay que revisar la calidad del número en la configuración.", AccionSistema},
	131000: {"WhatsApp tuvo un problema y no envió el mensaje. Volvé a probar en un momento.", AccionReintentar},
	131016: {"WhatsApp está con problemas en este momento. Volvé a probar en unos minutos.", AccionReintentar},
	2:      {"WhatsApp no está disponible en este momento. Volvé a probar en unos minutos.", AccionReintentar},
	190:    {"El permiso de la plataforma para usar WhatsApp venció o se revocó. Hay que generar uno nuevo en Meta (lo hace quien mantiene el sistema).", AccionSistema},
	10:     {"La plataforma no tiene permiso para mandar mensajes con este número. Avisale a quien mantiene el sistema.", AccionSistema},
	200:    {"La plataforma no tiene permiso para mandar mensajes con este número. Avisale a quien mantiene el sistema.", AccionSistema},
	131005: {"Meta negó el acceso a este número. Avisale a quien mantiene el sistema.", AccionSistema},
	133010: {"El número del negocio no está registrado en la Cloud API. Avisale a quien mantiene el sistema.", AccionSistema},
	131031: {"Meta bloqueó la cuenta de WhatsApp del negocio. Hay que revisarlo en el administrador de WhatsApp de Meta.", AccionSistema},
	368:    {"Meta bloqueó temporalmente los envíos por una infracción a sus políticas. Hay que revisarlo en el administrador de WhatsApp de Meta.", AccionSistema},
	131042: {"Meta no está cobrando: falta o falló el medio de pago de la cuenta de WhatsApp. Hay que revisarlo en Meta.", AccionSistema},
	131051: {"WhatsApp no admite ese tipo de mensaje.", AccionRevisar},
	131052: {"No se pudo bajar el archivo que mandó el cliente.", AccionReintentar},
	131053: {"WhatsApp no aceptó el archivo: puede ser muy pesado o de un formato que no admite. Probá con un PDF o una foto JPG.", AccionRevisar},
	132000: {"El mensaje preparado no tiene los datos que espera. Revisá que estén todos completos.", AccionRevisar},
	132001: {"Ese mensaje preparado no existe en Meta, o no en este idioma. Volvé a sincronizar las plantillas.", AccionRevisar},
	132005: {"Con los datos completos, el mensaje preparado queda demasiado largo. Acortá alguno.", AccionRevisar},
	132007: {"Meta rechazó el texto del mensaje preparado por sus políticas.", AccionRevisar},
	132012: {"Algún dato del mensaje preparado no tiene el formato que espera Meta.", AccionRevisar},
	132015: {"Meta pausó ese mensaje preparado por baja calidad. Usá otro o revisalo en Meta.", AccionRevisar},
	132016: {"Meta desactivó ese mensaje preparado. Usá otro.", AccionRevisar},
	131008: {"Faltó un dato obligatorio en el mensaje.", AccionRevisar},
	131009: {"Algún dato del mensaje no es válido (puede ser el número o el archivo).", AccionRevisar},
	100:    {"Meta rechazó el pedido por un dato inválido.", AccionRevisar},
	131021: {"No se puede mandar un mensaje al número del propio negocio.", AccionRevisar},
}

// ExplicarError explica un error de Meta; uno desconocido igual da un texto útil.
func ExplicarError(codigo *float64, detalle string) ErrorExplicado {
	if codigo != nil && *codigo != 0 {
		if e, ok := explicaciones[*codigo]; ok {
			return ErrorExplicado{codigo, e.texto, e.accion}
		}
	}
	texto := "WhatsApp no envió el mensaje"
	if detalle != "" {
		texto += " («" + cortarJS(detalle, 160) + "»)"
	}
	texto += ". Volvé a probar, y si sigue pasando avisale a quien mantiene el sistema."
	return ErrorExplicado{codigo, texto, AccionReintentar}
}

// EsFueraDeVentana dice si el error es «fuera de la ventana de 24 h».
func EsFueraDeVentana(codigo *float64) bool {
	return codigo != nil && (*codigo == 131047 || *codigo == 470)
}
