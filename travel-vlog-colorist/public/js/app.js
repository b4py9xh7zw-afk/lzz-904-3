import { SCENES, PRESETS, CONTROLS, DEFAULT_SETTINGS, sanitizeSettings, buildCssFilter } from '../../shared/filters.mjs'
import { extractFrames, uploadFrames } from './frames.js'
import { buildCommands, buildBatch, normalizeWinPath } from './commands.js'

const $ = (s) => document.querySelector(s)
const state = {
  config: null,
  scene: 'beach',
  project: null,           // {id, frames, ffmpegAvailable}
  originals: [],           // object URLs
  frameIdx: 0,
  presetId: null,
  settings: { ...DEFAULT_SETTINGS },
  schemes: [],
  selectedSchemeId: null,
  videoName: '',
  realRenderFailed: false, // 当前参数真实渲染是否失败（回退 CSS）
  renderToken: 0,
}
const LS_KEY = 'tvcs_schemes_v1'
const BIG_VIDEO_MB = 500

// ---------- toast ----------
function toast(level, title, msg = '') {
  const el = document.createElement('div')
  el.className = `toast ${level}`
  el.innerHTML = `<div class="t-title"></div><div class="t-msg"></div>`
  el.querySelector('.t-title').textContent = title
  el.querySelector('.t-msg').textContent = msg
  $('#toastWrap').appendChild(el)
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300) }, 4200)
}

// ---------- init ----------
async function init() {
  bindStatic()
  renderPresets()
  renderSliders()
  loadSchemes()
  try {
    const cfg = await fetch('/api/config').then((r) => r.json())
    state.config = cfg
    const b = $('#envBadge')
    if (cfg.ffmpeg?.ffmpeg) {
      b.textContent = '🖥 ffmpeg 就绪'
      b.className = 'env-badge ok'
      b.title = cfg.ffmpeg.version || ''
    } else {
      b.textContent = '⚠ 服务器无 ffmpeg（近似预览）'
      b.className = 'env-badge bad'
      toast('warn', '未检测到 ffmpeg', '将使用浏览器 CSS 近似预览；最终命令仍可生成，请在 Windows 上安装 ffmpeg 后执行。')
    }
  } catch {
    $('#envBadge').textContent = '配置检测失败'
    $('#envBadge').className = 'env-badge bad'
  }
}

function setStep(n) {
  document.querySelectorAll('.step').forEach((el) => {
    const s = Number(el.dataset.step)
    el.classList.toggle('active', s === n)
    el.classList.toggle('done', s < n)
  })
}

// ---------- static bindings ----------
function bindStatic() {
  // scene
  $('#sceneSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-scene]')
    if (!btn) return
    state.scene = btn.dataset.scene
    document.querySelectorAll('#sceneSeg button').forEach((b) => b.classList.toggle('active', b === btn))
    renderPresets()
  })

  // upload
  const dz = $('#dropzone')
  const fi = $('#fileInput')
  dz.addEventListener('click', () => fi.click())
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fi.click() })
  fi.addEventListener('change', () => fi.files[0] && handleFile(fi.files[0]))
  ;['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover') }))
  ;['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover') }))
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files?.[0]; if (f) handleFile(f) })

  $('#resetTune').addEventListener('click', () => {
    const base = state.presetId ? PRESETS.find((p) => p.id === state.presetId)?.settings : DEFAULT_SETTINGS
    state.settings = sanitizeSettings(base)
    state.selectedSchemeId = null
    syncSliders(); renderSchemes(); scheduleRender()
  })

  // schemes
  $('#saveScheme').addEventListener('click', saveScheme)
  $('#schemeName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveScheme() })
  $('#exportSchemes').addEventListener('click', exportSchemes)
  $('#importSchemes').addEventListener('change', importSchemes)

  // commands
  $('#generateCmd').addEventListener('click', generateCommand)
  $('#testFilter').addEventListener('click', testFilterOnline)
  $('#copyCmd').addEventListener('click', copyCommand)
  $('#downloadBat').addEventListener('click', downloadBatch)
  $('#inputPath').addEventListener('input', () => setHint($('#cmdHint'), '', ''))

  // comparator drag
  bindComparator()
}

