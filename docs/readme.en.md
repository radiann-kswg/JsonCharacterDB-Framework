# 100BeautiesLab. Creations DB (Web) — README (English)

This document is an English, reader-friendly version of the technical parts of `README.md`.

- Viewer UI: `pages/characters.html`
- Viewer guide (JP): `docs/viewer-guide.md`
- DB update guidelines (JP): `docs/db-update-guidelines.md`
- Third-party policy (JP): `docs/third-party-policy.md`

> Note: The _Primary/Secondary Works Guidelines_ at the beginning of `README.md` are treated as the source of truth for licensing and permissions.

---

## 1. What is this repository?

**100BeautiesLab. Creations DB (Web)** is a database of original characters, published as a static web site.
It provides:

- A viewer UI (character sheet) implemented with vanilla JavaScript, hosted on GitHub Pages
- **A real API** served from the edge by Cloudflare Workers, backed by R2 (JSON mirror) and D1 (FTS5 search)
- **A pseudo-API** implemented by Service Workers for in-browser use (`/api/v1/*`, `/pages/v1/*`, `/svc/v1/*`)
- JSON databases and schema-like definitions under `data/**`

### API in two layers

Since ADR-0001 (adopted 2026-06-21) the API is served in two layers. Pick whichever fits your client.

| Layer          | Endpoint                                            | Implementation                                  | Data source                | Intended for                          |
| -------------- | --------------------------------------------------- | ----------------------------------------------- | -------------------------- | ------------------------------------- |
| **Real API**   | `https://database.numbertales-radiann.net/api/v1/*` | Cloudflare Workers (`pkg/cloudflare/worker.js`) | R2 (JSON) + D1 (FTS5)      | External clients, curl, mobile apps   |
| **Pseudo API** | `(same origin)/api/v1/*`, `/pages/v1/*`, `/svc/v1/*` | Service Worker (`pages/sw.js`)                  | Static JSON on GitHub Pages | Browsers, the character-sheet UI      |

- The pseudo-API resolves references fully (`_DBLink` / `_Jump`). The real API currently applies `_Commons`
  only; full reference resolution is planned for a later phase.
