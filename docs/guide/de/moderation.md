---
title: Moderation und Sicherheit
section: Einen Server leiten
summary: Halte deinen Server freundlich mit AutoMod, Timeouts, Banns, Meldungen, Raid-Schutz und dem Audit-Log.
source: ede402610205
---

## Mit jemandem umgehen

Klicke mit der rechten Maustaste auf eine Person (oder halte sie auf dem Handy gedrückt), um diese Optionen zu bekommen:

| Option | Was passiert |
|---|---|
| **Timeout** | Die Person kann lesen, aber nicht posten, reagieren oder Sprachkanälen beitreten, für 60 Sekunden bis zu einer Woche. **Timeout aufheben** beendet ihn vorzeitig. |
| **Kicken** | Entfernt die Person. Mit einer neuen Einladung kann sie zurückkommen. |
| **Bannen** | Entfernt die Person und verhindert, dass sie zurückkommt. Du kannst auch ihre Nachrichten der letzten Tage löschen, bis zu 7. |
| **Moderatoransicht** | Ihr Verlauf auf deinem Server: Verwarnungen, Timeouts und Notizen. Du kannst sie **Verwarnen** oder in **Quarantäne** schicken, während du einer Sache nachgehst. |

Gib immer einen Grund an. Er wird im Audit-Log gespeichert, damit der Rest des Teams weiß, was passiert ist.

Banns hebst du unter **Servereinstellungen → Banns** auf. Gebannte Mitglieder können Einspruch einlegen, wenn der Server das erlaubt. Einsprüche warten dort darauf, dass du sie annimmst oder ablehnst.

Um eine Spamflut zu beseitigen, tippe `/purge 50`, um die letzten 50 Nachrichten zu löschen, oder `/purge 50 @someone`, um nur die einer Person zu löschen (bis zu 100 auf einmal).

## AutoMod

**Servereinstellungen → AutoMod** fängt Probleme automatisch ab, auch wenn gerade kein Moderator da ist. Regeln können:

- **Wörter blockieren**: eine Liste von Wörtern oder Ausdrücken. Nutze `*` als Platzhalter.
- **Erwähnungs-Spam blockieren**: Nachrichten, die zu viele Leute auf einmal anpingen.
- **Links blockieren**: Links zu allen Websites außer denen, die du erlaubst.
- **Nicknames filtern**, die gegen deine Regeln verstoßen.

Wähle für jede Regel, was passiert:

- die Nachricht blockieren, auf Wunsch mit einer eigenen Nachricht an den Absender
- eine Warnung in einen Moderatorenkanal schicken
- der Person einen Timeout geben

Du kannst auch Rollen oder Kanäle ausnehmen, etwa einen Kanal, in dem deine Moderatoren über verbotene Wörter sprechen. Leute, die den Server verwalten dürfen, werden nie gefiltert.

## Sicherheits-Setup

**Servereinstellungen → Sicherheits-Setup** hat die großen Schalter:

- **Verifizierungsstufe**: was ein Neuling braucht, bevor er posten darf. **Niedrig** verlangt eine bestätigte E-Mail-Adresse. **Mittel** verlangt zusätzlich ein Parley-Konto, das älter als 5 Minuten ist. **Hoch** verlangt zusätzlich 10 Minuten auf deinem Server. Mitglieder mit irgendeiner Rolle überspringen das.
- **Raid-Schutz**: bemerkt einen plötzlichen Ansturm neuer Konten und warnt deine Moderatoren.
- **Einladungen pausieren** und **DMs zwischen Mitgliedern pausieren**: Notbremsen während eines Raids.
- **Filter für explizite Bilder**: prüft Bilder, die auf dem Server gepostet werden.
- **Zwei-Faktor-Authentifizierung für Moderatoren**: Moderatoren müssen 2FA eingeschaltet oder einen Passkey hinzugefügt haben, damit ein gestohlenes Passwort nicht gegen den Server verwendet werden kann. Beides zählt, und du brauchst selbst eins davon, um das einzuschalten.
- **KI-Zusammenfassungen**: Schalte die Schaltfläche Zusammenfassungen ein oder aus.

## Meldungen

Wenn Mitglieder **Nachricht melden** oder **Benutzer melden** nutzen und das Häkchen setzen, um auch die Moderatoren dieses Servers zu informieren, landet die Meldung unter **Servereinstellungen → Meldungen**. Mit **Springen** siehst du sie im Zusammenhang, dann wählst du **Erledigen** oder **Schließen**.

## Das Audit-Log

Das **Audit-Log** hält fest, wer was geändert hat: Rollen, Kanäle, Banns, Kicks, Timeouts, gelöschte Nachrichten und Einstellungen. Filtere nach Person oder nach Art der Aktion. Hier schaust du zuerst nach, wenn sich etwas ändert und niemand weiß, warum.

## An Parley melden

Manches geht über einen einzelnen Server hinaus, etwa Drohungen, illegale Inhalte oder Spam auf vielen Servern. Jede Meldung geht an die Admins, die deinen Parley-Server betreiben. Mit dem Häkchen geht sie außerdem an die Moderatoren des jeweiligen Servers.