// ---------- presets / sliders ----------
function renderPresets() {
  const grid = $('#presetGrid')
  grid.innerHTML = ''
  PRESETS.filter((p) => p.scene === state.scene).forEach((p) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'preset' + (state.presetId === p.id ? ' active' : '')
    b.innerHTML = `<div class="p-emoji">${p.emoji}</div><div class="p-name"></div><div class="p-desc"></div>`
    b.querySelector('.p-name').textContent = p.name
    b.querySelector('.p-desc').textContent = p.desc
    b.addEventListener('click', () => applyPreset(p))
    grid.appendChild(b)
  })
}

function applyPreset(p) {
  state.presetId = p.id
  state.settings = sanitizeSettings(p.settings)
  state.selectedSchemeId = null
  state.realRenderFailed = false
  renderPresets()
  syncSliders()
  renderSchemes()
  scheduleRender()
  setStep(2)
  toast('ok', `已应用预设：${p.name}`, p.desc)
}

function renderSliders() {
  const wrap = $('#sliders')
  wrap.innerHTML = ''
  CONTROLS.forEach((c) => {
    const row = document.createElement('div')
    row.className = 'slider-row'
    row.innerHTML = `<label><span></span><b></b></label><input type="range" min="${c.min}" max="${c.max}" step="${c.step}" />`
    row.querySelector('label span').textContent = c.label
    const val = state.settings[c.key]
    row.querySelector('label b').textContent = fmtVal(c.key, val)
    const input = row.querySelector('input')
    input.value = val
    input.addEventListener('input', () => {
      state.settings[c.key] = Number(input.value)
      state.selectedSchemeId = null
      state.realRenderFailed = false
      row.querySelector('label b').textContent = fmtVal(c.key, input.value)
      renderSchemes()
      scheduleRender()
    })
    wrap.appendChild(row)
  })
}
function fmtVal(key, v) {
  const mult = ['contrast', 'saturation', 'gamma'].includes(key) ? 1 : 1
  return (Number(v) * mult).toFixed(2)
}
function syncSliders() {
  document.querySelectorAll('#sliders .slider-row').forEach((row, i) => {
    const c = CONTROLS[i]
    const v = state.settings[c.key]
    row.querySelector('input').value = v
    row.querySelector('label b').textContent = fmtVal(c.key, v)
  })
}

// ---------- file -> frames -> upload ----------
async function handleFile(file) {
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)) {
    toast('err', '不是视频文件', '请选择 MP4 / MOV / WebM 等视频片段。')
    return
  }
  const sizeMb = file.size / 1048576
  if (sizeMb > BIG_VIDEO_MB) {
    toast('warn', '视频较大（' + sizeMb.toFixed(0) + ' MB）',
      '仅在浏览器本地抽帧、不会上传整段视频；低配设备抽帧可能稍慢，请耐心等待。')
  }
  setHint($('#uploadHint'), '', '')
  $('#progressWrap').classList.remove('hidden')
  setProgress(0.05, '准备抽帧…')
  try {
    const count = state.config?.frameCount || 5
    const { blobs, duration, warnings } = await extractFrames(file, count, {
      onProgress: (p) => setProgress(p * 0.7, `本地抽帧 ${Math.round(p * 100)}%`),
    })
    if (warnings.length) toast('warn', '抽帧提示', warnings.join('\n'))

    setProgress(0.72, '上传抽帧…')
    let project
    try {
      project = await uploadFrames(blobs, { onProgress: (p) => setProgress(0.72 + p * 0.28, `上传 ${Math.round(p * 100)}%`) })
    } catch (e) {
      if (e.status === 413) {
        setHint($('#uploadHint'), 'err', `❌ ${e.data?.message || '文件过大'} ${e.data?.hint || ''}`)
        toast('err', '文件过大', e.data?.hint || '请重试或联系管理员调大上限。')
      } else {
        setHint($('#uploadHint'), 'err', '❌ 上传失败：' + e.message)
        toast('err', '上传失败', e.message)
      }
      return
    }

    // 成功：建立本地原图
    state.originals.forEach((u) => URL.revokeObjectURL(u))
    state.originals = blobs.map((b) => URL.createObjectURL(b))
    state.project = { ...project, id: project.projectId }
    state.frameIdx = 0
    state.videoName = file.name
    buildFrameStrip(blobs)
    enableWorkflow()
    setProgress(1, '完成')
    setTimeout(() => $('#progressWrap').classList.add('hidden'), 800)
    setStep(2)

    if (project.ffmpegAvailable === false) {
      setHint($('#compareHint'), 'warn', '⚠ ' + project.warning)
      toast('warn', '近似预览模式', project.warning)
    } else {
      setHint($('#compareHint'), '', '')
    }
    // 新片段：若之前选的预设不属于当前场景，则推荐当前场景第一个预设
    const presetStillValid = state.presetId && PRESETS.some((p) => p.id === state.presetId && p.scene === state.scene)
    if (!presetStillValid) {
      applyPreset(PRESETS.find((p) => p.scene === state.scene))
    } else {
      state.realRenderFailed = false
      scheduleRender()
    }
    // 预填 Windows 输入路径
    $('#inputPath').value = `C:\\videos\\${file.name.replace(/\//g, '\\')}`
    toast('ok', '抽帧完成', `时长 ${duration.toFixed(1)}s，共 ${blobs.length} 帧。现在选择左侧预设查看效果。`)
  } catch (e) {
    $('#progressWrap').classList.add('hidden')
    setHint($('#uploadHint'), 'err', '❌ ' + e.message)
    toast('err', '抽帧失败', e.message)
  }
}

