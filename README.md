# Bastilla OS 2

Repozytorium główne: **mmitek515-netizen/Bastilla_OS_2**.

Odtworzona baza aplikacji webowej BastillaOS, integracji AI/MCP i narzędzi
Debian/QEMU. Obecność konfiguracji VM lub profili AI nie oznacza ich uruchomienia.

## Uruchomienie

Node.js 24:

```sh
npm ci
npm run verify
npm run dev
```

Interfejs: `http://localhost:3000`. Ustaw własne integracje według `.env.example`.
Port Codespaces pozostaw prywatny do zakończenia audytu uwierzytelniania.

- [Zasady agentów](AGENTS.md)
- [Podział pracy i nazewnictwo](docs/DEVELOPMENT.md)
- [Misja projektu](docs/MISSION_BASTILLA_OS_2.md)
- [Raport weryfikacji](docs/BASTILLA_OS_2_REPORT.md)

Źródło importu: `u6930438163-code/AI_Studio_BastillaOS` @
`2203ac94b1dbbad0f9e2a470c00a4b24bc9900ed`. Zachowano istniejące moduły;
pominięto prywatne bazy, stan wykonawczy i archiwa.
