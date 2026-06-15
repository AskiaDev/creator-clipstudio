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

## Transcription (AI pipeline · Phase 1)

The first AI-pipeline phase turns a local video into a typed, timestamped transcript, fully on-device
via [whisper.cpp](https://github.com/ggerganov/whisper.cpp). One-time setup:

```bash
brew install whisper-cpp                                   # provides the `whisper-cli` binary
mkdir -p models                                            # ggml models live here (gitignored)
curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

Then transcribe a clip:

```bash
bun run transcribe path/to/video.mp4          # prints segment count + duration
bun run transcribe path/to/video.mp4 --json   # also prints the full Transcript JSON
```

Overrides (optional): `WHISPER_BIN` (default `whisper-cli`) and `WHISPER_MODEL`
(default `models/ggml-base.en.bin`). A source with no audio stream yields an empty transcript with a
note rather than an error. Audio never leaves your machine.

## Scope

Shipped: the **MVP renderer** (batch reel rendering — the export stage). In progress: the **v2 AI
repurposing pipeline** (ingest → transcribe → auto-clip → captions → reframe → b-roll), built locally
on whisper.cpp + Ollama. Still out of scope: auto-posting, cloud rendering, desktop packaging.
