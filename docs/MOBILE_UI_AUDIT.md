# Audyt mobilnego UI Bastilla OS 2

## Rozróżnienie wersji

| Widok | Tożsamość i wygląd |
| --- | --- |
| Odziedziczony pulpit BastillaOS | Ciemny pulpit z nawigacją i akcentami cyan/emerald; zachowuje dotychczasowe moduły. |
| Bastilla OS 2 | Osobny widok „BASTILLA OS 2” w estetyce Ivory & Gold Sentinel, z rejestrem zadań i artefaktów. |

W repozytorium nie ma kompletnego, niezależnego UI Bastilla OS 1 ani jego zrzutów. Powyższe porównanie opisuje widok odziedziczony i nowy widok v2; nie jest bezpośrednim porównaniem dwóch wydań v1/v2. Wspólny nagłówek i tytuł karty identyfikują aplikację jako Bastilla OS 2. Odznaka `SVL v…` oznacza wersję jądra, a nie osobne wydanie UI.

## Scenariusze i wyniki

Kontrole wykonano 2026-11-01 w przeglądarce z lokalnym serwerem Vite na loopback. Backend nie był uruchomiony; odpowiedzi API/agentów nie były częścią testu.

| Widok / rozmiar | Scenariusz | Wynik |
| --- | --- | --- |
| Terminal, 320 × 700 | Sprawdzenie szerokości strony, wysokości widoku, nawigacji dolnej, przewijania logu i widoczności pola polecenia. | Brak poziomego ani dokumentowego przewijania. Główna część: 452 px; dolna nawigacja: 66 px. Log przewija się wewnętrznie (495 px treści / 340 px widocznego obszaru); pole polecenia pozostaje nad nawigacją. |
| Terminal, 320 × 700 | Skupienie pola, wpisanie `help`, Enter. | Etykieta pola jest dostępna; pole pozostaje aktywne, wynik pojawia się w obszarze logu. |
| Czat, 320 × 700 | Otwarcie `/?view=comms`, skupienie pola wiadomości. | Kompozytor wiadomości otrzymuje fokus; widoczne są przełączniki „Czat” i „Agenci”. Wysłanie wiadomości nie było testowane bez backendu. |
| Bastilla OS 2, 390 × 844 | Zmiana modułu z mobilnej listy „Więcej”. | Widok ładuje się bez poziomego przewijania; dokument mieści się w 390 × 844, dolna nawigacja ma 66 px. Moduł „Integracje” pozostaje dostępny z bezpośredniego przycisku i nie jest duplikowany w „Więcej”. |
| Bastilla OS 2, 1440 × 900 | Układ desktopowy. | Nawigacja boczna ma 240 px, treść 1200 px; dokument mieści się w oknie bez dodatkowego przewijania. |
| Klawiatura ekranowa / czytnik ekranu | Rzeczywiste urządzenie i technologia asystująca. | Nie testowano. Zmniejszenie viewportu w przeglądarce nie zastępuje testu natywnej klawiatury ani czytnika. |

### Dowody wizualne

Nie zapisano zrzutów przed/po w repozytorium: odziedziczona historia czatu i baner terminala zawierają dane operatora. Dołączenie ich bez anonimizacji naruszałoby zasady prywatności. Repozytorium nie zawiera również zrzutu Bastilla OS 1, więc nie da się rzetelnie przedstawić porównania obrazów v1/v2 bez dostarczenia bezpiecznych, zanonimizowanych materiałów.

## Zmiany w tym audycie

- Widoki czatu i terminala korzystają z pozostałej przestrzeni między nagłówkiem a nawigacją; usunięto wymuszone `75dvh`, które powodowało nadmiarową wysokość na telefonie.
- Aktywowano istniejące klasy mobilne kontenera, safe-area inset oraz minimalne cele dotykowe.
- Nagłówek i tytuł karty wskazują Bastilla OS 2; wersja jądra jest jawnie opisana jako SVL.
- Dodano dostępne nazwy dla polecenia i kontrolek terminala oraz semantykę logu.
