---
title: Studio
section: Musik machen
summary: Nehmt Songs gemeinsam in einem Aufnahmestudio-Kanal auf, arrangiert und mischt sie, live oder wann immer ihr Zeit habt.
source: 13ae054b4cd0
---

Ein Kanal vom Typ **Aufnahmestudio** ist ein Musik-Arbeitsplatz auf deinem Server. Jedes **Projekt** ist ein Song, mit eigenem Mehrspur-Editor, Takes, Kommentaren, Versionen und Chat. Bandmitglieder können live zusammen aufnehmen oder ihre Parts einspielen, wann immer sie Zeit haben.

![Ein im Studio geöffnetes Projekt](shot:studio)

## Ein Projekt beginnen

Öffne einen Aufnahmestudio-Kanal und klicke auf **Neues Projekt**. Gib ihm einen Namen und ein Tempo. Dafür brauchst du die Berechtigung **Projekte erstellen**.

Du hast einen Song schon woanders angefangen? **Importieren** öffnet `.dawproject`-Dateien aus Bitwig, Studio One, Cubase und anderen sowie Parleys eigene `.parley-project`-Dateien.

## Aufnehmen

1. Richte dein Audio im Bereich **Audio** ein: deinen Ausgang und die **Aufnahmelatenz**. Klicke auf **Messen**, damit deine Takes im Takt liegen.
2. Füge eine Spur hinzu: **Audio** für ein Mikrofon oder Instrument oder **MIDI** mit eingebautem Synth, Schlagzeug oder Sampler.
3. Schalte die Spur scharf und drück auf Aufnahme. **Die Band ab der Abspielposition aufnehmen** nimmt alle in der Session ab der Abspielposition auf; **Allein aufnehmen** nimmt nur dich auf. Ein Take darf bis zu 30 Minuten lang sein.

Kein MIDI-Keyboard? Spiel Noten mit deiner Computertastatur: <kbd>A</kbd> bis <kbd>K</kbd> sind die weißen Tasten, und <kbd>Z</kbd> und <kbd>X</kbd> wechseln die Oktave.

## Anordnen und bearbeiten

| Tasten | Bewirkt |
|---|---|
| <kbd>Space</kbd> | Abspielen oder stoppen |
| <kbd>Home</kbd> | Zurück zum Anfang |
| <kbd>L</kbd> | Loop an oder aus |
| <kbd>S</kbd> | Clip an der Abspielposition teilen |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Duplizieren |
| <kbd>Q</kbd> | Quantisieren (Noten am Raster ausrichten) |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Rückgängig / Wiederholen |
| <kbd>Tab</kbd> | Zwischen Arrangement und Mixer wechseln |

Doppelklicke auf einen MIDI-Clip, um die **Pianoroll** zu öffnen. Außerdem gibt es ein Metronom und einen Einzähler, Marker, Tempowechsel und Automationsspuren für Lautstärke und Effekte.

Im **Mixer** hat jede Spur Lautstärke, Panorama, Solo, Stumm, Effekte und Sends.

## Effekte

Jede Spur, jeder Bus und der Master haben ein Effekt-Rack: EQ, Filter, Kompressor, Gate, Limiter, Hall, Delay, Drive und Chorus. Klicke auf **+ Effekt**, um einen hinzuzufügen. Effekte wirken von oben nach unten; fahr mit der Maus über einen, um ihn zu verschieben oder zu entfernen.

![Effektfenster für EQ und Kompressor einer Gitarre und ein Bassfilter, nebeneinander geöffnet, während der Song läuft](shot:studio-effects)

Klicke auf einen Effekt, um sein Fenster zu öffnen. Du kannst so viele Fenster öffnen, wie du willst, und sie überallhin ziehen; ein Klick auf ein Fenster holt es nach vorne. Jedes Fenster zeigt, was der Effekt macht:

- **EQ** und **Filter**: die Frequenzkurve über dem Spektrum des Klangs. Zieh die Punkte auf der Kurve, um sie zu formen. Beim Filter ziehst du nach oben oder unten für mehr oder weniger Resonanz, oder du nutzt das Mausrad.
- **Kompressor**, **Gate** und **Limiter**: wie laut es hineingeht und wie laut es herauskommt, ein Punkt, der zeigt, wo dein Klang gerade liegt, der Pegel der letzten Sekunden und wie stark abgesenkt wird.
- **Hall**: die Form der Hallfahne. **Delay**: jedes Echo, wie es ausklingt. **Drive**: die Verzerrungskurve, mit dem Klang davor und danach. **Chorus**: die Modulation.

Während der Song läuft, bewegen sich die Ansichten und die Anzeigen **In** und **Out** mit dem Klang.

So änderst du eine Einstellung:

- Zieh einen Regler nach oben oder unten. Halte <kbd>Shift</kbd> für eine feine Einstellung.
- Nutze das Mausrad oder die Pfeiltasten.
- Tippe unter dem Regler einen Wert ein, etwa `2.5k` oder `25%`.
- Doppelklicke einen Regler, um ihn auf den Standardwert zurückzusetzen.

Die Ein/Aus-Taste in der Titelleiste des Fensters schaltet den Effekt aus und ein. Der Pfeil setzt alle seine Einstellungen zurück.

> Tip: Öffne denselben Effekt auf zwei Spuren nebeneinander, etwa den EQ der Gitarre und den Filter des Basses, und spiel den Song ab. So siehst du, wo jede Spur liegt, und kannst der anderen Platz machen.

