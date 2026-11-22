---
title: Moderacja i bezpieczeństwo
section: Prowadzenie serwera
summary: Dbaj o przyjazną atmosferę dzięki AutoModowi, przerwom, banom, zgłoszeniom, ochronie przed najazdami i dziennikowi zdarzeń.
source: cef706ea7d87
---

## Radzenie sobie z kimś

Kliknij osobę prawym przyciskiem (lub przytrzymaj palec na telefonie), aby zobaczyć te opcje:

| Opcja | Co się dzieje |
|---|---|
| **Wycisz czasowo** | Osoba może czytać, ale nie może pisać, reagować ani wchodzić na kanały głosowe przez czas od 60 sekund do tygodnia. **Zakończ przerwę** kończy ją wcześniej. |
| **Wyrzuć** | Usuwa osobę. Może wrócić z nowym zaproszeniem. |
| **Zbanuj** | Usuwa osobę i nie pozwala jej wrócić. Możesz też usunąć jej wiadomości z ostatnich kilku dni, maksymalnie 7. |
| **Widok moderatora** | Historia osoby na twoim serwerze: ostrzeżenia, przerwy i notatki. Możesz ją ostrzec (**Ostrzeż**) albo nałożyć na nią kwarantannę (**Kwarantanna**), gdy coś sprawdzasz. |

Zawsze podawaj powód. Zostaje w dzienniku zdarzeń, więc reszta zespołu wie, co się stało.

Bany zdejmiesz w **Ustawienia serwera → Bany**. Zbanowani członkowie mogą się odwołać, jeśli serwer na to pozwala. Odwołania czekają tam, aż je przyjmiesz lub odrzucisz.

Aby posprzątać zalew spamu, wpisz `/purge 50`, aby usunąć ostatnie 50 wiadomości, albo `/purge 50 @someone`, aby usunąć tylko wiadomości tej osoby (do 100 naraz).

## AutoMod

**Ustawienia serwera → AutoMod** wyłapuje problemy automatycznie, nawet gdy nie ma żadnego moderatora. Reguły mogą:

- **Blokuj słowa**: lista słów lub fraz. Użyj `*` jako symbolu wieloznacznego.
- **Blokuj spam wzmiankami**: wiadomości, które pingują zbyt wiele osób naraz.
- **Blokuj linki**: linki do wszystkich stron poza dozwolonymi.
- **Filtruj pseudonimy**, które łamią twoje zasady.

Dla każdej reguły wybierz, co się dzieje:

- zablokowanie wiadomości, opcjonalnie z własnym komunikatem do nadawcy
- wysłanie alertu na kanał moderatorów
- wysłanie osoby na przerwę

Możesz też wyłączyć z reguł wybrane role lub kanały, np. kanał, na którym moderatorzy omawiają zakazane słowa. Osoby, które mogą zarządzać serwerem, nigdy nie są filtrowane.

## Konfiguracja bezpieczeństwa

**Ustawienia serwera → Konfiguracja bezpieczeństwa** zawiera główne przełączniki:

