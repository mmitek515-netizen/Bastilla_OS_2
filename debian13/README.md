# Nowy interfejs Debian 13

Pierwszy etap oddzielnego interfejsu dla nowego systemu Debian 13 znajduje się
w [`ui/`](ui/). Nie jest to rozwinięcie starego dashboardu BastillaOS i nie
potwierdza bootowania ani instalacji Debiana.

## Uruchomienie

Z katalogu głównego repozytorium:

```sh
npm run dev:debian13-ui
```

Serwer statyczny wiąże się wyłącznie z `127.0.0.1:4174`; otwórz
`http://127.0.0.1:4174`.

## Testy

```sh
npm run test:debian13-ui
```

Sprawdzono dodatkowo Chromium 156 przy 320×780, 360×800, 412×915 i 1440×900:
widok terminala, czatu oraz czterech profili był widoczny bez poziomego
przewijania. Formularze nie wysyłają ani nie wykonują poleceń, a test
przeglądarkowy nie wykrył żądań API.

## Granice obecnego etapu

- Brak uzgodnionego API/runtime dla nowego systemu. Nie podłączono istniejących
  endpointów Bastilla ani skryptów QEMU.
- Profile Aria, Astyria, Aurelius i Alex mają status `Niepodłączony`; nie
  potwierdzono żadnego aktywnego wykonawcy AI.
- Czat i terminal są interfejsem szkiców, bez inferencji, powłoki, historii ani
  trwałego przechowywania.
- Nie przygotowano ISO, VM ani bootu Debian 13; nie uruchomiono MCP ani AI Studio.
- Nie uruchomiono usług płatnych i nie dokonano zakupów. Wymagana jest osobna
  uprzednia akceptacja konkretnego wydatku.