- If you work with the repository directly, the file-system clients under `pkg/` (Node.js / Python / C#)
  read the JSON without needing either API.

---

## 2. How to view characters (UI)

1. Open `pages/characters.html`
2. Select a Work (series) from the dropdown
3. Select a DB type (e.g. Primary)
4. Use the search box, then click a card to open details

### Direct link (URL parameters)

Character details can be opened directly with a single compact locator parameter:

```
?c=<Work>[/<DB>[/<Index>]]
```

The Work ID is written **without** the `Works_` prefix.

| Example                                            | Meaning                                     |
| -------------------------------------------------- | ------------------------------------------- |
| `?c=NumberTales/Primary/Num:57`                    | A single-key index                          |
| `?c=FLInvestigator78/Primary/Card.Num:7`           | A key path (`<root>.<child>`)               |
| `?c=FLInvestigator78/Primary/Suit:Major,SuitNum:16` | A composite index (comma-separated)         |
| `?c=NumberTales/Primary&q=狐`                      | A DB plus a search query                    |

Index notation is `value`, `keyPath:value`, or a comma-separated list of `keyPath:value` pairs.
When the key path is omitted, it is read as the primary element of `$IndexDef`.

Optional parameters:

- `q`: search query — added only when non-empty
- `lang`: `en` switches the UI to English

Legacy compatibility:

- The older per-key form (`work` / `db` / `idx` / `idxKey` / `num`, and Work IDs carrying the `Works_`
  prefix) is still **read** correctly, and such URLs are rewritten to the `c=` form on display.
  New links are always generated in the `c=` form.

---

## 3. Data structure overview (`data/**`)

High-level layout:

- `data/db_meta.json`: global metadata (works list, dictionaries, display/link helpers)
- `data/db_type.json`: global type definitions (`$DefType`, plus `$MetaType` for catalog metadata)
- `data/Works_<WorkName>/DataBases/`: per-work DB JSON, per-work meta/type definitions
- `data/Works_<WorkName>/Dictionaries/`: per-work dictionaries (`dict_*.json`)
- `data/Works_<WorkName>/References/`: reference material databases (`ref_*.json`)
- `data/Works_<WorkName>/Localization/`: translation dictionaries (`trans_*.json`)
- `data/Works_<WorkName>/RoleplayPrompts/`: generated roleplay prompts for distribution
- `data/Works_<WorkName>/Images/`: per-work images (`General/`, `DB_*`, `Ref_*`)

DB files follow `db_<Type>.json` naming (e.g. `db_Primary.json`).

Record key order is canonicalised against `$DefType`; `npm run data:order:check` verifies it.

---

## 4. Schema-driven design (important)

This project prefers **schema-driven** behavior:

- UI and Service Worker behavior should follow `db_type.json` (`$DefType`) whenever practical.
- Display labels prefer `hashTag_JP` (or legacy `hashtag_JP`) if present; otherwise fall back to field names.
- When adding fields to data, update `$DefType` accordingly to keep rendering/search/enrichment consistent.
- Layout is declared in `db_meta.json` (`$DetailLayout`), and field placement uses `$slot` markers
  (`$slotMatch` / `$slotExpand` / `$slotOrder` / `$slotAnchor`) rather than field-name branches in code.

---

## 5. Real API (Cloudflare Workers)

Base URL: `https://database.numbertales-radiann.net/api/v1/`

| Method | Path                             | Source       | Description                                                       |
| ------ | -------------------------------- | ------------ | ----------------------------------------------------------------- |
| GET    | `/api/v1/meta`                   | R2           | Global metadata (`data/db_meta.json`)                             |
| GET    | `/api/v1/works`                  | D1 `works`   | List of works (hidden works excluded)                             |
| GET    | `/api/v1/:work/meta`             | R2           | Per-work metadata                                                 |
| GET    | `/api/v1/:work/dbs`              | D1 `dbs`     | DB list for a work (hidden DBs excluded)                          |
| GET    | `/api/v1/:work/:db/records`      | D1 `records` | Records (`isPrivate` excluded, `_Commons` applied)                |
| GET    | `/api/v1/:work/:db/records/:idx` | D1 `records` | A single record (`?idxKey=X` selects the index field)             |
| GET    | `/api/v1/:work/:db/search?q=`    | D1 FTS5      | Full-text search within a DB                                      |
| GET    | `/api/v1/:work/search?q=`        | D1 FTS5      | Full-text search across a work                                    |

As of 2026-07-29 each entry of `/api/v1/works` exposes `key`, `Title`, `Title_EN`, `Works_Summary`,
`OldTitles` and `Works_OfficialLinks[]` (official-site links), all verified against production.

Visibility flags are enforced at the query level: `Works_Hidden` hides a whole work and `DB_Hidden`
hides a whole DB, both returning 404.

Setup and data synchronisation are documented in `pkg/cloudflare/README.md`.

---

## 6. Pseudo API (Service Worker, browser only)

On GitHub Pages the repository registers Service Workers that answer API requests from static JSON.

Three scopes are provided:

- `/api/v1/*` — standard API (`resolve=true`, `enrich=false` by default)
- `/pages/v1/*` — used by the character sheet (`resolve=true`, **`enrich=true`** by default)
- `/svc/v1/*` — a mirror of `/api/v1/*` for environments where `/api` is blocked by ad blockers

### 6.1 Path shape differs from the real API

Both layers share the `/api/v1/` prefix, but the pseudo-API keeps a `works/` prefix and a `db/` infix:

| Operation      | Real API (Workers)               | Pseudo API (Service Worker)               |
| -------------- | -------------------------------- | ----------------------------------------- |
| List works     | `/api/v1/works`                  | `/api/v1/works`                           |
| List DBs       | `/api/v1/:work/dbs`              | `/api/v1/works/:work/dbs`                 |
| List records   | `/api/v1/:work/:db/records`      | `/api/v1/works/:work/db/:db/records`      |
| Single record  | `/api/v1/:work/:db/records/:idx` | `/api/v1/works/:work/db/:db/records/:idx` |
| Search in a DB | `/api/v1/:work/:db/search?q=`    | `/api/v1/works/:work/db/:db/search?q=`    |

### 6.2 Definition endpoints

Definition data is only returned by these endpoints:

- `GET /api/v1/varsdef` (and variants) — field dictionary (`General.$VarsDef` merged with `db_type.json`'s `$VarsDef`)
- `GET /api/v1/typedef` or `GET /api/v1/deftype` (and variants) — `$DefType`
- `GET /api/v1/defs` (and variants) — combined view

### 6.3 Enrichment metadata

Responses from `/pages/v1/*` carry an `_enrichment` object that the UI uses for display control
(for example `displaySections`, image metadata and wrapper summaries).

---

## 7. Reference resolution (`_DBLink` / `_Jump`)

Records may link to records in other DBs — or in other works — and the enrichment layer resolves them.

Fields whose name ends with `_DBLink` use the `$Def_DBLinkRef` shape:

```json
{
  "AnotherRegions_DBLink": {
    "_Work": "SinisterChangingGirls",
    "_DB": "Primary",
    "Drc": "E"
  }
}
```

- `_Work` / `_DB` name the target; the remaining key is the index (nested indexes are allowed,
  e.g. `"Card": { "Suit": "Major", "SuitNum": 17 }`).
- `_Jump` (`{ "_Jump": { "hashTag": "...", "_Search": { ... } } }`) replaces a field with a value
  taken from the referenced record.

Rules worth knowing when reading the data:

- Merging only fills **empty** values; existing values are never overwritten.
- `{ "hideText": "..." }` marks an intentional mask and is never overwritten.
- Ambiguous lookups are skipped — only a single match is adopted.
- Image fields are never filled from a different DB.
- References to `isPrivate: true` records are filtered out on the client.

> The older shape (`{ worksTitle, dbName, _Search }`) has been retired. A root-level `_DBLink` on a
> record still uses the legacy form internally for merge resolution.

---

## 8. Development and tests

- Contribution rules: `CONTRIBUTING.md`
- How to run tests: `README.test.md`
- Run tests (Vitest, Node.js >= 18): `npm test`

Useful checks:

- `npm run data:order:check` — verifies record key order against `$DefType`
- `npm run agents:check` — verifies that generated agent instructions match the canonical `AGENTS.md`

> When making large changes (data, Service Worker routing, common libs), the project expects tests to pass and (when applicable) local verification via an HTTP server.

---

## 9. Policies for third parties

For redistribution, commercial use, AI training/dataset usage, and other third-party topics:

- `docs/third-party-policy.md`

For database update rules (contributors/editors):

- `docs/db-update-guidelines.md`