### Beispiele

Diese Beispiele beginnen bei den Standardwerten eines Effekts. Spiel den Song beim Arbeiten ab, am besten mit eingeschaltetem **Loop**, damit die Fenster deinen Klang zeigen.

**Den Bassbereich einer Gitarre oder eines Gesangs aufräumen.** Füge einen **EQ** hinzu. Zieh den Punkt **C** auf der Kurve nach rechts, bis **Low Cut** etwa `90 Hz` anzeigt; das Rumpeln darunter verschwindet, und das Spektrum hinter der Kurve zeigt, was du weggenommen hast. Zieh den Punkt **M** auf etwa `2.5k` und ein paar dB nach oben, um den Part nach vorne zu holen.

**Einen Gesang gleichmäßiger machen.** Füge einen **Kompressor** hinzu. Stell **Ratio** auf `4:1` und dreh dann **Schwelle** herunter, während du den Punkt auf der Kurve beobachtest: Wenn die lauten Wörter den Knick überschreiten, zeigt die Anzeige **GR**, wie stark sie abgesenkt werden. Ziel sind etwa 3 bis 6 dB bei den lautesten Wörtern; dann hebst du **Makeup** um etwa denselben Wert an, damit der Part so laut ist wie vorher.

**Einen Filter-Sweep machen.** Füge einer Synth- oder Schlagzeugspur einen **Filter** hinzu und wähle **Tiefpass**. Zieh den Punkt auf der Kurve langsam von rechts nach links, während der Song läuft: Der Klang wird dunkler, je weiter die Grenzfrequenz sinkt. Zieh den Punkt nach oben oder unten oder dreh das Mausrad über ihm, um die **Resonanz** zu ändern: Mehr ergibt eine schärfere, klingelnde Spitze an der Grenzfrequenz. Um den Sweep zum Teil des Songs zu machen, nimm ihn mit einer [Automationsspur](#arranging-and-editing) auf.

**Verhindern, dass eine verrauschte Spur zwischen den Noten zischt.** Füge als Erstes im Rack ein **Gate** hinzu. Beobachte die Lampe: Sie zeigt **OPEN**, während der Part spielt, und **CLOSED** in den Pausen. Heb **Schwelle** an, bis das Gate in den Pausen schließt, aber bei den leisesten Noten, die du behalten willst, offen bleibt.

**Einen Part in einen Raum stellen.** Füge einen **Hall** hinzu und stell **Mix** auf etwa `20%`. Ein längeres **Decay** ergibt einen größeren Raum; ein niedrigerer **Klang** macht die Hallfahne dunkler, sodass sie hinter dem trockenen Signal liegt.

**Spitzen im ganzen Mix abfangen.** Füge dem **Master** einen **Limiter** hinzu und lass **Obergrenze** auf `-1 dB`. Das Fenster zeigt, wie oft die lautesten Momente gebremst werden; wenn er ständig arbeitet, dreh lieber die Spuren herunter.

## Als Band arbeiten

- **Band**: Jeder ist **Techniker** (darf alles ändern) oder **Künstler** (nimmt die eigenen Parts auf). **Diese Spur schützen** verhindert, dass andere deinen Part bearbeiten.
- **Sitzungen**: Ein Techniker klickt auf **Session starten**, um live zusammenzuarbeiten. Alle hören, was jemand abspielt.
- **Takes**: Jede Aufnahme bleibt erhalten. Wähle die beste mit **Take hier verwenden**.
- **Kommentare**: Hinterlass Notizen an einer Stelle im Song, etwa „Schlagzeug schleppt hier“, und markiere sie mit **Erledigen**, wenn sie abgearbeitet sind.
- **Versionen**: **Version speichern** vor großen Änderungen und **Wiederherstellen**, wenn dir die Richtung nicht gefällt.

Zuhörer, die nicht in der Band sind, können den Song trotzdem abspielen, mitverfolgen und kommentieren.

Verbindung verloren? Arbeite einfach weiter. Deine Änderungen werden gespeichert und gesendet, sobald du wieder online bist.

## Woanders weiterarbeiten

Ein Projekt spielt weiter und ein Take nimmt weiter auf, wenn du in einen Chat oder einen anderen Kanal wechselst. Solange das so ist, zeigt eine Karte über deinem Namen unten links das Projekt, ob es **Spielt** oder **Aufnahme** läuft, und die Zeit. Sie erscheint auch, während du im Sprachraum des Projekts bist. Seine Zeile in der Kanalliste zeigt beim Abspielen bewegte Balken und bei der Aufnahme einen roten Punkt.

- Klicke auf der Karte auf den Namen des Projekts, um dorthin zurückzukehren.
- Stoppe oder spiele über die Karte ab. Die Wiedergabe macht dort weiter, wo du gestoppt hast.
- Stoppe den Take über die Karte, sofern du ihn auch im Projekt stoppen könntest.
- Fertig? Stoppe es und klicke dann auf **✕**, um die Karte zu schließen.

## Das Ergebnis teilen

Der Bereich **Exportieren** kann:

- den Mix als WAV, FLAC oder MP3 exportieren
- **Stems** exportieren (jede Spur einzeln, gezippt)
- **Mix in einem Kanal posten**, damit alle ihn hören
- das Projekt als `.dawproject` speichern, um es in einer anderen Musik-App zu öffnen
