'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RenderTemplate } from '@/src/templates/schema'

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error ?? `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}

export function StudioPanel() {
  const [templates, setTemplates] = useState<RenderTemplate[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [name, setName] = useState('')
  const [crf, setCrf] = useState(20)
  const [titleSize, setTitleSize] = useState(72)
  const [titleColor, setTitleColor] = useState('#ffffff')

  const [folder, setFolder] = useState('')
  const [fileName, setFileName] = useState('')
  const [account, setAccount] = useState('acme')
  const [sampleTitle, setSampleTitle] = useState('Sample Title')
  const [sampleSubtitle, setSampleSubtitle] = useState('a subtitle')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewObjectUrl = useRef<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const applySelection = useCallback((template: RenderTemplate) => {
    setSelectedKey(template.key)
    setName(template.name)
    setCrf(template.crf)
    setTitleSize(template.overlay.title.fontSizePx)
    setTitleColor(template.overlay.title.color)
  }, [])

  const loadTemplates = useCallback(async () => {
    try {
      const response = await fetch('/api/templates', { cache: 'no-store' })
      if (!response.ok) {
        setError(await readError(response))
        return
      }
      const body = (await response.json()) as { templates: RenderTemplate[] }
      setTemplates(body.templates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load templates')
    }
  }, [])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  // auto-select the first template once they load
  useEffect(() => {
    if (selectedKey === '' && templates.length > 0) {
      applySelection(templates[0])
    }
  }, [templates, selectedKey, applySelection])

  // revoke the object URL on unmount (renderPreview revokes the previous one before each new render)
  useEffect(() => {
    return () => {
      if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
    }
  }, [])

  const selected = templates.find((t) => t.key === selectedKey)

  const saveTemplate = useCallback(async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const config = {
        ...selected,
        name,
        crf,
        overlay: { ...selected.overlay, title: { ...selected.overlay.title, fontSizePx: titleSize, color: titleColor } },
      }
      const response = await fetch('/api/templates', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!response.ok) {
        setError(await readError(response))
        return
      }
      setNotice(`Saved template "${name}".`)
      await loadTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }, [selected, name, crf, titleSize, titleColor, loadTemplates])

  const renderPreview = useCallback(async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputFolder: folder,
          fileName,
          templateKey: selectedKey,
          account,
          title: sampleTitle,
          subtitle: sampleSubtitle,
        }),
      })
      if (!response.ok) {
        setError(await readError(response))
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
      previewObjectUrl.current = url
      setPreviewUrl(url)
      setNotice('Rendered a sample frame at the clip midpoint.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }, [folder, fileName, selectedKey, account, sampleTitle, sampleSubtitle])

  const canPreview = folder.trim() !== '' && fileName.trim() !== '' && selectedKey !== '' && !busy

  return (
    <section className="console">
      <div className="panel">
        <div className="panel__head">
          <span className="panel__n">03</span>
          <span className="panel__title">Templates</span>
          <span className="panel__hint">{templates.length} built-in</span>
        </div>

        <label className="field">
          <span className="field__label">Template</span>
          <select
            className="input"
            value={selectedKey}
            onChange={(e) => {
              const next = templates.find((t) => t.key === e.target.value)
              if (next) applySelection(next)
            }}
          >
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Name</span>
          <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="actions">
          <label className="field" style={{ flex: 1 }}>
            <span className="field__label">CRF (quality)</span>
            <input
              className="input"
              type="number"
              min={0}
              max={51}
              value={crf}
              onChange={(e) => setCrf(Number(e.target.value))}
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="field__label">Title size (px)</span>
            <input
              className="input"
              type="number"
              min={1}
              value={titleSize}
              onChange={(e) => setTitleSize(Number(e.target.value))}
            />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="field__label">Title color</span>
            <input className="input" type="text" value={titleColor} onChange={(e) => setTitleColor(e.target.value)} />
          </label>
        </div>

        <div className="actions">
          <button type="button" className="btn btn--primary" onClick={saveTemplate} disabled={!selected || busy}>
            Save template
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <span className="panel__n">04</span>
          <span className="panel__title">Sample preview</span>
          <span className="panel__hint">real frame</span>
        </div>

        <div className="actions">
          <label className="field" style={{ flex: 2 }}>
            <span className="field__label">Input folder</span>
            <input className="input" type="text" placeholder="/Users/you/clips" value={folder} onChange={(e) => setFolder(e.target.value)} spellCheck={false} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="field__label">File</span>
            <input className="input" type="text" placeholder="clip-01.mp4" value={fileName} onChange={(e) => setFileName(e.target.value)} spellCheck={false} />
          </label>
        </div>

        <div className="actions">
          <label className="field" style={{ flex: 1 }}>
            <span className="field__label">Title</span>
            <input className="input" type="text" value={sampleTitle} onChange={(e) => setSampleTitle(e.target.value)} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="field__label">Subtitle</span>
            <input className="input" type="text" value={sampleSubtitle} onChange={(e) => setSampleSubtitle(e.target.value)} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="field__label">Account (watermark)</span>
            <input className="input" type="text" value={account} onChange={(e) => setAccount(e.target.value)} />
          </label>
        </div>

        <div className="actions">
          <button type="button" className="btn" onClick={renderPreview} disabled={!canPreview}>
            Render preview
          </button>
        </div>

        {error ? <p className="msg msg--err">{error}</p> : null}
        {notice ? <p className="msg msg--ok">{notice}</p> : null}

        {previewUrl ? (
          // biome-ignore lint/performance/noImgElement: object-URL blob preview, not a static asset
          <img className="preview-img" src={previewUrl} alt="Sample render preview" width={1080} height={1920} />
        ) : (
          <p className="empty">Pick a clip + template and render a real composited frame before committing the batch.</p>
        )}
      </div>
    </section>
  )
}
