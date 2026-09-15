/**
 * The pairing QR is the only bridge between the two halves of this feature, so
 * it is verified against published reference data — the standard's byte-mode
 * capacity rows, its format-information strings, its alignment-pattern centres
 * — and then read back out of the finished matrix by a decoder written here,
 * independently of the encoder, which recovers the original payload.
 */

import { describe, expect, it } from 'vitest'
import {
  alignmentPatternCenters,
  blockLayout,
  byteCapacity,
  encodeQr,
  formatBits,
  qrPathData,
  versionBits,
  type QrMatrix,
} from '../src/client/qr.ts'

/** Published byte-mode capacities, version 1 through 40 (ISO/IEC 18004 table 7). */
const CAPACITY_L = [
  17, 32, 53, 78, 106, 134, 154, 192, 230, 271,
  321, 367, 425, 458, 520, 586, 644, 718, 792, 858,
  929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732,
  1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953,
]
const CAPACITY_M = [
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213,
  251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
  711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370,
  1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331,
]

describe('reference data', () => {
  it('reproduces every published byte-mode capacity', () => {
    expect(Array.from({ length: 40 }, (_, at) => byteCapacity(at + 1, 'L'))).toEqual(CAPACITY_L)
    expect(Array.from({ length: 40 }, (_, at) => byteCapacity(at + 1, 'M'))).toEqual(CAPACITY_M)
  })

  it('reproduces the published format-information strings', () => {
    // Level L with each of the eight masks, then level M with mask 0.
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(mask => formatBits('L', mask).toString(2).padStart(15, '0'))).toEqual([
      '111011111000100', '111001011110011', '111110110101010', '111100010011101',
      '110011000101111', '110001100011000', '110110001000001', '110100101110110',
    ])
    expect(formatBits('M', 0).toString(2).padStart(15, '0')).toBe('101010000010010')
  })

  it('reproduces the published version-information string and omits it below version 7', () => {
    expect(versionBits(6)).toBeUndefined()
    expect(versionBits(7)?.toString(2).padStart(18, '0')).toBe('000111110010010100')
  })

  it('reproduces the published alignment-pattern centres', () => {
    expect(alignmentPatternCenters(1)).toEqual([])
    expect(alignmentPatternCenters(2)).toEqual([6, 18])
    expect(alignmentPatternCenters(7)).toEqual([6, 22, 38])
    expect(alignmentPatternCenters(32)).toEqual([6, 34, 60, 86, 112, 138])
  })

  it('splits blocks so every codeword is accounted for', () => {
    for (const level of ['L', 'M'] as const) {
      for (let version = 1; version <= 40; version += 1) {
        const layout = blockLayout(version, level)
        const dataTotal = layout.blocks.reduce((sum, block) => sum + block, 0)
        expect(dataTotal + layout.eccPerBlock * layout.blocks.length).toBe(layout.totalCodewords)
        expect(Math.max(...layout.blocks) - Math.min(...layout.blocks)).toBeLessThanOrEqual(1)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// An independent reader. It shares only the standard's tables with the
// encoder; the reserved-module map, the placement walk, the masks, the format
// read, and the byte-mode parse are written from the specification here.
// ---------------------------------------------------------------------------

function reservedMap(version: number): boolean[][] {
  const size = version * 4 + 17
  const reserved = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  const mark = (row: number, col: number): void => {
    if (row >= 0 && row < size && col >= 0 && col < size) reserved[row]![col] = true
  }
  // Top-left keeps nine rows and nine columns (finder, separator, format);
  // the other two corners keep eight in the direction facing the edge, so the
  // ninth row/column there stays available to data.
  for (let row = 0; row <= 8; row += 1) {
    for (let col = 0; col <= 8; col += 1) mark(row, col)
    for (let col = 0; col <= 7; col += 1) mark(row, size - 1 - col)
  }
  for (let row = 0; row <= 7; row += 1) {
    for (let col = 0; col <= 8; col += 1) mark(size - 1 - row, col)
  }
  for (let at = 0; at < size; at += 1) {
    mark(6, at)
    mark(at, 6)
  }
  const centers = alignmentPatternCenters(version)
  for (const row of centers) {
    for (const col of centers) {
      const corner = (row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)
      if (corner) continue
      for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) mark(row + dr, col + dc)
    }
  }
  if (version >= 7) {
    for (let at = 0; at < 6; at += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        mark(at, size - 11 + offset)
        mark(size - 11 + offset, at)
      }
    }
  }
  return reserved
}

const MASKS: ((row: number, col: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  i => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
  (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0,
  (i, j) => ((i + j) % 2 + (i * j) % 3) % 2 === 0,
]

/** Read the second format copy and undo the standard's 0x5412 mask. */
function readFormat(matrix: QrMatrix): { level: 'L' | 'M'; mask: number } {
  const { size, modules } = matrix
  let bits = 0
  for (let at = 0; at < 8; at += 1) bits |= (modules[8]![size - 1 - at]! ? 1 : 0) << at
  for (let at = 8; at < 15; at += 1) bits |= (modules[size - 15 + at]![8]! ? 1 : 0) << at
  const raw = bits ^ 0x5412
  const levelBits = (raw >> 13) & 0b11
  const level = levelBits === 0b01 ? 'L' : levelBits === 0b00 ? 'M' : undefined
  if (level === undefined) throw new Error(`unexpected error-correction level bits ${levelBits}`)
  return { level, mask: (raw >> 10) & 0b111 }
}

/** Walk the placement path and collect the unmasked data bits. */
function readCodewords(matrix: QrMatrix, mask: number): number[] {
  const { size, modules } = matrix
  const reserved = reservedMap(matrix.version)
  const apply = MASKS[mask]!
  const bits: number[] = []
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    // The vertical timing column is not a data column: the walk steps over it
    // and every later pair shifts with it.
    if (right === 6) right = 5
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step
      for (const col of [right, right - 1]) {
        if (reserved[row]![col]!) continue
        const module = modules[row]![col]!
        bits.push((module !== apply(row, col)) ? 1 : 0)
      }
    }
    upward = !upward
  }
  const codewords: number[] = []
  for (let at = 0; at + 7 < bits.length; at += 8) {
    let value = 0
    for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | bits[at + bit]!
    codewords.push(value)
  }
  return codewords
}

/** Undo the block interleave and return the data codewords in message order. */
function deinterleave(codewords: number[], version: number, level: 'L' | 'M'): number[] {
  const layout = blockLayout(version, level)
  const blocks: number[][] = layout.blocks.map(() => [])
  const longest = Math.max(...layout.blocks)
  let at = 0
  for (let index = 0; index < longest; index += 1) {
    for (let block = 0; block < layout.blocks.length; block += 1) {
      if (index >= layout.blocks[block]!) continue
      blocks[block]!.push(codewords[at]!)
      at += 1
    }
  }
  return blocks.flat()
}

/** Parse one byte-mode segment out of the data codewords. */
function readBytes(data: number[], version: number): Uint8Array {
  let cursor = 0
  const take = (count: number): number => {
    let value = 0
    for (let at = 0; at < count; at += 1) {
      const byte = data[Math.floor(cursor / 8)]!
      value = (value << 1) | ((byte >> (7 - cursor % 8)) & 1)
      cursor += 1
    }
    return value
  }
  expect(take(4)).toBe(0b0100)
  const length = take(version < 10 ? 8 : 16)
  return Uint8Array.from(Array.from({ length }, () => take(8)))
}

/** The full independent read: format, mask, placement, interleave, payload. */
function decode(matrix: QrMatrix): string {
  const format = readFormat(matrix)
  expect(format.level).toBe(matrix.level)
  const data = deinterleave(readCodewords(matrix, format.mask), matrix.version, format.level)
  return new TextDecoder().decode(readBytes(data, matrix.version))
}

describe('encoded matrices', () => {
  const pairing = JSON.stringify({
    v: 1,
    name: 'izzy-workstation',
    url: 'https://192.168.1.24:8765',
    token: 'GmQ7x1sJ0kL9pR3tY6wZ2aB5cD8eF1gH4iJ7kM0nO3Q',
    fingerprint: 'a'.repeat(64),
    expires: '2026-09-15T10:10:00.000Z',
  })

  it('carries the pairing payload through to a byte-identical read back', () => {
    const matrix = encodeQr(pairing)
    expect(matrix.size).toBe(matrix.version * 4 + 17)
    expect(decode(matrix)).toBe(pairing)
  })

  it('reads back payloads across the version and level ladder', () => {
    for (const text of ['a', 'saturn', 'x'.repeat(50), 'y'.repeat(300), 'z'.repeat(1200), '✓ verdict PASS · 判决']) {
      const matrix = encodeQr(text)
      expect(decode(matrix)).toBe(text)
    }
  })

  it('places the three finder patterns and the dark module', () => {
    const matrix = encodeQr(pairing)
    const { size, modules } = matrix
    for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 7; col += 1) {
          const ring = row === 0 || row === 6 || col === 0 || col === 6
          const core = row >= 2 && row <= 4 && col >= 2 && col <= 4
          expect(modules[top + row]![left + col]).toBe(ring || core)
        }
      }
    }
    for (let at = 8; at < size - 8; at += 1) {
      expect(modules[6]![at]).toBe(at % 2 === 0)
      expect(modules[at]![6]).toBe(at % 2 === 0)
    }
    expect(modules[size - 8]![8]).toBe(true)
  })

  it('chooses the smallest version that fits and upgrades the level when there is room', () => {
    expect(encodeQr('saturn').level).toBe('M')
    expect(encodeQr('a'.repeat(2300)).level).toBe('L')
    expect(encodeQr('a'.repeat(14)).version).toBe(1)
    expect(encodeQr('a'.repeat(15)).version).toBe(2)
    expect(() => encodeQr('a'.repeat(2954))).toThrow(/too large/u)
    expect(() => encodeQr('')).toThrow(/empty/u)
  })

  it('draws a path whose commands cover exactly the dark modules', () => {
    const matrix = encodeQr('saturn')
    const path = qrPathData(matrix)
    const dark = matrix.modules.flat().filter(Boolean).length
    expect(path.match(/M/gu)?.length).toBe(dark)
    expect(path.startsWith('M')).toBe(true)
    expect(path).not.toContain('NaN')
  })
})
