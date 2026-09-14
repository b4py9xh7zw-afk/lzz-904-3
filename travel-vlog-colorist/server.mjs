import express from 'express'
import multer from 'multer'
import { mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  setFfmpegBin, detect, extractFrames, renderFiltered, testFilter,
} from './lib/ffmpeg.mjs'
import { sanitizeSettings } from './shared/filters.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const UPLOAD_ROOT = path.join(__dirname, 'uploads')
// 仅接收浏览器抽出的帧（JPG）。上限可通过环境变量调整。
const MAX_FRAME_MB = Number(process.env.MAX_UPLOAD_MB || 20)
const MAX_FRAME_BYTES = MAX_FRAME_MB * 1024 * 1024
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg'
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe'
const FRAME_COUNT = 5

setFfmpegBin(FFMPEG_BIN, FFPROBE_BIN)
await mkdir(UPLOAD_ROOT, { recursive: true })

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dirname, 'public')))
// 让浏览器可直接 import 共享模块
app.use('/shared', express.static(path.join(__dirname, 'shared')))
app.use('/uploads', express.static(UPLOAD_ROOT))

const storage = multer.diskStorage({
  // destination 对每个文件都会调用一次：项目 ID 必须按“请求”生成，否则 5 帧会散落到 5 个目录
  destination: async (req, file, cb) => {
    if (!req.projectId) req.projectId = randomUUID()
    const dir = path.join(UPLOAD_ROOT, req.projectId, 'frames')
    try { await mkdir(dir, { recursive: true }); cb(null, dir) } catch (e) { cb(e) }
  },
  filename: (req, file, cb) => cb(null, file.originalname),
})
const upload = multer({
  storage,
  limits: { fileSize: MAX_FRAME_BYTES, files: FRAME_COUNT },
  fileFilter: (req, file, cb) => {
    if (!/^frame_\d+\.jpg$/.test(file.originalname) || !/jpeg|jpg/.test(file.mimetype)) {
      cb(new Error('BAD_FILE_TYPE'))
    } else cb(null, true)
  },
})

app.get('/api/config', async (req, res) => {
  const d = await detect()
  res.json({
    maxUploadMb: MAX_FRAME_MB,
    frameCount: FRAME_COUNT,
    ffmpeg: d,
    ffmpegConfigured: FFMPEG_BIN,
  })
})

// 接收 5 张抽帧（multipart 字段名 frames），并在 ffmpeg 可用时直接渲染原图确认信息
app.post('/api/projects', (req, res) => {
  upload.array('frames', FRAME_COUNT)(req, res, async (err) => {
    const fail = (status, code, message, extra = {}) =>
      res.status(status).json({ error: code, message, ...extra })

    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return fail(413, 'FILE_TOO_LARGE',
          `文件过大：单张抽帧超过 ${MAX_FRAME_MB}MB 上限。`,
          { limitMb: MAX_FRAME_MB, hint: '请降低抽帧分辨率后重试（页面已自动压缩，若仍失败请检查网络/文件）。' })
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return fail(400, 'TOO_MANY_FILES', `最多上传 ${FRAME_COUNT} 张抽帧。`)
      }
      if (err.message === 'BAD_FILE_TYPE') {
        return fail(400, 'BAD_FILE_TYPE', '仅接受 frame_N.jpg 抽帧文件。')
      }
      return fail(500, 'UPLOAD_FAILED', '上传失败：' + (err.message || '未知错误'))
    }

    const files = req.files || []
    if (!files.length) return fail(400, 'NO_FILE', '未收到任何抽帧文件。')

    const d = await detect()
    const sorted = files
      .map((f) => f.filename)
      .sort((a, b) => parseInt(a.match(/\d+/), 10) - parseInt(b.match(/\d+/), 10))

    // ffmpeg 缺失：仍然可以用 CSS 近似预览工作，但需明确告知
    if (!d.ffmpeg) {
      return res.status(200).json({
        projectId: req.projectId,
        frames: sorted,
        ffmpegAvailable: false,
        warning: '服务器未检测到 ffmpeg，仅提供 CSS 近似预览；最终命令请在安装 ffmpeg 的 Windows 机器上运行。',
      })
    }

    res.json({ projectId: req.projectId, frames: sorted, ffmpegAvailable: true })
  })
})

