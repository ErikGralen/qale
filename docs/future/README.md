# Future possibilities

Docs here are **explored but deliberately not built** — parked to keep track of the idea and the
reasoning, not committed to. Each was set aside because it expands scope beyond the current MVP.

| Doc | Idea in one line | Why parked |
|---|---|---|
| [on-demand-capture-and-reply.md](./on-demand-capture-and-reply.md) | Hotkey from inside a Slack/Gmail thread to **capture** its context into PM or **draft a reply** in your voice, via a one-shot macOS Accessibility read (no browser extension, one install, one permission). | Scope: needs a native AX-read + synthetic-keystroke module, a global hotkey, and thread→entity resolution. |
| [messaging-integrations.md](./messaging-integrations.md) | Real outbound send to Gmail/Slack/Teams as the user, and why copy-paste "handoff" beats it for an MVP. Background for the capture-and-reply doc. | Each real-send path drags in OAuth app registration, verification (CASA), and per-workspace admin install. |
| [google-calendar-integration.md](./google-calendar-integration.md) | Read Google Calendar to feed meeting briefs and the commitment ledger. | Designed, not implemented; OAuth + connector work. |
| [google-cloud-setup.md](./google-cloud-setup.md) | Operational checklist for the one Google Cloud OAuth project behind Calendar (and later Gmail/Drive). | Companion to the above — only relevant once Calendar is built. |

**Shipped design/decision records** were moved to [`../archive/`](../archive/) — kept for reference,
not active work.
