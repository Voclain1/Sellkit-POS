# Sellkit POS — Guidelines

Offline-first point of sale. A cashier must be able to keep selling with the
network down, and nothing taken at the till may ever be lost. Most of the rules
below exist to protect that.

## Tech Stack
- **Client**: Vite 8 + React 19 + TypeScript + Tailwind v4 + IndexedDB, installable as a PWA
- **Server**: Express 5 + Prisma 6 + PostgreSQL (Neon)
- **Repo**: monorepo, `client/` and `server/` each with their own `package.json` and lockfile.
  The root `package.json` only orchestrates — it is **not** an npm workspace.

## Layout
```
client/   Vite SPA. src/components (pos, checkout, auth, common),
          src/lib/api.ts, src/lib/offline/{db,sync}.ts, src/lib/pwa.ts
server/   Express API. src/routes -> src/controllers, src/prisma.ts,
          prisma/schema.prisma, prisma/migrations
```

## Setup
```bash
npm run install:all                       # root + client + server dependencies
cp server/.env.example server/.env        # DATABASE_URL, JWT_SECRET, PIN_PEPPER, PORT
cp client/.env.example client/.env        # VITE_API_BASE_URL
npm run db:generate && npm run db:migrate && npm run db:seed
npm run dev                               # both processes, colour-tagged
```
Server listens on `PORT` (default 3000) and mounts everything under `/api`.
`GET /api/health` pings PostgreSQL and is the fastest way to confirm the stack is wired up.

## Key Commands
All run from the repo root.

| Command | What it does |
| --- | --- |
| `npm run dev` | Client + server together (`-k`: one dies, both stop) |
| `npm run dev:client` / `dev:server` | Either half on its own |
| `npm run build` | Server `tsc`, then client `tsc -b && vite build` |
| `npm run start` | Built server + `vite preview` — the only way to exercise the service worker |
| `npm run typecheck` | `tsc` across both projects, no emit |
| `npm run lint` | oxlint on the client |
| `npm run db:migrate` | `prisma migrate dev` — schema change + migration file |
| `npm run db:deploy` | `prisma migrate deploy` — apply existing migrations (CI/prod) |
| `npm run db:seed` | `prisma db seed` → `tsx src/seed.ts` |
| `npm run db:generate` | Regenerate the Prisma client after any schema edit |
| `npm run db:studio` | Prisma Studio |
| `npm run clean` | Drop `client/dist`, `server/dist`, `client/dev-dist` |

`npm --prefix <dir> run <script>` runs with the working directory set to that
package. `npm --prefix <dir> exec` does **not** — it stays in the caller's cwd,
which is why every sub-command lives as a script inside `client/` or `server/`
rather than being invoked directly from the root.

## Architecture Rules

### Styling
- Use semantic CSS tokens (`bg-card`, `bg-surface`, `text-muted`, `text-foreground`,
  `border-border`, `bg-brand`, `text-success`, `text-danger`, `bg-accent`) — never raw
  palette colours (`slate-500`, `emerald-400`, `purple-500`). Tokens are declared once in
  `client/src/index.css` under `:root` / `.dark` and exposed through `@theme inline`.
- Adding a colour means adding a token in **both** blocks, not reaching for the palette.
- The one deliberate exception is the receipt body (`#printable-receipt`), which is
  literally black on white because it previews thermal printer output.

### Dark mode
- The `dark` class belongs on `document.documentElement`, never on a wrapper `<div>`.
  `body` and any portalled modal resolve their variables at `:root`; a nested class
  leaves them themed wrong.
- `index.html` sets the class from `localStorage.sellkit_theme` before first paint;
  `App.tsx` keeps it, `color-scheme`, and the `theme-color` meta in sync afterwards.

### Offline & IndexedDB
- **Always await the transaction, not the request.** IndexedDB fires `onsuccess` on a
  write before the transaction commits — `client/src/lib/offline/db.ts` exports `txDone()`
  for this. A sale reported as saved but lost on reload is a lost sale.
- A queued sale is **never deleted except after a confirmed successful POST.** When the
  server rejects one (4xx), mark it `failed` so it stops blocking the queue, and surface
  the reason — do not drop it.
- One failing record must not halt the sync loop; isolate it and carry on with the rest.
- `syncAll()` is single-flight. Reconnect, the retry sweep and manual retry can all fire
  at once, and a replayed sale double-counts at the till.

### API
- Every endpoint returns standard status codes and a JSON `{ error }` on failure.
- The client's `ApiError` splits retryable (status 0 / 5xx) from permanent (4xx); the
  offline queue depends on that distinction, so keep server status codes honest —
  a validation failure returned as 500 would make the queue retry forever.
- Checkout should be idempotent on replay: a POST that succeeds but loses its response
  will be resent by the offline queue.

### PWA
- `vite-plugin-pwa` in `client/vite.config.ts`, `registerType: 'prompt'`.
  Never switch to `autoUpdate` — it reloads the page the moment a new worker activates,
  which at a till discards an in-progress cart. `PwaUpdatePrompt` asks first and stays
  disabled while a cart is open or sales are pending sync.
- API responses are never precached (`navigateFallbackDenylist: [/^\/api\//]`) —
  stale stock or prices at the counter are worse than an error.
- The service worker is disabled in dev. Test it with `npm run build && npm run start`.
- Icons in `client/public/` are generated from `app-icon.svg` / `app-icon-maskable.svg`.

### Printing
- Receipts target 80mm thermal paper: `@page { size: 80mm auto; margin: 0 }`, pure white
  ground, pure black text, in the `@media print` block of `client/src/index.css`.
- Non-printable UI carries `.no-print` and is `display: none` in print, not merely
  invisible — hidden-but-present elements reserve blank paper on the roll.
- The receipt sits inside a scroll container under a `backdrop-filter` ancestor, which is
  a containing block for fixed positioning. The print rules unwrap `.receipt-overlay` /
  `.receipt-panel` / `.receipt-scroll`; without that, anything past one viewport is
  silently cut off the printout.

## Secrets
`.env` is git-ignored; `.env.example` is committed and is the source of truth for which
variables exist. `server/src/middleware/auth.ts` currently falls back to a hardcoded
`JWT_SECRET` when the env var is unset — set it everywhere and remove that fallback
before any deployment.
