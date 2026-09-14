import { buildFilterChain } from '../../shared/filters.mjs'

// Windows 路径处理：统一反斜杠；含空格/特殊字符时自动加双引号（始终加引号最稳妥）
export function normalizeWinPath(p) {
  return String(p || '').trim().replace(/["<>|?*]/g, '').replace(/\//g, '\\')
}

// 返回 { warnings: [], errors: [] }
export function validateWinPath(raw, { mustExist = false } = {}) {
  const warnings = []
  const errors = []
  const p = String(raw || '').trim()
  if (!raw || !String(raw).trim()) { errors.push('路径为空。'); return { warnings, errors } }
  if (/[<>?*|"\x00-\x1f]/.test(raw)) errors.push('路径包含 Windows 非法字符（< > " | ? * 或控制符）。')
  if (/^\s|\s$/.test(raw)) warnings.push('路径首尾有空格，Windows 可能忽略结尾空格，已自动 trim。')
  if (p.includes('%')) warnings.push('路径含 % 字符：在 .bat 中会被当作环境变量，建议改名；在 cmd 直接粘贴则无影响。')
  if (!/^[a-zA-Z]:[\\/]/.test(p) && !/^\\\\/.test(p)) {
    warnings.push('路径不像 Windows 绝对路径（如 C:\\...）；请确认后在 Windows 上执行。')
  }
  if (/\s/.test(p)) warnings.push('路径含空格：命令已自动用英文双引号包裹，无需手动处理。')
  if (p.includes("'")) warnings.push('路径含单引号，执行前请确认。')
  if (mustExist) warnings.push('执行前请确认该文件真实存在（应用无法检查你的本地磁盘）。')
  return { warnings, errors }
}

function deriveOutput(input, tag) {
  const safeTag = String(tag).replace(/[<>:"/\\|?*\s]+/g, '_').slice(0, 40) || 'graded'
  const dot = input.lastIndexOf('.')
  const base = dot > 1 ? input.slice(0, dot) : input
  return `${base}_${safeTag}.mp4`
}

export function buildOneCommand({ input, output, settings, quickTest = false, ffmpegExe = 'ffmpeg' }) {
  const graph = buildFilterChain(settings)
  const inQ = `"${input}"`
  const outQ = `"${output}"`
  const parts = [inQ, '-y']
  if (quickTest) parts.push('-t', '10')
  parts.push('-vf', `"${graph}"`,
    '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outQ)
  return `${ffmpegExe} ${parts.join(' ')}`
}

// 为多个方案生成命令（面板展示单条）
export function buildCommands(scheme, opts) {
  const rawInput = String(opts.inputPath || '')
  const input = normalizeWinPath(rawInput)
  const output = opts.outputPath
    ? normalizeWinPath(opts.outputPath)
    : deriveOutput(input, scheme.name)
  // 在原始输入上校验非法字符（normalize 只会去除这些字符）
  const v = validateWinPath(rawInput, { mustExist: true })
  const vOut = opts.outputPath ? validateWinPath(opts.outputPath) : { warnings: [], errors: [] }
  return {
    input, output,
    command: buildOneCommand({
      input, output, settings: scheme.settings, quickTest: opts.quickTest,
      ffmpegExe: opts.ffmpegExe || 'ffmpeg',
    }),
    warnings: [...v.warnings, ...vOut.warnings.map((w) => '输出路径：' + w)],
    errors: [...v.errors, ...vOut.errors.map((e) => '输出路径：' + e)],
  }
}

// 生成 Windows 批处理（.bat）：遍历全部方案，含失败检测与暂停
export function buildBatch(schemes, opts) {
  const input = normalizeWinPath(opts.inputPath)
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'rem 旅行 Vlog 调色助手生成 —— 共 ' + schemes.length + ' 个方案',
    'set "FFMPEG=ffmpeg"',
    'rem 若 ffmpeg 不在 PATH，请改成完整路径，例如 set "FFMPEG=C:\\ffmpeg\\bin\\ffmpeg.exe"',
    `set "INPUT=${input.replace(/^"|"$/g, '')}"`,
    'where %FFMPEG% >nul 2>nul',
    'if errorlevel 1 (',
    '  echo [错误] 未找到 ffmpeg，请安装并加入 PATH，或修改本文件顶部的 FFMPEG 路径。',
    '  pause',
    '  exit /b 1',
    ')',
    'if not exist "%INPUT%" (',
    '  echo [错误] 找不到输入文件：%INPUT%',
    '  echo 提示：路径含空格无需担心，本脚本已使用引号包裹。',
    '  pause',
    '  exit /b 1',
    ')',
  ]
  schemes.forEach((s, i) => {
    const output = deriveOutput(input, s.name)
    const graph = buildFilterChain(s.settings).replace(/"/g, '\\"')
    lines.push(
      '',
      `echo ==== [${i + 1}/${schemes.length}] ${s.name.replace(/[&<>^|]/g, '')} ====`,
      `set "OUTPUT=${output}"`,
      opts.quickTest
        ? `"%FFMPEG%" -y -i "%INPUT%" -t 10 -vf "${graph}" -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "%OUTPUT%"`
        : `"%FFMPEG%" -y -i "%INPUT%" -vf "${graph}" -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart "%OUTPUT%"`,
      'if errorlevel 1 (',
      `  echo [失败] 方案「${s.name.replace(/[&<>^|]/g, '')}」处理失败，请检查 ffmpeg 报错信息。`,
      '  pause',
      '  exit /b 1',
      ')'
    )
  })
  lines.push('', 'echo [完成] 全部方案处理成功。', 'pause')
  // 加 UTF-8 BOM，保证中文在记事本/部分终端正常显示
  return '﻿' + lines.join('\r\n')
}
