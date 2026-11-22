---
title: Moderazione e sicurezza
section: Gestire un server
summary: Mantieni il server accogliente con AutoMod, timeout, ban, segnalazioni, protezione anti-raid e registro attività.
source: cef706ea7d87
---

## Gestire una persona

Fai clic destro su una persona (o tieni premuto sul telefono) per queste opzioni:

| Opzione | Cosa succede |
|---|---|
| **Metti in timeout** | Può leggere ma non scrivere, reagire o entrare in vocale, da 60 secondi fino a una settimana. **Rimuovi timeout** lo termina prima. |
| **Espelli** | La rimuove. Può tornare con un nuovo invito. |
| **Banna** | La rimuove e le impedisce di tornare. Puoi anche eliminare i suoi messaggi degli ultimi giorni, fino a 7. |
| **Vista moderatore** | La sua storia nel tuo server: avvisi, timeout e note. Puoi usare **Avvisa** o metterla in **Quarantena** mentre verifichi qualcosa. |

Aggiungi sempre un motivo. Resta nel registro attività, così il resto della squadra sa cos'è successo.

Revoca i ban in **Impostazioni server → Ban**. I membri banditi possono presentare ricorso, se il server lo consente. I ricorsi aspettano lì che tu li accetti o li respinga.

Per ripulire un'ondata di spam, scrivi `/purge 50` per eliminare gli ultimi 50 messaggi, oppure `/purge 50 @someone` per eliminare solo quelli di una persona (fino a 100 alla volta).

## AutoMod

**Impostazioni server → AutoMod** individua i problemi in automatico, anche quando non c'è nessun moderatore. Le regole possono:

- **Blocca parole**: un elenco di parole o frasi. Usa `*` come carattere jolly.
- **Blocca lo spam di menzioni**: messaggi che menzionano troppe persone insieme.
- **Blocca link**: link a qualsiasi sito tranne quelli che consenti.
- **Filtra nickname** che violano le tue regole.

Per ogni regola, scegli cosa succede:

- bloccare il messaggio, eventualmente con un tuo messaggio per chi l'ha inviato
- mandare un avviso in un canale dei moderatori
- mettere la persona in timeout

Puoi anche escludere ruoli o canali, come un canale in cui i moderatori discutono di parole vietate. Chi può gestire il server non viene mai filtrato.

## Configurazione sicurezza

**Impostazioni server → Configurazione sicurezza** ha gli interruttori principali:

- **Livello di verifica**: cosa serve a un nuovo arrivato prima di poter scrivere. **Basso** richiede un'email verificata. **Medio** richiede anche un account Parley creato da più di 5 minuti. **Alto** richiede anche 10 minuti nel tuo server. I membri con un ruolo qualsiasi lo saltano.
- **Protezione anti-raid**: nota un improvviso afflusso di nuovi account e avvisa i moderatori.
- **Metti in pausa gli inviti** e **Metti in pausa i DM tra membri**: freni di emergenza durante un raid.
- **Server per soli adulti**: spunta **Tutto in questo server è 18+** e solo i membri confermati come maggiorenni (almeno 18 anni) possono leggere o partecipare, ovunque nel server. Per limitare solo alcune aree, usa invece **Canale vietato ai minori** su un canale o una categoria. Vedi [Canali e categorie](server-settings#channels-and-categories).
- **Filtro immagini esplicite**: analizza le immagini pubblicate nel server. Il controllo lo fa l'app di ogni membro, e anche l'istanza se i suoi admin l'hanno configurata per farlo.
- **Autenticazione a due fattori per i moderatori**: i moderatori devono avere la 2FA attiva o una passkey aggiunta, così una password rubata non può essere usata contro il server. Va bene una delle due, e per attivarlo ne serve una anche a te.
- **Riassunti IA**: attiva o disattiva il pulsante Riassunti.

## Segnalazioni

Quando i membri usano **Segnala messaggio** o **Segnala utente** e spuntano la casella per avvisare anche i moderatori di questo server, la segnalazione arriva in **Impostazioni server → Segnalazioni**. Usa **Vai** per vederla nel contesto, poi **Risolvi** o **Ignora**.

Le segnalazioni sulla sicurezza di un minore o su immagini intime condivise senza consenso non compaiono mai qui. Arrivano solo al team che gestisce il tuo server Parley.

## Il registro attività

**Registro attività** registra chi ha cambiato cosa: ruoli, canali, ban, espulsioni, timeout, messaggi eliminati e impostazioni. Filtra per persona o per tipo di azione. È il primo posto dove guardare quando qualcosa cambia e nessuno sa perché.

## Segnalare a Parley

Alcune cose vanno oltre un singolo server, come minacce, contenuti illegali o spam in tanti server. Ogni segnalazione arriva agli amministratori che gestiscono il tuo server Parley. Spuntando la casella la mandi anche ai moderatori di quel server.

Per segnalare, fai clic destro su un messaggio e scegli **Segnala messaggio**, oppure fai clic destro su una persona e scegli **Segnala utente**. Indica cosa non va, aggiungi tutto ciò che può aiutare e scegli **Invia segnalazione**.

Alcuni motivi vengono esaminati per primi: **Minaccia di violenza**, **Qualcuno potrebbe farsi del male**, **Immagini intime condivise senza consenso** e la maggior parte delle scelte sotto **Un minore è in pericolo**. Le segnalazioni sulla sicurezza di un minore o su immagini intime arrivano solo al team che gestisce il tuo server Parley, mai ai moderatori di un server, quindi per queste la casella non viene proposta.

Ciò che segnali viene copiato nel momento in cui lo invii: il messaggio, gli eventuali file allegati e, in un canale di un server, quello che è stato detto subito prima e subito dopo. Eliminare il messaggio in seguito non rimuove la copia.

> Heads up: Se ti imbatti in immagini o video a sfondo sessuale di un minore, non salvarli, non fare screenshot e non inoltrarli, nemmeno come prova. Segnala il messaggio e lascialo dov'è. La tua segnalazione conserva ciò che serve.

> Note: Se qualcuno è in pericolo in questo momento, chiama prima il numero di emergenza locale, poi segnala.

Puoi inviare fino a 10 segnalazioni all'ora. I motivi esaminati per primi hanno un limite a parte, più alto.
