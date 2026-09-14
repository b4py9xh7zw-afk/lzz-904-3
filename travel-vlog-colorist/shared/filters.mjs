// 前后端共享：预设、滤镜参数校验、ffmpeg filter graph 构建、CSS 近似滤镜
// 所有数值都经过白名单校验，防止命令注入（filter graph 不经过 shell 执行）。

export const SCENES = [
  { id: 'beach', label: '海边' },
  { id: 'city', label: '城市' },
  { id: 'night', label: '夜景' },
]

// 自定义滑块定义
export const CONTROLS = [
  { key: 'brightness', label: '亮度', min: -0.3, max: 0.3, step: 0.01 },
  { key: 'contrast', label: '对比度', min: 0.5, max: 1.8, step: 0.01 },
  { key: 'saturation', label: '饱和度', min: 0, max: 2, step: 0.01 },
  { key: 'gamma', label: '伽马(暗部)', min: 0.6, max: 1.6, step: 0.01 },
  { key: 'temperature', label: '色温(冷↔暖)', min: -1, max: 1, step: 0.01 },
  { key: 'tint', label: '色调(绿↔品红)', min: -1, max: 1, step: 0.01 },
  { key: 'shadowsR', label: '阴影偏红/青', min: -1, max: 1, step: 0.01 },
  { key: 'highlightsB', label: '高光偏蓝/黄', min: -1, max: 1, step: 0.01 },
  { key: 'sharpen', label: '锐化', min: 0, max: 1, step: 0.01 },
  { key: 'vignette', label: '暗角', min: 0, max: 1, step: 0.01 },
  { key: 'fade', label: '褪色(胶片感)', min: 0, max: 1, step: 0.01 },
]

export const DEFAULT_SETTINGS = Object.fromEntries(CONTROLS.map((c) => [c.key, 0]))
Object.assign(DEFAULT_SETTINGS, { brightness: 0, contrast: 1, saturation: 1, gamma: 1 })
// 注：brightness 0 = 中性；contrast/saturation/gamma 1 = 中性

export const PRESETS = [
  {
    id: 'beach-fresh',
    name: '海盐清新',
    scene: 'beach',
    emoji: '🌊',
    desc: '提亮、青蓝海水、低对比清透感',
    settings: {
      brightness: 0.04, contrast: 0.95, saturation: 1.18, gamma: 1.05,
      temperature: -0.28, tint: 0.02, shadowsR: -0.12, highlightsB: 0.1,
      sharpen: 0.15, vignette: 0, fade: 0.12,
    },
  },
  {
    id: 'beach-golden',
    name: '落日金滩',
    scene: 'beach',
    emoji: '🌅',
    desc: '暖色夕阳、金黄高光、柔和暗角',
    settings: {
      brightness: 0.02, contrast: 1.12, saturation: 1.28, gamma: 0.98,
      temperature: 0.42, tint: -0.03, shadowsR: 0.18, highlightsB: -0.18,
      sharpen: 0.1, vignette: 0.28, fade: 0.05,
    },
  },
  {
    id: 'beach-cinematic',
    name: '海岸电影',
    scene: 'beach',
    emoji: '🎬',
    desc: '青橙电影调、褪色暗部、宽幅质感',
    settings: {
      brightness: 0, contrast: 1.15, saturation: 0.92, gamma: 1.02,
      temperature: -0.05, tint: 0, shadowsR: -0.2, highlightsB: 0.08,
      sharpen: 0.18, vignette: 0.32, fade: 0.3,
    },
  },
  {
    id: 'city-street',
    name: '城市街拍',
    scene: 'city',
    emoji: '🏙️',
    desc: '通透中性、轻微锐化、日光漫步',
    settings: {
      brightness: 0.02, contrast: 1.08, saturation: 1.08, gamma: 1,
      temperature: 0.05, tint: 0, shadowsR: 0, highlightsB: 0,
      sharpen: 0.25, vignette: 0.1, fade: 0.08,
    },
  },
  {
    id: 'city-tealorange',
    name: '青橙都市',
    scene: 'city',
    emoji: '🌆',
    desc: '经典青橙对比，霓虹招牌更跳',
    settings: {
      brightness: 0, contrast: 1.2, saturation: 1.22, gamma: 0.95,
      temperature: 0.08, tint: -0.02, shadowsR: -0.28, highlightsB: 0.14,
      sharpen: 0.2, vignette: 0.24, fade: 0.1,
    },
  },
  {
    id: 'city-fog',
    name: '灰雾冷调',
    scene: 'city',
    emoji: '🌫️',
    desc: '阴天/雨天氛围，低饱和冷灰',
    settings: {
      brightness: 0.03, contrast: 0.88, saturation: 0.78, gamma: 1.08,
      temperature: -0.18, tint: 0.04, shadowsR: -0.06, highlightsB: 0.06,
      sharpen: 0.05, vignette: 0.18, fade: 0.28,
    },
  },
  {
    id: 'night-neon',
    name: '霓虹赛博',
    scene: 'night',
    emoji: '🌃',
    desc: '压暗、高对比、品红青蓝霓虹',
    settings: {
      brightness: -0.02, contrast: 1.3, saturation: 1.45, gamma: 0.9,
      temperature: -0.12, tint: 0.22, shadowsR: -0.3, highlightsB: 0.2,
      sharpen: 0.3, vignette: 0.42, fade: 0,
    },
  },
  {
    id: 'night-gold',
    name: '黑金夜色',
    scene: 'night',
    emoji: '✨',
    desc: '灯光鎏金、压制杂色、暗角聚焦',
    settings: {
      brightness: -0.01, contrast: 1.25, saturation: 1.12, gamma: 0.92,
      temperature: 0.3, tint: -0.05, shadowsR: 0.05, highlightsB: -0.22,
      sharpen: 0.28, vignette: 0.5, fade: 0.06,
    },
  },
  {
    id: 'night-clear',
    name: '夜空通透',
    scene: 'night',
    emoji: '🔭',
    desc: '提亮暗部保留细节、冷色星空',
    settings: {
      brightness: 0.06, contrast: 1.05, saturation: 1.15, gamma: 1.15,
      temperature: -0.22, tint: 0.03, shadowsR: -0.1, highlightsB: 0.12,
      sharpen: 0.22, vignette: 0.2, fade: 0.12,
    },
  },
]