- **Poziom weryfikacji**: czego potrzebuje nowa osoba, zanim będzie mogła pisać. **Niski** wymaga potwierdzonego e-maila. **Średni** wymaga też konta Parley starszego niż 5 minut. **Wysoki** wymaga też 10 minut na twoim serwerze. Członkowie z dowolną rolą są z tego zwolnieni.
- **Ochrona przed najazdami**: zauważa nagły napływ nowych kont i ostrzega moderatorów.
- **Wstrzymaj zaproszenia** i **Wstrzymaj wiadomości prywatne między członkami**: hamulce awaryjne na czas najazdu.
- **Serwer tylko dla dorosłych**: zaznacz **Wszystko na tym serwerze jest 18+**, a czytać i brać udział w rozmowach gdziekolwiek na serwerze będą mogli tylko członkowie z potwierdzonym ukończeniem 18 lat. Aby ograniczyć tylko niektóre miejsca, użyj zamiast tego opcji **Kanał z ograniczeniem wiekowym** na kanale lub kategorii. Zobacz [Kanały i kategorie](server-settings#channels-and-categories).
- **Filtr obrazów dla dorosłych**: skanuje obrazy publikowane na serwerze. Sprawdza je aplikacja każdego członka, a także instancja, jeśli jej administratorzy to skonfigurowali.
- **Uwierzytelnianie dwuskładnikowe dla moderatorów**: moderatorzy muszą mieć włączone 2FA lub dodany klucz dostępu, żeby skradzione hasło nie mogło zostać użyte przeciw serwerowi. Liczy się jedno albo drugie, a żeby to włączyć, sam musisz mieć jedno z nich.
- **Podsumowania AI**: włącz lub wyłącz przycisk Podsumowania.

## Zgłoszenia

Gdy członkowie użyją opcji **Zgłoś wiadomość** lub **Zgłoś użytkownika** i zaznaczą pole, by powiadomić też moderatorów tego serwera, zgłoszenie trafia do **Ustawienia serwera → Zgłoszenia**. **Przejdź**, aby zobaczyć je w kontekście, a potem **Rozwiąż** lub **Odrzuć**.

Zgłoszenia dotyczące bezpieczeństwa dziecka albo intymnych zdjęć udostępnionych bez zgody nigdy się tu nie pojawiają. Trafiają wyłącznie do zespołu, który prowadzi twój serwer Parley.

## Dziennik zdarzeń

**Dziennik zdarzeń** zapisuje, kto co zmienił: role, kanały, bany, wyrzucenia, przerwy, usunięte wiadomości i ustawienia. Filtruj według osoby lub rodzaju działania. To pierwsze miejsce, do którego warto zajrzeć, gdy coś się zmienia i nikt nie wie dlaczego.

## Zgłaszanie do Parley

Niektóre sprawy wykraczają poza jeden serwer, np. groźby, nielegalne treści albo spam na wielu serwerach. Każde zgłoszenie trafia do administratorów, którzy prowadzą twój serwer Parley. Zaznaczenie pola wysyła je też moderatorom danego serwera.

Aby coś zgłosić, kliknij wiadomość prawym przyciskiem i wybierz **Zgłoś wiadomość** albo kliknij osobę prawym przyciskiem i wybierz **Zgłoś użytkownika**. Wybierz, co jest nie tak, dodaj wszystko, co może pomóc, i wybierz **Wyślij zgłoszenie**.

Niektóre powody są rozpatrywane w pierwszej kolejności: **Groźba przemocy**, **Ktoś może zrobić sobie krzywdę**, **Intymne zdjęcia udostępnione bez zgody** oraz większość opcji w grupie **Dziecko jest zagrożone**. Zgłoszenia dotyczące bezpieczeństwa dziecka albo intymnych zdjęć trafiają wyłącznie do zespołu, który prowadzi twój serwer Parley, nigdy do moderatorów serwera, dlatego pole się przy nich nie pojawia.

To, co zgłaszasz, jest kopiowane w chwili wysłania: wiadomość, dołączone do niej pliki, a na kanale serwera także to, co napisano tuż przed nią i tuż po niej. Późniejsze usunięcie wiadomości nie usuwa kopii.

> Heads up: Jeśli natkniesz się na zdjęcia lub filmy o charakterze seksualnym przedstawiające dziecko, nie zapisuj ich, nie rób zrzutów ekranu i nie przesyłaj ich dalej, nawet jako dowodu. Zgłoś wiadomość i zostaw ją tam, gdzie jest. Twoje zgłoszenie zachowa to, co potrzebne.

> Note: Jeśli komuś w tej chwili grozi niebezpieczeństwo, najpierw zadzwoń pod lokalny numer alarmowy, a dopiero potem wyślij zgłoszenie.

Możesz wysłać do 10 zgłoszeń na godzinę. Powody rozpatrywane w pierwszej kolejności mają własny, większy limit.
