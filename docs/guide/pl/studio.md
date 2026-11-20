---
title: Studio
section: Tworzenie muzyki
summary: Nagrywajcie, aranżujcie i miksujcie utwory razem na kanale Studio nagrań, na żywo albo we własnym tempie.
source: 13ae054b4cd0
---

Kanał **Studio nagrań** to muzyczna przestrzeń robocza na twoim serwerze. Każdy **projekt** to utwór z własnym edytorem wielościeżkowym, ujęciami, komentarzami, wersjami i czatem. Członkowie zespołu mogą nagrywać razem na żywo albo dogrywać partie, kiedy mają czas.

![Projekt otwarty w studiu](shot:studio)

## Zaczynanie projektu

Otwórz kanał Studio nagrań i kliknij **Nowy projekt**. Nadaj mu nazwę i tempo. Potrzebujesz uprawnienia **Tworzenie projektów**.

Zacząłeś już utwór gdzie indziej? **Importuj** otwiera pliki `.dawproject` z Bitwig, Studio One, Cubase i innych programów, a także własne pliki Parley `.parley-project`.

## Nagrywanie

1. Skonfiguruj dźwięk w panelu **Dźwięk**: wyjście i **Opóźnienie nagrywania**. Kliknij **Zmierz**, żeby twoje ujęcia trafiały w rytm.
2. Dodaj ścieżkę: **audio** dla mikrofonu lub instrumentu albo **MIDI** z wbudowanym syntezatorem, zestawem perkusyjnym lub samplerem.
3. Uzbrój ścieżkę i naciśnij nagrywanie. **Nagrywaj zespół** nagrywa wszystkich w sesji od kursora odtwarzania; **Nagrywaj sam** nagrywa tylko ciebie. Ujęcie może trwać do 30 minut.

Nie masz klawiatury MIDI? Graj nuty klawiszami komputera: od <kbd>A</kbd> do <kbd>K</kbd> to białe klawisze, a <kbd>Z</kbd> i <kbd>X</kbd> zmieniają oktawę.

## Aranżowanie i edycja

| Klawisze | Działanie |
|---|---|
| <kbd>Space</kbd> | Odtwórz lub zatrzymaj |
| <kbd>Home</kbd> | Wróć na początek |
| <kbd>L</kbd> | Włącz lub wyłącz pętlę |
| <kbd>S</kbd> | Podziel klip w miejscu kursora odtwarzania |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Duplikuj |
| <kbd>Q</kbd> | Kwantyzuj (przyciągnij nuty do siatki) |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Cofnij / ponów |
| <kbd>Tab</kbd> | Przełącz między aranżacją a mikserem |

Kliknij dwukrotnie klip MIDI, aby otworzyć **piano roll**. Są też metronom i odliczanie, znaczniki, zmiany tempa oraz ścieżki automatyki głośności i efektów.

W **mikserze** każda ścieżka ma głośność, panoramę, solo, wyciszenie, efekty i wysyłki.

## Efekty

Każda ścieżka, szyna i master mają rack efektów: EQ, filtr, kompresor, bramkę, limiter, pogłos, opóźnienie, przester i chorus. Kliknij **+ Efekt**, aby dodać efekt. Efekty działają od góry do dołu; najedź na efekt, aby go przesunąć lub usunąć.

![Okna efektów EQ i kompresora gitary oraz filtra basu, otwarte obok siebie podczas odtwarzania utworu](shot:studio-effects)

Kliknij efekt, aby otworzyć jego okno. Możesz otworzyć dowolnie wiele okien i przeciągać je w dowolne miejsce; kliknij okno, aby przenieść je na wierzch. Każde okno pokazuje, co robi efekt:

- **EQ** i **filtr**: krzywa częstotliwości na tle widma dźwięku. Przeciągaj kropki na krzywej, aby ją kształtować. W filtrze przeciągnij w górę lub w dół, aby zwiększyć lub zmniejszyć rezonans, albo użyj kółka myszy.
- **Compressor**, **Gate** i **Limiter**: jak głośny dźwięk wchodzi w porównaniu z tym, jak głośny wychodzi, kropka pokazująca, gdzie jest teraz twój dźwięk, poziom z ostatnich kilku sekund i to, jak mocno dźwięk jest ściszany.
- **Reverb**: kształt wybrzmienia. **Opóźnienie**: każde zanikające echo. **Przester**: krzywa zniekształcenia, z dźwiękiem przed i po. **Chorus**: modulacja.

Podczas odtwarzania utworu widoki i mierniki **Wej.** i **Wyj.** poruszają się razem z dźwiękiem.

Aby zmienić ustawienie:

- Przeciągnij pokrętło w górę lub w dół. Przytrzymaj <kbd>Shift</kbd>, aby regulować precyzyjnie.
- Użyj kółka myszy lub strzałek.
- Wpisz wartość pod pokrętłem, np. `2.5k` albo `25%`.
- Kliknij pokrętło dwukrotnie, aby przywrócić wartość domyślną.

Przycisk zasilania na pasku tytułu okna wyłącza i włącza efekt. Strzałka resetuje wszystkie jego ustawienia.

> Tip: Otwórz ten sam efekt na dwóch ścieżkach obok siebie, np. EQ gitary i filtr basu, i odtwórz utwór. Zobaczysz, gdzie każda z nich się mieści, i zrobisz miejsce dla drugiej.

