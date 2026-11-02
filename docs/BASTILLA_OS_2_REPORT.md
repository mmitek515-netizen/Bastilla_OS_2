# Raport Bastilla OS 2 — 2026-11-01

## Kontynuacja interfejsu — 2026-11-02

PR #94 kontynuuje część UI misji #90; nie oznacza ukończenia całej misji. Zmiany
pozostają na tej samej gałęzi i nie modyfikują backendu ani kontraktów API.

### UI i dowody

- [x] Pulpit pokazuje statusy API, aplikacji, misji i profilu Gemini; stany
  oczekiwania i błędu nie udają dostępności usługi.
- [x] Podgląd produkcyjnego buildu sprawdzono w Chromium 156 przy szerokościach
  320, 360, 412 i 1440 px. Wszystkie widoki zawierały 4 karty statusu i 15
  skrótów; `scrollWidth` nie przekraczał `clientWidth`.
- [x] Czat: sprawdzono wybór Arii i wpisanie wiadomości, ale jej nie wysłano.
- [x] Terminal: lokalna komenda `help` wyświetliła pomoc; nie uruchamiano poleceń
  powłoki ani testów backendu.
- [x] Ustawienia: widok DATA_STORE oraz pola edytora zostały wyświetlone; nie
  zapisano zmian.
- [x] Zapisano zrzuty podglądu w
  [`previews/debian-13-dashboard/`](previews/debian-13-dashboard/):
  [pulpit 320 px](previews/debian-13-dashboard/dashboard-320.png),
  [360 px](previews/debian-13-dashboard/dashboard-360.png),
  [412 px](previews/debian-13-dashboard/dashboard-412.png),
  [desktop 1440 px](previews/debian-13-dashboard/dashboard-1440.png),
  [czat](previews/debian-13-dashboard/chat-412.png),
  [terminal](previews/debian-13-dashboard/terminal-412.png) i
  [ustawienia](previews/debian-13-dashboard/settings-412.png).
- Podgląd Vite był serwowany lokalnie na `127.0.0.1:4173`, bez backendu.
  Żądania API nie dostarczały danych, więc nie potwierdzono statusu działającego
  serwera ani odpowiedzi modelu. Wiadomości czatu celowo nie wysłano.

### Kontynuacja — kryteria nadal otwarte

- [ ] Integracja UI z działającym API i rzeczywistym dostawcą modelu; działanie
  czterech profili agentów, historię zadań i zatwierdzenia trzeba potwierdzić
  osobnymi testami integracyjnymi. Profile nie są dowodem działających agentów.
- [ ] Pełny audyt uwierzytelniania API oraz bezpieczne testy zapisu. PR #97
  proponuje oddzielne zmiany backendowe; nie są częścią tego PR.
- [ ] MCP: handshake zewnętrznego klienta i test bezpiecznego odczytu.
- [ ] Budowa i rzeczywisty rozruch Debian 13/QEMU (KVM oraz jawny fallback TCG).
- [ ] Eksport/synchronizacja i wdrożenie Google AI Studio.
- [ ] Pełny audyt dostępności, klawiatury/czytnika ekranu oraz E2E z działającym
  serwerem; wykonane tu próby są testami UI na statycznym podglądzie.
- [x] Nie dokonano zakupów, nie zamówiono konsultacji i nie uruchomiono płatnych
  usług. Każde takie działanie wymaga osobnej, uprzedniej pisemnej zgody
  właściciela na konkretny zakres i budżet.

### Wyniki tej kontynuacji

- `npm ci`: 317 pakietów z lockfile. Środowisko ma Node.js 22.23.4, podczas gdy
  dokumentacja wymaga Node 24; npm zgłosił wymaganie Node `>=24.12.0` dla Firebase
  i 4 podatności wysokiego poziomu w zależnościach.
- `npm run verify`: PASS — 92/92 testów oraz TypeScript, build UI i build serwera.
  Build UI zgłasza duży chunk (~1,861 kB przed gzip).
- GitHub Actions dla commita `b47740c`: przebiegi PR miały `action_required` i
  zero zadań; nie uruchomiły testów. Ten stan nie jest wynikiem pozytywnym CI.

## Wykonano

- Odtworzono 225 plików źródłowych z commit `2203ac94b1dbbad0f9e2a470c00a4b24bc9900ed`.
- Zachowano istniejące profile agentów i misję repozytorium docelowego.
- Dodano podział odpowiedzialności, kolejkę priorytetów i konwencje nazw.
- Ustawiono nazwę npm `bastilla-os-2`, zachowując kompatybilne ścieżki i identyfikatory.
- Dodano równoległe `npm run verify`; automatyczna synchronizacja używa tego samego zestawu kontroli.
- Dodano CI z cache npm i anulowaniem nieaktualnych przebiegów tej samej gałęzi.
- Usunięto zależność od globalnego `__dirname` w konfiguracji Vite.
- Zastąpiono odziedziczoną konfigurację Firebase ustawieniami własnego wdrożenia.
- Pominięto prywatne bazy danych, historyczny stan zadań, eksporty, środowiska i archiwa.

## Faktycznie sprawdzono lokalnie

- `npm ci --ignore-scripts --no-audit --no-fund`: 317 pakietów z lockfile.
- `npm test`: 90/90 testów przeszło.
- `npm run lint`: poprawny TypeScript.
- `npm run build`: poprawna kompilacja UI.
- `npm run build:server`: poprawna kompilacja backendu.
- `npm run verify`: wszystkie cztery kontrole przeszły równolegle.
- Serwer produkcyjny uruchomiony lokalnie na porcie 3099 na czas testu.
- `npm run check:api -- http://127.0.0.1:3099`: pięć punktów API przeszło kontrolę.
- Ollama: offline; nie potwierdzono działania modelu.

## Pozostałe ograniczenia

Profile Alex, Aria, Astyria i Aurelius istnieją; nie potwierdzono uruchomionych
zewnętrznych procesów tych agentów. Ten import i kontrole wykonał Codex.
Nie porównano niewysłanych zmian Codespace. Nie uruchamiano VM, budowania ISO
ani wdrożenia AI Studio; nie potwierdzono połączenia MCP z klientem ChatGPT.
Backend odziedziczył rozbudowane endpointy zapisu i wymaga audytu przed
publicznym udostępnieniem. Build zgłasza duży pakiet JS (~1.85 MB przed gzip);
podział ładowania UI jest kolejnym zadaniem optymalizacyjnym.
Raport nie określa procentu ukończenia całego systemu.
