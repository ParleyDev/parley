---
title: Studio
section: Muziek maken
summary: Neem samen nummers op, arrangeer en mix ze in een opnamestudiokanaal, live of wanneer het jou uitkomt.
source: 13ae054b4cd0
---

Een **Opnamestudio**-kanaal is een muziekwerkplek binnen je server. Elk **project** is een nummer, met een eigen multitrack-editor, takes, opmerkingen, versies en chat. Bandleden kunnen live samen opnemen, of partijen toevoegen wanneer ze tijd hebben.

![Een project geopend in de studio](shot:studio)

## Een project starten

Open een opnamestudiokanaal en klik op **Nieuw project**. Geef het een naam en een tempo. Je hebt de machtiging **Projecten maken** nodig.

Heb je ergens anders al een nummer opgezet? **Importeren** opent `.dawproject`-bestanden uit Bitwig, Studio One, Cubase en andere, en ook Parley's eigen `.parley-project`-bestanden.

## Opnemen

1. Stel je audio in in het paneel **Audio**: je uitgang, en **Opnamelatentie**. Klik op **Meten** zodat je takes gelijk lopen met de beat.
2. Voeg een spoor toe: **audio** voor een microfoon of instrument, of **MIDI** met een ingebouwde synth, drumstel of sampler.
3. Wapen het spoor en druk op opnemen. **De band opnemen** neemt iedereen in de sessie op vanaf de afspeelkop; **Alleen opnemen** neemt alleen jou op. Een take mag tot 30 minuten duren.

Geen MIDI-keyboard? Speel noten met je computertoetsen: <kbd>A</kbd> tot <kbd>K</kbd> zijn de witte toetsen, en met <kbd>Z</kbd> en <kbd>X</kbd> wissel je van octaaf.

## Arrangeren en bewerken

| Toetsen | Doet |
|---|---|
| <kbd>Space</kbd> | Afspelen of stoppen |
| <kbd>Home</kbd> | Terug naar het begin |
| <kbd>L</kbd> | Loop aan of uit |
| <kbd>S</kbd> | De clip splitsen bij de afspeelkop |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Dupliceren |
| <kbd>Q</kbd> | Kwantiseren (noten op het raster uitlijnen) |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Ongedaan maken / opnieuw |
| <kbd>Tab</kbd> | Wisselen tussen het arrangement en de mixer |

Dubbelklik op een MIDI-clip om de **pianorol** te openen. Er zijn ook een metronoom en aftellen, markers, tempowijzigingen, en automatiseringssporen voor volume en effecten.

In de **mixer** heeft elk spoor volume, pan, solo, dempen, effecten en sends.

## Effecten

Elk spoor, elke bus en de master heeft een effectenrack: EQ, filter, compressor, gate, limiter, reverb, delay, drive en chorus. Klik op **+ Effect** om er een toe te voegen. Effecten spelen van boven naar beneden; ga met de muis over een effect om het te verplaatsen of te verwijderen.

![Effectvensters voor de EQ en compressor van een gitaar en een basfilter, naast elkaar geopend terwijl het nummer speelt](shot:studio-effects)

Klik op een effect om het venster te openen. Je kunt zoveel vensters openen als je wilt en ze overal neerzetten; klik op een venster om het naar voren te halen. Elk venster laat zien wat het effect doet:

- **EQ** en **filter**: de frequentiecurve over het spectrum van het geluid. Sleep de punten op de curve om hem vorm te geven. Bij het filter sleep je omhoog of omlaag voor meer of minder resonantie, of gebruik je het scrollwiel.
- **Compressor**, **gate** en **limiter**: hoe hard het erin gaat tegenover hoe hard het eruit komt, een punt dat laat zien waar je geluid nu zit, het niveau van de laatste paar seconden, en hoeveel er zachter wordt gezet.
- **Reverb**: de vorm van de galmstaart. **Delay**: elke echo die wegsterft. **Drive**: de vervormingscurve, met het geluid ervoor en erna. **Chorus**: de sweep.

Terwijl het nummer speelt, bewegen de weergaven en de meters **In** en **Out** mee met het geluid.

Een instelling wijzigen:

- Sleep een knop omhoog of omlaag. Houd <kbd>Shift</kbd> ingedrukt voor fijne controle.
- Gebruik het scrollwiel of de pijltjestoetsen.
- Typ een waarde onder de knop, zoals `2.5k` of `25%`.
- Dubbelklik op een knop om hem terug te zetten op de standaardwaarde.

De aan/uit-knop in de titelbalk van het venster zet het effect uit en aan. Het pijltje zet alle instellingen terug.

> Tip: Open hetzelfde soort effect op twee sporen naast elkaar, zoals de EQ van de gitaar en het filter van de bas, en speel het nummer af. Je ziet waar elk zit en kunt ruimte maken voor de ander.

