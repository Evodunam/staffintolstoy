# Message translation design

Instant translation of chat messages so each user sees messages in their preferred language (from profile/locale), without changing how senders type or what is stored as the source of truth.

---

## Goals

- **Sender**: Types in their own language; message is stored as written (single source of truth).
- **Recipient**: Sees messages in their preferred language when it differs from the sender’s.
- **Instant**: Translation is available as soon as the message is sent (either precomputed on send or on first view, then cached).
- **Respect settings**: Use each user’s language preference (profile `language` + current i18n) for both “source” (sender) and “target” (viewer).

---

## Current state

- **Profile**: Has `language` (e.g. `'en'`, `'es'`, `'zh'`, `'pt'`, `'fr'`). Used for UI via i18n; can be saved on language change.
- **Job messages**: `job_messages` has `content` (text), no language or translation fields.
- **Send**: Client sends `content` as-is; server stores it. No translation.
- **Display**: Client renders `msg.content` as-is. No translation.

---

## Data model

### 1. Message source language (sender’s language at send time)

- **Option A (recommended)**: Add column to `job_messages`:
  - `sender_language_code` `text` nullable (e.g. `'en'`, `'es'`). Set when the message is created from the sender’s profile or request.
- **Option B**: Store in `metadata`: `metadata.senderLanguageCode`. No migration, but slightly messier to query and index.

Use **Option A** so we can index and filter by language if needed, and keep metadata for other uses.

### 2. Cached translations

Add a table so we translate each message at most once per target language.

**Drizzle schema (add to `shared/schema.ts`):**

```ts
export const messageTranslations = pgTable(
  "message_translations",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id").notNull().references(() => jobMessages.id, { onDelete: "cascade" }),
    languageCode: text("language_code").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_message_translations_message_lang").on(table.messageId, table.languageCode),
    index("idx_message_translations_message").on(table.messageId),
  ]
);
```

**Migration:** Add column to `job_messages`:

```ts
senderLanguageCode: text("sender_language_code"),  // e.g. 'en', 'es'
```

- **When to fill**: Either on send (for each recipient whose language differs from sender) or on first display (lazy), then reuse.
- **Source of truth**: Always `job_messages.content` (+ `sender_language_code`). Translations are derived and cacheable.

---

## When to translate

### Strategy: hybrid (instant for recipients + lazy fallback)

1. **On send (instant for known recipients)**  
   After creating the message:
   - Read sender’s `language` (profile or request) → set `sender_language_code` on the message.
   - For each **recipient** of this message (company or workers on the job, excluding sender), if recipient’s profile `language` is set and different from `sender_language_code`:
     - Call translation: `content` from `sender_language_code` → `recipient.language`.
     - Insert into `message_translations` (message_id, language_code = recipient.language, content = translated).
   - New recipients (e.g. added later) get translation on first view (lazy).

2. **On display (lazy + cache)**  
   When loading messages for a viewer:
   - Viewer’s language = e.g. `Accept-Language` header, or `?viewerLanguage=es`, or from profile (recommended: profile + optional header override).
   - For each message:
     - If `viewer_language` is null or same as `message.sender_language_code`: return `content` as-is (no translation).
     - Else: look up `message_translations` for (message_id, viewer_language). If found, return that as `translatedContent`. If not found, call translation API once, insert into `message_translations`, then return `translatedContent`.

Result: Sender’s text is always stored in `content`; recipients with a different language get a translated version either immediately (from send) or on first view (and then from cache).

---

## Translation service

- **Server-only**: All translation must happen on the server (API keys, rate limits, cost).
- **Provider**: e.g. Google Cloud Translation API, DeepL, or LibreTranslate (self-hosted). Env var e.g. `TRANSLATION_API_KEY` and optionally `TRANSLATION_PROVIDER=google|deepl|libre`.
- **Interface**: One function used by both “on send” and “on display”:
  - `translate(text: string, sourceLang: string, targetLang: string): Promise<string>`
  - If sourceLang === targetLang, return text unchanged. Otherwise call provider and return translated string.
- **Limits**: Skip translation for very long messages (e.g. cap at 5000 chars) or for non-text message types (e.g. clock_in/clock_out). Only translate `messageType === 'text'` and when `content` is present.

---

## API changes

### POST `/api/jobs/:id/messages` (send message)

- **Request**: Optionally send sender’s current language so we don’t have to reload profile every time:
  - Body: `{ content, attachmentUrls?, mentionedProfileIds?, metadata?, senderLanguageCode? }`
  - If `senderLanguageCode` is omitted, server sets it from `profile.language` (from DB).
