// 浏览器本地抽帧：用 <video> + canvas 生成 5 张均匀分布的小 JPG，
// 既不上传整段视频（避免大文件），又能用于真实 ffmpeg 渲染。

const SHORT_EDGE = 480
const JPEG_QUALITY = 0.82

function loadVideo(file, onMeta) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    video.src = url
    const cleanup = () => {
      video.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
    video.onerror = () => { cleanup(); reject(new Error('视频无法解码，请确认是浏览器支持的 MP4/MOV/WebM。')) }
    video.onloadedmetadata = () => {
      if (!isFinite(video.duration) || video.duration === 0) {
        cleanup(); reject(new Error('无法读取视频时长，可能是损坏或不支持的封装格式。')); return
      }
      onMeta?.(video)
      resolve(video)
    }
  })
}

function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { video.pause(); reject(new Error('抽帧超时（视频编码可能不兼容）')) }, 15000)
    video.onseeked = () => { clearTimeout(to); resolve() }
    video.currentTime = Math.min(time, Math.max(0, video.duration - 0.05))
  })
}

async function grabOne(video) {
  const vw = video.videoWidth, vh = video.videoHeight
  const scale = Math.min(1, SHORT_EDGE / Math.min(vw, vh))
  const w = Math.round(vw * scale / 2) * 2
  const h = Math.round(vh * scale / 2) * 2
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(video, 0, 0, w, h)
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY))
}

export async function extractFrames(file, count = 5, { onProgress } = {}) {
  const video = await loadVideo(file)
  const blobs = []
  const warnings = []
  try {
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) / count) * video.duration
      await seekTo(video, t)
      // 部分浏览器 seek 后需要再跑一帧
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const blob = await grabOne(video)
      if (blob.size > 8 * 1024 * 1024) warnings.push(`第 ${i + 1} 帧体积较大（${(blob.size / 1048576).toFixed(1)}MB）`)
      blobs.push(blob)
      onProgress?.((i + 1) / count)
    }
  } finally {
    video.pause()
    URL.revokeObjectURL(video.src)
  }
  return { blobs, duration: video.duration, warnings, name: file.name, size: file.size }
}

export function uploadFrames(blobs, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    blobs.forEach((b, i) => fd.append('frames', b, `frame_${i}.jpg`))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/projects')
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText)
        if (xhr.status >= 200 && xhr.status < 300) resolve(data)
        else reject(Object.assign(new Error(data.message || '服务器错误'), { status: xhr.status, data }))
      } catch { reject(new Error('服务器返回无法解析（状态码 ' + xhr.status + '）')) }
    }
    xhr.onerror = () => reject(new Error('网络错误：上传中断，请检查网络后重试。'))
    xhr.send(fd)
  })
}
