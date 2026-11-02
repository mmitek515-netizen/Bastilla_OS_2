# Debian 13 chat core

This is the first isolated chat milestone for the Debian 13 system. It recognizes
a small set of Polish and English requests and places supported state-changing
operations in an authenticated, in-memory approval queue.

## Run

Requires Node.js with built-in ES modules and `node:test`; there are no external
dependencies.

```sh
cd debian13
npm test
DEBIAN13_CHAT_OPERATOR_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')" npm start
```

The operator token must contain at least 32 bytes. Keep it private and do not
commit it. The demo accepts `show system status`, bounded service-restart
requests for `cron`, `nginx`, or `ssh`, and `reboot the system`. Use `approve
<proposal-id>` or `reject <proposal-id>` to record an explicit decision.

This milestone does not connect to an AI model, read live system status, execute
approved operations, persist the queue across restarts, expose HTTP routes, or
boot Debian. Approval records a decision only; no shell or system command is
run. The API transport and executor remain separate follow-up work.