// 数值白名单：仅允许数字，并裁剪到控件范围
export function sanitizeSettings(input = {}) {
  const out = { ...DEFAULT_SETTINGS }
  for (const c of CONTROLS) {
    const v = input[c.key]
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[c.key] = Math.min(c.max, Math.max(c.min, v))
    }
  }
  return out
}

const n = (v) => {
  let s = Number(v).toFixed(3)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s
}

// 构建 ffmpeg 滤镜链（顺序固定，参数数值化）
export function buildFilterChain(raw) {
  const s = sanitizeSettings(raw)
  const chain = []

  // 1) 基础影调
  const eqParts = [`brightness=${n(s.brightness)}`, `contrast=${n(s.contrast)}`,
    `saturation=${n(s.saturation)}`, `gamma=${n(s.gamma)}`]
  chain.push('eq=' + eqParts.join(':'))

  // 2) 色温/色调（colorbalance 分区调色），按“通道+区域”聚合后一次输出
  // colorbalance 选项：红/绿/蓝 × 阴影/中间调/高光 = rs gs bs / rm gm bm / rh gh bh
  // 色温 >0 偏暖：阴影加红、高光加黄(减蓝)；<0 反之
  const cbMap = new Map()
  const addCb = (key, v) => cbMap.set(key, (cbMap.get(key) || 0) + v)
  addCb('rs', s.temperature * 0.4)
  addCb('rm', s.temperature * 0.25)
  addCb('bh', -s.temperature * 0.35)
  // tint >0 偏品红(红+蓝)，<0 偏绿
  addCb('gm', s.tint * -0.3)
  addCb('rm', s.tint * 0.18)
  addCb('bm', s.tint * 0.18)
  // 显式分区
  addCb('rs', s.shadowsR)
  addCb('bh', s.highlightsB)
  const cb = []
  for (const [k, v] of cbMap) {
    if (Math.abs(v) <= 0.001) continue
    // colorbalance 各选项有效范围 [-1, 1]，聚合后钳制避免越界报错
    cb.push(`${k}=${n(Math.max(-1, Math.min(1, v)))}`)
  }
  if (cb.length) chain.push('colorbalance=' + cb.join(':'))

  // 3) 锐化 unsharp=5:5:amount:5:5:amount
  if (s.sharpen > 0.001) {
    const a = n(s.sharpen)
    chain.push(`unsharp=5:5:${a}:5:5:${a}`)
  }

  // 4) 褪色胶片：抬起黑场（曲线 master）
  if (s.fade > 0.001) {
    const lift = n(s.fade * 0.14)
    const crush = n(1 - s.fade * 0.08)
    chain.push(`curves=master='0/${lift} 1/${crush}'`)
  }

  // 5) 暗角：angle 越小暗角越强（约 PI/6 强 ~ PI/3 弱）
  if (s.vignette > 0.001) {
    const a = n(Math.PI / (6.1 - s.vignette * 3.0))
    chain.push(`vignette=angle=${a}`)
  }

  return chain.join(',')
}

// 浏览器即时预览用的 CSS filter（近似，ffmpeg 不可用时也能工作）
export function buildCssFilter(raw) {
  const s = sanitizeSettings(raw)
  const parts = []
  parts.push(`brightness(${1 + s.brightness})`)
  parts.push(`contrast(${s.contrast})`)
  parts.push(`saturate(${s.saturation})`)
  const hue = s.temperature * -8 + s.tint * 10
  if (Math.abs(hue) > 0.1) parts.push(`hue-rotate(${hue.toFixed(1)}deg)`)
  parts.push(`sepia(${Math.max(0, s.temperature) * 0.12})`)
  if (s.fade > 0.01) parts.push(`opacity(${1 - s.fade * 0.06})`)
  return parts.join(' ')
}
