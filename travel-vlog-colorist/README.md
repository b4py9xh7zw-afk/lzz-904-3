# 🎒 旅行 Vlog 调色助手

上传海边 / 城市 / 夜景片段后，浏览器本地抽帧对比原图与滤镜效果，支持保存多个调色方案；选定方案后一键生成 **Windows 可直接执行的 ffmpeg 命令 / .bat 批处理**。

## 功能

- **场景化预设**：海边 3 款（海盐清新 / 落日金滩 / 海岸电影）、城市 3 款（城市街拍 / 青橙都市 / 灰雾冷调）、夜景 3 款（霓虹赛博 / 黑金夜色 / 夜空通透）。
- **本地抽帧**：`<video>` + Canvas 均匀抽取 5 帧（短边 480px JPG），**不上传整段视频**，大文件也无压力。
- **滑杆对比**：左右拖动分界线对比原图 / 滤镜；5 帧可切换；11 项参数精细微调（亮度、对比、饱和、伽马、色温、色调、分区偏色、锐化、暗角、褪色）。
- **真实渲染**：服务器用 ffmpeg 对抽帧做真实滤镜渲染（结果缓存）；服务器无 ffmpeg 时自动回退浏览器 CSS 近似预览并明确标注。
- **多方案管理**：保存 / 选用 / 删除多个方案，localStorage 持久化，支持 JSON 导入导出。
- **Windows 命令**：自动生成带正确引号的命令（路径含空格也安全），支持快速测试（只处理前 10 秒）；可下载含多个方案的 `vlog-grade.bat`（UTF-8 BOM、CRLF、自动检测 ffmpeg 与输入文件、失败暂停报错）。

## 错误与提示（重点需求）

| 场景 | 行为 |
| --- | --- |
| **路径含空格** | 所有路径统一用英文双引号包裹；界面额外提示“已自动加引号，无需手动处理” |
| **路径非法字符** `< > " | ? *` | 生成前拦截，红框报错，不产生命令 |
| **路径含 `%`** | 警告 .bat 中会被当作环境变量 |
| **命令失败** | ① 页面「在线试跑滤镜」先用 `color/lavfi` 空帧验证滤镜链，失败展示 ffmpeg 原始报错；② .bat 中 `if errorlevel 1` 捕获失败、打印方案名并暂停 |
| **文件过大** | 客户端对 >500MB 视频提示（仅本地抽帧）；服务端单帧超限返回 413 `FILE_TOO_LARGE` 与处置建议（上限可用 `MAX_UPLOAD_MB` 调整） |
| **ffmpeg 缺失** | 顶部徽标 + toast + 接口三层提示，自动降级 CSS 近似预览 |
| **视频无法解码 / 抽帧超时** | toast 明确提示，进度条复位 |

## 快速开始

```bash
cd travel-vlog-colorist
npm install
# 要求 Node.js >= 18；服务器需能调用 ffmpeg（真实预览/试跑用）
#   未安装也可启动：自动降级为 CSS 近似预览
npm start
# 打开 http://localhost:3000
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 3000 | 监听端口 |
| `FFMPEG_BIN` | ffmpeg | ffmpeg 可执行文件（也可填绝对路径） |
| `FFPROBE_BIN` | ffprobe | ffprobe（当前用 ffmpeg 自身探测，非必须） |
| `MAX_UPLOAD_MB` | 20 | 单张抽帧大小上限 |

Windows 安装 ffmpeg：`winget install Gyan.FFmpeg`（或从 https://www.gyan.dev/ffmpeg/builds/ 下载并把 `bin` 加入 PATH）。

## 使用流程

1. 选择片段类型（海边 / 城市 / 夜景），拖入视频 → 自动抽 5 帧并上传小图。
2. 点选预设，在中间区域拖动对比；可展开 11 个滑杆微调，切换不同帧检查。
3. 命名后「保存当前」，可重复保存多个方案，随时选用 / 删除 / 导入导出。
4. 填写 Windows 输入路径（如 `C:\videos\my beach.mp4`）→ 生成命令 / 在线试跑 / 复制 / 下载 .bat。

## 安全说明

- ffmpeg 以 **参数数组**方式调用（`spawn`，不经 shell），且所有滤镜参数经数值白名单校验与钳制，杜绝命令注入。
- 项目 ID 使用 UUID 并做格式校验，防止路径穿越；上传仅接受 `frame_N.jpg`。

## 目录结构

```
travel-vlog-colorist/
├── server.mjs            # Express API：上传、真实渲染、试跑
├── lib/ffmpeg.mjs        # ffmpeg 封装（检测/抽帧/渲染/试跑，数组传参）
├── shared/filters.mjs    # 预设、参数校验、filter graph、CSS 近似（前后端共享）
└── public/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── app.js        # 页面编排
        ├── frames.js     # 浏览器抽帧 + XHR 上传（带进度）
        └── commands.js   # Windows 命令 / .bat 生成与路径校验
```
