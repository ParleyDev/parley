---
title: Moderación y seguridad
section: Gestionar un servidor
summary: Mantén un buen ambiente en tu servidor con AutoMod, aislamientos temporales, baneos, reportes, protección contra raids y el registro de auditoría.
source: ede402610205
---

## Actuar con alguien

Haz clic derecho en una persona (o mantén pulsado en el móvil) para ver estas opciones:

| Opción | Qué pasa |
|---|---|
| **Aislar temporalmente** | Puede leer, pero no puede publicar, reaccionar ni entrar en voz, desde 60 segundos hasta una semana. **Quitar aislamiento** lo termina antes. |
| **Expulsar** | La saca del servidor. Puede volver con una invitación nueva. |
| **Banear** | La saca del servidor y le impide volver. También puedes eliminar sus mensajes de los últimos días, hasta 7. |
| **Vista de moderador** | Su historial en tu servidor: advertencias, aislamientos y notas. Puedes **Advertir**, o ponerla en **Cuarentena** mientras investigas algo. |

Añade siempre un motivo. Se guarda en el registro de auditoría, así el resto del equipo sabe lo que pasó.

Quita baneos en **Ajustes del servidor → Baneos**. Los miembros baneados pueden apelar, si el servidor lo permite. Las apelaciones esperan ahí a que las aceptes o las rechaces.

Para limpiar una avalancha de spam, escribe `/purge 50` para eliminar los últimos 50 mensajes, o `/purge 50 @someone` para eliminar solo los de esa persona (hasta 100 a la vez).

## AutoMod

**Ajustes del servidor → AutoMod** detecta problemas automáticamente, aunque no haya ningún moderador conectado. Las reglas pueden:

- **Bloquear palabras**: una lista de palabras o frases. Usa `*` como comodín.
- **Bloquear spam de menciones**: mensajes que mencionan a demasiada gente a la vez.
- **Bloquear enlaces**: enlaces a cualquier sitio salvo los que permitas.
- **Filtrar apodos** que incumplen tus reglas.

En cada regla, elige qué pasa:

- bloquear el mensaje, con un mensaje tuyo para quien lo envió si quieres
- enviar una alerta a un canal de moderadores
- aislar temporalmente a la persona

También puedes eximir roles o canales, como un canal en el que tus moderadores hablan de las palabras prohibidas. A quienes pueden gestionar el servidor nunca se les filtra.

## Configuración de seguridad

**Ajustes del servidor → Configuración de seguridad** tiene los interruptores importantes:

- **Nivel de verificación**: lo que necesita un recién llegado antes de poder publicar. **Baja** exige un correo verificado. **Media** exige además una cuenta de Parley con más de 5 minutos de antigüedad. **Alta** exige además llevar 10 minutos en tu servidor. Los miembros con cualquier rol se lo saltan.
- **Protección contra raids**: detecta una llegada repentina de cuentas nuevas y avisa a tus moderadores.
- **Pausar invitaciones** y **Pausar los MD entre miembros**: frenos de emergencia durante una raid.
- **Filtro de imágenes explícitas**: analiza las imágenes que se publican en el servidor.
- **Autenticación en dos pasos para moderadores**: los moderadores deben tener activada la verificación en dos pasos o haber añadido una clave de acceso, para que una contraseña robada no pueda usarse contra el servidor. Cualquiera de las dos vale, y necesitas una tú para activar esta opción.
- **Resúmenes con IA**: activa o desactiva el botón de Resúmenes.

## Reportes

Cuando los miembros usan **Reportar mensaje** o **Reportar usuario** y marcan la casilla para avisar también a los moderadores de este servidor, el reporte llega a **Ajustes del servidor → Reportes**. Usa **Ir** para verlo en su contexto y luego **Resolver** o **Descartar**.

## El registro de auditoría

El **Registro de auditoría** guarda quién cambió qué: roles, canales, baneos, expulsiones, aislamientos, mensajes eliminados y ajustes. Filtra por persona o por tipo de acción. Es el primer sitio donde mirar cuando algo cambia y nadie sabe por qué.

## Reportar a Parley

Algunas cosas van más allá de un servidor, como las amenazas, el contenido ilegal o el spam en muchos servidores. Todos los reportes llegan a los administradores que gestionan tu servidor de Parley. Si marcas la casilla, también se envían a los moderadores de ese servidor.
