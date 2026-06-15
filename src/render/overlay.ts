/**
 * Text overlay renderer: template + text → transparent 1080×1920 PNG.
 *
 * Layout is done by satori (flexbox → SVG with glyph outlines), then resvg-js rasterizes the
 * SVG to PNG. Because satori embeds glyphs as vector paths, the rasterizer needs no fonts and
 * the output is deterministic. The PNG is transparent except where text is drawn — the brand
 * background is a separate FFmpeg `color` source (see `ffmpegArgs.ts`), never baked in here.
 *
 * This module spawns no process. `runRender.ts` (Phase 4) writes the returned PNG bytes to a
 * temp file and passes the path as `RenderSpec.overlayInput`, composited full-canvas at 0:0.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import satori, { type Font } from 'satori'
import type { Size } from './ffmpegArgs'

/** The text an overlay can show. Any field omitted/empty is simply not drawn. */
export interface OverlayContent {
  readonly title?: string
  readonly subtitle?: string
  readonly watermark?: string
}

/** Visual style for one text element. `weight` selects the bundled Inter face. */
export interface OverlayTextStyle {
  readonly fontSizePx: number
  readonly color: string
  readonly weight: 400 | 700
}

/** One overlay template: canvas + padding + per-element styles. */
export interface OverlayTemplate {
  readonly canvas: Size
  readonly paddingPx: number
  readonly title: OverlayTextStyle
  readonly subtitle: OverlayTextStyle
  readonly watermark: OverlayTextStyle
}

/** A rasterized overlay: PNG bytes plus the raw RGBA buffer (for alpha inspection). */
export interface OverlayRaster {
  readonly png: Uint8Array
  readonly width: number
  readonly height: number
  /** RGBA, length = width * height * 4. */
  readonly pixels: Uint8Array
}

/** Final vertical reel canvas. */
export const OVERLAY_CANVAS: Size = { width: 1080, height: 1920 }

/** The single built-in template for the MVP (Phase 8 adds the configurable catalog). */
export const DEFAULT_OVERLAY_TEMPLATE: OverlayTemplate = {
  canvas: OVERLAY_CANVAS,
  paddingPx: 72,
  title: { fontSizePx: 76, color: '#ffffff', weight: 700 },
  subtitle: { fontSizePx: 44, color: '#f2f2f2', weight: 400 },
  watermark: { fontSizePx: 32, color: 'rgba(255,255,255,0.82)', weight: 400 },
}

// --- bundled fonts (loaded once) ---------------------------------------------------------

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'fonts')
const FONT_FAMILY = 'Inter'

/** Read a bundled font, failing with a diagnosable message (it must ship alongside this module). */
function loadFont(file: string): Buffer {
  const path = join(FONT_DIR, file)
  try {
    return readFileSync(path)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new Error(
      `Overlay font missing or unreadable at ${path} (${reason}). Bundle it under src/render/assets/fonts/ so it ships with overlay.ts.`,
    )
  }
}

const FONTS: Font[] = [
  { name: FONT_FAMILY, data: loadFont('Inter-Regular.ttf'), weight: 400, style: 'normal' },
  { name: FONT_FAMILY, data: loadFont('Inter-Bold.ttf'), weight: 700, style: 'normal' },
]

// --- pure layout -------------------------------------------------------------------------

type StyleMap = Record<string, string | number>

/** Minimal satori node shape (we build plain objects, no JSX in a `.ts` module). */
interface OverlayNode {
  readonly type: string
  readonly props: {
    readonly style?: StyleMap
    readonly children?: string | OverlayNode | readonly (string | OverlayNode)[]
  }
}

/** Deliberate legibility shadow so light text stays readable over arbitrary video frames. */
const TEXT_SHADOW = '0px 2px 8px rgba(0,0,0,0.55)'

function textNode(text: string, style: OverlayTextStyle, extra: StyleMap = {}): OverlayNode {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        fontFamily: FONT_FAMILY,
        fontSize: style.fontSizePx,
        fontWeight: style.weight,
        color: style.color,
        lineHeight: 1.15,
        textShadow: TEXT_SHADOW,
        ...extra,
      },
      children: text,
    },
  }
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Build the satori element tree for an overlay. Pure and deterministic: title + subtitle stack
 * at the bottom, the watermark sits in the top-right corner. Absent text is omitted entirely.
 */
export function buildOverlayElement(
  content: OverlayContent,
  template: OverlayTemplate = DEFAULT_OVERLAY_TEMPLATE,
): OverlayNode {
  const children: (string | OverlayNode)[] = []

  if (hasText(content.watermark)) {
    children.push(
      textNode(content.watermark, template.watermark, {
        position: 'absolute',
        top: template.paddingPx,
        right: template.paddingPx,
      }),
    )
  }
  if (hasText(content.title)) {
    children.push(textNode(content.title, template.title))
  }
  if (hasText(content.subtitle)) {
    children.push(textNode(content.subtitle, template.subtitle, { marginTop: 18 }))
  }

  return {
    type: 'div',
    props: {
      style: {
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        width: template.canvas.width,
        height: template.canvas.height,
        padding: template.paddingPx,
      },
      children,
    },
  }
}

// --- raster ------------------------------------------------------------------------------

type SatoriArg = Parameters<typeof satori>[0]

/**
 * Render an overlay to PNG + raw RGBA. In-process only (no spawn). The brand background is NOT
 * included — only text on a transparent canvas.
 */
export async function renderOverlay(
  content: OverlayContent,
  template: OverlayTemplate = DEFAULT_OVERLAY_TEMPLATE,
): Promise<OverlayRaster> {
  const element = buildOverlayElement(content, template)
  // satori accepts plain objects at runtime; its static type is React's ReactNode, so we bridge
  // through `unknown` rather than couple the render core to React types.
  const svg = await satori(element as unknown as SatoriArg, {
    width: template.canvas.width,
    height: template.canvas.height,
    fonts: FONTS,
  })

  const rendered = new Resvg(svg, { font: { loadSystemFonts: false } }).render()
  // `.pixels` copies on every property access — read it exactly once.
  const pixels = rendered.pixels
  const png = rendered.asPng()

  return { png, width: rendered.width, height: rendered.height, pixels }
}

/** Convenience for the render pipeline: the PNG bytes only. This is the Phase-4 seam. */
export async function renderOverlayPng(
  content: OverlayContent,
  template: OverlayTemplate = DEFAULT_OVERLAY_TEMPLATE,
): Promise<Uint8Array> {
  return (await renderOverlay(content, template)).png
}
