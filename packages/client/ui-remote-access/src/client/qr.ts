/**
 * A QR encoder, byte mode, versions 1 through 40, error-correction levels L
 * and M — written here because the pairing code must be drawable with the
 * browser bundle the app already ships and nothing else, and because a QR that
 * only *looks* like a QR is a feature that fails in someone's kitchen.
 *
 * The published tables this depends on are asserted against ISO/IEC 18004's
 * own capacity, format-information, and alignment-centre values in the suite,
 * and every matrix is read back out by an independent decoder there.
 */

/** Error-correction levels this encoder produces. */
export type QrLevel = 'L' | 'M'

/** One finished symbol. `modules[row][col]` is true where the module is dark. */
export interface QrMatrix {
  /** Symbol version, 1 through 40. */
  version: number
  /** Error-correction level actually used. */
  level: QrLevel
  /** Side length in modules, `version * 4 + 17`. */
  size: number
  /** Row-major module grid; true is dark. */
  modules: boolean[][]
}

/** The block split for one version and level. */
export interface QrBlockLayout {
  /** Data plus error-correction codewords the symbol holds. */
  totalCodewords: number
  /** Error-correction codewords per block. */
  eccPerBlock: number
  /** Data codewords in each block, short blocks first. */
  blocks: number[]
}

/** ISO/IEC 18004 table 13-22: error-correction codewords per block, versions 1-40. */
const ECC_PER_BLOCK: Record<QrLevel, readonly number[]> = {
  L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
}

/** ISO/IEC 18004 table 13-22: error-correction blocks, versions 1-40. */
const BLOCKS: Record<QrLevel, readonly number[]> = {
  L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
    8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
}

/** Two-bit level indicator carried by the format information. */
const LEVEL_BITS: Record<QrLevel | 'Q' | 'H', number> = { M: 0b00, L: 0b01, H: 0b10, Q: 0b11 }

const BYTE_MODE = 0b0100
const PAD_BYTES = [0xec, 0x11]
const FORMAT_GENERATOR = 0x537
const FORMAT_MASK = 0x5412
const VERSION_GENERATOR = 0x1f25
const GF_PRIMITIVE = 0x11d
const MAX_VERSION = 40

/**
 * Read one element of a table whose index the caller has already bounded.
 * @param list - the table.
 * @param index - an index the caller derived from the table's own extent.
 * @returns the element.
 */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index]
  /* v8 ignore next -- every caller derives the index from the table's own length. */
  if (value === undefined) throw new Error(`qr: index ${String(index)} is outside the table`)
  return value
}

/** Character-count indicator width for byte mode at one version. */
function countBits(version: number): number {
  return version < 10 ? 8 : 16
}

function assertVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION) {
    throw new Error(`qr: version ${String(version)} is outside 1-40`)
  }
}

/**
 * Centre coordinates of the alignment patterns for one version.
 * @param version - symbol version.
 * @returns the centres, ascending; empty for version 1.
 */
export function alignmentPatternCenters(version: number): number[] {
  assertVersion(version)
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2
  const centers = [6]
  for (let position = version * 4 + 17 - 7; centers.length < count; position -= step) {
    centers.splice(1, 0, position)
  }
  return centers
}

/** Data plus error-correction bits one version holds, after the function patterns. */
function rawDataBits(version: number): number {
  let bits = (16 * version + 128) * version + 64
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2
    bits -= (25 * count - 10) * count - 55
    if (version >= 7) bits -= 36
  }
  return bits
}

/**
 * How the codewords of one version and level are split into blocks.
 * @param version - symbol version.
 * @param level - error-correction level.
 * @returns the totals and the per-block data counts.
 */
export function blockLayout(version: number, level: QrLevel): QrBlockLayout {
  assertVersion(version)
  const totalCodewords = Math.floor(rawDataBits(version) / 8)
  const eccPerBlock = at(ECC_PER_BLOCK[level], version - 1)
  const count = at(BLOCKS[level], version - 1)
  const dataTotal = totalCodewords - eccPerBlock * count
  const short = Math.floor(dataTotal / count)
  const shortCount = count - dataTotal % count
  return {
    totalCodewords,
    eccPerBlock,
    blocks: Array.from({ length: count }, (_unused, index) => index < shortCount ? short : short + 1),
  }
}

function dataCapacity(version: number, level: QrLevel): number {
  return blockLayout(version, level).blocks.reduce((sum, block) => sum + block, 0)
}

/**
 * How many raw bytes one version and level can carry in byte mode.
 * @param version - symbol version.
 * @param level - error-correction level.
 * @returns the byte capacity.
 */
