import { CaptionStudio } from './components/CaptionStudio'
import { SAMPLE_TRANSCRIPT } from './lib/sampleTranscript'

export const metadata = {
  title: 'Caption Studio · CreatorClip',
  description: 'Review and fix karaoke captions for a clip, then preview them over the video.',
}

/** /studio — the caption editor + scrub preview, seeded with a demo transcript. */
export default function StudioPage() {
  return (
    <main className="shell">
      <header className="bar">
        <span className="bar__dot" aria-hidden />
        <span>creatorclip-studio</span>
        <span className="bar__sep">/</span>
        <span className="bar__dim">caption studio</span>
        <span className="bar__status">LOCALHOST</span>
      </header>

      <section className="mast">
        <p className="eyebrow">Phase 3 · Karaoke captions</p>
        <h1 className="title">
          Caption<span className="title__accent">.</span> Studio
        </h1>
      </section>

      <CaptionStudio initialTranscript={SAMPLE_TRANSCRIPT} />

      <footer className="foot">
        <span>Review · fix · preview</span>
        <span>edits → /api/captions → burned at export</span>
      </footer>
    </main>
  )
}
