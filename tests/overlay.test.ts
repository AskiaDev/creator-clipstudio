import { describe, expect, test } from 'bun:test'
import {
  buildOverlayElement,
  DEFAULT_OVERLAY_TEMPLATE,
  type OverlayRaster,
  renderOverlay,
  renderOverlayPng,
} from '../src/render/overlay'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function hasPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b)
}

/** Read width/height from the PNG IHDR chunk (big-endian uint32 at byte 16/20). */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function alphaRange(pixels: Uint8Array): { min: number; max: number } {
  let min = 255
  let max = 0
  for (let i = 3; i < pixels.length; i += 4) {
    const a = pixels[i]
    if (a < min) min = a
    if (a > max) max = a
  }
  return { min, max }
}

/** Count rows containing at least one non-transparent pixel — a proxy for text line count. */
function opaqueRowCount({ pixels, width, height }: OverlayRaster): number {
  let rows = 0
  for (let y = 0; y < height; y++) {
    const base = y * width * 4
    for (let x = 0; x < width; x++) {
      if (pixels[base + x * 4 + 3] > 0) {
        rows++
        break
      }
    }
  }
  return rows
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

const FULL_CONTENT = {
  title: 'Summer Sale Is Live',
  subtitle: 'Up to 50% off everything this weekend',
  watermark: '@brandhandle',
}

describe('overlay renderer', () => {
  test('renders title/subtitle/watermark to a transparent 1080x1920 PNG', async () => {
    // Act
    const raster = await renderOverlay(FULL_CONTENT)

    // Assert — valid PNG at the reel canvas size, matching the raster dimensions
    expect(hasPngSignature(raster.png)).toBe(true)
    expect(pngSize(raster.png)).toEqual({ width: 1080, height: 1920 })
    expect(raster.width).toBe(1080)
    expect(raster.height).toBe(1920)
    expect(raster.pixels.length).toBe(1080 * 1920 * 4)
  })

  test('produces non-empty alpha: text is opaque and the canvas stays transparent', async () => {
    // Act
    const { pixels } = await renderOverlay(FULL_CONTENT)
    const { min, max } = alphaRange(pixels)

    // Assert — both a fully transparent region (alpha 0) and solid text (alpha 255) exist
    expect(min).toBe(0)
    expect(max).toBe(255)
  })

  test('empty content yields a fully transparent canvas without throwing', async () => {
    // Act
    const raster = await renderOverlay({})

    // Assert — correct size, valid PNG, but no opaque pixels at all
    expect(pngSize(raster.png)).toEqual({ width: 1080, height: 1920 })
    expect(alphaRange(raster.pixels).max).toBe(0)
  })

  test('wraps a long title onto more lines than a short title', async () => {
    // Arrange
    const short = await renderOverlay({ title: 'Hi' })
    const long = await renderOverlay({
      title:
        'This is a deliberately long marketing headline that must wrap across several lines to stay inside the vertical canvas',
    })

    // Assert — the wrapped headline occupies strictly more text rows, and still renders text
    expect(alphaRange(long.pixels).max).toBeGreaterThan(0)
    expect(opaqueRowCount(long)).toBeGreaterThan(opaqueRowCount(short))
  })

  test('is deterministic: identical input renders byte-identical PNGs', async () => {
    // Act
    const a = await renderOverlayPng(FULL_CONTENT)
    const b = await renderOverlayPng(FULL_CONTENT)

    // Assert
    expect(bytesEqual(a, b)).toBe(true)
  })

  test('renderOverlayPng (the Phase-4 seam) returns PNG bytes at 1080x1920', async () => {
    // Act
    const png = await renderOverlayPng(FULL_CONTENT)

    // Assert
    expect(hasPngSignature(png)).toBe(true)
    expect(pngSize(png)).toEqual({ width: 1080, height: 1920 })
  })

  test('buildOverlayElement omits absent text fields (pure layout)', () => {
    // Act — only a title; subtitle and watermark are absent
    const node = buildOverlayElement({ title: 'Only Title' }, DEFAULT_OVERLAY_TEMPLATE)
    const children = node.props.children as readonly unknown[]

    // Assert — exactly one child (the title); nothing invented for missing fields
    expect(Array.isArray(children)).toBe(true)
    expect(children).toHaveLength(1)
  })
})
