---
title: Apps, Bots und KI-Assistenten
section: Einen Server leiten
summary: Füge deinem Server Bots hinzu, nutze ihre Befehle und verbinde einen KI-Assistenten mit deinem Konto.
source: a98657c6c333
---

**Apps** erweitern Parley um Funktionen. Ein **Bot** ist eine App, die einem Server wie ein Mitglied beitritt: Er kann Leute begrüßen, Spiele leiten, Musik abspielen oder Updates posten.

## Apps finden

Öffne das **App-Verzeichnis** über Entdecken (**Das App-Verzeichnis durchsuchen**) oder über **Benutzereinstellungen → Autorisierte Apps**. Suche oder stöbere nach Kategorie. Ein Abzeichen **Verifiziert** bedeutet, dass Parley geprüft hat, wer die App gemacht hat.

## Einen Bot zu deinem Server hinzufügen

1. Klicke bei der App auf **Zum Server hinzufügen** oder öffne den Einladungslink, den dir ihr Entwickler gibt.
2. Wähle einen Server, auf dem du die Berechtigung **Server verwalten** hast.
3. Prüf die Berechtigungen, die sie anfordert. Entferne den Haken bei allem, was sie nicht braucht.
4. Klicke auf **Autorisieren**.

Der Bot bekommt eine eigene Rolle. Seine Berechtigungen kannst du unter **Servereinstellungen → Rollen** ändern. Um einen Bot zu entfernen, nutze **Servereinstellungen → Integrationen** oder kicke ihn wie jedes andere Mitglied.

## Apps nur für dich

Manche Apps kannst du mit **Zu meinen Apps hinzufügen** deinem eigenen Konto hinzufügen. Dann kannst du sie überall nutzen: auf jedem Server und in jeder DM. Sie erscheinen auch unter **Apps**, wenn du mit der rechten Maustaste auf eine Nachricht oder eine Person klickst.

## Befehle verwenden

Tippe `/` am Anfang des Nachrichtenfelds. Zuerst kommen Parleys eigene Befehle, dann die Befehle aller Apps, die du dort nutzen kannst. Wähle einen, fülle seine Optionen aus und drück <kbd>Enter</kbd>. Manche Apps öffnen ein Formular oder antworten nur dir.

## KI-Assistenten

Du kannst einen KI-Assistenten wie Claude, ChatGPT oder Cursor für dich Nachrichten lesen und senden lassen. Frag ihn etwa „Was habe ich verpasst?“ oder „Antworte Sam, dass ich mich verspäte“.

1. Öffne **Benutzereinstellungen → Autorisierte Apps** und kopiere die Adresse unter **KI-Assistenten (MCP)**.
2. Füge sie in deinem Assistenten als eigenen Connector hinzu (er heißt dort vielleicht *Remote-MCP-Server*).
3. Parley öffnet eine Seite, auf der du festlegst, was der Assistent darf: **Lesen**, **Benachrichtigungen**, **Nachrichten senden** oder **Server verwalten**. Wähle nur, was du brauchst, und bestätige dann.

> Heads up: Alles, was der Assistent sendet, erscheint unter deinem Namen. Mit **Server verwalten** könnte er Nachrichten löschen oder Leute entfernen, also erlaube das nur, wenn du es wirklich willst.

Um ihn zu stoppen, klicke in **Autorisierte Apps** neben dem Assistenten auf **Trennen**.

## Werkzeuge für Admins

Manche Werkzeuge, die mit deiner Instanz arbeiten, etwa Profile Studio zum Erstellen von Profil-Kosmetik, melden sich auf dieselbe Weise an. Wenn du dich aus dem Werkzeug anmeldest, öffnet Parley eine Seite, auf der du ihm **Kosmetik verwalten** erlaubst: Kosmetik zur Instanz hinzufügen und bestehende ändern. Das funktioniert nur, wenn dein Konto die Instanz verwalten darf, und das Werkzeug sieht nie dein Passwort.

> Heads up: Alles, was es hinzufügt oder ändert, erscheint sofort für alle. Erlaube nur Werkzeuge, denen du vertraust.

Um es zu stoppen, klicke in **Autorisierte Apps** neben dem Werkzeug auf **Trennen**.

## Eigene Apps erstellen

Du willst einen Bot bauen? Erstelle eine App unter **Benutzereinstellungen → Anwendungen** und lies [die Entwicklerdoku](https://app.runparley.com/developers).
