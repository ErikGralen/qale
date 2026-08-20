# Model providers

Written 2026-08-17, when Gemini was added beside Claude. Built and type-checked; the open items
are at the bottom.

## The decision

**One provider at a time, both bring-your-own-key.** A workspace runs on Anthropic or on Google,
never both, and nothing falls back from one to the other. The choice is really a choice of which
key you already hold, so Settings asks it as one question with the key field under it.

Both keys are kept on disk once pasted (`anthropicKeyEnc`, `geminiKeyEnc`). Only the chosen
provider's key ever reaches the runtime. Somebody trying Gemini for a week should not have to find
their Anthropic key again to come back.

**The picker is a shortlist, not a catalogue.** pi carries dozens of models per provider: dated
snapshots, retired families, and preview builds for jobs this product never does (images, speech,
robotics). Offering all of them made the choice a research task. What we offer now:

| Provider  | Models                                         | Default        |
| --------- | ---------------------------------------------- | -------------- |
| Anthropic | Claude Opus 5, Claude Sonnet 5, Claude Fable 5 | Opus 5         |
| Google    | Gemini 3.1 Pro (preview), Gemini 3.6 Flash     | Gemini 3.1 Pro |

The full catalogue is still reachable underneath. `resolveModel` honours a session pinned to an
older id, and the session namer still shops the whole list for the cheapest model. Only what we
put in front of somebody is cut down.

The table lives in `packages/domain/src/models/index.ts`, one place, read by main, the renderer and
the agent.

## Where the pieces are

- `packages/domain/src/models/` — the table, the defaults, and `modelForProvider`, which is what
  stops a Claude id staying in force under a Gemini key.
- `apps/desktop/src/main/services/settings-service.ts` — `provider`, both keys, and the migration
  that carries any dropped model to the chosen provider's default.
- `apps/desktop/src/main/services/verify-key.ts` — one probe per provider, so a typo fails at the
  field rather than inside a session twenty minutes later.
- `packages/agent/src/runtime.ts` — `setRuntimeApiKey(provider, …)`, and every model lookup bounded
  to the chosen provider. That bound matters: pi treats `ANTHROPIC_API_KEY` in the environment as a
  configured provider, so without it a dev machine could answer on Claude while set to Gemini.
- `packages/agent/src/api-errors.ts` — the refusal reads its own provider off the message. Anthropic
  and Google word the same four failures differently enough to tell apart, so nothing has to be
  threaded through the bridge and the history to name the right billing page.

## Open

1. **Nobody has run a Gemini turn against a live key.** Everything below the key field is verified
   (settings, switching, the picker, the shortlist against pi's catalogue), and the first real
   round trip is not. The thing most likely to bite is tool calling: we register ~30 typebox tool
   schemas, and pi sends them to Google as `parametersJsonSchema`, which claims full JSON Schema
   support. Claimed, not seen.
2. **pi 0.83's Google catalogue lags Google's own.** Google ships `gemini-3.7-flash` as the current
   stable flagship; pi does not carry it, and an id pi cannot route cannot be selected at all. When
   pi is next bumped, check for 3.7 Flash and a stable (non-preview) 3.1 Pro.
   `packages/agent/test/models.test.ts` fails loudly if a shortlisted id disappears in a bump.
