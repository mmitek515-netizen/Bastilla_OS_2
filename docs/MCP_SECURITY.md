# MCP — bezpieczne uruchomienie (Bastilla OS 2)

## Status
Endpointy `/api/mcp`, `/mcp` i `/api/mcp/sse` wymagają osobnego tokenu Bearer. Brak tokenu (lub token krótszy niż 32 znaki) powoduje HTTP 503; niepoprawny token powoduje HTTP 401. Nie należy publikować serwera przed pełnym audytem wszystkich tras aplikacji.

## Konfiguracja
W bezpiecznych sekretach środowiska uruchomieniowego ustaw `BASTILLA_MCP_TOKEN` (co najmniej 32 losowe znaki). Nie dodawaj tokenu do repozytorium ani frontendu. Przykład lokalnego wygenerowania: `openssl rand -hex 32`.

Po uruchomieniu serwera lokalnie sprawdź bez tokenu: `curl -i http://127.0.0.1:3000/api/mcp` (oczekiwane 401 lub 503). Następnie wyślij żądanie `initialize` z nagłówkiem `Authorization: Bearer <token>`, `Content-Type: application/json` i JSON-RPC 2.0. Powtórz dla `tools/list` i bezpiecznego `tools/call`. Tokenu nie wypisuj w logach.

## Ograniczenia
Testy statyczne CI nie potwierdzają połączenia z ChatGPT. Należy jeszcze wykonać testy HTTP end-to-end (401/503/handshake), walidację argumentów i uprawnień poszczególnych narzędzi, ograniczenia częstotliwości, zgodność transportu Streamable HTTP oraz audyt innych tras serwera. Codespaces porty pozostają prywatne do czasu zakończenia audytu. Silnik `without_nlp` nie wymaga Ollamy.
