---
title: Moderación y seguridad
section: Gestionar un servidor
summary: Mantén un buen ambiente en tu servidor con AutoMod, aislamientos temporales, baneos, reportes, protección contra raids y el registro de auditoría.
source: cef706ea7d87
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
- **Servidor solo para adultos**: marca **Todo en este servidor es 18+** y solo los miembros confirmados como mayores de 18 años podrán leer o participar, en cualquier parte del servidor. Para restringir solo algunas zonas, usa mejor **Canal con restricción de edad** en un canal o una categoría. Consulta [Canales y categorías](server-settings#channels-and-categories).
- **Filtro de imágenes explícitas**: analiza las imágenes que se publican en el servidor. La comprobación la hace la app de cada miembro, y también la instancia si sus administradores lo han configurado.
- **Autenticación en dos pasos para moderadores**: los moderadores deben tener activada la verificación en dos pasos o haber añadido una clave de acceso, para que una contraseña robada no pueda usarse contra el servidor. Cualquiera de las dos vale, y necesitas una tú para activar esta opción.
- **Resúmenes con IA**: activa o desactiva el botón de Resúmenes.

## Reportes

Cuando los miembros usan **Reportar mensaje** o **Reportar usuario** y marcan la casilla para avisar también a los moderadores de este servidor, el reporte llega a **Ajustes del servidor → Reportes**. Usa **Ir** para verlo en su contexto y luego **Resolver** o **Descartar**.

Los reportes sobre la seguridad de un menor o sobre imágenes íntimas compartidas sin consentimiento nunca aparecen aquí. Solo llegan al equipo que gestiona tu servidor de Parley.

## El registro de auditoría

El **Registro de auditoría** guarda quién cambió qué: roles, canales, baneos, expulsiones, aislamientos, mensajes eliminados y ajustes. Filtra por persona o por tipo de acción. Es el primer sitio donde mirar cuando algo cambia y nadie sabe por qué.

## Reportar a Parley

Algunas cosas van más allá de un servidor, como las amenazas, el contenido ilegal o el spam en muchos servidores. Todos los reportes llegan a los administradores que gestionan tu servidor de Parley. Si marcas la casilla, también se envían a los moderadores de ese servidor.

Para reportar, haz clic derecho en un mensaje y elige **Reportar mensaje**, o haz clic derecho en una persona y elige **Reportar usuario**. Indica qué ocurre, añade lo que pueda ayudar y elige **Enviar denuncia**.

Algunos motivos se revisan primero: **Amenaza de violencia**, **Alguien podría hacerse daño**, **Imágenes íntimas compartidas sin consentimiento** y la mayoría de las opciones de **Un menor está en peligro**. Los reportes sobre la seguridad de un menor o sobre imágenes íntimas solo llegan al equipo que gestiona tu servidor de Parley, nunca a los moderadores de un servidor, por eso en ellos no se ofrece la casilla.

Lo que reportas se copia en el momento en que lo envías: el mensaje, los archivos que lleve y, en un canal de servidor, lo que se dijo justo antes y después. Eliminar el mensaje después no borra la copia.

> Heads up: Si encuentras imágenes o vídeos sexuales de un menor, no los guardes, no hagas capturas de pantalla ni los reenvíes, ni siquiera como prueba. Reporta el mensaje y déjalo donde está. Tu reporte conserva lo necesario.

> Note: Si alguien corre peligro ahora mismo, llama primero al número de emergencias de tu zona y después reporta.

Puedes enviar hasta 10 reportes por hora. Los motivos que se revisan primero tienen su propio límite, más amplio.
