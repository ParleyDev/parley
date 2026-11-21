---
title: Moderatie en veiligheid
section: Een server runnen
summary: Houd je server vriendelijk met AutoMod, time-outs, verbanningen, meldingen, raidbescherming en het auditlogboek.
source: 902efa01e18b
---

## Iemand aanpakken

Klik met rechts op een persoon (of houd ingedrukt op een telefoon) voor deze opties:

| Optie | Wat er gebeurt |
|---|---|
| **Time-out** | Diegene kan lezen, maar niets plaatsen, niet reageren en niet in spraak, voor 60 seconden tot een week. **Time-out opheffen** beëindigt het eerder. |
| **Verwijderen** | Haalt diegene uit de server. Met een nieuwe uitnodiging kan diegene terugkomen. |
| **Verbannen** | Haalt diegene uit de server en voorkomt dat hij of zij terugkomt. Je kunt ook de berichten van de afgelopen dagen verwijderen, tot 7 dagen. |
| **Moderatorweergave** | De geschiedenis van diegene in je server: waarschuwingen, time-outs en notities. Je kunt diegene **Waarschuwen**, of in **Quarantaine** zetten terwijl je iets uitzoekt. |

Geef altijd een reden op. Die wordt bewaard in het auditlogboek, zodat de rest van het team weet wat er is gebeurd.

Hef verbanningen op onder **Serverinstellingen → Verbanningen**. Verbannen leden kunnen in beroep gaan, als de server dat toestaat. Beroepen wachten daar tot jij ze accepteert of afwijst.

Om een vloed aan spam op te ruimen, typ je `/purge 50` om de laatste 50 berichten te verwijderen, of `/purge 50 @someone` om alleen die van diegene te verwijderen (tot 100 tegelijk).

## AutoMod

**Serverinstellingen → AutoMod** vangt problemen automatisch af, ook als er geen moderator in de buurt is. Regels kunnen:

- **Woorden blokkeren**: een lijst met woorden of zinnen. Gebruik `*` als jokerteken.
- **Vermeldingsspam blokkeren**: berichten die te veel mensen tegelijk pingen.
- **Links blokkeren**: links naar elke site behalve de sites die je toestaat.
- **Bijnamen filteren** die tegen je regels ingaan.

Kies per regel wat er gebeurt:

- het bericht blokkeren, eventueel met een eigen bericht aan de afzender
- een waarschuwing sturen naar een moderatorkanaal
- de persoon een time-out geven

Je kunt ook rollen of kanalen uitzonderen, zoals een kanaal waarin je moderators scheldwoorden bespreken. Mensen die de server mogen beheren, worden nooit gefilterd.

## Veiligheidsinstellingen

**Serverinstellingen → Veiligheidsinstellingen** bevat de grote schakelaars:

- **Verificatieniveau**: wat een nieuwkomer nodig heeft voordat hij of zij iets kan plaatsen. **Laag** vereist een bevestigd e-mailadres. **Gemiddeld** vereist ook een Parley-account dat ouder is dan 5 minuten. **Hoog** vereist ook 10 minuten in je server. Leden met een rol slaan dit over.
- **Raidbescherming**: merkt een plotselinge toestroom van nieuwe accounts op en waarschuwt je moderators.
- **Uitnodigingen pauzeren** en **DM's tussen leden pauzeren**: noodremmen tijdens een raid.
- **Filter voor expliciete afbeeldingen**: scant afbeeldingen die in de server worden geplaatst.
- **Tweestapsverificatie voor moderators**: moderators moeten 2FA aan hebben staan of een passkey hebben toegevoegd, zodat een gestolen wachtwoord niet tegen de server kan worden gebruikt. Een van beide telt, en je hebt er zelf een nodig om dit aan te zetten.
- **AI-samenvattingen**: zet de knop Samenvattingen aan of uit.

## Meldingen

Als leden **Bericht rapporteren** of **Gebruiker rapporteren** gebruiken en het vakje aanvinken om ook de moderators van deze server in te lichten, komt de melding terecht onder **Serverinstellingen → Meldingen**. Kies **Springen** om hem in context te zien, en daarna **Oplossen** of **Sluiten**.

Meldingen over de veiligheid van een kind of over intieme beelden die zonder toestemming zijn gedeeld, verschijnen hier nooit. Ze gaan alleen naar het team dat je Parley-server draait.

## Het auditlogboek

Het **Auditlogboek** houdt bij wie wat heeft gewijzigd: rollen, kanalen, verbanningen, verwijderingen, time-outs, verwijderde berichten en instellingen. Filter op persoon of op soort actie. Het is de eerste plek om te kijken als er iets verandert en niemand weet waarom.

## Melden bij Parley

Sommige dingen gaan verder dan één server, zoals bedreigingen, illegale inhoud of spam over veel servers. Elke melding gaat naar de beheerders die je Parley-server draaien. Als je het vakje aanvinkt, gaat hij ook naar de moderators van die server.

Om iets te melden klik je met rechts op een bericht en kies je **Bericht rapporteren**, of klik je met rechts op een persoon en kies je **Gebruiker rapporteren**. Kies wat er mis is, voeg toe wat kan helpen en kies **Melding indienen**.

Sommige redenen worden als eerste bekeken: **Dreiging met geweld**, **Iemand doet zichzelf mogelijk iets aan**, **Intieme beelden die zonder toestemming zijn gedeeld** en de meeste keuzes onder **Een kind loopt gevaar**. Meldingen over de veiligheid van een kind of over intieme beelden gaan alleen naar het team dat je Parley-server draait, nooit naar de moderators van een server. Daarom krijg je het vakje daarbij niet te zien.

Wat je meldt, wordt gekopieerd op het moment dat je het verstuurt: het bericht, de bestanden die erbij zitten en, in een serverkanaal, wat er vlak ervoor en erna is gezegd. Als het bericht daarna wordt verwijderd, blijft de kopie bestaan.

> Heads up: Kom je seksuele foto's of video's van een kind tegen, sla ze dan niet op, maak er geen screenshot van en stuur ze niet door, ook niet als bewijs. Meld het bericht en laat het staan. Je melding bewaart wat nodig is.

> Note: Is iemand nu in gevaar, bel dan eerst het lokale alarmnummer en dien daarna een melding in.

Je kunt maximaal 10 meldingen per uur versturen. Voor de redenen die als eerste worden bekeken, geldt een eigen, ruimere limiet.
