const STAGES = [
  { n: '01', name: 'ffprobe', desc: 'Inspect duration, dimensions, audio.' },
  { n: '02', name: 'overlay', desc: 'Satori + resvg → 1080×1920 PNG.' },
  { n: '03', name: 'ffmpeg', desc: 'Scale, crop, composite, H.264 / AAC.' },
  { n: '04', name: 'output', desc: 'Dated, per-account, per-category MP4s.' },
] as const

export default function Home() {
  return (
    <main className="shell">
      <header className="bar">
        <span className="bar__dot" aria-hidden />
        <span>creatorclip-studio</span>
        <span className="bar__sep">/</span>
        <span className="bar__dim">renderer-mvp</span>
        <span className="bar__status">DEV SKELETON</span>
      </header>

      <section className="hero">
        <p className="eyebrow">Local-first · Batch reel renderer</p>
        <h1 className="title">
          CreatorClip<span className="title__accent">.</span> Studio
        </h1>
        <p className="lede">
          Turn a folder of cut clips, a metadata CSV, and a template into branded
          1080×1920 vertical reels — rendered at volume, entirely on your machine.
        </p>
      </section>

      <section className="pipe" aria-label="Render pipeline">
        {STAGES.map((stage) => (
          <article key={stage.n} className="stage">
            <span className="stage__n">{stage.n}</span>
            <span className="stage__name">{stage.name}</span>
            <span className="stage__desc">{stage.desc}</span>
          </article>
        ))}
      </section>

      <footer className="foot">
        <span>Phase 1 — Scaffold + preflight</span>
        <span className="foot__ok">● ready</span>
      </footer>
    </main>
  )
}
