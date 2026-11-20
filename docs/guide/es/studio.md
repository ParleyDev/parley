---
title: Estudio
section: Hacer música
summary: Graba, arregla y mezcla canciones en grupo en un canal de Estudio de grabación, en directo o cuando te venga bien.
source: 13ae054b4cd0
---

Un canal de **Estudio de grabación** es un espacio de trabajo musical dentro de tu servidor. Cada **proyecto** es una canción, con su propio editor multipista, tomas, comentarios, versiones y chat. Los miembros de la banda pueden grabar juntos en directo o añadir partes cuando tengan tiempo.

![Un proyecto abierto en el estudio](shot:studio)

## Empezar un proyecto

Abre un canal de Estudio de grabación y haz clic en **Nuevo proyecto**. Ponle un nombre y un tempo. Necesitas el permiso **Crear proyectos**.

¿Ya empezaste una canción en otro sitio? **Importar** abre archivos `.dawproject` de Bitwig, Studio One, Cubase y otros, además de los archivos `.parley-project` propios de Parley.

## Grabar

1. Configura tu audio en el panel **Audio**: tu salida y la **Latencia de grabación**. Haz clic en **Medir** para que tus tomas cuadren con el ritmo.
2. Añade una pista: de **audio** para un micrófono o un instrumento, o **MIDI** con un sintetizador, una batería o un sampler integrados.
3. Arma la pista y pulsa grabar. **Grabar a la banda** graba a todos los de la sesión desde el cabezal; **Grabar en solitario** te graba solo a ti. Una toma puede durar hasta 30 minutos.

¿No tienes teclado MIDI? Toca notas con el teclado del ordenador: de <kbd>A</kbd> a <kbd>K</kbd> son las notas blancas, y <kbd>Z</kbd> y <kbd>X</kbd> cambian de octava.

## Arreglar y editar

| Teclas | Qué hace |
|---|---|
| <kbd>Space</kbd> | Reproducir o parar |
| <kbd>Home</kbd> | Volver al principio |
| <kbd>L</kbd> | Activar o desactivar el bucle |
| <kbd>S</kbd> | Dividir el clip en el cabezal |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Duplicar |
| <kbd>Q</kbd> | Cuantizar (ajustar las notas a la cuadrícula) |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Deshacer / rehacer |
| <kbd>Tab</kbd> | Cambiar entre el arreglo y el mezclador |

Haz doble clic en un clip MIDI para abrir el **Piano roll**. También hay metrónomo y cuenta previa, marcadores, cambios de tempo y carriles de automatización para el volumen y los efectos.

En el **mezclador**, cada pista tiene volumen, panorama, solo, silencio, efectos y envíos.

## Efectos

Cada pista, cada bus y el máster tienen un rack de efectos: EQ, filtro, compresor, puerta de ruido, limitador, reverb, delay, drive y chorus. Haz clic en **+ Efecto** para añadir uno. Los efectos suenan de arriba abajo; pasa el cursor sobre uno para moverlo o quitarlo.

![Ventanas de efectos con el EQ y el compresor de una guitarra y un filtro de bajo, abiertas una al lado de otra mientras suena la canción](shot:studio-effects)

Haz clic en un efecto para abrir su ventana. Puedes abrir tantas ventanas como quieras y arrastrarlas a cualquier sitio; haz clic en una ventana para traerla al frente. Cada ventana muestra lo que hace el efecto:

- **EQ** y **Filter** (filtro): la curva de frecuencias sobre el espectro del sonido. Arrastra los puntos de la curva para darle forma. En el filtro, arrastra hacia arriba o hacia abajo para tener más o menos resonancia, o usa la rueda del ratón.
- **Compressor** (compresor), **Gate** (puerta de ruido) y **Limiter** (limitador): cuánto volumen entra frente a cuánto sale, un punto que muestra dónde está tu sonido ahora, el nivel de los últimos segundos y cuánto se está bajando.
- **Reverb**: la forma de la cola. **Delay**: cada eco que se va apagando. **Drive**: la curva de distorsión, con el sonido antes y después. **Chorus**: el barrido.

Mientras suena la canción, las vistas y los medidores de **Entrada** y **Salida** se mueven con el sonido.

Para cambiar un ajuste:

- Arrastra un mando hacia arriba o hacia abajo. Mantén <kbd>Shift</kbd> para un control fino.
- Usa la rueda del ratón o las flechas del teclado.
- Escribe un valor debajo del mando, como `2.5k` o `25%`.
- Haz doble clic en un mando para devolverlo a su valor predeterminado.

El botón de encendido de la barra de título de la ventana activa y desactiva el efecto. La flecha restablece todos sus ajustes.