export function byteCapacity(version: number, level: QrLevel): number {
  return Math.floor((dataCapacity(version, level) * 8 - 4 - countBits(version)) / 8)
}

/** Remainder of one value under a BCH generator polynomial. */
function bch(value: number, generator: number, degree: number): number {
  let remainder = value << degree
  for (let bit = Math.floor(Math.log2(remainder)); bit >= degree; bit -= 1) {
    if ((remainder >> bit & 1) === 0) continue
    remainder ^= generator << (bit - degree)
  }
  return (value << degree) | remainder
}

/**
 * The fifteen-bit format information for one level and mask.
 * @param level - error-correction level.
 * @param mask - mask pattern 0 through 7.
 * @returns the masked format bits.
 */
export function formatBits(level: QrLevel | 'Q' | 'H', mask: number): number {
  return bch(LEVEL_BITS[level] << 3 | mask, FORMAT_GENERATOR, 10) ^ FORMAT_MASK
}

/**
 * The eighteen-bit version information, which only versions 7 and up carry.
 * @param version - symbol version.
 * @returns the version bits, or undefined below version 7.
 */
export function versionBits(version: number): number | undefined {
  assertVersion(version)
  return version < 7 ? undefined : bch(version, VERSION_GENERATOR, 12)
}

/** GF(256) multiply under the QR primitive polynomial. */
function gfMultiply(left: number, right: number): number {
  let result = 0
  for (let bit = 7; bit >= 0; bit -= 1) {
    result = (result << 1) ^ ((result >> 7) * GF_PRIMITIVE)
    result ^= ((right >> bit) & 1) * left
  }
  return result & 0xff
}

/** Reed-Solomon generator polynomial of one degree, the leading term implied. */
function generatorPolynomial(degree: number): number[] {
  let poly = [1]
  let root = 1
  for (let step = 0; step < degree; step += 1) {
    const next = Array.from({ length: poly.length + 1 }, () => 0)
    poly.forEach((coefficient, index) => {
      next[index] = at(next, index) ^ coefficient
      next[index + 1] = at(next, index + 1) ^ gfMultiply(coefficient, root)
    })
    poly = next
    root = gfMultiply(root, 2)
  }
  return poly.slice(1)
}

/** The error-correction codewords for one data block. */
function eccCodewords(data: readonly number[], degree: number): number[] {
  const generator = generatorPolynomial(degree)
  const remainder = Array.from({ length: degree }, () => 0)
  for (const byte of data) {
    const factor = byte ^ at(remainder, 0)
    remainder.shift()
    remainder.push(0)
    generator.forEach((coefficient, index) => {
      remainder[index] = at(remainder, index) ^ gfMultiply(coefficient, factor)
    })
  }
  return remainder
}

