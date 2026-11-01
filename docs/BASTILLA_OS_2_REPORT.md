# Raport Bastilla OS 2 — 2026-11-01

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

## MCP — wykonanie i ograniczenia

- Oddzielny serwer `integrations/mcp/server.py` pozostaje kanonicznym transportem Streamable HTTP i nasłuchuje wyłącznie na loopback. `healthcheck.py` sprawdza SDK initialize, ping i tools/list; `smoke_test.py` sprawdza bezpieczne diagnostyczne wywołania. Wyniki narzędzi nie są wypisywane do logu smoke testu.
- Starsze endpointy Express `/api/mcp` i `/mcp` wymagają osobnego sekretu `BASTILLA_MCP_TOKEN` (co najmniej 32 znaki), są ograniczone standardowym middleware rate-limit i udostępniają tylko `kernel_status`. Dawny URL `/api/mcp/openapi.json` przekierowuje do chronionego Bearerem schematu GPT Actions REST; nie jest to endpoint MCP.
- Widok Integracje rozdziela konfigurację publicznego URL, dostępność lokalnego mostu i lokalny handshake. Stan połączenia ChatGPT oraz uwierzytelnienia ingressu pozostaje jawnie „niezweryfikowany”.
- Lokalny test SDK `mcp` 1.30.0 przeszedł handshake/ping/list/call zarówno z testowym mock API, jak i z odizolowaną lokalną kopią Bastilla API. `npm run check:api -- http://127.0.0.1:3000` również przeszedł na tej kopii; potwierdził lokalne API, nie integrację z ChatGPT. Ollama/model nie zostały potwierdzone.
- `npm run verify`: wszystkie cztery kontrole przeszły; 95 testów Node, TypeScript, build UI oraz build serwera. Build UI nadal zgłasza istniejący duży chunk (~1.86 MB przed gzip). Testy MCP poza SDK smoke nie dowodzą dostępności produkcyjnej.
- `express-rate-limit@8.7.2` sprawdzono w bazie GitHub Advisory Database przed dodaniem; nie znaleziono dla tej wersji znanych podatności.
- Nie skonfigurowano trwałego publicznego hosta HTTPS, OAuth dla ingressu ani konta/konektora ChatGPT. `BASTILLA_MCP_PUBLIC_URL` oznacza wyłącznie ustawioną wartość; nie dowodzi DNS, TLS, autoryzacji ani osiągalności. Wymagane są wdrożenie i zgoda właściciela, a następnie test curl i handshake w rzeczywistym kliencie.
- Wykonanie `npm ci` w środowisku Node 22 zgłosiło wymaganie części Firebase na Node >=24.12 oraz 4 high severity z audytu istniejącego lockfile. Nie zmieniano wersji zależności w ramach tej pracy.
