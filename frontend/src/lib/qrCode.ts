const QR_VERSION = 4
const QR_SIZE = QR_VERSION * 4 + 17
const DATA_CODEWORDS = 80
const ERROR_CORRECTION_CODEWORDS = 20
const QUIET_ZONE = 4
const FORMAT_POLYNOMIAL = 0x537
const FORMAT_MASK = 0x5412
const LOW_ERROR_CORRECTION_FORMAT_BITS = 1

type Cell = boolean | null

export function buildQrCodeSvg(value: string): string {
  const codewords = encodeCodewords(value)
  const errorCorrection = calculateErrorCorrection(codewords)
  const bits = [...codewords, ...errorCorrection].flatMap(byteToBits)
  const baseMatrix = createBaseMatrix()
  const matrix = chooseBestMask(baseMatrix, bits)
  const svgSize = QR_SIZE + QUIET_ZONE * 2
  const modules = matrix.flatMap((row, y) => row.map((isDark, x) => isDark ? `<rect x="${x + QUIET_ZONE}" y="${y + QUIET_ZONE}" width="1" height="1"/>` : '')).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" role="img" shape-rendering="crispEdges"><title>QR code for ${escapeHtml(value)}</title><rect width="100%" height="100%" fill="#fff"/><g fill="#111827">${modules}</g></svg>`
}

function encodeCodewords(value: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(value))
  if (bytes.length > DATA_CODEWORDS - 3) {
    throw new Error('QR value is too long')
  }

  const bits = [0, 1, 0, 0, ...byteToBits(bytes.length), ...bytes.flatMap(byteToBits)]
  bits.push(...Array(Math.min(4, DATA_CODEWORDS * 8 - bits.length)).fill(0))
  while (bits.length % 8 !== 0) bits.push(0)

  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bitsToByte(bits.slice(i, i + 8)))
  }

  let padByte = 0xec
  while (codewords.length < DATA_CODEWORDS) {
    codewords.push(padByte)
    padByte = padByte === 0xec ? 0x11 : 0xec
  }

  return codewords
}

function createBaseMatrix(): Cell[][] {
  const matrix = Array.from({ length: QR_SIZE }, () => Array<Cell>(QR_SIZE).fill(null))

  drawFinder(matrix, 0, 0)
  drawFinder(matrix, QR_SIZE - 7, 0)
  drawFinder(matrix, 0, QR_SIZE - 7)
  drawTimingPatterns(matrix)
  drawAlignmentPattern(matrix, 26, 26)
  reserveFormatBits(matrix)
  matrix[QR_VERSION * 4 + 9][8] = true

  return matrix
}

function chooseBestMask(baseMatrix: Cell[][], bits: number[]): boolean[][] {
  let bestMatrix: boolean[][] | null = null
  let bestPenalty = Number.POSITIVE_INFINITY

  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = cloneMatrix(baseMatrix)
    drawData(matrix, bits, mask)
    drawFormatBits(matrix, mask)
    const completedMatrix = matrix.map(row => row.map(Boolean))
    const penalty = calculatePenalty(completedMatrix)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      bestMatrix = completedMatrix
    }
  }

  return bestMatrix ?? baseMatrix.map(row => row.map(Boolean))
}

function drawFinder(matrix: Cell[][], left: number, top: number) {
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const row = top + y
      const col = left + x
      if (row < 0 || row >= QR_SIZE || col < 0 || col >= QR_SIZE) continue
      const isFinder = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4))
      matrix[row][col] = isFinder
    }
  }
}

function drawTimingPatterns(matrix: Cell[][]) {
  for (let i = 8; i < QR_SIZE - 8; i += 1) {
    const isDark = i % 2 === 0
    if (matrix[6][i] === null) matrix[6][i] = isDark
    if (matrix[i][6] === null) matrix[i][6] = isDark
  }
}

function drawAlignmentPattern(matrix: Cell[][], centerX: number, centerY: number) {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      matrix[centerY + y][centerX + x] = Math.max(Math.abs(x), Math.abs(y)) !== 1
    }
  }
}

function reserveFormatBits(matrix: Cell[][]) {
  for (const [x, y] of getFormatPositions().flat()) {
    matrix[y][x] = false
  }
}

function drawData(matrix: Cell[][], bits: number[], mask: number) {
  let bitIndex = 0
  let upward = true

  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1

    for (let vertical = 0; vertical < QR_SIZE; vertical += 1) {
      const y = upward ? QR_SIZE - 1 - vertical : vertical
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset
        if (matrix[y][x] !== null) continue
        const bit = bitIndex < bits.length ? bits[bitIndex] === 1 : false
        matrix[y][x] = bit !== shouldMask(mask, x, y)
        bitIndex += 1
      }
    }

    upward = !upward
  }
}

function shouldMask(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
    default: return false
  }
}

function drawFormatBits(matrix: Cell[][], mask: number) {
  const bits = calculateFormatBits(mask)
  const [firstPositions, secondPositions] = getFormatPositions()

  for (let i = 0; i < 15; i += 1) {
    const bit = ((bits >> i) & 1) === 1
    matrix[firstPositions[i][1]][firstPositions[i][0]] = bit
    matrix[secondPositions[i][1]][secondPositions[i][0]] = bit
  }
}

