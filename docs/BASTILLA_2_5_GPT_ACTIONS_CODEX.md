# Bastilla OS 2.5 — GPT Actions and Codex

This is a non-invasive blueprint on a separate branch; Bastilla OS 2 production remains unchanged.

## GPT Actions
- Expose an authenticated HTTPS OpenAPI 3.1 endpoint for status and approved task creation.
- Configure the Custom GPT Action by importing the OpenAPI schema and selecting an authentication method.
- Never put API tokens in the schema, source code, or frontend.
- Require explicit authorization for repository writes and privileged operations.

## Codex
- Connect the target GitHub repository to Codex through its supported integration.
- Give agents bounded tasks; require branch + PR + CI for changes.
- Do not claim autonomous Codex execution without an actual configured runner.

## Planned 2.5 implementation
- Separate repository and isolated deployment.
- Agent queue and task status endpoints.
- Optional MCP adapter.
- CI checks and rollback policy.

The configuration is not a live GPT Action or running Codex agent until the external connections are completed.
