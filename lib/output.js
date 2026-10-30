/**
 * pnpm output is a foreign string that lands in a transcript cell. Strip
 * terminal control sequences, turn progress carriage returns into line
 * boundaries, and cap what reaches the screen.
 *
 * @module dsh-tui-plugin-update/output
 */

// OSC (hyperlinks, titles), CSI (colors, cursor), and the short two-byte
// escapes. OSC is matched first because it may contain `[` and `;`.
const ANSI = /(?:\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B\[[0-?]*[ -/]*[@-~]|\u001B[@-Z\\-_]|\u009B[0-?]*[ -/]*[@-~])/g
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** Remove ANSI sequences and remaining control characters. */
export function cleanOutput(text) {
  return String(text ?? '')
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CONTROL, '')
}

/**
 * The last `maxLines` meaningful lines of a command's output.
 * @param {string} text
 * @param {{ maxLines?: number, maxCells?: number }} [options]
 * @returns {string[]}
 */
export function tailLines(text, { maxLines = 12, maxCells = 240 } = {}) {
  const lines = cleanOutput(text)
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
    // pnpm's progress lines are noisy and carry no final diagnosis.
    .filter(line => !/^Progress: resolved \d+, reused \d+, downloaded \d+, added \d+(?:, done)?$/.test(line.trim()))
  const deduped = []
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) deduped.push(line)
  }
  return deduped.slice(-maxLines).map(line => line.length > maxCells ? `${line.slice(0, maxCells)}…` : line)
}

/** Whether pnpm said there was nothing to do. */
export function isUpToDate(text) {
  return /already up[ -]?to[ -]?date/i.test(cleanOutput(text))
}
