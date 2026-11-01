# Audyt mobilnego UI Bastilla OS 2

Audyt issue #12: nawigacja, czat, terminal, klawiatura, focus i oznaczenie wersji.

## Rozróżnienie wersji i wyglądu

- Odziedziczony pulpit używa ciemnego granatowego tła, siatki cybernetycznej oraz
  cyjanowych i szmaragdowych akcentów. Zawiera nawigację modułów, czat i terminal.
- Dedykowany widok Bastilla OS 2 ma jasne tło ivory, złote akcenty i oznaczenie
  „Ivory & Gold Sentinel”; zawiera rejestr zadań i karty statusu. Wersja produktu
  `v2.0.0` jest widoczna przy nazwie systemu oraz w karcie aplikacji.
- Wersja jądra jest osobna: nagłówek opisuje ją jako `SVL v…`, a nie jako wydanie
  Bastilla OS 2.
- Repozytorium nie zawiera weryfikowalnego zrzutu ani źródła UI Bastilla OS 1.
  Dlatego porównanie opisuje faktyczny odziedziczony pulpit i dedykowany widok
  OS 2, bez przypisywania historycznego wyglądu nieobecnemu ekranowi OS 1.

## Zmiany i dostępność

- Czat i terminal wypełniają przestrzeń pozostałą po nagłówku i nawigacji zamiast
  wymuszać wysokość `75dvh`; klasa `.app-main` aktywuje istniejące reguły
  zawijania i ograniczenia szerokości treści.
- Na krótkich ekranach nagłówek i pasek kanału czatu przewijają się poziomo;
  kontrolki czatu pozostają dostępne przy otwartej klawiaturze.
- Pozycje głównej nawigacji mobilnej nie powtarzają się w menu „Więcej”.
- Pole terminala ma jawną nazwę dostępną, a historia czatu i wyjście terminala
  są regionami logów ogłaszającymi nowe wpisy.
- Na telefonach pola tekstowe zachowują 16 px, a focus klawiaturowy ma widoczny
  obrys 2 px. Preferencja ograniczonego ruchu pozostaje obsługiwana.

## Scenariusze i wyniki

| Widok / viewport | Sprawdzenie | Wynik |
| --- | --- | --- |
| Terminal, 320×568 | Polecenie, przewijanie wyjścia i dolna nawigacja | Po zmianie nawigacja kończy się przy 568 px; pole wejściowe mieści się w panelu. Przed zmianą `75dvh` wypychało nawigację poza viewport. |
| Czat, 320×568 | Historia, composer i nawigacja | Composer i dolna nawigacja mieszczą się w viewport; strona nie ma poziomego overflow. |
| Czat, 320×400 | Widok o wysokości zmniejszonej jak przy klawiaturze | Symulowany composer kończy się przy 333 px, przed nawigacją zaczynającą się przy 334 px. To zmiana rozmiaru viewportu, nie rzeczywisty test IME. |
| Czat, 375×667 | Focus, tekst i composer | Tekstarea ma 16 px; po przejściu Shift+Tab/Tab focus jest widoczny (`:focus-visible`, obrys 2 px). Composer kończy się przed dolną nawigacją. |
| Czat, 1440×900 | Przestrzeń robocza desktop | Czat zajmuje szerokość 1200 px obok 240 px nawigacji; composer pozostaje w panelu. |
| Nawigacja, 320 px | Lista „Więcej” | „Integracje” występują raz, jako widoczna pozycja główna; wybór Bastilla OS 2 otwiera ten widok. |
| Terminal, 320 px | Klawiatura i obsługa polecenia | Dostępna nazwa pola to „Polecenie terminala”; wpisanie i zatwierdzenie `help` wyświetla wynik, a focus pozostaje w polu. |

### Zrzuty ekranu

Zrzuty `before-*` odtwarzają poprzednią regułę `min-height: 75dvh` w lokalnej
przeglądarce i służą wyłącznie porównaniu geometrii. Dane czatu i wyjście terminala
były puste przy zapisie.

| Przed | Po |
| --- | --- |
| [Terminal 320×568](mobile-ui-evidence/before-terminal-320x568.png) | [Terminal 320×568](mobile-ui-evidence/after-terminal-320x568.png) |
| [Czat 320×568](mobile-ui-evidence/before-chat-320x568.png) | [Czat 320×568](mobile-ui-evidence/after-chat-320x568.png) |

[Czat przy wysokości 320×400](mobile-ui-evidence/after-chat-short-320x400.png) ·
[Widok Bastilla OS 2, 375×667](mobile-ui-evidence/bastilla-os-2-375x667.png)

## Ograniczenia testu

UI uruchomiono lokalnie przez Vite na `127.0.0.1:4173`, bez backendu. Ostrzeżenia
pollingu API i rejestru zadań wynikają z odpowiedzi HTML Vite zamiast JSON; nie
potwierdzają działania serwera ani agentów. Test 320×400 symuluje zmniejszoną
wysokość viewportu, ale nie uruchamia natywnej klawiatury telefonu. W repozytorium
nie ma istniejącego harnessu testów UI; wyniki viewportów pochodzą z ręcznej
inspekcji przeglądarki i zrzutów ekranu.

## Kontrole projektu

- `npm test`: PASS, 92/92.
- `npm run lint`: PASS (`tsc --noEmit`).
- `npm run build`: PASS; Vite raportuje istniejący duży bundle JS (1855.56 kB).
- `npm run build:server`: PASS.
- `npm run verify`: PASS — test, lint, build web i build serwera.
- `npm ci`: PASS na Node 22.23.4; projekt zaleca Node 24, a Firebase emituje
  ostrzeżenia engine dla Node `>=24.12.0`. npm zgłosił 4 wysokie advisory w
  zależnościach; w tej zmianie nie aktualizowano zależności.