/** Mask predicates 0 through 7, by row and column. */
const MASKS: readonly ((row: number, col: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  i => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
  (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0,
  (i, j) => ((i + j) % 2 + (i * j) % 3) % 2 === 0,
]

/** One symbol under construction: a flat dark grid and a flat reserved grid. */
interface Canvas {
  size: number
  dark: boolean[]
  fixed: boolean[]
}

function canvas(version: number): Canvas {
  const size = version * 4 + 17
  return {
    size,
    dark: Array.from({ length: size * size }, () => false),
    fixed: Array.from({ length: size * size }, () => false),
  }
}

function inside(board: Canvas, row: number, col: number): boolean {
  return row >= 0 && row < board.size && col >= 0 && col < board.size
}

function isDark(board: Canvas, row: number, col: number): boolean {
  return at(board.dark, row * board.size + col)
}

function isFixed(board: Canvas, row: number, col: number): boolean {
  return at(board.fixed, row * board.size + col)
}

/** Write one module and mark it a function module. */
function put(board: Canvas, row: number, col: number, dark: boolean): void {
  if (!inside(board, row, col)) return
  board.dark[row * board.size + col] = dark
  board.fixed[row * board.size + col] = true
}

/** Reserve one module without touching the value already drawn there. */
function reserve(board: Canvas, row: number, col: number): void {
  board.fixed[row * board.size + col] = true
}

/** Finder pattern with its separator, anchored at one centre. */
function drawFinder(board: Canvas, centerRow: number, centerCol: number): void {
  for (let dr = -4; dr <= 4; dr += 1) {
    for (let dc = -4; dc <= 4; dc += 1) {
      const distance = Math.max(Math.abs(dr), Math.abs(dc))
      put(board, centerRow + dr, centerCol + dc, distance !== 2 && distance <= 3)
    }
  }
}

function drawFunctionPatterns(board: Canvas, version: number): void {
  const last = board.size - 1
  for (let step = 0; step < board.size; step += 1) {
    put(board, 6, step, step % 2 === 0)
    put(board, step, 6, step % 2 === 0)
  }
  drawFinder(board, 3, 3)
  drawFinder(board, 3, last - 3)
  drawFinder(board, last - 3, 3)

  const centers = alignmentPatternCenters(version)
  for (const row of centers) {
    for (const col of centers) {
      const corner = (row === 6 && col === 6) || (row === 6 && col === board.size - 7)
        || (row === board.size - 7 && col === 6)
      if (corner) continue
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          put(board, row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
        }
      }
    }
  }

  // Reserve the format seats; their value depends on the mask chosen later.
  // Reserved, never written: two cells the naive rectangle would cover —
  // (6,8) and (8,6) — belong to the timing patterns and already carry a value.
  for (let step = 0; step <= 8; step += 1) {
    reserve(board, step, 8)
    reserve(board, 8, step)
  }
  for (let step = 0; step < 8; step += 1) {
    reserve(board, 8, last - step)
    reserve(board, last - step, 8)
  }
  put(board, last - 7, 8, true)

  const version18 = versionBits(version)
  if (version18 === undefined) return
  for (let step = 0; step < 18; step += 1) {
    const dark = ((version18 >> step) & 1) === 1
    const near = board.size - 11 + step % 3
    const far = Math.floor(step / 3)
    put(board, far, near, dark)
    put(board, near, far, dark)
  }
}

function drawFormat(board: Canvas, level: QrLevel, mask: number): void {
  const bits = formatBits(level, mask)
  const bit = (index: number): boolean => ((bits >> index) & 1) === 1
  const last = board.size - 1
  for (let step = 0; step <= 5; step += 1) put(board, step, 8, bit(step))
  put(board, 7, 8, bit(6))
  put(board, 8, 8, bit(7))
  put(board, 8, 7, bit(8))
  for (let step = 9; step < 15; step += 1) put(board, 8, 14 - step, bit(step))
  for (let step = 0; step < 8; step += 1) put(board, 8, last - step, bit(step))
  for (let step = 8; step < 15; step += 1) put(board, board.size - 15 + step, 8, bit(step))
  put(board, last - 7, 8, true)
}

/** Lay the interleaved codewords along the standard boustrophedon path. */
function drawCodewords(board: Canvas, codewords: readonly number[]): void {
  let cursor = 0
  let upward = true
  for (let right = board.size - 1; right >= 1; right -= 2) {
    // The vertical timing column is not a data column: the walk steps over it
    // and every later pair shifts with it.
    if (right === 6) right = 5
    for (let step = 0; step < board.size; step += 1) {
      const row = upward ? board.size - 1 - step : step
      for (const col of [right, right - 1]) {
        if (isFixed(board, row, col)) continue
        const byte = codewords[cursor >>> 3] ?? 0
        board.dark[row * board.size + col] = ((byte >> (7 - (cursor & 7))) & 1) === 1
        cursor += 1
      }
    }
    upward = !upward
  }
}

/** The 1:1:3:1:1 finder-like run the standard penalizes when light-bounded. */
const FINDER_RUN = [true, false, true, true, true, false, true]

/** Rows first, then columns, as plain boolean lines. */
function lines(board: Canvas): boolean[][] {
  const rows = Array.from({ length: board.size }, (_unused, row) =>
    Array.from({ length: board.size }, (_cell, col) => isDark(board, row, col)))
  const columns = Array.from({ length: board.size }, (_unused, col) =>
    Array.from({ length: board.size }, (_cell, row) => isDark(board, row, col)))
  return [...rows, ...columns]
}

/** Penalty score of one masked symbol (ISO/IEC 18004 section 8.8.2). */
function penalty(board: Canvas): number {
  const size = board.size
  let score = 0
  for (const line of lines(board)) {
    let run = 1
    for (let step = 1; step <= size; step += 1) {
      if (step < size && line[step] === line[step - 1]) {
        run += 1
        continue
      }
      if (run >= 5) score += 3 + (run - 5)
      run = 1
    }
    for (let start = 0; start + 7 <= size; start += 1) {
      if (!FINDER_RUN.every((value, offset) => line[start + offset] === value)) continue
      const clearBefore = start >= 4 && line.slice(start - 4, start).every(value => !value)
      const clearAfter = start + 11 <= size && line.slice(start + 7, start + 11).every(value => !value)
      if (clearBefore || clearAfter) score += 40
    }
  }
  for (let row = 0; row + 1 < size; row += 1) {
    for (let col = 0; col + 1 < size; col += 1) {
      const first = isDark(board, row, col)
      if (isDark(board, row, col + 1) === first && isDark(board, row + 1, col) === first
        && isDark(board, row + 1, col + 1) === first) score += 3
    }
  }
  const dark = board.dark.filter(Boolean).length
  score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10
  return score
}

/**
 * Choose the symbol: the smallest version that fits, upgraded to level M when
 * that costs at most one extra version. A pairing code is scanned once, close
 * up, so size matters more than redundancy up to that bound.
 */
function choose(byteLength: number): { version: number; level: QrLevel } {
  let smallest: { version: number; level: QrLevel } | undefined
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    if (byteCapacity(version, 'M') >= byteLength) {
      if (smallest === undefined || version <= smallest.version + 1) return { version, level: 'M' }
      return smallest
    }
    if (smallest === undefined && byteCapacity(version, 'L') >= byteLength) {
      smallest = { version, level: 'L' }
    }
  }
  if (smallest === undefined) throw new Error(`qr: ${String(byteLength)} bytes is too large for one symbol`)
  return smallest
}