function projectDirs(projectId) {
  if (!/^[0-9a-f-]{36}$/.test(projectId)) throw new Error('BAD_PROJECT')
  const base = path.join(UPLOAD_ROOT, projectId)
  return { base, frames: path.join(base, 'frames'), cache: path.join(base, 'cache') }
}

// 对某一帧套用滤镜，返回真实渲染的 JPG
app.get('/api/projects/:id/filtered', async (req, res) => {
  try {
    const { frames, cache } = projectDirs(req.params.id)
    const idx = Number(req.query.frame ?? 0)
    if (!Number.isInteger(idx) || idx < 0 || idx >= FRAME_COUNT) {
      return res.status(400).json({ error: 'BAD_FRAME', message: '帧序号无效。' })
    }
    let settings
    try { settings = sanitizeSettings(JSON.parse(req.query.settings || '{}')) }
    catch { return res.status(400).json({ error: 'BAD_SETTINGS', message: '滤镜参数无法解析。' }) }

    const d = await detect()
    if (!d.ffmpeg) {
      return res.status(503).json({
        error: 'FFMPEG_UNAVAILABLE',
        message: '服务器没有可用的 ffmpeg，无法生成真实滤镜预览（已自动使用浏览器近似预览）。',
      })
    }

    const framePath = path.join(frames, `frame_${idx}.jpg`)
    const { out, graph } = await renderFiltered(framePath, settings, cache)
    res.set('X-Filter-Graph', encodeURIComponent(graph))
    res.set('Cache-Control', 'private, max-age=3600')
    res.sendFile(out)
  } catch (e) {
    if (e.message === 'BAD_PROJECT') {
      return res.status(400).json({ error: 'BAD_PROJECT', message: '项目 ID 无效。' })
    }
    if (e.code === 'ENOENT') {
      return res.status(404).json({ error: 'FRAME_NOT_FOUND', message: '找不到原始抽帧，可能已过期，请重新加载视频。' })
    }
    res.status(422).json({
      error: 'FILTER_RENDER_FAILED',
      message: '滤镜渲染失败：该 ffmpeg 可能不支持其中某个滤镜。',
      detail: e.detail || e.message,
    })
  }
})

// 试跑滤镜链（不依赖用户视频），用于在生成命令前验证可用性
app.post('/api/test-filter', async (req, res) => {
  const d = await detect()
  if (!d.ffmpeg) {
    return res.status(503).json({
      error: 'FFMPEG_UNAVAILABLE',
      message: '服务器未安装 ffmpeg，无法在线试跑。请在 Windows 上执行命令时验证。',
    })
  }
  const settings = sanitizeSettings(req.body?.settings || {})
  const result = await testFilter(settings)
  res.status(result.ok ? 200 : 422).json(result)
})

// 清理项目（可选）
app.delete('/api/projects/:id', async (req, res) => {
  try {
    const { base } = projectDirs(req.params.id)
    await rm(base, { recursive: true, force: true })
    res.json({ ok: true })
  } catch {
    res.status(400).json({ error: 'BAD_PROJECT', message: '项目 ID 无效。' })
  }
})

app.use((err, req, res, next) => {
  res.status(500).json({ error: 'SERVER_ERROR', message: err.message })
})

app.listen(PORT, () => {
  console.log(`旅行 vlog 调色助手已启动: http://localhost:${PORT}`)
  console.log(`ffmpeg 可执行文件: ${FFMPEG_BIN}（单帧上限 ${MAX_FRAME_MB}MB）`)
})
