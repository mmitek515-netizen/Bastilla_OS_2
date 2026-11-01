# Bastilla Command Center — przypisywanie incydentów do agentów (Issue #81)

## Cel
Operator wybiera rzeczywisty incydent w dashboardzie i klika **Zleć diagnozę → Alex** (lub Astyria, Aria, Aurelius, Wszyscy). Agent dostaje bezpieczny pakiet dowodowy, a operator śledzi wynik. Nie wolno utożsamiać samego kliknięcia z faktycznym wykonaniem misji.

## Proponowany kontrakt API

- `GET /api/diagnostics/incidents?severity=error&cursor=...`: paginowana lista incydentów, stabilne ID, timestamp ISO, źródło, poziom, zredagowany opis i powiązane trace ID. Wymaga sesji operatora.
- `POST /api/diagnostics/assignments`: body `{incident_id, agent_id: "Alex", note?, idempotency_key}`; serwer waliduje incydent, operatora, uprawnienia i limity. Zwraca `202 {assignment_id, status:"queued"}` **tylko po trwałym zapisie w rzeczywistej kolejce**; bez kolejki zwraca `503`, nigdy fikcyjnego sukcesu.
- `GET /api/diagnostics/assignments/:id`: `queued|running|completed|failed|cancelled`, actor, timestamps, odnośniki do raportu i dowodów.
- `POST /api/diagnostics/assignments/:id/cancel`: anulowanie, jeśli pozwala na to stan i uprawnienia.

## Przepływ
1. Dashboard pokazuje prawdziwy błąd z backendu, nie losowy przykładowy wpis.
2. Operator otwiera szczegóły, wybiera Alex, opcjonalnie komentarz, zatwierdza.
3. Backend pobiera kontekst po `incident_id` (nie ufa surowym logom wysłanym przez przeglądarkę), redaguje sekrety, tworzy audytowany pakiet dowodowy i zapisuje zadanie atomowo.
4. Autoryzowany worker Alex odbiera zadanie, potwierdza start, przeprowadza diagnostykę odczytową, zapisuje raport i linki do dowodów.
5. UI aktualizuje status przez SSE/polling; po błędzie wyświetla konkretny stan i możliwość ponowienia.
6. Zmiana kodu lub restart usługi wymaga osobnego, kontrolowanego przepływu zatwierdzania. Diagnoza sama nie naprawia systemu.

## Model danych
`incidents(id, source, severity, created_at, trace_id, redacted_summary, status)`
`diagnostic_assignments(id, incident_id, agent_id, requested_by, note, status, idempotency_key, created_at, started_at, finished_at, report_ref, error_code)`
`diagnostic_audit(id, assignment_id, actor_id, action, timestamp, metadata_redacted)`

## Wymagania bezpieczeństwa
RBAC po stronie serwera, CSRF/ochrona sesji, ograniczenie częstotliwości, brak logowania tokenów/cookies/PII, kontrola dostępu do załączników, niezależna tożsamość agentów, zasada najmniejszych uprawnień, audyt. Nie eksponować surowych `systemLogs` w publicznym endpointcie. Nie wykonywać poleceń shell z treści incydentu. Zachować silnik `without_nlp`.

## Obecne ograniczenia repozytorium
Istniejący `GET /api/agents/activity` zwraca jedynie ograniczone zdarzenia GitHub/deploy/chat, nie pełne incydenty; `systemLogs` to pamięć procesu, bufor do 350 wpisów i timestamp tylko z godziną. Brakuje trwałej kolejki, autoryzacji akcji przypisania i potwierdzonego workera Alex. **Nie uruchamiać produkcyjnego przycisku Zleć diagnozę, zanim te zależności nie powstaną.**

## Plan wdrożenia
1. Stabilne ID i trwałe źródło incydentów z redakcją sekretów.
2. Autoryzacja operatora + transakcyjne API assignments + audyt + idempotencja.
3. Worker Alex i potwierdzone statusy; brak wykonawcy = widoczny błąd/oczekiwanie.
4. UI przy każdym błędzie, mobilny modal wyboru agenta, szczegóły zlecenia i status.
5. Testy kontraktowe: poprawny incydent, nieznany ID, nieautoryzowany operator, duplikat, brak workera, retry, timeout, anulowanie, usunięte logi, błąd storage, sekret w logu.
6. End-to-end: prawdziwy HTTP 500 → przypisanie Alex → potwierdzony raport → operator widzi dowody. Testy `npm run lint`, `npm test`, `npm run build` oraz Huawei P Smart 2019 / Samsung SM-A135F.

## Kryterium ukończenia
Wymagane są dowody z działającego backendu i agenta, nie tylko statyczny panel, commit czy utworzone GitHub Issue.