function setProgress(p, text) {
  $('#progressBar').style.width = `${Math.round(p * 100)}%`
  $('#progressText').textContent = `${text || Math.round(p * 100) + '%'}`
}
function setHint(el, level, text) {
  el.className = 'hint' + (level ? ' ' + level : '')
  el.textContent = text
}

function buildFrameStrip(blobs) {
  const strip = $('#frameStrip')
  strip.innerHTML = ''
  blobs.forEach((b, i) => {
    const img = document.createElement('img')
    img.className = 'thumb' + (i === 0 ? ' active' : '')
    img.src = URL.createObjectURL(b)
    img.alt = `帧 ${i + 1}`
    img.addEventListener('click', () => {
      state.frameIdx = i
      document.querySelectorAll('.thumb').forEach((t, j) => t.classList.toggle('active', j === i))
      scheduleRender()
    })
    strip.appendChild(img)
  })
}

function enableWorkflow() {
  $('#presetCard').classList.remove('disabled-card')
  $('#tuneCard').classList.remove('disabled-card')
  $('#schemeCard').classList.remove('disabled-card')
  $('#cmdCard').classList.remove('disabled-card')
  const ph = $('#comparator .placeholder')
  if (ph) ph.remove()
  $('#baseImg').src = state.originals[state.frameIdx]
  $('#previewModeBadge').textContent = '加载中…'
  $('#previewModeBadge').className = 'badge'
}

// ---------- comparator ----------
function bindComparator() {
  const box = $('#comparator')
  const top = $('#topWrap')
  const divider = $('#divider')
  const move = (clientX) => {
    const r = box.getBoundingClientRect()
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    top.style.width = `${pct * 100}%`
    divider.style.left = `${pct * 100}%`
  }
  box.addEventListener('pointerdown', (e) => {
    box.setPointerCapture(e.pointerId)
    move(e.clientX)
    const dm = (ev) => move(ev.clientX)
    box.addEventListener('pointermove', dm)
    box.addEventListener('pointerup', () => box.removeEventListener('pointermove', dm), { once: true })
  })
}

// ---------- render filtered (server real or CSS fallback) ----------
function scheduleRender() {
  if (!state.project) return
  const token = ++state.renderToken
  setTimeout(() => token === state.renderToken && renderFiltered(), 220)
}

function renderFiltered() {
  const idx = state.frameIdx
  $('#baseImg').src = state.originals[idx]
  const filtered = $('#filteredImg')
  const badge = $('#previewModeBadge')
  const useServer = state.project.ffmpegAvailable && !state.realRenderFailed

  // CSS 近似（立即可见）
  filtered.style.filter = buildCssFilter(state.settings)
  filtered.src = state.originals[idx]

  if (!useServer) {
    badge.textContent = 'CSS 近似预览'
    badge.className = 'badge css'
    return
  }

  badge.textContent = '真实渲染中…'
  badge.className = 'badge'
  const q = new URLSearchParams({ frame: String(idx), settings: JSON.stringify(state.settings) })
  const url = `/api/projects/${state.project.id}/filtered?${q}`
  fetch(url)
    .then(async (r) => {
      if (state.frameIdx !== idx) return
      if (r.ok) {
        const blob = await r.blob()
        const old = filtered.dataset.objUrl
        if (old) URL.revokeObjectURL(old)
        const obj = URL.createObjectURL(blob)
        filtered.dataset.objUrl = obj
        filtered.src = obj
        filtered.style.filter = ''
        badge.textContent = 'ffmpeg 真实预览'
        badge.className = 'badge real'
        setHint($('#compareHint'), '', '')
      } else {
        const data = await r.json().catch(() => null)
        state.realRenderFailed = true
        badge.textContent = 'CSS 近似预览（渲染失败）'
        badge.className = 'badge css'
        const detail = data?.message
          ? `${data.message}${data.detail ? '\n' + data.detail.split('\n').slice(-3).join('\n') : ''}`
          : '真实滤镜渲染失败，已回退近似预览。'
        setHint($('#compareHint'), 'warn', '⚠ ' + detail)
      }
    })
    .catch(() => {
      if (state.frameIdx !== idx) return
      state.realRenderFailed = true
      badge.textContent = 'CSS 近似预览（网络错误）'
      badge.className = 'badge css'
    })
}

