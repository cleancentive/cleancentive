#!/usr/bin/env bun
/**
 * close-feedback: scan commit messages for "Fix(es) <id>" tags and close the
 * matching feedback ticket — locally (frontmatter + move to fixed/) and
 * upstream on cleancentive.org (response + status=resolved).
 *
 * Usage:
 *   bun scripts/close-feedback.ts <sha>[:<id>] [...] [--dry-run]
 *
 * Without an explicit `:<id>`, the script reads the commit message and matches
 * `Fix(es) <id>` (case-insensitive). The `sha:id` form is for retroactive
 * closures where the convention wasn't followed.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync } from 'fs'
import { execSync } from 'child_process'
import { join, basename } from 'path'

const REPO_ROOT = execSync('git rev-parse --show-toplevel').toString().trim()
const PLANS_DIR = join(REPO_ROOT, 'docs/feedback-plans/cleancentive.org')
const FIXED_DIR = join(PLANS_DIR, 'fixed')
const TOKEN_FILE = join(REPO_ROOT, 'infrastructure/.feedback-token.cleancentive.org')
const API_BASE = process.env.FEEDBACK_API_BASE || 'https://cleancentive.org/api/v1'
const REPO_URL = process.env.FEEDBACK_REPO_URL || 'https://github.com/cleancentive/cleancentive'
const FIX_TAG_RE = /\bfix(?:es)?\s+([0-9a-f]{8,}(?:-[0-9a-f-]+)?)/gi
const DRY_RUN = process.env.DRY_RUN === '1' || process.argv.includes('--dry-run')

function listPlans(): string[] {
  const out: string[] = []
  for (const dir of [PLANS_DIR, FIXED_DIR]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.md')) out.push(join(dir, f))
    }
  }
  return out
}

function resolveId(token: string): string | null {
  const lower = token.toLowerCase()
  const matches = listPlans().filter((p) => basename(p, '.md').toLowerCase().startsWith(lower))
  if (matches.length === 0) return null
  if (matches.length > 1) {
    console.error(`  ✗ ambiguous id "${token}": matches ${matches.map((m) => basename(m)).join(', ')}`)
    return null
  }
  return matches[0]
}

function loadToken(): string | null {
  if (!existsSync(TOKEN_FILE)) return null
  const t = readFileSync(TOKEN_FILE, 'utf8').trim()
  return t || null
}

function gitSubject(sha: string): string {
  return execSync(`git log -1 --format=%s ${sha}`).toString().trim()
}

function gitBody(sha: string): string {
  return execSync(`git log -1 --format=%B ${sha}`).toString()
}

function shortSha(sha: string): string {
  return execSync(`git rev-parse --short ${sha}`).toString().trim()
}

interface Parsed {
  fm: string[]
  body: string[]
}

function parse(content: string): Parsed {
  const lines = content.split('\n')
  if (lines[0] !== '---') throw new Error('missing frontmatter')
  const end = lines.indexOf('---', 1)
  if (end < 0) throw new Error('unterminated frontmatter')
  return { fm: lines.slice(1, end), body: lines.slice(end + 1) }
}

function serialise(p: Parsed): string {
  return ['---', ...p.fm, '---', ...p.body].join('\n')
}

function findKey(fm: string[], key: string): number {
  return fm.findIndex((l) => l === `${key}:` || l.startsWith(`${key}: `))
}

function setScalar(fm: string[], key: string, value: string): void {
  const idx = findKey(fm, key)
  if (idx >= 0) fm[idx] = `${key}: ${value}`
  else fm.push(`${key}: ${value}`)
}

function appendToArray(fm: string[], key: string, value: string): boolean {
  const idx = findKey(fm, key)
  if (idx < 0) {
    fm.push(`${key}:`, `  - ${value}`)
    return true
  }
  let end = idx + 1
  while (end < fm.length && fm[end].startsWith('  -')) {
    if (fm[end].trim() === `- ${value}`) return false
    end++
  }
  if (fm[idx] !== `${key}:`) {
    const existing = fm[idx].substring(`${key}:`.length).trim()
    fm[idx] = `${key}:`
    if (existing && existing !== '[]') {
      fm.splice(idx + 1, 0, `  - ${existing}`)
      if (existing === value) return false
      fm.splice(idx + 2, 0, `  - ${value}`)
    } else {
      fm.splice(idx + 1, 0, `  - ${value}`)
    }
    return true
  }
  fm.splice(end, 0, `  - ${value}`)
  return true
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

async function postClosure(
  id: string,
  message: string,
  token: string,
): Promise<{ ok: boolean; err?: string }> {
  try {
    const r1 = await fetch(`${API_BASE}/feedback/${id}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message }),
    })
    if (!r1.ok) return { ok: false, err: `POST responses ${r1.status}: ${await r1.text()}` }
    const r2 = await fetch(`${API_BASE}/feedback/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'resolved' }),
    })
    if (!r2.ok) return { ok: false, err: `PATCH status ${r2.status}: ${await r2.text()}` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, err: String(e?.message || e) }
  }
}

async function processCommit(sha: string, token: string | null, overrideId?: string): Promise<void> {
  const subject = gitSubject(sha)
  const short = shortSha(sha)

  const planPaths = new Set<string>()
  if (overrideId) {
    const planPath = resolveId(overrideId)
    if (!planPath) {
      console.warn(`  ✗ ${short} unknown id "${overrideId}"`)
      return
    }
    planPaths.add(planPath)
  } else {
    const matches = [...gitBody(sha).matchAll(FIX_TAG_RE)]
    if (matches.length === 0) {
      console.log(`· ${short} no Fix tag`)
      return
    }
    for (const m of matches) {
      const planPath = resolveId(m[1])
      if (!planPath) {
        console.warn(`  ✗ ${short} unknown id "${m[1]}"`)
        continue
      }
      planPaths.add(planPath)
    }
  }

  for (const planPath of planPaths) {
    const id = basename(planPath, '.md')
    const content = readFileSync(planPath, 'utf8')
    const parsed = parse(content)
    const inFixed = planPath.startsWith(FIXED_DIR)

    const newClosure = appendToArray(parsed.fm, 'closure_commits', short)
    if (!newClosure && inFixed) {
      console.log(`· ${short} ${id.slice(0, 8)} already closed — skipping`)
      continue
    }

    setScalar(parsed.fm, 'status', 'implemented')
    setScalar(parsed.fm, 'last_updated', todayUtc())
    if (findKey(parsed.fm, 'fixed_at') < 0) setScalar(parsed.fm, 'fixed_at', todayUtc())

    const targetPath = inFixed ? planPath : join(FIXED_DIR, basename(planPath))

    if (DRY_RUN) {
      console.log(`[dry-run] ${short} ${id} → ${targetPath.replace(REPO_ROOT + '/', '')}`)
      console.log(serialise(parsed).split('\n').slice(0, 14).map((l) => `         ${l}`).join('\n'))
    } else {
      if (planPath !== targetPath && !existsSync(FIXED_DIR)) mkdirSync(FIXED_DIR, { recursive: true })
      writeFileSync(planPath, serialise(parsed))
      if (planPath !== targetPath) renameSync(planPath, targetPath)
      console.log(`✓ ${short} ${id} → fixed/`)
    }

    if (!token) {
      console.warn(`  ! no token at ${TOKEN_FILE.replace(REPO_ROOT + '/', '')}, skipping prod update`)
      continue
    }
    const message = `Fix shipped in [${short}](${REPO_URL}/commit/${sha}): ${subject}`
    if (DRY_RUN) {
      console.log(`[dry-run] POST /feedback/${id}/responses { message: ${JSON.stringify(message)} }`)
      console.log(`[dry-run] PATCH /feedback/${id}/status   { status: "resolved" }`)
      continue
    }
    const result = await postClosure(id, message, token)
    if (result.ok) console.log(`  ✓ posted closure response + status=resolved`)
    else console.warn(`  ✗ prod update failed: ${result.err}`)
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (args.length === 0) {
    console.error('usage: bun scripts/close-feedback.ts <sha>[:<id>] [...] [--dry-run]')
    process.exit(2)
  }
  const token = loadToken()
  if (!token) console.warn(`! no token at ${TOKEN_FILE} — prod-side updates will be skipped`)
  for (const arg of args) {
    const [sha, overrideId] = arg.split(':', 2)
    try {
      await processCommit(sha, token, overrideId)
    } catch (e: any) {
      console.error(`✗ ${sha}: ${e?.message || e}`)
    }
  }
}

main()