### Voorbeelden

Deze beginnen vanaf de standaardinstellingen van een effect. Speel het nummer af terwijl je bezig bent, het liefst met **Loop** aan, zodat de vensters je geluid laten zien.

**De lage tonen van een gitaar of zang opschonen.** Voeg een **EQ** toe. Sleep de punt **C** op de curve naar rechts tot **Low cut** ongeveer `90 Hz` aangeeft; het gerommel daaronder verdwijnt, en het spectrum achter de curve laat zien wat je hebt weggehaald. Sleep de punt **M** naar ongeveer `2.5k` en een paar dB omhoog om de partij naar voren te halen.

**Zang gelijkmatiger maken.** Voeg een **Compressor** toe. Zet **Ratio** op `4:1` en draai dan **Drempel** omlaag terwijl je naar de punt op de curve kijkt: als de harde woorden over de knik gaan, laat de meter **GR** zien hoeveel zachter ze worden gezet. Mik op ongeveer 3 tot 6 dB bij de hardste woorden en verhoog dan **Makeup** met ongeveer evenveel, zodat de partij even hard is als eerst.

**Een filter laten sweepen.** Voeg een **Filter** toe aan een synth- of drumspoor en kies **Laagdoorlaat**. Sleep de punt op de curve langzaam van rechts naar links terwijl het nummer speelt: het geluid wordt donkerder naarmate de cutoff zakt. Sleep de punt omhoog of omlaag, of scroll erover met het muiswiel, om **Resonantie** te wijzigen: meer geeft een scherpere, rinkelende piek bij de cutoff. Wil je de sweep in het nummer houden, neem hem dan op met een [automatiseringsspoor](#arranging-and-editing).

**Een ruisend spoor stil houden tussen de noten.** Zet een **Gate** als eerste in het rack. Let op het lampje: het toont **OPEN** zolang de partij speelt en **CLOSED** in de stiltes. Verhoog **Drempel** tot hij dichtgaat in de stiltes maar open blijft bij de zachtste noten die je wilt houden.

**Een partij in een ruimte zetten.** Voeg een **Reverb** toe en zet **Mix** op ongeveer `20%`. Een langere **Decay** geeft een grotere ruimte; een lagere **Klank** maakt de galmstaart donkerder, zodat die achter het droge geluid zit.

**Pieken in de hele mix opvangen.** Voeg een **Limiter** toe aan de **Master** en laat **Plafond** op `-1 dB` staan. Het venster laat zien hoe vaak de hardste momenten worden afgeremd; werkt hij voortdurend, zet dan liever de sporen zachter.

## Samenwerken als band

- **Band**: iedereen is **Technicus** (mag alles wijzigen) of **Artiest** (neemt de eigen partijen op). **Dit spoor beschermen** voorkomt dat anderen jouw partij bewerken.
- **Sessies**: een technicus klikt op **Sessie starten** om live samen te werken. Iedereen hoort wat iemand speelt.
- **Takes**: elke opname wordt bewaard. Kies de beste met **Take hier gebruiken**.
- **Opmerkingen**: laat notities achter op een punt in het nummer, zoals "drums slepen hier", en kies **Oplossen** als het klaar is.
- **Versies**: **Versie opslaan** voor grote wijzigingen, en **Herstellen** als je niet blij bent met waar het naartoe ging.

Luisteraars die niet in de band zitten, kunnen het nummer nog steeds afspelen, meevolgen en opmerkingen plaatsen.

Verbinding kwijt? Werk gewoon door. Je wijzigingen worden opgeslagen en verstuurd zodra je weer online bent.

## Ergens anders bezig zijn

Een project blijft spelen, en een take blijft opnemen, als je naar een chat of een ander kanaal gaat. Zolang dat zo is, toont een kaart boven je naam linksonder het project, of het **Speelt** of in **Opname** is, en de tijd. De kaart verschijnt ook zolang je in de spraakruimte van het project zit. De rij in de kanalenlijst toont bewegende balkjes als het speelt en een rode stip als het opneemt.

- Klik op de naam van het project op de kaart om er terug naartoe te gaan.
- Stop of speel af vanaf de kaart. Afspelen gaat verder waar je stopte.
- Stop de take vanaf de kaart, als je hem in het project ook kon stoppen.
- Klaar ermee? Stop het, en klik dan op **✕** om de kaart te sluiten.

## Het resultaat delen

Het paneel **Exporteren** kan:

- de mix exporteren als WAV, FLAC of MP3
- **stems** exporteren (elk spoor apart, gezipt)
- **De mix in een kanaal plaatsen** zodat iedereen hem kan horen
- het project opslaan als `.dawproject` om in een andere muziekapp te openen
