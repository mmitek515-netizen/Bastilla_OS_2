# Debian 13 — niezależny interfejs

Interfejs w [`ui/`](ui/) łączy się z wersjonowanym API Debian 13 v1, bez
korzystania z API starszej aplikacji Bastilla OS 2. Kontrakt backendu jest
zdefiniowany w PR #97, commit
[`7673119`](https://github.com/mmitek515-netizen/Bastilla_OS_2/commit/767311930dab4a36e53ff6bc2425a5e130b787fa);
ten etap nie kopiuje ani nie zmienia jego plików backendu.

## Uruchomienie

Uruchom zgodny backend API na `127.0.0.1:8765` (źródło z powyższego commita
udostępnia `python3 debian13/server.py`), a następnie z katalogu repozytorium:

```sh
npm run dev:debian13-ui
```

Otwórz `http://127.0.0.1:4174`. UI i serwer pośredniczący wiążą się wyłącznie z
loopbackiem. Serwer pośredniczy tylko w pięciu endpointach UI i nie zastępuje
ani nie implementuje API. Dla wdrożenia UI i API muszą być na tym samym originie
albo za zaufanym reverse proxy przekazującym te ścieżki.

UI pobiera `GET /api/v1/status`, `/agents` i `/tasks`, wysyła
`POST /api/v1/chat` z `{message, agent}` oraz `/terminal` z `{command}`.
Wyświetla rzeczywiste błędy API, rozróżnia status skonfigurowanego profilu od
statusu workera i nie zastępuje błędu 503 odpowiedzią pozorną.

## Testy

```sh
npm run test:debian13-ui
```

Testy HTTP używają jawnie oznaczonego lokalnego test-double i sprawdzają `/help`,
dozwolone `pwd`, odrzucone `id` oraz HTTP 503 bez modelu. Dodatkowo interfejs
sprawdzono z backendem pobranym tymczasowo z przypiętego commita PR #97:
`/help` i `pwd` zwróciły HTTP 200, `id` HTTP 400, a zwykła wiadomość HTTP 503
bez wygenerowanej odpowiedzi. Test nie konfigurował ani nie uruchamiał modelu.

Chromium 156: formularze czatu i terminala, status API i cztery profile działały
przy szerokościach 320, 360, 412 i 1440 px; `scrollWidth` równał się
`clientWidth` w każdym widoku.

## Niewykonane

- Nie przygotowano ISO, VM ani bootu Debian 13; nie uruchomiono MCP ani AI Studio.
- Cztery role to profile; backend v1 jawnie raportuje workery jako
  `not_running`. Nie uruchomiono czterech procesów agentów.
- Nie uruchomiono płatnych usług ani nie dokonano zakupów. Każdy wydatek wymaga
  osobnej uprzedniej akceptacji.
