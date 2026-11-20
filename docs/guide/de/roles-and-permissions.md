---
title: Rollen und Berechtigungen
section: Einen Server leiten
summary: Gib Leuten Rollen, leg fest, wer was darf, und mach Kanäle privat.
source: 1d7dad25cdb6
---

**Rollen** sind Bezeichnungen, die du Mitgliedern gibst, etwa *Moderator*, *Künstler* oder *Neu hier*. Jede Rolle hat **Berechtigungen**, die bestimmen, was ihre Mitglieder tun dürfen. Eine Rolle kann auch eine Farbe und ein Symbol haben, die neben den Namen erscheinen.

Alle auf dem Server haben automatisch die Rolle **@everyone**. Ihre Berechtigungen sind das, was alle dürfen.

![Die Seite Rollen in den Servereinstellungen](shot:roles)

## Eine Rolle erstellen

1. Öffne **Servereinstellungen → Rollen** und klicke auf **Rolle erstellen**.
2. Gib ihr einen Namen und eine Farbe. Optional kannst du:
   - ihr ein **Rollensymbol** geben (ein Emoji oder ein kleines Bild)
   - **Rollenmitglieder getrennt von Online-Mitgliedern anzeigen** in der Mitgliederliste
   - **Allen erlauben, diese Rolle zu @erwähnen**
   - **Mitglieder diese Rolle selbst wählen lassen**
3. Schalte die Berechtigungen ein, die sie haben soll.
4. Füge im Tab **Mitglieder** Leute hinzu, oder klicke in der Mitgliederliste mit der rechten Maustaste auf jemanden und wähle Rollen aus.

**Rolle duplizieren** kopiert eine Rolle, praktisch, um eine ähnliche zu erstellen.

## Welche Rolle gewinnt

Rollen werden in einer Reihenfolge aufgelistet, und weiter oben stehende Rollen sind höher als die darunter. Zieh sie oder nutze **Nach oben** und **Nach unten**.

- Leute können nur Rollen verwalten, die unter ihrer eigenen höchsten Rolle liegen.
- Wenn sich Rollen bei der Farbe widersprechen, gilt die Farbe der höchsten Rolle.

**Server als Rolle ansehen** zeigt dir genau, was ein Mitglied mit dieser Rolle sieht, damit du deine Einrichtung prüfen kannst.

## Berechtigungen

Berechtigungen sind gruppiert: Allgemein, Mitgliedschaft, Text, Sprache und Studio. Einige der wichtigsten:

| Berechtigung | Erlaubt Leuten … |
|---|---|
| **Administrator** | alles zu tun und jede Kanalbeschränkung zu umgehen. Sparsam vergeben. |
| **Server verwalten** | Name, Icon und Einstellungen des Servers zu ändern. |
| **Rollen verwalten** | Rollen unter ihrer eigenen zu erstellen und zuzuweisen. |
| **Kanäle verwalten** | Kanäle zu erstellen, zu bearbeiten und zu löschen. |
| **Mitglieder kicken / Mitglieder bannen / Timeout für Mitglieder** | Leute zu moderieren. Siehe [Moderation](moderation). |
| **Nachrichten verwalten** | die Nachrichten aller zu löschen und anzuheften. |
| **@everyone erwähnen** | den ganzen Server anzupingen. |
| **Einladung erstellen** | neue Leute einzuladen. |
| **Ausdrücke verwalten** | Emojis, Sticker und Sounds hinzuzufügen. |
| **Events verwalten** | Veranstaltungen zu planen. |
| **Audit-Log anzeigen** | zu sehen, wer was geändert hat. |

> Tip: Fang damit an, dass **@everyone** lesen und chatten darf. Füge dann eine Rolle *Moderator* mit Kicken, Timeout und Nachrichten verwalten hinzu. Administrator brauchen nur wenige.

## Kanalberechtigungen

Um einen Kanal privat zu machen oder zu ändern, was Leute in einem Kanal dürfen:

1. Klicke mit der rechten Maustaste auf den Kanal, wähle **Kanal bearbeiten** und dann **Berechtigungen**.
2. Schalte **Privater Kanal** ein, um ihn vor allen außer den Rollen und Personen zu verbergen, die du hinzufügst.
3. Oder nutze **Rolle oder Mitglied hinzufügen** und setze jede Berechtigung auf **Erlauben** (✓), **Ablehnen** (✗) oder **Erben** (/, die serverweite Einstellung).

Auch Kategorien haben Berechtigungen. Ein Kanal, der seiner Kategorie entspricht, zeigt **Berechtigungen mit Kategorie synchronisiert**; **Jetzt synchronisieren** gleicht ihn wieder an, nachdem du ihn geändert hast.

## Die Mitgliederliste

**Servereinstellungen → Mitglieder** listet alle. Suche, filtere nach Rolle, sieh, wie jede Person beigetreten ist, und vergib oder entziehe Rollen. Du kannst auch mehrere Leute auf einmal auswählen, um sie zu kicken oder zu bannen.

## Verknüpfte Rollen

Eine verknüpfte Rolle wird automatisch an Leute vergeben, die ein Konto verknüpft haben, zum Beispiel Twitch-Abonnenten. Richte sie unter **Integrationen** ein.
