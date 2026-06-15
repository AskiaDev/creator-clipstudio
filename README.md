# CreatorClip Studio

Local-first **batch reel renderer** for social-media agencies. Point it at a folder of cut clips + a
metadata CSV, and it renders branded **1080×1920** vertical MP4s, organized by date/account/category,
with crash-safe per-row logging. Everything runs on your machine — nothing is uploaded.

## Requirements

- [Bun](https://bun.sh) (the runtime — `bun --version`)
- **FFmpeg + ffprobe** on your `PATH` (`ffmpeg -version`, `ffprobe -version`). On macOS: `brew install ffmpeg`.

## Setup

```bash
bun install
bun run db:migrate      # create the SQLite tables (drizzle)
```

## Run

```bash
bun run dev             # UI at http://localhost:3000  (Batch Render console)
bun run worker          # in a SECOND terminal — drains the render queue
```

> The `dev`/`start` scripts run Next under **`bun --bun`** on purpose: the DB driver is `bun:sqlite`,
> which only resolves under the Bun runtime. Do not launch the server with bare `next start` / Node —
> DB-backed routes (status, enqueue) would fail. `bun run build` itself runs under Node and is fine
> (the DB module is imported lazily, so the build never evaluates `bun:sqlite`).

### Typical flow

1. In the UI, enter the **input folder** (absolute path to your clips) and paste the **metadata CSV**
   (`file_name,title,subtitle,category,account,template`).
2. **Preview** to validate rows against the folder + known templates (invalid rows are flagged with reasons).
3. **Render batch** to enqueue the valid rows.
4. Run `bun run worker` to render them. Outputs land in `output/{date}/{account}/{category}/{name}_reel.mp4`;
   per-run logs in `logs/render-log-{date}.csv`.

## Develop

```bash
bun test                # unit + golden render/worker integration tests
bun run typecheck       # tsc --noEmit (strict)
bun run lint            # biome
bun run build           # next build
```

## Scope

MVP renderer only. Out of scope: auto-clipping, transcription, AI, auto-posting, cloud rendering,
desktop packaging.