- **Server**:
  1. Create message as today; set `sender_language_code` from body or profile.
  2. (Optional but recommended) Resolve recipients (same logic as today: company, location rep, other workers). For each recipient with `language` !== sender language, call `translate(content, sender_language_code, recipient.language)` and insert into `message_translations`.
  3. Return created message (with `sender_language_code`).
- **Client**: When submitting the message, send current i18n language: e.g. `senderLanguageCode: getCurrentLanguage()` or from profile, so the server can use it if profile is not yet updated.

### GET `/api/jobs/:id/messages` (list messages)

- **Request**: Viewer’s preferred language so server can return translated content:
  - Query: `?viewerLanguage=es` or header: `Accept-Language: es` (optional; prefer explicit query for clarity).
  - If absent, server can use profile language for the authenticated user.
- **Response**: Same list of messages as today, with one extra field per message when translation applies:
  - `displayContent`: string. If viewer’s language differs from `sender_language_code`, this is the translated text (from cache or freshly translated and cached). Otherwise same as `content`.
  - Optionally keep `content` as the original and add `translatedContent` only when different, so the client can show “Original” if desired.
- **Server**:
  1. Load messages as today (with senders).
  2. For each text message, if viewer language !== sender_language_code:
     - Select from `message_translations` where message_id and language_code = viewer language.
     - If missing, call `translate(content, sender_language_code, viewer_language)`, insert into `message_translations`, then use that for `displayContent`.
  3. Return messages with `displayContent` (and optionally `content` + `translatedContent`).

### Optional: GET `/api/jobs/:jobId/messages/:messageId/translation?lang=es`

- Returns only the translated body for one message and one language (e.g. for “Show original” toggle and lazy-load translation in the UI). Can be implemented later if you want to move translation to a separate request.

---

## Client changes

### Sending

- When building the send payload (e.g. in `handleSendMessage` or wherever `postMessage` / `sendMessageMutation.mutate` is called), add the current user’s language:
  - e.g. `senderLanguageCode: getCurrentLanguage()` from `@/lib/i18n`, or from profile if you already have it.
- No change to the text the user types; send as-is.

### Display

- When fetching messages, pass viewer’s language:
  - e.g. `GET /api/jobs/${jobId}/messages?viewerLanguage=${getCurrentLanguage()}` or send in a header.
- In the message list, render `displayContent` (or `translatedContent` when present, otherwise `content`) instead of always `msg.content`.
- Optional: show a small “Original” / “Translated” toggle per message when `translatedContent` exists, toggling between `content` and `translatedContent`.

### UI copy

- Use i18n keys for “Original” / “Show original” / “Translated” (e.g. in `chat` or `common` namespace) so the UI stays localized.

---

## Edge cases

- **Missing profile language**: Treat as no translation (show original). Optionally default to `en` for translation target if you want a fallback.
- **Unsupported language**: If the translation API doesn’t support sender or viewer language, show original and optionally log; no need to fail the request.
- **System / non-text messages**: Don’t translate clock_in, clock_out, timesheet_summary, or video call link messages; only translate `messageType === 'text'` and when content is plain text.
- **Rate limits / errors**: If translation fails on send, still save the message and set `sender_language_code`; translations can be filled lazily on display. If translation fails on display, show original `content`.
- **Long messages**: Cap translatable length (e.g. 5000 chars); beyond that show original or truncate for translation to avoid cost/time.

---

## Implementation order

1. **Schema**: Add `sender_language_code` to `job_messages`; add `message_translations` table; run migration.
2. **Translation module**: Add `server/translation.ts` (or similar) with `translate(text, from, to)` using one provider (e.g. Google or LibreTranslate), env var for key, and the limits above.
3. **POST message**: When creating a message, set `sender_language_code` (from body or profile). Optionally: resolve recipients and prefill `message_translations` for their languages.
4. **GET messages**: Accept `viewerLanguage`; for each message, resolve `displayContent` (from cache or translate and cache). Return messages with `displayContent` (and optionally `content` for “Show original”).
5. **Client**: Send `senderLanguageCode` on submit; send `viewerLanguage` when fetching messages; render `displayContent` (or equivalent) in the chat list.
6. **Optional**: “Show original” toggle and any analytics/logging for translation usage.

---

## Summary

| Concern              | Approach                                                                 |
|----------------------|--------------------------------------------------------------------------|
| Source of truth      | `job_messages.content` + `sender_language_code`                         |
| When to translate    | On send for known recipients; on first view for others (then cached)     |
| Where                | Server only (translation module + routes)                                |
| Cache                | `message_translations` (message_id, language_code, content)             |
| Client               | Send sender language on submit; send viewer language on fetch; show displayContent |

This design keeps storage simple (one body per message + cached translations), respects each user’s language settings, and makes translation “instant” for recipients either at send time or on first view with no duplicate work.