// ---------- schemes ----------
function loadSchemes() {
  try { state.schemes = JSON.parse(localStorage.getItem(LS_KEY)) || [] } catch { state.schemes = [] }
  renderSchemes()
}
function persistSchemes() { localStorage.setItem(LS_KEY, JSON.stringify(state.schemes)) }

function saveScheme() {
  const name = $('#schemeName').value.trim()
  if (!name) { toast('warn', '请填写方案名称'); return }
  const preset = PRESETS.find((p) => p.id === state.presetId)
  const scheme = {
    id: crypto.randomUUID(),
    name,
    scene: state.scene,
    presetId: state.presetId,
    presetName: preset?.name || '自定义',
    settings: sanitizeSettings(state.settings),
    createdAt: Date.now(),
  }
  state.schemes.push(scheme)
  state.selectedSchemeId = scheme.id
  $('#schemeName').value = ''
  persistSchemes(); renderSchemes()
  setStep(3)
  toast('ok', '方案已保存', `${name}（共 ${state.schemes.length} 个方案）`)
}

function renderSchemes() {
  const ul = $('#schemeList')
  ul.innerHTML = ''
  state.schemes.forEach((s) => {
    const li = document.createElement('li')
    li.className = 'scheme-item' + (state.selectedSchemeId === s.id ? ' active' : '')
    const scene = SCENES.find((x) => x.id === s.scene)
    li.innerHTML = `<span class="si-name"></span><span class="si-scene"></span>
      <button class="btn tiny use" type="button">选用</button>
      <button class="btn tiny del" type="button">删除</button>`
    li.querySelector('.si-name').textContent = s.name
    li.querySelector('.si-scene').textContent = `${scene ? scene.label : ''}·${s.presetName}`
    li.querySelector('.use').addEventListener('click', () => selectScheme(s.id))
    li.querySelector('.del').addEventListener('click', () => {
      state.schemes = state.schemes.filter((x) => x.id !== s.id)
      if (state.selectedSchemeId === s.id) state.selectedSchemeId = null
      persistSchemes(); renderSchemes()
      toast('ok', '已删除方案', s.name)
    })
    ul.appendChild(li)
  })
  $('#schemeCount').textContent = state.schemes.length ? `已存 ${state.schemes.length} 个` : '暂无方案'
}

function selectScheme(id) {
  const s = state.schemes.find((x) => x.id === id)
  if (!s) return
  state.selectedSchemeId = id
  state.scene = s.scene
  state.presetId = s.presetId
  state.settings = sanitizeSettings(s.settings)
  state.realRenderFailed = false
  document.querySelectorAll('#sceneSeg button').forEach((b) => b.classList.toggle('active', b.dataset.scene === s.scene))
  renderPresets(); syncSliders(); renderSchemes(); scheduleRender()
  setStep(3)
  toast('ok', '已选用方案', s.name)
}

