import { BatchConsole } from './components/BatchConsole'
import { StudioPanel } from './components/StudioPanel'

export default function Home() {
  return (
    <main className="shell">
      <header className="bar">
        <span className="bar__dot" aria-hidden />
        <span>creatorclip-studio</span>
        <span className="bar__sep">/</span>
        <span className="bar__dim">batch renderer</span>
        <span className="bar__status">LOCALHOST</span>
      </header>

      <section className="mast">
        <p className="eyebrow">Local-first · Batch reel renderer</p>
        <h1 className="title">
          Render<span className="title__accent">.</span> Deck
        </h1>
      </section>

      <BatchConsole />
      <StudioPanel />

      <footer className="foot">
        <span>Phase 7 — Batch Render UI</span>
        <span>clips → 1080×1920 reels · on your machine</span>
      </footer>
    </main>
  )
}
