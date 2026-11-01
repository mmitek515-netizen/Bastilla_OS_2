# Domyślna ścieżka Bastilla Global Sync

Domyślny katalog danych w katalogu roboczym uruchomionego serwera: `data/bastilla-sync/`.

Przewidziane podfoldery: `projects/`, `apps/`, `files/`, `databases/`, `chat/`, `agents/`, `dashboards/`, `incidents/`, `events/`, `outbox/`, `backups/`.

Konfiguracja wdrożenia: `BASTILLA_SYNC_ROOT=/ścieżka/do/trwałego/wolumenu/bastilla-sync` (ścieżka bezwzględna jest zalecana dla serwera produkcyjnego). Repozytorium ignoruje `data/` w `.gitignore`; pliki użytkownika **nie powinny być commitowane do Git**. Uwaga: istniejące eksporty pozostają obecnie w `exports/`, a inne dane w dotychczasowych lokalizacjach. Ta zmiana **nie przenosi ich automatycznie**, nie tworzy katalogów i nie uruchamia synchronizacji. Migracja wymaga kopii zapasowej, walidacji praw dostępu i osobnego PR.

**Bezpieczeństwo:** katalog danych musi znajdować się poza publicznym katalogiem statycznym i być dostępny tylko dla procesu serwera. Należy zastosować uprawnienia właściciela, izolację projektów, kontrolę dostępu i limity wielkości. Nie należy ujawniać bezwzględnych ścieżek serwera w publicznym API. W Codespaces domyślny dysk nie jest gwarantowanym magazynem produkcyjnym; w chmurze trzeba skonfigurować trwały wolumen lub bazę danych.

**Status:** dodano wyłącznie centralną konfigurację ścieżek (`src/lib/syncWorkspace.ts`) i testy. Trwały outbox, migracja istniejących plików, podłączenie modułów oraz integracje GitHub/AI Studio pozostają do wdrożenia.
