# Raport Bastilla OS 2 — 2026-11-01

## Wykonano w tej zmianie

- Domyślne bindowanie API ograniczono do `127.0.0.1`; Codespaces jawnie używa `0.0.0.0` wyłącznie z portem 3000 oznaczonym jako prywatny.
- Automatyczny commit/push i mutacje autonomiczne w tle są wyłączone domyślnie. Wymagają osobnych, jawnych zmiennych opt-in.
- Odczyt `/api/apps/list` nie odtwarza ani nie nadpisuje aplikacji. Trzykrotny odczyt zachował SHA-256 istniejących plików HTML.
- Usunięto syntetyczne ukończone zadania; stare wpisy demonstracyjne są degradowane, a nowe zadania ograniczono do znanych akcji i bezpiecznych ścieżek aplikacji.
- Ollama: skonfigurowany model musi występować w odczytanym inwentarzu, zanim diagnostyka go wybierze lub wykona benchmark.
- Wizualizator 3D ładuje się na żądanie; usunięto zewnętrzny HDR, który powodował błąd renderowania. Etykiety UI/MCP odróżniają profile i konfigurację od aktywnej inferencji.
- Dodano jawny MCP ping do smoke testu oraz sprawdzanie odpowiedzi offline jako poprawnego statusu diagnostycznego.
- Rzeczywiste, równoległe audyty read-only wykonali Alex, Aurelius, Astyria i Aria. Nie edytowali plików i nie potwierdzili zewnętrznych połączeń AI.

## Wyniki sprawdzeń

- `npm ci --no-audit --no-fund`: 317 pakietów z lockfile. Środowisko testowe ma Node `v22.23.4`; zależności Firebase ostrzegają o wymaganiu Node `>=24.12.0`. Dokumentacja/devcontainer wskazują Node 24.12+.
- `npm run verify`: PASS — 94 testy, TypeScript, build UI i build serwera.
- `.venv-mcp/bin/python -m unittest integrations.mcp.test_remote_server`: PASS — 6 testów.
- `npm run check:api -- http://127.0.0.1:3000`: PASS — 7/7 odczytów na rzeczywistym lokalnym serwerze.
- MCP FastMCP na localhost: PASS — initialize, ping, tools/list i odczyty statusu agentów, Ollamy i VM. Ollama zwróciła `connected: false`.
- Własny JSON-RPC `/api/mcp` na localhost: PASS — initialize (200), `notifications/initialized` (202), ping, tools/list i bezpieczny odczyt `kernel_status`.
- Playwright: pulpit działa przy 390×844 bez poziomego overflow; Integracje są pojedynczym skrótem mobilnym, wizualizator nie ładuje się na ekranie startowym, a po otwarciu renderuje się bez zewnętrznych zasobów.
- Build wydzielił główny chunk UI `854.21 kB` (gzip `243.75 kB`) i chunk wizualizatora `945.47 kB` (gzip `251.47 kB`). Pozostaje ostrzeżenie Vite o chunkach >500 kB; wizualizator jest pobierany dopiero po otwarciu.
- Rzeczywisty nasłuch lokalny: `127.0.0.1:3000`; API raportowało `auto-sync=false`, `continuousMissionEnabled=false`, `autoRepairEnabled=false`.

## Ograniczenia i dalsze kroki

- Ollama była offline; nie uruchomiono inferencji Gemini, Ollamy ani innego modelu. VM Gemini zgłosiła `not_created`.
- Lokalny MCP nie potwierdza HTTPS ani połączenia klienta ChatGPT. Nie wdrażano do Google AI Studio i nie zmieniano limitów płatnych usług.
- W dostępnej przestrzeni roboczej nie znaleziono eksportu `codespace-cuddly-xylophone-gx7rjx9wj7gg29947`; nie było dostępnego narzędzia do odczytu prywatnego Codespace, więc niewysłane zmiany nie zostały porównane.
- Nie uruchamiano QEMU/Debiana, nie budowano ISO ani pakietu Debian.
- Backend nadal zawiera trasy zapisu/poleceń bez własnej autoryzacji konta. Nie wystawiać API/MCP publicznie; poza prywatnym portem Codespaces wymagane jest uwierzytelnione ingress. To ograniczenie nie jest równoznaczne z pełnym audytem wszystkich tras.
- Build emituje ostrzeżenia Three.js/WebGL o deprecacji i programowym renderowaniu w użytej przeglądarce; nie blokują renderowania.
- Odzyskanie źródeł z commit `2203ac94b1dbbad0f9e2a470c00a4b24bc9900ed` oraz historia wcześniejszych kontroli pozostają odnotowane jako prace wcześniejsze, nie jako nowe wyniki tej sesji.

Raport nie określa procentu ukończenia ani terminu.