function exportSchemes() {
  if (!state.schemes.length) { toast('warn', '还没有可导出的方案'); return }
  const blob = new Blob([JSON.stringify(state.schemes, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'vlog-color-schemes.json'
  a.click()
  URL.revokeObjectURL(a.href)
}
function importSchemes(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const arr = JSON.parse(reader.result)
      if (!Array.isArray(arr)) throw new Error('格式应为数组')
      const valid = arr.map((s) => ({
        id: crypto.randomUUID(),
        name: String(s.name || '导入方案').slice(0, 30),
        scene: SCENES.some((x) => x.id === s.scene) ? s.scene : 'city',
        presetId: s.presetId || null,
        presetName: String(s.presetName || '自定义'),
        settings: sanitizeSettings(s.settings || {}),
        createdAt: Date.now(),
      }))
      state.schemes.push(...valid)
      persistSchemes(); renderSchemes()
      toast('ok', '导入成功', `新增 ${valid.length} 个方案`)
    } catch (err) {
      toast('err', '导入失败', 'JSON 格式不正确：' + err.message)
    }
  }
  reader.readAsText(file)
  e.target.value = ''
}

// ---------- command generation ----------
function activeSchemeForCommand() {
  const s = state.schemes.find((x) => x.id === state.selectedSchemeId)
  if (s) return s
  const preset = PRESETS.find((p) => p.id === state.presetId) || { name: '自定义' }
  return {
    name: $('#schemeName').value.trim() || preset.name,
    settings: sanitizeSettings(state.settings),
  }
}

function generateCommand() {
  $('#failBox').classList.add('hidden')
  const input = $('#inputPath').value
  if (!input.trim()) {
    showCmdError('请先填写 Windows 上的输入视频路径，例如 C:\\videos\\clips\\my beach.mp4')
    return
  }
  const scheme = activeSchemeForCommand()
  const result = buildCommands(scheme, {
    inputPath: input,
    outputPath: $('#outputPath').value,
    quickTest: $('#optCopy').checked,
  })
  if (result.errors.length) {
    showCmdError(result.errors.join('\n'))
    return
  }
  $('#cmdOut').textContent = result.command
  const notes = []
  if (result.warnings.length) notes.push('⚠ 路径提示：\n' + result.warnings.join('\n'))
  notes.push(`提示：路径含空格已自动加双引号；输出文件：${result.output}`)
  setHint($('#cmdHint'), result.warnings.length ? 'warn' : '', notes.join('\n\n'))
  setStep(4)
  toast('ok', '命令已生成', '可复制到 Windows 终端执行，或下载 .bat 批量处理全部方案。')
}

function showCmdError(msg) {
  const box = $('#failBox')
  box.textContent = '❌ ' + msg
  box.classList.remove('hidden')
  toast('err', '无法生成命令', msg)
}

async function testFilterOnline() {
  if (!state.config?.ffmpeg?.ffmpeg) {
    toast('warn', '服务器无 ffmpeg', '无法在线试跑。请把命令拿到 Windows 上执行验证；脚本会自动检测失败并暂停。')
    return
  }
  const scheme = activeSchemeForCommand()
  const btn = $('#testFilter')
  btn.disabled = true; btn.textContent = '试跑中…'
  try {
    const r = await fetch('/api/test-filter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: scheme.settings }),
    })
    const data = await r.json()
    if (r.ok) {
      toast('ok', '滤镜试跑通过 ✅', '该滤镜链可在此 ffmpeg 上正常执行。')
      setHint($('#cmdHint'), 'ok', '✅ 在线试跑通过：' + data.graph)
    } else {
      const box = $('#failBox')
      box.textContent = `❌ 命令可能失败：${data.message || '滤镜不被支持'}\n${data.detail || ''}\n\n滤镜链：${data.graph || ''}`
      box.classList.remove('hidden')
      toast('err', '滤镜试跑失败', '已显示 ffmpeg 报错详情，请调整参数。')
    }
  } catch (e) {
    toast('err', '试跑请求失败', e.message)
  } finally {
    btn.disabled = false; btn.textContent = '在线试跑滤镜'
  }
}

async function copyCommand() {
  const text = $('#cmdOut').textContent
  if (!text || text.startsWith('选定方案')) { toast('warn', '请先生成命令'); return }
  try {
    await navigator.clipboard.writeText(text)
    toast('ok', '已复制到剪贴板')
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text; document.body.appendChild(ta); ta.select()
    document.execCommand('copy'); ta.remove()
    toast('ok', '已复制到剪贴板')
  }
}

function downloadBatch() {
  const input = $('#inputPath').value
  if (!input.trim()) { showCmdError('请先填写 Windows 上的输入视频路径。'); return }
  const schemes = state.schemes.length
    ? state.schemes
    : [activeSchemeForCommand()]
  // 先验证路径
  const first = buildCommands(schemes[0], { inputPath: input, quickTest: $('#optCopy').checked })
  if (first.errors.length) { showCmdError(first.errors.join('\n')); return }
  const content = buildBatch(schemes, { input: normalizeWinPath(input), quickTest: $('#optCopy').checked })
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'vlog-grade.bat'
  a.click()
  URL.revokeObjectURL(a.href)
  setStep(4)
  toast('ok', '批处理已下载', `vlog-grade.bat 含 ${schemes.length} 个方案；含空格路径已处理，失败会自动暂停提示。`)
}

init()
