import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { buildFilterChain, sanitizeSettings } from '../shared/filters.mjs'

// 用数组传参（不经 shell），从根上杜绝命令注入；参数本身也全部数值化。
function run(bin, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let timer
    const child = spawn(bin, args, { windowsHide: true })
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`SPAWN_${err.code}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(Object.assign(new Error('NONZERO_EXIT'), { code, stderr }))
    })
    timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('TIMEOUT'))
    }, timeoutMs)
  })
}

let ffmpegPath = null
let ffprobePath = null
export function setFfmpegBin(ff, fp) {
  ffmpegPath = ff
  ffprobePath = fp
}

async function exists(p) {
  try { await access(p, constants.R_OK); return true } catch { return false }
}

let detectionCache = null
export async function detect() {
  if (detectionCache) return detectionCache
  const result = { ffmpeg: false, ffprobe: false, version: null }
  try {
    const { stdout } = await run(ffmpegPath, ['-version'], { timeoutMs: 8000 })
    result.ffmpeg = true
    result.version = stdout.split('\n')[0]?.trim() || 'ffmpeg'
  } catch { /* 不可用 */ }
  try {
    await run(ffprobePath, ['-version'], { timeoutMs: 8000 })
    result.ffprobe = true
  } catch { /* 不可用 */ }
  detectionCache = result
  return result
}

// 用 ffmpeg 探测时长（不强依赖 ffprobe）
export async function probeDuration(file) {
  try {
    const { stderr } = await run(ffmpegPath, ['-i', file, '-hide_banner'])
  } catch (e) {
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(e.stderr || '')
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3])
  }
  return null
}

// 抽 count 张均匀分布的帧（size 为短边等比缩放，控制体积）
export async function extractFrames(src, outDir, count = 5, size = 480) {
  await mkdir(outDir, { recursive: true })
  const duration = (await probeDuration(src)) || null
  const frames = []
  for (let i = 0; i < count; i++) {
    const name = `frame_${i}.jpg`
    const out = path.join(outDir, name)
    const t = duration ? ((i + 0.5) / count) * duration : null
    const args = ['-hide_banner', '-loglevel', 'error', '-y']
    if (t !== null) args.push('-ss', t.toFixed(3))
    args.push('-i', src, '-frames:v', '1', '-vf',
      `scale='if(gt(iw,ih),-2,${size})':'if(gt(iw,ih),${size},-2)'`,
      '-q:v', '4', out)
    await run(ffmpegPath, args, { timeoutMs: 30_000 })
    if (await exists(out)) frames.push(name)
  }
  return { frames, duration }
}

// 对一张抽帧套用滤镜，带磁盘缓存
export async function renderFiltered(framePath, settings, cacheDir) {
  const safe = sanitizeSettings(settings)
  const graph = buildFilterChain(safe)
  const hash = createHash('md5').update(graph).digest('hex').slice(0, 12)
  await mkdir(cacheDir, { recursive: true })
  const out = path.join(cacheDir, `f_${hash}.jpg`)
  if (await exists(out)) return { out, graph, cached: true }
  const args = ['-hide_banner', '-loglevel', 'error', '-y',
    '-i', framePath, '-vf', graph, '-q:v', '3', out]
  try {
    await run(ffmpegPath, args, { timeoutMs: 30_000 })
  } catch (e) {
    const detail = (e.stderr || e.message || '').split('\n').filter(Boolean).slice(-6).join('\n')
    throw Object.assign(new Error('FILTER_RENDER_FAILED'), { detail })
  }
  return { out, graph, cached: false }
}

// 试跑：只解码 1 秒、不写文件，快速验证滤镜链在该 ffmpeg 上可用
export async function testFilter(settings) {
  const graph = buildFilterChain(settings)
  const args = ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=0.4',
    '-vf', graph, '-frames:v', '1', '-f', 'null', '-']
  try {
    await run(ffmpegPath, args, { timeoutMs: 20_000 })
    return { ok: true, graph }
  } catch (e) {
    const detail = (e.stderr || '').split('\n').filter(Boolean).slice(-8).join('\n')
    return { ok: false, graph, detail: detail || e.message }
  }
}

export async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'))
}
export async function writeJson(p, data) {
  await writeFile(p, JSON.stringify(data, null, 2), 'utf8')
}
