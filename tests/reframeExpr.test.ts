import { expect, test } from 'bun:test'
import { buildCropExpr, buildCropZoompanExpr } from '../src/reframe/expr'
import type { RectAtTime } from '../src/reframe/types'

test('buildCropExpr emits a static crop filter with integer-rounded pixels', () => {
  expect(buildCropExpr({ x: 656.25, y: 0, width: 607.5, height: 1080 })).toBe('crop=608:1080:656:0')
})

test('buildCropExpr throws on a non-positive dimension', () => {
  expect(() => buildCropExpr({ x: 0, y: 0, width: 0, height: 100 })).toThrow()
})

test('buildCropZoompanExpr collapses a single rect to a static crop', () => {
  const rects: readonly RectAtTime[] = [{ tSec: 0, rect: { x: 656.25, y: 0, width: 607.5, height: 1080 } }]
  expect(buildCropZoompanExpr(rects)).toBe('crop=608:1080:656:0')
})

test('buildCropZoompanExpr collapses constant rects to a static crop', () => {
  const rects: readonly RectAtTime[] = [
    { tSec: 0, rect: { x: 100, y: 0, width: 600, height: 1080 } },
    { tSec: 1, rect: { x: 100, y: 0, width: 600, height: 1080 } },
    { tSec: 2, rect: { x: 100, y: 0, width: 600, height: 1080 } },
  ]
  expect(buildCropZoompanExpr(rects)).toBe('crop=600:1080:100:0')
})

test('buildCropZoompanExpr builds a piecewise-linear expression for a moving x', () => {
  const rects: readonly RectAtTime[] = [
    { tSec: 0, rect: { x: 100, y: 0, width: 600, height: 1080 } },
    { tSec: 2, rect: { x: 300, y: 0, width: 600, height: 1080 } },
  ]
  expect(buildCropZoompanExpr(rects)).toBe("crop=600:1080:'if(lt(t,2),(100+200*t/2),300)':0")
})

test('buildCropZoompanExpr varies width and height when the zoom changes', () => {
  const rects: readonly RectAtTime[] = [
    { tSec: 0, rect: { x: 0, y: 0, width: 600, height: 1080 } },
    { tSec: 1, rect: { x: 0, y: 0, width: 300, height: 540 } },
  ]
  expect(buildCropZoompanExpr(rects)).toBe(
    "crop='if(lt(t,1),(600-300*t),300)':'if(lt(t,1),(1080-540*t),540)':0:0",
  )
})

test('buildCropZoompanExpr holds the first value before a delayed start time', () => {
  const rects: readonly RectAtTime[] = [
    { tSec: 1, rect: { x: 100, y: 0, width: 600, height: 1080 } },
    { tSec: 3, rect: { x: 500, y: 0, width: 600, height: 1080 } },
  ]
  expect(buildCropZoompanExpr(rects)).toBe(
    "crop=600:1080:'if(lt(t,1),100,if(lt(t,3),(100+400*(t-1)/2),500))':0",
  )
})

test('buildCropZoompanExpr sorts out-of-order samples and is deterministic', () => {
  const rects: readonly RectAtTime[] = [
    { tSec: 2, rect: { x: 300, y: 0, width: 600, height: 1080 } },
    { tSec: 0, rect: { x: 100, y: 0, width: 600, height: 1080 } },
  ]
  expect(buildCropZoompanExpr(rects)).toBe("crop=600:1080:'if(lt(t,2),(100+200*t/2),300)':0")
  expect(buildCropZoompanExpr(rects)).toBe(buildCropZoompanExpr(rects))
})

test('buildCropZoompanExpr throws on an empty timeline', () => {
  expect(() => buildCropZoompanExpr([])).toThrow()
})

test('buildCropZoompanExpr handles coincident timestamps without emitting a divide-by-zero', () => {
  const rects: readonly RectAtTime[] = [
    { tSec: 1, rect: { x: 100, y: 0, width: 600, height: 1080 } },
    { tSec: 1, rect: { x: 200, y: 0, width: 600, height: 1080 } },
  ]
  const expr = buildCropZoompanExpr(rects)
  expect(expr).not.toContain('/0')
  expect(expr.startsWith('crop=')).toBe(true)
  expect(buildCropZoompanExpr(rects)).toBe(expr) // deterministic
})
