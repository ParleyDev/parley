---
title: Configurare un server
section: Gestire un server
summary: Nome, icona e banner, inviti, canali, emoji e sticker, benvenuto e onboarding, modelli e altro.
source: 1958fc7c367d
---

Apri il menu del server facendo clic sul suo nome, poi scegli **Impostazioni server**. Vedi solo le pagine che hai il permesso di modificare. Il proprietario vede tutto. Si apre nella stessa finestra di Impostazioni utente; scrivi nella casella di ricerca in cima all'elenco per trovare una pagina.

![Impostazioni server, nella pagina Profilo del server](shot:server-settings)

## Nome, icona e banner

In **Profilo del server**:

- **Icona**: un'immagine quadrata fino a 8 MB.
- **Nome del server**: fino a 100 caratteri. **Descrizione**: fino a 300.
- **Banner del server**: l'immagine in cima all'elenco dei canali. Viene ritagliata in 16:9; l'ideale è 1920×1080. GIF, APNG e WebP animati restano animati.
- **Canale dei messaggi di sistema**: dove Parley dà il benvenuto ai nuovi membri. Se vuoi, invita i membri a salutare.
- **Regole del server**: fino a 4.000 caratteri. Spunta **I membri devono accettare le regole prima di scrivere** perché i nuovi arrivati le accettino prima.
- **Impostazioni di notifica predefinite** per i nuovi membri, e se i membri possono **programmare messaggi**.

Dopo aver scelto un'immagine, trascinala e ingrandiscila per inquadrarla. Per reinquadrarla in seguito, fai clic su **Regola**.

Qui trovi anche:

- **Tema del server**: dai al server dei colori suoi. I membri possono scegliere di vederli.
- **Tag del server**: un tag breve con un badge che i membri possono mostrare accanto al nome.
- **Statistiche**: quante persone entrano e restano, quanto è attivo il server e quali canali sono più seguiti.

## Invitare persone

Fai clic su **Invita persone** nel menu del server per avere un link da condividere. In **Inviti** in Impostazioni server puoi creare inviti personalizzati:

- **Scade dopo**: da 30 minuti fino a 30 giorni, oppure mai.
- **Numero massimo di utilizzi**: da 1 a 100, oppure senza limite.
- **Concedi un'iscrizione temporanea**: le persone escono automaticamente quando si disconnettono, a meno che non abbiano ricevuto un ruolo.

Ogni invito attivo è elencato, con **Revoca** per annullarlo. I server pubblici elencati in Esplora possono avere anche un **link personalizzato**.

**Accesso**: per approvare le persone a mano, attiva **Controlla i nuovi membri prima che possano scrivere** e scrivi qualche domanda. Le richieste aspettano che tu faccia **Approva** o **Rifiuta**.

## Canali e categorie

- **Crea canale** è nel menu del server, oppure fai clic sul **+** accanto a una categoria. Vedi [Canali](channels#kinds-of-channel) per i vari tipi.
- Trascina canali e categorie per riordinarli.
- Fai clic destro su un canale e scegli **Modifica canale** per:
  - l'argomento e lo **Slowmode**
  - le impostazioni **Canale vietato ai minori** e **Spoiler**. Un canale vietato ai minori è aperto solo ai membri confermati come maggiorenni (almeno 18 anni); tutti gli altri lo vedono bloccato. Attivalo su una categoria e tutti i suoi canali diventano vietati ai minori. Solo chi è a sua volta confermato può disattivarlo di nuovo.
  - per i vocali: il **limite di utenti**, la qualità video e audio e la **crittografia end-to-end**
  - i **Tag** dei forum
  - i **Permessi**: vedi [Ruoli e permessi](roles-and-permissions#channel-permissions)

## Emoji, sticker e suoni

| | Limite | File |
|---|---|---|
| **Emoji** | 100 per server | PNG, JPEG, GIF o WebP sotto i 512 KB. Nomi da 2 a 32 tra lettere, numeri o `_`. |
| **Sticker** | 60 per server | Sotto 1 MB. Funzionano meglio a 320×320 pixel. |
| **Soundboard** | 48 per server | MP3, OGG, WAV, WebM o M4A sotto i 512 KB (circa 5 secondi). |

I membri possono usare le tue emoji personalizzate in qualsiasi server in cui si trovano.

## Accogliere i nuovi membri

- **Schermata di benvenuto**: un saluto con un massimo di 5 canali consigliati, mostrato quando qualcuno entra.
- **Onboarding**: domande per i nuovi arrivati ("Cosa ti porta qui?"). Ogni risposta può assegnare ruoli e canali, così le persone vedono ciò che le riguarda. Segna le domande come **Obbligatorio** o consenti più risposte.
- **Regole**: si impostano in Profilo del server. I membri fanno clic su **Accetto** prima di poter scrivere.

## Community all'interno del server

In un server grande, raggruppa i canali in [community](channels#communities). Ognuna ha una sua pagina e dei gestori.

- Creane una con il **+** accanto a **Community** nell'elenco dei canali.
- Apri la sua pagina e fai clic su **Modifica**. Puoi impostare:
  - icona, nome e descrizione
  - un indirizzo web
  - una sezione **Informazioni** e dei **Link**
  - chi se ne occupa e i suoi canali
- **Aggiungi immagine di intestazione** dà alla pagina un banner:
  - Funzionano meglio le immagini larghe da 1600 pixel in su.
  - Fai clic su **Regola** per scegliere **Riempi** o **Adatta**, allinearla con la griglia di allineamento e fare zoom.
  - Le anteprime mostrano come appare su un telefono, un portatile e uno schermo largo.
- **Elimina community** è in cima alla barra di modifica. Elimina anche i canali della community e i loro messaggi.

## Farsi trovare

- **Scoperta**: elenca il server in Esplora con una categoria, una descrizione e un banner. Prima lo esamina un amministratore.
- **Widget**: un riquadro da incorporare nel tuo sito, che mostra chi è online con un pulsante **Unisciti**.
- **Badge**: un badge dal vivo "Unisciti a noi" per un README o un sito.

## Modelli di server

**Impostazioni server → Modello di server** condivide la configurazione del tuo server (ruoli, categorie, canali, permessi e alcune impostazioni) così altri possono creare un server uguale. Messaggi, membri ed emoji non vengono mai copiati.

- **Scarica il file del modello** salva il server com'è adesso come file `.json`. Tienilo come backup della tua configurazione o mandalo a qualcuno. Non serve nessun link.
- **Condividi un link**: dai al modello un titolo e una descrizione, poi **Genera modello**. Il link resta sempre lo stesso; fai clic su **Sincronizza modello** dopo aver cambiato il server, così il link fornisce la nuova configurazione. **Elimina modello** disattiva il link.

Chiunque può creare un server da un file o un link di modello con **Aggiungi un server → Usa un modello**, su qualsiasi server Parley. Vedi [Partire da un modello](joining-servers#starting-from-a-template).

Chi apre il link di un modello vede cosa configura, e può creare un server da esso o scaricarlo come file.

## Cedere o chiudere il server

Queste opzioni sono in fondo all'elenco, solo per il proprietario:

- **Trasferisci la proprietà** cede il server a un altro membro.
- **Elimina server**: scrivi il nome del server e la tua password per confermare. Hai cambiato idea? Hai **7 giorni** per ripristinarlo da **Impostazioni utente → Account**.
