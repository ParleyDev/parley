---
title: Studio
section: Fare musica
summary: Registra, arrangia e mixa brani insieme in un canale Studio di registrazione, dal vivo o quando hai tempo.
source: 13ae054b4cd0
---

Un canale **Studio di registrazione** è uno spazio di lavoro musicale dentro il tuo server. Ogni **progetto** è un brano, con il suo editor multitraccia, i take, i commenti, le versioni e la chat. I membri della band possono registrare insieme dal vivo, oppure aggiungere le loro parti quando hanno tempo.

![Un progetto aperto nello studio](shot:studio)

## Iniziare un progetto

Apri un canale Studio di registrazione e fai clic su **Nuovo progetto**. Dagli un nome e un tempo. Ti serve il permesso **Creare progetti**.

Hai già iniziato un brano altrove? **Importa** apre i file `.dawproject` di Bitwig, Studio One, Cubase e altri, oltre ai file `.parley-project` di Parley.

## Registrare

1. Configura l'audio nel pannello **Audio**: la tua uscita e la **Latenza di registrazione**. Fai clic su **Misura** così i tuoi take si allineano al tempo.
2. Aggiungi una traccia: **audio** per un microfono o uno strumento, oppure **MIDI** con un synth, una batteria o un campionatore integrati.
3. Arma la traccia e premi Registra. **Registra la band** registra tutti quelli nella sessione a partire dalla testina; **Registra da solo** registra solo te. Un take può durare fino a 30 minuti.

Niente tastiera MIDI? Suona le note con i tasti del computer: da <kbd>A</kbd> a <kbd>K</kbd> sono i tasti bianchi, e <kbd>Z</kbd> e <kbd>X</kbd> cambiano ottava.

## Arrangiare e modificare

| Tasti | Cosa fa |
|---|---|
| <kbd>Space</kbd> | Riproduci o ferma |
| <kbd>Home</kbd> | Torna all'inizio |
| <kbd>L</kbd> | Attiva o disattiva il loop |
| <kbd>S</kbd> | Dividi la clip alla testina |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Duplica |
| <kbd>Q</kbd> | Quantizza (aggancia le note alla griglia) |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Annulla / ripeti |
| <kbd>Tab</kbd> | Passa dall'arrangiamento al mixer e viceversa |

Fai doppio clic su una clip MIDI per aprire il **piano roll**. Ci sono anche metronomo e count-in, marcatori, cambi di tempo e corsie di automazione per volume ed effetti.

Nel **mixer**, ogni traccia ha volume, pan, solo, mute, effetti e mandate.

## Effetti

Ogni traccia, ogni bus e il master hanno un rack di effetti: EQ, filtro, compressore, gate, limiter, riverbero, delay, drive e chorus. Fai clic su **+ Effetto** per aggiungerne uno. Gli effetti agiscono dall'alto verso il basso; passa il mouse su uno per spostarlo o rimuoverlo.

![Le finestre degli effetti per l'EQ e il compressore di una chitarra e il filtro di un basso, aperte una accanto all'altra mentre il brano suona](shot:studio-effects)

Fai clic su un effetto per aprirne la finestra. Puoi aprire quante finestre vuoi e trascinarle ovunque; fai clic su una finestra per portarla in primo piano. Ogni finestra mostra cosa fa l'effetto:

- **EQ** e **filtro**: la curva di frequenza sopra lo spettro del suono. Trascina i punti sulla curva per modellarla. Sul filtro, trascina in su o in giù per avere più o meno risonanza, oppure usa la rotella del mouse.
- **Compressor**, **gate** e **limiter**: quanto forte entra il suono rispetto a quanto forte esce, un punto che mostra dove si trova adesso il tuo suono, il livello degli ultimi secondi e quanto viene abbassato.
- **Reverb**: la forma della coda. **Delay**: ogni eco che svanisce. **Drive**: la curva di distorsione, con il suono prima e dopo. **Chorus**: la modulazione.

Mentre il brano suona, le visualizzazioni e gli indicatori **In** e **Out** si muovono con il suono.

Per cambiare un'impostazione:

- Trascina una manopola in su o in giù. Tieni premuto <kbd>Shift</kbd> per un controllo più fine.
- Usa la rotella del mouse o i tasti freccia.
- Scrivi un valore sotto la manopola, come `2.5k` o `25%`.
- Fai doppio clic su una manopola per riportarla al valore predefinito.

Il pulsante di accensione nella barra del titolo della finestra spegne e riaccende l'effetto. La freccia ripristina tutte le sue impostazioni.

> Tip: Apri lo stesso effetto su due tracce una accanto all'altra, come l'EQ della chitarra e il filtro del basso, e fai suonare il brano. Vedi dove si colloca ciascuna e puoi fare spazio all'altra.