### Przykłady

Te przykłady zaczynają od domyślnych ustawień efektu. Odtwarzaj utwór podczas pracy, najlepiej z włączoną **Pętlą**, żeby okna pokazywały twój dźwięk.

**Oczyść doły gitary lub wokalu.** Dodaj **EQ**. Przeciągaj kropkę **C** na krzywej w prawo, aż **Obcięcie niskich** pokaże około `90 Hz`; dudnienie poniżej zniknie, a widmo za krzywą pokaże, co usunąłeś. Przeciągnij kropkę **M** do około `2.5k` i podnieś o kilka dB, aby wysunąć partię do przodu.

**Wyrównaj wokal.** Dodaj **Compressor**. Ustaw **Stosunek** na `4:1`, a potem obniżaj **Próg**, obserwując kropkę na krzywej: gdy głośne słowa przekraczają zagięcie, miernik **GR** pokazuje, o ile są ściszane. Celuj w około 3–6 dB na najgłośniejszych słowach, a potem podnieś **Wyrównanie** mniej więcej o tyle samo, żeby partia była tak głośna jak wcześniej.

**Przemiataj filtrem.** Dodaj **Filter** do ścieżki syntezatora lub perkusji i wybierz **Dolnoprzepustowy**. Podczas odtwarzania powoli przeciągaj kropkę na krzywej od prawej do lewej: dźwięk ciemnieje, gdy częstotliwość odcięcia spada. Przeciągnij kropkę w górę lub w dół albo przewiń nad nią kółkiem myszy, aby zmienić **Rezonans**: więcej daje ostrzejszy, dzwoniący szczyt przy częstotliwości odcięcia. Aby przemiatanie stało się częścią utworu, nagraj je na [ścieżce automatyki](#arranging-and-editing).

**Usuń syk zaszumionej ścieżki między nutami.** Dodaj **Gate** na początku racka. Obserwuj lampkę: pokazuje **OPEN**, gdy partia gra, i **CLOSED** w przerwach. Podnoś **Próg**, aż bramka zamyka się w przerwach, ale zostaje otwarta na najcichszych nutach, które chcesz zachować.

**Umieść partię w pomieszczeniu.** Dodaj **Reverb** i ustaw **Miks** na około `20%`. Dłuższe **Zanikanie** daje większą przestrzeń; niższa **Barwa** przyciemnia wybrzmienie, więc siedzi za suchym dźwiękiem.

**Łap szczyty całego miksu.** Dodaj **Limiter** do ścieżki **Master** i zostaw **Pułap** na `-1 dB`. Okno pokazuje, jak często najgłośniejsze momenty są przytrzymywane; jeśli limiter pracuje cały czas, ścisz raczej ścieżki.

## Praca w zespole

- **Zespół**: każdy jest **Inżynier** (może zmieniać wszystko) albo **Wykonawca** (nagrywa własne partie). **Chroń tę ścieżkę** nie pozwala innym edytować twojej partii.
- **Sesje**: inżynier klika **Rozpocznij sesję**, aby pracować razem na żywo. Każdy słyszy, co gra ktokolwiek.
- **Ujęcia**: każde nagranie jest zachowywane. Wybierz najlepsze przyciskiem **Użyj ujęcia**.
- **Komentarze**: zostawiaj notatki w danym miejscu utworu, np. „perkusja tu się ciągnie”, i oznaczaj je jako **Rozwiąż**, gdy sprawa jest załatwiona.
- **Wersje**: **Zapisz wersję** przed dużymi zmianami i **Przywróć**, jeśli nie podoba ci się kierunek.

Słuchacze spoza zespołu mogą odtwarzać utwór, śledzić pracę i komentować.

Straciłeś połączenie? Pracuj dalej. Zmiany są zapisywane i wysyłane, gdy wrócisz do sieci.

## Praca w innym miejscu

Projekt dalej gra, a ujęcie dalej się nagrywa, gdy przejdziesz na czat lub inny kanał. W tym czasie karta nad twoją nazwą w lewym dolnym rogu pokazuje projekt, to, czy jest odtwarzany (**Gra**) czy nagrywany (**Nagrywanie**), oraz czas. Karta jest widoczna także wtedy, gdy jesteś w pokoju głosowym projektu. Jego wiersz na liście kanałów pokazuje ruchome słupki podczas odtwarzania i czerwoną kropkę podczas nagrywania.

- Kliknij nazwę projektu na karcie, aby do niego wrócić.
- Zatrzymuj i odtwarzaj z karty. Odtwarzanie wznawia się od miejsca zatrzymania.
- Zatrzymaj ujęcie z karty, jeśli mógłbyś je zatrzymać w projekcie.
- Skończyłeś? Zatrzymaj, a potem kliknij **✕**, aby zamknąć kartę.

## Udostępnianie wyniku

Panel **Eksportuj** pozwala:

- wyeksportować miks do WAV, FLAC lub MP3
- wyeksportować **stemy** (każdą ścieżkę osobno, w archiwum ZIP)
- opublikować miks na kanale (**Opublikuj miks na kanale**), aby wszyscy mogli go posłuchać
- zapisać projekt jako `.dawproject`, aby otworzyć go w innym programie muzycznym
