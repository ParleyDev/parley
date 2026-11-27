---
title: Aplikacje, boty i asystenci AI
section: Prowadzenie serwera
summary: Dodawaj boty do serwera, korzystaj z ich poleceń i połącz asystenta AI ze swoim kontem.
source: 33c7e9205c14
---

**Aplikacje** dodają do Parley nowe funkcje. **Bot** to aplikacja, która dołącza do serwera jak członek: może witać ludzi, prowadzić gry, puszczać muzykę albo publikować aktualności.

## Znajdowanie aplikacji

Otwórz **Katalog aplikacji** z Odkrywania (**Przeglądaj Katalog aplikacji**) albo z **Ustawienia użytkownika → Autoryzowane aplikacje**. Szukaj albo przeglądaj według kategorii. Odznaka **Zweryfikowany** oznacza, że Parley sprawdziło, kto stworzył aplikację.

## Dodawanie bota do serwera

1. Kliknij **Dodaj do serwera** przy aplikacji albo otwórz link z zaproszeniem od jej twórcy.
2. Wybierz serwer, na którym masz uprawnienie **Zarządzanie serwerem**. Link przygotowany dla konkretnego serwera ma go już wybranego.
3. Sprawdź, o jakie uprawnienia prosi. Odznacz te, których nie potrzebuje.
4. Kliknij **Autoryzuj**.

Potem kliknij **Przejdź do serwera**. Jeśli zaczynasz na stronie aplikacji, Parley odeśle cię z powrotem tam.

Bot dostaje własną rolę. Jego uprawnienia zmienisz w **Ustawienia serwera → Role**. Aby usunąć bota, użyj **Ustawienia serwera → Integracje** albo wyrzuć go jak każdego członka.

## Aplikacje tylko dla ciebie

Niektóre aplikacje można dodać do własnego konta przyciskiem **Dodaj do Moich aplikacji**. Wtedy możesz ich używać wszędzie: na każdym serwerze i w każdej wiadomości prywatnej. Pojawiają się też w sekcji **Aplikacje**, gdy klikniesz prawym przyciskiem wiadomość lub osobę.

## Używanie poleceń

Wpisz `/` na początku pola wiadomości. Najpierw są polecenia samego Parley, a potem polecenia wszystkich aplikacji, których możesz tam używać. Wybierz jedno, uzupełnij opcje i naciśnij <kbd>Enter</kbd>. Niektóre aplikacje otwierają formularz albo odpowiadają tylko tobie.

## Asystenci AI

Możesz pozwolić asystentowi AI, np. Claude, ChatGPT lub Cursor, czytać i wysyłać wiadomości w twoim imieniu. Pytaj go o rzeczy w stylu „co mnie ominęło?” albo „odpisz Samowi, że się spóźnię”.

1. Otwórz **Ustawienia użytkownika → Autoryzowane aplikacje** i skopiuj adres w sekcji **Asystenci AI (MCP)**.
2. W asystencie dodaj go jako własny łącznik (może się nazywać *zdalny serwer MCP*).
3. Parley otworzy stronę z pytaniem, co asystent może robić: **Przeczytane**, **Powiadomienia**, **Wysyłanie wiadomości** lub **Zarządzaj serwerami**. Wybierz tylko to, czego potrzebujesz, i zatwierdź.

> Heads up: Wszystko, co wyśle asystent, pojawia się pod twoją nazwą. Z uprawnieniem **Zarządzaj serwerami** mógłby usuwać wiadomości albo ludzi, więc pozwalaj na to tylko wtedy, gdy naprawdę tego chcesz.

Aby go odłączyć, kliknij **Rozłącz** obok asystenta w **Autoryzowane aplikacje**.

## Narzędzia dla administratorów

Niektóre narzędzia działające na twojej instancji, np. Profile Studio do tworzenia kosmetyków profilu, logują się w ten sam sposób. Gdy zalogujesz się z narzędzia, Parley otworzy stronę z prośbą o zgodę na **Zarządzaj kosmetykami**: dodawanie kosmetyków do instancji i zmienianie istniejących. Działa to tylko wtedy, gdy twoje konto może zarządzać instancją, a narzędzie nigdy nie widzi twojego hasła.

> Heads up: Wszystko, co doda lub zmieni, od razu widzą wszyscy. Zezwalaj tylko narzędziom, którym ufasz.

Aby je odłączyć, kliknij **Rozłącz** obok narzędzia w **Autoryzowane aplikacje**.

## Tworzenie własnych

Chcesz zbudować bota? Utwórz aplikację w **Ustawienia użytkownika → Aplikacje** i przeczytaj [dokumentację dla deweloperów](https://app.runparley.com/developers).
