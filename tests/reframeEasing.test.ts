import { expect, test } from 'bun:test'
import { easeInOutCubic, linear, smoothstep } from '../src/reframe/easing'

test('linear is the identity on [0,1]', () => {
  expect(linear(0)).toBe(0)
  expect(linear(0.3)).toBeCloseTo(0.3, 12)
  expect(linear(1)).toBe(1)
})

test('linear clamps inputs outside [0,1]', () => {
  expect(linear(-2)).toBe(0)
  expect(linear(5)).toBe(1)
})

test('easeInOutCubic pins endpoints and is symmetric about the midpoint', () => {
  expect(easeInOutCubic(0)).toBe(0)
  expect(easeInOutCubic(1)).toBe(1)
  expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12)
})

test('easeInOutCubic has the expected eased values', () => {
  expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625, 12)
  expect(easeInOutCubic(0.75)).toBeCloseTo(0.9375, 12)
})

test('easeInOutCubic clamps inputs outside [0,1]', () => {
  expect(easeInOutCubic(-1)).toBe(0)
  expect(easeInOutCubic(2)).toBe(1)
})

test('smoothstep pins endpoints, midpoint, and matches 3t^2 - 2t^3', () => {
  expect(smoothstep(0)).toBe(0)
  expect(smoothstep(1)).toBe(1)
  expect(smoothstep(0.5)).toBeCloseTo(0.5, 12)
  expect(smoothstep(0.25)).toBeCloseTo(0.15625, 12)
})