function getFormatPositions(): [number[][], number[][]] {
  return [
    [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]],
    [[QR_SIZE - 1, 8], [QR_SIZE - 2, 8], [QR_SIZE - 3, 8], [QR_SIZE - 4, 8], [QR_SIZE - 5, 8], [QR_SIZE - 6, 8], [QR_SIZE - 7, 8], [QR_SIZE - 8, 8], [8, QR_SIZE - 7], [8, QR_SIZE - 6], [8, QR_SIZE - 5], [8, QR_SIZE - 4], [8, QR_SIZE - 3], [8, QR_SIZE - 2], [8, QR_SIZE - 1]],
  ]
}

function calculateFormatBits(mask: number): number {
  const data = (LOW_ERROR_CORRECTION_FORMAT_BITS << 3) | mask
  let remainder = data << 10
  for (let i = 14; i >= 10; i -= 1) {
    if (((remainder >> i) & 1) !== 0) {
      remainder ^= FORMAT_POLYNOMIAL << (i - 10)
    }
  }

  return ((data << 10) | remainder) ^ FORMAT_MASK
}

function calculateErrorCorrection(codewords: number[]): number[] {
  const generator = reedSolomonGenerator(ERROR_CORRECTION_CODEWORDS)
  const result = Array(ERROR_CORRECTION_CODEWORDS).fill(0)

  for (const codeword of codewords) {
    const factor = codeword ^ result.shift()
    result.push(0)
    for (let i = 0; i < ERROR_CORRECTION_CODEWORDS; i += 1) {
      result[i] ^= multiplyGalois(generator[i], factor)
    }
  }

  return result
}

function reedSolomonGenerator(degree: number): number[] {
  const generator = Array(degree).fill(0)
  generator[degree - 1] = 1
  let root = 1

  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < generator.length; j += 1) {
      generator[j] = multiplyGalois(generator[j], root)
      if (j + 1 < generator.length) generator[j] ^= generator[j + 1]
    }
    root = multiplyGalois(root, 0x02)
  }

  return generator
}

function multiplyGalois(x: number, y: number): number {
  let product = 0
  for (let i = 7; i >= 0; i -= 1) {
    product = (product << 1) ^ ((product & 0x80) !== 0 ? 0x11d : 0)
    if (((y >> i) & 1) !== 0) product ^= x
  }
  return product & 0xff
}

function calculatePenalty(matrix: boolean[][]): number {
  let penalty = 0
  penalty += calculateRunPenalty(matrix)
  penalty += calculateBlockPenalty(matrix)
  penalty += calculateFinderLikePenalty(matrix)
  penalty += calculateBalancePenalty(matrix)
  return penalty
}

function calculateRunPenalty(matrix: boolean[][]): number {
  let penalty = 0
  for (let y = 0; y < QR_SIZE; y += 1) penalty += countRunPenalty(matrix[y])
  for (let x = 0; x < QR_SIZE; x += 1) penalty += countRunPenalty(matrix.map(row => row[x]))
  return penalty
}

function countRunPenalty(line: boolean[]): number {
  let penalty = 0
  let runColor = line[0]
  let runLength = 1

  for (let i = 1; i < line.length; i += 1) {
    if (line[i] === runColor) {
      runLength += 1
    } else {
      if (runLength >= 5) penalty += runLength - 2
      runColor = line[i]
      runLength = 1
    }
  }

  return penalty + (runLength >= 5 ? runLength - 2 : 0)
}

function calculateBlockPenalty(matrix: boolean[][]): number {
  let penalty = 0
  for (let y = 0; y < QR_SIZE - 1; y += 1) {
    for (let x = 0; x < QR_SIZE - 1; x += 1) {
      const color = matrix[y][x]
      if (matrix[y][x + 1] === color && matrix[y + 1][x] === color && matrix[y + 1][x + 1] === color) penalty += 3
    }
  }
  return penalty
}

function calculateFinderLikePenalty(matrix: boolean[][]): number {
  let penalty = 0
  const pattern = '10111010000'
  const reversePattern = '00001011101'
  for (let y = 0; y < QR_SIZE; y += 1) penalty += countPatternPenalty(matrix[y], pattern, reversePattern)
  for (let x = 0; x < QR_SIZE; x += 1) penalty += countPatternPenalty(matrix.map(row => row[x]), pattern, reversePattern)
  return penalty
}

function countPatternPenalty(line: boolean[], pattern: string, reversePattern: string): number {
  const text = line.map(cell => cell ? '1' : '0').join('')
  let penalty = 0
  for (let i = 0; i <= text.length - pattern.length; i += 1) {
    const segment = text.slice(i, i + pattern.length)
    if (segment === pattern || segment === reversePattern) penalty += 40
  }
  return penalty
}

function calculateBalancePenalty(matrix: boolean[][]): number {
  const darkCount = matrix.flat().filter(Boolean).length
  const percent = darkCount * 100 / (QR_SIZE * QR_SIZE)
  return Math.floor(Math.abs(percent - 50) / 5) * 10
}

function byteToBits(byte: number): number[] {
  return Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1)
}

function bitsToByte(bits: number[]): number {
  return bits.reduce((byte, bit) => (byte << 1) | bit, 0)
}

function cloneMatrix(matrix: Cell[][]): Cell[][] {
  return matrix.map(row => [...row])
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