/** Mode indicator, length, payload, terminator, and the alternating pad. */
function dataCodewords(bytes: Uint8Array, version: number, level: QrLevel): number[] {
  const capacity = dataCapacity(version, level)
  const bits: number[] = []
  const push = (value: number, width: number): void => {
    for (let index = width - 1; index >= 0; index -= 1) bits.push((value >> index) & 1)
  }
  push(BYTE_MODE, 4)
  push(bytes.length, countBits(version))
  for (const byte of bytes) push(byte, 8)
  for (let index = 0; index < 4 && bits.length < capacity * 8; index += 1) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)
  const codewords: number[] = []
  for (let start = 0; start < bits.length; start += 8) {
    codewords.push(bits.slice(start, start + 8).reduce((value, bit) => (value << 1) | bit, 0))
  }
  for (let index = 0; codewords.length < capacity; index += 1) codewords.push(at(PAD_BYTES, index % 2))
  return codewords
}

/** Split into blocks, append error correction, and interleave both halves. */
function interleave(data: readonly number[], version: number, level: QrLevel): number[] {
  const layout = blockLayout(version, level)
  const blocks: number[][] = []
  const ecc: number[][] = []
  let cursor = 0
  for (const size of layout.blocks) {
    const block = data.slice(cursor, cursor + size)
    cursor += size
    blocks.push(block)
    ecc.push(eccCodewords(block, layout.eccPerBlock))
  }
  const out: number[] = []
  const longest = Math.max(...layout.blocks)
  for (let index = 0; index < longest; index += 1) {
    for (const block of blocks) {
      const codeword = block[index]
      if (codeword !== undefined) out.push(codeword)
    }
  }
  for (let index = 0; index < layout.eccPerBlock; index += 1) {
    for (const block of ecc) out.push(at(block, index))
  }
  return out
}

/** Draw one masked candidate and score it. */
function candidate(version: number, level: QrLevel, codewords: readonly number[], mask: number): { board: Canvas; score: number } {
  const board = canvas(version)
  drawFunctionPatterns(board, version)
  drawCodewords(board, codewords)
  drawFormat(board, level, mask)
  const predicate = at(MASKS, mask)
  for (let row = 0; row < board.size; row += 1) {
    for (let col = 0; col < board.size; col += 1) {
      if (isFixed(board, row, col) || !predicate(row, col)) continue
      board.dark[row * board.size + col] = !isDark(board, row, col)
    }
  }
  return { board, score: penalty(board) }
}

/**
 * Encode one string as a QR symbol.
 * @param text - the payload; encoded as UTF-8 in byte mode.
 * @returns the finished matrix.
 * @throws when the text is empty or larger than any symbol.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length === 0) throw new Error('qr: nothing to encode (the payload is empty)')
  const { version, level } = choose(bytes.length)
  const codewords = interleave(dataCodewords(bytes, version, level), version, level)
  const best = Array.from({ length: 8 }, (_unused, mask) => candidate(version, level, codewords, mask))
    .reduce((chosen, next) => next.score < chosen.score ? next : chosen)
  const modules = Array.from({ length: best.board.size }, (_unused, row) =>
    Array.from({ length: best.board.size }, (_cell, col) => isDark(best.board, row, col)))
  return { version, level, size: best.board.size, modules }
}

/**
 * SVG path data covering the dark modules, one unit per module.
 * @param matrix - the encoded symbol.
 * @returns the `d` attribute for a single path.
 */
export function qrPathData(matrix: QrMatrix): string {
  const parts: string[] = []
  matrix.modules.forEach((row, rowIndex) => {
    row.forEach((dark, colIndex) => {
      if (dark) parts.push(`M${String(colIndex)} ${String(rowIndex)}h1v1h-1z`)
    })
  })
  return parts.join('')
}
