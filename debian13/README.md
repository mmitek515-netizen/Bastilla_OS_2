# Debian 13 — niezależny interfejs

Interfejs w [`ui/`](ui/) łączy się z wersjonowanym API Debian 13 v1, bez
korzystania z API starszej aplikacji Bastilla OS 2. Używa kontraktu backendu
z PR #97, commit
[`664b7b6`](https://github.com/mmitek515-netizen/Bastilla_OS_2/commit/664b7b621c85b5e1a745a28c6845b67a33fc2e2c);
ten etap nie kopiuje ani nie zmienia jego plików backendu.

## Uruchomienie

Uruchom zgodny backend API na `127.0.0.1:8765` (źródło z powyższego commita
udostępnia `python3 debian13/server.py`), a następnie z katalogu repozytorium:

```sh
npm run dev:debian13-ui
```

Otwórz `http://127.0.0.1:4174`. UI i serwer pośredniczący wiążą się wyłącznie z
loopbackiem. Serwer pośredniczy wyłącznie w jawnie dozwolonych trasach UI i nie zastępuje
ani nie implementuje API. Dla wdrożenia UI i API muszą być na tym samym originie
albo za zaufanym reverse proxy przekazującym te ścieżki.

UI pobiera status, profile, zadania i zdarzenia z `GET /api/v1/status`,
`/agents`, `/tasks` i `/events`. Work pokazuje rzeczywiste, ograniczone zdarzenia
cyklu życia zadań zwracane przez `/events`; ręczne odświeżenie nie jest strumieniem
na żywo, a zdarzenia są pamięcią procesu, nie dziennikiem systemowym. Czat wysyła
`POST /api/v1/chat/stream` z `{message, agent}` oraz
opcjonalnym `session_id`; zdarzenia SSE `meta`, `delta`, `done` i `error` są
przekazywane bez buforowania. Historię bieżącej sesji pobiera
`GET /api/v1/sessions/{uuid}/messages`. Terminal używa
`POST /api/v1/terminal` z `{command}`.

Panel boczny ma nawigację Czat/Work/Terminal/Ustawienia, historię sesji i
zwijany tryb desktopowy; na telefonie otwiera się jako dostępne klawiaturą
menu. Historia w API jest przechowywana w pamięci backendu i wygasa, a
przeglądarka przechowuje tylko identyfikatory i tytuły znanych sesji. Work
pokazuje rzeczywiste zadania z `/tasks`, ale nie uruchamia planów ani kroków:
kontrakt v1 nie ma API do wieloetapowego Work. Czat wybiera jeden profil;
grupowe „Wszyscy” jest wyłączone, ponieważ kontrakt nie obsługuje broadcastu.
Profile agentów nie oznaczają aktywnych workerów. UI pokazuje błędy API i nie
zastępuje braku modelu odpowiedzią pozorną.

## Testy

```sh
npm run test:debian13-ui
```

Testy HTTP używają jawnie oznaczonego lokalnego test-double i sprawdzają
przekazywanie SSE bez buforowania, historię, zdarzenia zadań, dozwolone `pwd`,
odrzucone `id`, limit body oraz HTTP 503 bez modelu. Test-double nie jest dowodem aktywnego
modelu ani workera.

Rzeczywisty przegląd UI wykonano w Chromium 156.0.8078.0 z przypiętym backendem
`664b7b6`, bez skonfigurowanego modelu. Poziomy overflow nie wystąpił, a
composer pozostał przy dolnej krawędzi widoku przy wszystkich wymiarach:

- [320 × 900](ui/previews/debian13-chat-ui-320.png)
- [360 × 900](ui/previews/debian13-chat-ui-360.png)
- [412 × 900](ui/previews/debian13-chat-ui-412.png)
- [1440 × 1000](ui/previews/debian13-chat-ui-1440.png)

Przetestowano widoczny lokalny `/help`, błąd strumienia bez modelu, odtwarzanie
historii, `pwd`, odrzucenie `id`, widoki Work/Ustawienia, otwieranie panelu
bocznego na telefonie, Escape i zwijanie panelu na desktopie. Screenshoty pokazują
rzeczywisty interfejs i lokalną odpowiedź `/help`, nie inferencję modelu.

## Niewykonane

- Nie przygotowano ISO, VM ani bootu Debian 13; nie uruchomiono MCP ani AI Studio.
- Cztery role to profile; backend v1 jawnie raportuje workery jako
  `not_running`. Nie uruchomiono czterech procesów agentów.
- Nie uruchomiono płatnych usług ani nie dokonano zakupów. Każdy wydatek wymaga
  osobnej uprzedniej akceptacji.
