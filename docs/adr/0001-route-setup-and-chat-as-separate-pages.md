---
status: superseded by ADR-0014
---

# Route setup and chat as separate pages

The desktop renderer separates runtime setup from daily conversation with explicit `/setup` and `/chat` routes. We use React Router in hash-router mode so packaged Electron builds can navigate between these pages without depending on server-side history fallback, and the chat page no longer exposes runtime controls once the model service is configured.
