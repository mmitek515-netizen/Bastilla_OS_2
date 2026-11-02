# New Debian 13 system: isolated development setup

This branch prepares an **optional Debian 13 Codespaces profile** for the new system. It does not rename or replace the existing Bastilla OS 2 application and does not claim agents are running.

## Launch
In GitHub Codespaces, select **New with options**, branch `setup/debian13-agent-environment`, and the `.devcontainer/debian13/devcontainer.json` configuration. Keep forwarded ports private.

## Four proposed workstreams
1. Debian 13 packaging, boot and system architecture.
2. Responsive GUI and accessibility.
3. MCP, Codex, GPT Actions integration with least-privilege credentials.
4. CI, security, diagnostics, integration tests.

Use distinct issues and branches per workstream. Require review and passing CI before merging. Do not grant unattended agents root access, write secrets to files, or automatically merge their PRs.

## Automation limitations
The workflow validates Debian 13 on manual dispatch or relevant PRs. It does **not** launch four AI agents. 24/7 agent work requires a separately configured, authenticated runner/orchestrator, available agent APIs, quotas, and spending limits. Codespaces alone is not a persistent 24/7 agent host.
