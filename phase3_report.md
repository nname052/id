# Phase 3: ElevenLabs settings (balance, key status, approval threshold)

Branch: `autovideo-motion-v2`. No motion or scene code changed. No audio was generated and no credits were spent: the test used read-only calls, and usage stayed at 12,418 before and after.

## ElevenLabs API: what exists
| Need | Endpoint | Result |
|---|---|---|
| (a) Remaining credits and monthly limit | `GET /v1/user/subscription` | **Exists.** Returns `character_count`, `character_limit`, `next_character_count_reset_unix`, `character_refresh_period`, `tier`, `status`. Read-only, costs nothing. |
| (b) Change the per-key credit limit | `PATCH /v1/service-accounts/{service_account_user_id}/api-keys/{api_key_id}` (`character_limit`) | **Only for service-account (workspace) keys.** There is no documented endpoint to read or change the limit of a personal key (Developers → API Keys). **No editor was built**: the page shows the limit as read-only and says to change it on elevenlabs.io. |

Sources: [Get subscription](https://elevenlabs.io/docs/api-reference/user/subscription/get) · [Update service-account API key](https://elevenlabs.io/docs/api-reference/service-accounts/api-keys/update) · [List service-account API keys](https://elevenlabs.io/docs/api-reference/service-accounts/api-keys/list)

## What was added
- **`/settings` page** (link in the top bar):
  - Balance is fetched only when the user clicks "تحديث الرصيد", never on page load. The page shows remaining credits, used/limit, refresh period, next reset, tier and subscription status.
  - **Key status:** "active" (the key is accepted) or "limited" (the last voice request returned `quota_exceeded`). A personal key's own cap can't be read for free from the API, so it shows up only on the next voice request.
  - Per-key credit limit: read-only notice pointing to elevenlabs.io.
  - **Approval threshold:** default 200 credits per run, stored in `data/app_settings.json` (gitignored). It changes only when the user saves a new value.
- **Guard before any audio generation** (`app/pipeline/audio.py`, `app/main.py`). It runs before any request to ElevenLabs:
  - **Full voice:** if the estimate (1 credit per character sent, the existing pricing logic) is above the threshold, the stage stops at "محتاج موافقة". The message shows the total and the cost per sentence; "موافق، كمّل" continues.
  - **Single-sentence regeneration** (previously unguarded): the server returns `needs_confirm` with the cost, and the page shows a confirm dialog. Nothing is sent unless the user confirms.
- **Key handling:** the key is read only from `.env` (`ELEVENLABS_API_KEY` in `app/config.py`; `.env` is gitignored and untracked). `app/eleven_account.py` returns computed numbers only, never the key.

## Acceptance
| Item | Result | Evidence |
|---|---|---|
| Balance shows the real number from the API | **PASS** | Read **19,119 credits remaining** (12,418 used of 31,537, monthly; next reset 10 Nov 2026; tier starter, subscription active) on **17 Oct 2026, 05:54** local time |
| Key never displayed or logged | **PASS** | Exact key value: 0 matches in 15,132 project files (excluding `.env`), 0 in the full git history (all branches), 0 in the responses of `/api/eleven/account`, `/api/settings`, `/api/usage`, `/api/voices`, `/api/style`, `/api/projects`. Server log: 0 lines matching `sk_` or `xi-api-key`. Tracked files: 0 key-shaped strings. |
| Confirmation before a generation above the threshold | **PASS** | Threshold set to 1 from the settings page. Temporary project (3 sentences, 65 credits). Full voice → stage `needs_credits` with "65 credit … جملة 1: 21، جملة 2: 23، جملة 3: 19"; the "موافق، كمّل" button was shown and **not clicked**. Sentence regeneration → `needs_confirm` (cost 65) and the confirm dialog shown once; cancelled, nothing sent. Usage before/after: 12,418 / 12,418 (0 spent). Temp project deleted; threshold restored to 200. |
| No motion-code change; old scenes render with zero console errors | **PASS** | Changed files: `app/main.py`, `app/worker.py`, `app/pipeline/audio.py`, `app/eleven_account.py`, `settings.html`, `project.html`, `base.html`; no file under `app/player/`. Fridge, Rocketbox, scene, body, look: 0 page errors, 0 console errors. Settings page in a fresh tab: 0 console errors. |

## Notes
- Speech-to-text review and forced alignment (your own voice) also use ElevenLabs credits, but they are not audio generation, so the threshold does not cover them yet.