> Tip: Abre el mismo efecto en dos pistas una al lado de otra, como el EQ de la guitarra y el filtro del bajo, y reproduce la canción. Verás dónde se sitúa cada una y podrás hacerle hueco a la otra.

### Ejemplos

Estos ejemplos parten de los valores predeterminados de cada efecto. Reproduce la canción mientras trabajas, mejor con el **Bucle** activado, para que las ventanas muestren tu sonido.

**Limpiar los graves de una guitarra o una voz.** Añade un **EQ**. Arrastra el punto **C** de la curva hacia la derecha hasta que **Corte de graves** marque unos `90 Hz`; el retumbe por debajo desaparece, y el espectro detrás de la curva muestra lo que has quitado. Arrastra el punto **M** hasta unos `2.5k` y súbelo unos dB para que la parte destaque.

**Igualar una voz.** Añade un **Compressor**. Pon **Ratio** en `4:1` y luego baja el **Umbral** mientras miras el punto de la curva: cuando las palabras más fuertes pasan el codo, el medidor **GR** muestra cuánto se bajan. Busca unos 3 a 6 dB en las palabras más fuertes, y luego sube la **Compensación** más o menos lo mismo para que la parte suene igual de alta que antes.

**Hacer un barrido de filtro.** Añade un **Filter** a una pista de sintetizador o de batería y elige **Paso bajo**. Arrastra despacio el punto de la curva de derecha a izquierda mientras suena la canción: el sonido se oscurece a medida que baja la frecuencia de corte. Arrastra el punto hacia arriba o hacia abajo, o gira la rueda del ratón sobre él, para cambiar la **Resonancia**: más resonancia da un pico más marcado y resonante en la frecuencia de corte. Para que el barrido forme parte de la canción, grábalo con un [carril de automatización](#arranging-and-editing).

**Evitar que una pista con ruido sisee entre notas.** Añade un **Gate** al principio del rack. Fíjate en el piloto: pone **OPEN** mientras suena la parte y **CLOSED** en los huecos. Sube el **Umbral** hasta que se cierre en los huecos pero siga abierto en las notas más suaves que quieras conservar.

**Poner una parte en una sala.** Añade una **Reverb** y pon la **Mezcla** en torno al `20%`. Un **Decaimiento** más largo da un espacio más grande; un **Tono** más bajo oscurece la cola, para que quede detrás del sonido seco.

**Controlar los picos de toda la mezcla.** Añade un **Limiter** al **Máster** y deja el **Techo** en `-1 dB`. La ventana muestra con qué frecuencia se contienen los momentos más fuertes; si está actuando todo el rato, mejor baja las pistas.

## Trabajar en banda

- **Banda**: cada persona es **Ingeniero** (puede cambiarlo todo) o **Artista** (graba sus propias partes). **Proteger esta pista** impide que otros editen tu parte.
- **Sesiones**: un ingeniero hace clic en **Empezar la sesión** para trabajar juntos en directo. Todo el mundo oye lo que toca cualquiera.
- **Tomas**: se guardan todas las grabaciones. Elige la mejor con **Usar la toma**.
- **Comentarios**: deja notas en un punto de la canción, como "aquí la batería se arrastra", y márcalas con **Resolver** cuando estén hechas.
- **Versiones**: usa **Guardar versión** antes de cambios grandes, y **Restaurar** si no te gusta cómo ha quedado.

Los oyentes que no están en la banda pueden reproducir la canción, seguirla y comentar.

¿Se te ha cortado la conexión? Sigue trabajando. Tus cambios se guardan y se envían cuando vuelvas a estar en línea.

## Trabajar desde otro sitio

Un proyecto sigue sonando, y una toma sigue grabando, cuando vas a un chat o a otro canal. Mientras tanto, una tarjeta encima de tu nombre, abajo a la izquierda, muestra el proyecto, si está **Jugando** (reproduciéndose) o **Grabando**, y el tiempo. También aparece mientras estás en la sala de voz del proyecto. Su fila en la lista de canales muestra barras en movimiento mientras suena y un punto rojo mientras graba.

- Haz clic en el nombre del proyecto en la tarjeta para volver a él.
- Para o reproduce desde la tarjeta. La reproducción sigue desde donde la paraste.
- Para la toma desde la tarjeta, si podías pararla en el proyecto.
- ¿Has terminado? Páralo y haz clic en **✕** para cerrar la tarjeta.

## Compartir el resultado

El panel **Exportar** puede:

- exportar la mezcla en WAV, FLAC o MP3
- exportar los **stems** (cada pista por separado, en un zip)
- **Publicar la mezcla en un canal** para que todos la oigan
- guardar el proyecto como `.dawproject` para abrirlo en otra app de música