### Esempi

Questi esempi partono dalle impostazioni predefinite di un effetto. Fai suonare il brano mentre lavori, meglio se con il **Loop** attivo, così le finestre mostrano il tuo suono.

**Ripulisci le basse di una chitarra o di una voce.** Aggiungi un **EQ**. Trascina il punto **C** sulla curva verso destra finché **Taglio bassi** non indica circa `90 Hz`; il rombo sotto quella frequenza sparisce, e lo spettro dietro la curva mostra cosa hai tolto. Trascina il punto **M** a circa `2.5k` e alzalo di qualche dB per portare avanti la parte.

**Rendi uniforme una voce.** Aggiungi un **Compressor**. Imposta **Rapporto** su `4:1`, poi abbassa **Soglia** guardando il punto sulla curva: quando le parole più forti superano la piega, l'indicatore **GR** mostra di quanto vengono abbassate. Punta a circa 3-6 dB sulle parole più forti, poi alza **Makeup** più o meno della stessa quantità, così la parte suona forte come prima.

**Fai una sweep con un filtro.** Aggiungi un **Filter** a una traccia di synth o di batteria e scegli **Passa-basso**. Trascina lentamente il punto sulla curva da destra a sinistra mentre il brano suona: il suono si scurisce man mano che la frequenza di taglio scende. Trascina il punto in su o in giù, o usa la rotella del mouse sopra di esso, per cambiare la **Risonanza**: aumentandola ottieni un picco più stretto e squillante sulla frequenza di taglio. Per fare della sweep una parte del brano, registrala con una [corsia di automazione](#arranging-and-editing).

**Evita che una traccia rumorosa fischi tra una nota e l'altra.** Aggiungi un **Gate** per primo nel rack. Guarda la spia: indica **OPEN** mentre la parte suona e **CLOSED** nelle pause. Alza **Soglia** finché non si chiude nelle pause ma resta aperta sulle note più deboli che vuoi tenere.

**Metti una parte in una stanza.** Aggiungi un **Reverb** e imposta **Mix** a circa `20%`. Un **Decadimento** più lungo dà uno spazio più grande; un **Tono** più basso rende la coda più scura, così sta dietro al suono asciutto.

**Tieni a bada i picchi dell'intero mix.** Aggiungi un **Limiter** al **Master** e lascia **Tetto** a `-1 dB`. La finestra mostra quanto spesso i momenti più forti vengono contenuti; se lavora in continuazione, abbassa invece le tracce.

## Lavorare come band

- **Band**: ognuno è un **Tecnico** (può cambiare qualsiasi cosa) o un **Artista** (registra le sue parti). **Proteggi questa traccia** impedisce agli altri di modificare la tua parte.
- **Sessioni**: un tecnico fa clic su **Avvia sessione** per lavorare insieme dal vivo. Tutti sentono quello che suona chiunque.
- **Take**: ogni registrazione viene conservata. Scegli la migliore con **Usa qui il take**.
- **Commenti**: lascia note in un punto del brano, come "qui la batteria rallenta", e segnale come **Risolvi** quando hai finito.
- **Versioni**: usa **Salva versione** prima di grosse modifiche, e **Ripristina** se non ti piace dove è andato a finire.

Chi ascolta senza far parte della band può comunque riprodurre il brano, seguire il lavoro e commentare.

Hai perso la connessione? Continua a lavorare. Le tue modifiche vengono salvate e inviate quando torni online.

## Lavorare altrove

Un progetto continua a suonare, e un take continua a registrare, quando passi a una chat o a un altro canale. Nel frattempo una scheda sopra il tuo nome in basso a sinistra mostra il progetto, se è in riproduzione o in registrazione (**Sta giocando** o **Registrazione**) e il tempo. Compare anche mentre sei nella stanza vocale del progetto. La sua riga nell'elenco dei canali mostra delle barre in movimento mentre suona e un pallino rosso mentre registra.

- Fai clic sul nome del progetto nella scheda per tornarci.
- Ferma o riproduci dalla scheda. La riproduzione riprende da dove ti eri fermato.
- Ferma il take dalla scheda, se potevi fermarlo nel progetto.
- Hai finito? Fermalo, poi fai clic su **✕** per chiudere la scheda.

## Condividere il risultato

Il pannello **Esporta** può:

- esportare il mix in WAV, FLAC o MP3
- esportare gli **stem** (ogni traccia separata, in un file zip)
- **Pubblica il mix in un canale** perché tutti lo sentano
- salvare il progetto come `.dawproject` per aprirlo in un'altra app musicale
