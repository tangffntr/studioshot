# 电商出图 Agent 实施计划（Implementation Plan）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零构建一个可交互 Web 应用，用「多模态工具调用 Agent」驱动电商出图全流程（产品分析→出图→视频），含模型/素材/模板管理与在线 API 出图。

**Architecture:** Node+Express+TS 后端（参考 Toonflow 的 ai.ts/vendor/oss）+ SolidJS 前端（参考 opencode 的 SSE/工具调用）+ SQLite 持久化 + 多供应商在线 API。主 Agent 是多模态工具调用 Agent，把看图/生图/试穿/视频建模成工具。

**Tech Stack:** TypeScript, Node.js, Express, better-sqlite3, drizzle-orm, SolidJS, Vite, Tailwind, sharp, Vercel AI SDK（文本），受控适配器（图/视频/试穿）。

---

## 0. 关键约束与阅读须知

- **本计划为单人 + 多 Agent 并行设计**：模块边界与 API 契约已钉到可直接执行，确保多个 subagent 并行开发不产生集成冲突。**任何 agent 不得跨模块边界修改**。
- **首里程碑是最小闭环**（单产品→分析→1 张主图）：所有 Phase 1-3 工作都为这个闭环服务，不要提前做模板套图/视频/批量。
- **TDD 纪律**：每个模块先写失败测试，再实现。后端用 vitest，前端用 vitest。
- **频繁提交**：每个 Task 完成即 commit，commit message 用 `feat/fix/test/docs/refactor(scope): ...`。
- **假设熔断点**（Phase 0 必须验证，否则停下重评估）：
  - A1：即梦 seedream + OutfitAnyone 出图保真度达标（产品外观/版型不失真）
  - A2：SolidJS 前端能正确接收 SSE 并渲染（opencode 模式可移植）
  - A3：多模态主 LLM（GLM-4.5V/GPT-4o）能"看回"生图工具返回的 base64 图（工具循环闭环）
- **故意推迟的决策**（先不定，避免计划瘫痪）：
  - Prompt 具体措辞、模板图位文案、UI 配色/文案
  - 多租户/品牌包（Phase 4+）
  - 本地 GPU 降本（Phase 4+）
  - 部署方式（容器化/裸机）

---

## 1. 技术决策记录（ADR）

### ADR-1: 后端 Node + Express + TypeScript（非 Effect/Bun）
**决策**：用 Express 而非 opencode 的 Effect HttpApi。
**理由**：① 直接复用 Toonflow 的 `ai.ts`/`vm.ts`/`oss.ts`（同为 Express+TS）；② 单人上手快；③ 多 agent 并行时 Express 的心智负担最低。
**备选**：Effect HttpApi（类型更强但学习曲线陡，放弃）；Hono（可后续替换 Express，接口兼容）。
**影响**：API 契约用 OpenAPI 风格手动维护；工具契约用 Zod schema。

### ADR-2: 前端 SolidJS（复用 opencode SSE 代码）
**决策**：SolidJS + Vite + Tailwind。
**理由**：最大化复用 opencode 的 SSE 客户端（`server-sdk.tsx`）和 createStore 模式。
**影响**：生态比 React 小，但本项目所需组件（对话流/画廊/表单）SolidJS 都够用。

### ADR-3: 工具契约用 Zod（非 Effect Schema）
**决策**：用 Zod 定义工具输入 schema，自动转 JSON Schema 给 LLM。
**理由**：opencode 用 Effect Schema，我们用 Express 栈，Zod 是 TS 生态标准，与 AI SDK 兼容。
**影响**：`Tool.make` 实现需自己做 Zod→JSON Schema 转换（用 `zod-to-json-schema`）。

### ADR-4: 模型管理用"受控适配器 + JSON 注册表"（非 vm2 沙箱）
**决策**：放弃 Toonflow 的 vm2 沙箱，改用受控 TypeScript 适配器类。
**理由**：vm2 已停止维护且有性能开销；受控适配器类型安全、可测试。
**影响**：新增供应商需写代码（非纯配置），但电商场景供应商有限（OpenAI/即梦/阿里云/可灵），可接受。供应商的**可配置部分**（baseUrl/key/模型列表/计价）仍走 DB 的 JSON。

### ADR-5: 首里程碑最小闭环（非完整图片链路）
**决策**：Phase 1-3 只做"单产品→VLM 分析→出 1 张主图→主 LLM 看回→满意/重试"。
**理由**：最快验证 A1/A2/A3 三个熔断点假设；失败成本最低。
**影响**：模板套图/试穿/视频/批量推迟到 Phase 4+。

---

## 2. 模块划分与依赖图

```
packages/                          （monorepo，pnpm workspaces）
├── shared/                        【共享类型与 Zod schema】无依赖
│   ├── src/types.ts               # Media, Asset, Job, Tool 等 TS 类型
│   ├── src/schemas/               # Zod schema（工具输入、API 请求体）
│   └── src/constants.ts           # SSE 事件类型枚举、任务状态枚举
│
├── server/                        【后端】依赖 shared
│   ├── src/db/                    # Drizzle schema + 迁移 + 查询
│   │   ├── schema.ts              # 全部表定义
│   │   ├── client.ts              # better-sqlite3 + drizzle 初始化
│   │   └── migrations/
│   ├── src/adapters/              # 受控适配器（每供应商一个文件）
│   │   ├── base.ts                # VendorAdapter 接口
│   │   ├── openai-image.ts
│   │   ├── jimeng.ts              # 即梦 seedream + 视频
│   │   ├── aliyun-tryon.ts        # OutfitAnyone
│   │   └── registry.ts            # 适配器注册表
│   ├── src/model-manager/         # 模型管理门面（照搬 Toonflow ai.ts）
│   │   ├── facade.ts              # Model.image/video/tryon/vlm
│   │   ├── credentials.ts         # AES 加密凭证
│   │   └── task-slots.ts          # task_slots 解析
│   ├── src/storage/               # OSS 本地存储抽象（照搬 Toonflow oss.ts）
│   │   └── oss.ts
│   ├── src/tools/                 # Agent 工具（照搬 opencode Tool.make）
│   │   ├── tool.ts                # Tool 接口 + make
│   │   ├── registry.ts            # 工具注册表
│   │   ├── analyze-product.ts     # VLM 看图分析
│   │   ├── generate-image.ts      # 生图（含图片回灌 toModelOutput）
│   │   └── check-quality.ts       # VLM 质检
│   ├── src/agent/                 # 主 Agent 循环（照搬 opencode runner/llm.ts）
│   │   ├── loop.ts                # 循环 + MAX_STEPS + 并发 settle
│   │   ├── event-bus.ts           # SSE 事件发布
│   │   └── runner.ts              # 单任务执行入口
│   ├── src/routes/                # Express 路由
│   │   ├── jobs.ts                # POST /api/jobs（admit-then-run）
│   │   ├── events.ts              # GET /api/events（SSE）
│   │   ├── assets.ts              # 资产/媒体 CRUD
│   │   ├── models.ts              # 供应商/模型/task_slots CRUD
│   │   └── oss-static.ts          # /oss 静态服务 + 缩略图
│   ├── src/config.ts              # 环境变量与配置
│   └── src/index.ts               # Express 入口
│
└── web/                           【前端】依赖 shared
    ├── src/entry.tsx
    ├── src/App.tsx
    ├── src/context/
    │   ├── sse.tsx                # SSE 客户端（照搬 opencode server-sdk.tsx）
    │   ├── api.ts                 # REST 封装
    │   └── store.ts               # createStore 全局状态
    ├── src/pages/
    │   ├── ChatPage.tsx           # 对话/任务工作台
    │   └── GalleryPage.tsx        # 媒体画廊
    └── src/components/
        ├── MessageList.tsx        # Agent 轨迹（工具调用链可视化）
        ├── Composer.tsx           # 输入框 + 图片上传
        ├── MediaCard.tsx
        └── SettingsPanel.tsx
```

**依赖方向（严格单向，禁止循环）**：
`web` → `shared` ← `server`；`server/routes` → `server/agent` → `server/tools` → `server/model-manager` → `server/adapters` + `server/db` + `server/storage`。

**并行开发边界**（多 agent 分工）：
- Agent-α：`shared` → `server/db` → `server/storage` → `server/model-manager` → `server/adapters`
- Agent-β：等 `shared` 完成后做 `server/tools` → `server/agent` → `server/routes`
- Agent-γ：等 `shared` 完成后做 `web/*`
- α/β/γ 三者只在 `shared` 层耦合，契约（§3）钉死后可完全并行。

---

## 3. API 契约（前后端并行开发的硬边界）

### 3.1 REST 端点

| 方法 | 路径 | 请求体 | 响应 | 说明 |
|------|------|--------|------|------|
| POST | `/api/jobs` | `{ productId: string, instruction: string, attachments?: string[] }` | `{ jobId: string }` | admit-then-run，立即返回 |
| GET | `/api/jobs/:id` | - | `Job` | 查任务状态 |
| GET | `/api/events` | - (SSE) | `text/event-stream` | **所有**进度走这条流 |
| GET | `/api/assets?productId=` | - | `Asset[]` | 资产列表 |
| GET | `/api/media?assetId=` | - | `Media[]` | 媒体列表 |
| POST | `/api/products` | `{ name, imageBase64 }` | `{ productId }` | 上传产品 |
| GET/PUT | `/api/models/vendors` | Vendor[] | - | 供应商管理 |
| POST | `/api/models/task-slots` | `{ slotKey, modelId }` | - | 绑定模型到任务槽 |

### 3.2 SSE 事件类型（`shared/src/constants.ts` 枚举，前后端共用）

```typescript
export const EventType = {
  JobStarted: "job.started",          // { jobId }
  JobProgress: "job.progress",        // { jobId, progress: 0-100, message }
  ToolCall: "tool.call",              // { jobId, toolName, input }
  ToolResult: "tool.result",          // { jobId, toolName, mediaId?, text? }
  MediaCompleted: "media.completed",  // { mediaId, thumbUrl, url }
  AgentMessage: "agent.message",      // { jobId, text } 主 LLM 的思考/回复
  JobCompleted: "job.completed",      // { jobId, resultMediaIds: [] }
  JobFailed: "job.failed",            // { jobId, error }
} as const;
```

### 3.3 工具契约（`shared/src/schemas/tools.ts`）

每个工具的输入用 Zod 定义，前后端共享。最小闭环只需 3 个工具：

```typescript
// analyze-product
export const AnalyzeProductInput = z.object({
  mediaId: z.string().describe("待分析的产品图 media id"),
});
// generate-image
export const GenerateImageInput = z.object({
  prompt: z.string(),
  referenceMediaIds: z.array(z.string()),
  size: z.enum(["1024x1024", "1024x1536"]),
  purpose: z.string().describe("这张图的用途，便于审计"),
});
// check-quality
export const CheckQualityInput = z.object({
  mediaId: z.string(),
  criteria: z.array(z.string()).describe("检查项，如 logo保真/文字清晰"),
});
```

---

## 4. 数据库 Schema（Phase 1 全部建表，后续阶段只加表）

最小闭环只需以下表（Phase 1 一次建好，标记 ⭐ 为 MVP 必需）：

- ⭐ `products` (id, name, category, attributes JSON, selling_points JSON, created_at)
- ⭐ `media` (id, asset_id NULL, product_id, type, file_path, thumb_path, model_id, prompt_text, params JSON, gen_state, cost, width, height, created_at)
- ⭐ `jobs` (id, product_id, type, instruction, payload JSON, status, progress, result JSON, error, created_at, started_at, finished_at)
- ⭐ `api_calls` (id, job_id, model_id, vendor_id, duration_ms, cost, status, error, created_at)
- ⭐ `vendors` (id, name, category, adapter, base_url, inputs JSON)
- ⭐ `vendor_credentials` (vendor_id PK, values_enc BLOB, enabled, updated_at)
- ⭐ `models` (id, vendor_id, model_name, display_name, type, modes JSON, pricing JSON, enabled)
- ⭐ `task_slots` (slot_key PK, model_id, params JSON)

> `assets`/`media_versions`/`prompts`/`templates` 等表 Phase 4+ 再加，MVP 不建。

完整建表 SQL 与 Drizzle schema 在 Task 1.2 给出。

---

## 5. 里程碑与验收（Definition of Done）

### Phase 0：原型验证（Week 1）— 熔断点
**DoD**：以下 3 个假设各有一个可运行的 demo 脚本证明：
- A1：`scripts/verify-jimeng.ts` 调即梦 seedream，对 1 张白底产品图出场景图，人工肉眼确认产品外观不失真
- A2：`scripts/verify-sse.ts` 起 Express + 1 个 SSE 端点，SolidJS 页面能接收并渲染
- A3：`scripts/verify-tool-loop.ts` 手动构造一次工具调用（生图→返回 base64→喂给 GLM-4.5V→让它描述这张图），证明主 LLM 能看回
**熔断**：任一假设不通过，停下重评估，不进 Phase 1。

### Phase 1：后端骨架（Week 2-3）
**DoD**：
- [ ] `pnpm test` 全绿（db/storage/adapters/model-manager 各模块单测）
- [ ] `POST /api/products` 上传产品 → `POST /api/jobs` 提交"分析这张图" → 任务入队 → `GET /api/events` 收到 `tool.call` 事件
- [ ] 4 个适配器（openai-image/jimeng/aliyun-tryon/kling）各有一个集成测试（mock 或真实 API 二选一）

### Phase 2：Agent 循环 + 前端（Week 3-4）
**DoD（最小闭环！）**：
- [ ] 浏览器打开 web，上传 1 张白底产品图
- [ ] Agent 自动：调用 `analyze_product` → 调用 `generate_image` 出 1 张主图 → 调用 `check_quality` 自检
- [ ] 若质检不通过，Agent 自主重试 `generate_image`（最多 MAX_STEPS）
- [ ] 前端实时显示 Agent 轨迹（工具调用链）+ 生成的图
- [ ] **这就是首里程碑，达成即可对外演示**

### Phase 3：素材管理（Week 4-5）
**DoD**：媒体画廊可用，图片可下载/删除，prompt_text 可查看。

### Phase 4+（推迟）：模板套图、试穿、视频、批量、模型管理 UI。

---

## 6. 任务分解（Task 0.x ~ Task 3.x）

> 每个 Task 是可独立 commit 的工作单元。Phase 0 的 Task 可由 1 个 agent 串行做；Phase 1+ 的 Task 按 §2 边界分给 α/β/γ 并行。

### Phase 0：原型验证（熔断点）

#### Task 0.1：项目脚手架与 monorepo 初始化
**Files:**
- Create: `D:\zcode\opc\package.json`, `pnpm-workspace.yaml`, `.gitignore`, `tsconfig.base.json`
- Create: `packages/shared/package.json`, `packages/server/package.json`, `packages/web/package.json`
- Create: `packages/shared/tsconfig.json`, `packages/server/tsconfig.json`, `packages/web/tsconfig.json`

- [ ] **Step 1: 初始化 git 与根 package.json**
```bash
cd D:\zcode\opc
git init
# 创建根 package.json（private, 无入口）
```
- [ ] **Step 2: 创建 pnpm workspace 配置**
`pnpm-workspace.yaml` 内容：`packages: ['packages/*']`
- [ ] **Step 3: 创建三个子包的 package.json 与 tsconfig**
server 依赖：express, better-sqlite3, drizzle-orm, sharp, zod, ai, @ai-sdk/openai；devDep：typescript, tsx, vitest, @types/express。
web 依赖：solid-js, @solidjs/router, vite; devDep：typescript, vitest。
- [ ] **Step 4: 验证 workspace 可装依赖**
Run: `pnpm install`
Expected: 三个包依赖装好，无报错。
- [ ] **Step 5: Commit**
`git commit -m "chore: init monorepo with shared/server/web workspaces"`

#### Task 0.2：验证假设 A1 — 即梦/OutfitAnyone 保真度（熔断点）
**Files:**
- Create: `packages/server/scripts/verify-jimeng.ts`
- Create: `.env.example`（含 VOLC_AK/SK, DASHSCOPE_API_KEY 占位）

- [ ] **Step 1: 配置环境变量**
在 `.env` 填入真实的火山引擎 AK/SK（即梦）和阿里云 DashScope key（OutfitAnyone）。
- [ ] **Step 2: 写即梦出图验证脚本**
脚本读取 `data/sample-product.jpg`（放一张真实白底产品图），调即梦 seedream 图生图生成场景图，保存到 `data/verify-out.jpg`。
- [ ] **Step 3: 写 OutfitAnyone 试穿验证脚本**（如有服装平铺图）
- [ ] **Step 4: 运行并人工肉眼检查**
Run: `pnpm --filter server tsx scripts/verify-jimeng.ts`
**熔断判断**：产品外观（Logo/形状/颜色）是否失真？失真则停下，考虑换 gpt-image-1 或加更强参考图保真参数。
- [ ] **Step 5: 记录结论到 `docs/verify-phase0.md`，Commit**

#### Task 0.3：验证假设 A2 — SSE 可移植性（熔断点）
**Files:**
- Create: `packages/server/scripts/verify-sse.ts`（最小 Express + SSE）
- Create: `packages/web/scripts/verify-sse.html`（原生 fetch EventSource 接收）

- [ ] **Step 1: 后端 SSE 端点**
Express `/events` 端点，每秒 push 一个 `{type:'test', n}`。
- [ ] **Step 2: 前端接收页面**
- [ ] **Step 3: 运行两端，浏览器看到计数递增**
- [ ] **Step 4: 记录结论，Commit**

#### Task 0.4：验证假设 A3 — 多模态主 LLM 能看回生图（熔断点）⭐最关键
**Files:**
- Create: `packages/server/scripts/verify-tool-loop.ts`

- [ ] **Step 1: 脚本逻辑**
① 调即梦生成 1 张图得 base64；② 构造 AI SDK 消息，把 base64 作为 image part 喂给 GLM-4.5V（或 GPT-4o）；③ 问"这张图里产品是什么颜色？有没有文字？"；④ 打印 LLM 回答。
- [ ] **Step 2: 运行**
Run: `pnpm --filter server tsx scripts/verify-tool-loop.ts`
**熔断判断**：LLM 能否正确描述它"看到"的图？若不能，整个 Agent 工具循环范式不成立，必须重设计（如改为纯文本描述回灌）。
- [ ] **Step 3: 记录结论，Commit**

> **Phase 0 Gate**：3 个熔断点全过 → 进 Phase 1。任一不过 → 停下，与人对齐调整方案。

---

### Phase 1：后端骨架（Agent-α 主力，β/γ 可开始准备）

#### Task 1.1：shared 包 — 类型与 Zod schema（阻塞 β/γ）
**Files:** `packages/shared/src/{types.ts,constants.ts,schemas/tools.ts,schemas/api.ts}`

- [ ] **Step 1: 写 EventType / JobStatus / GenState 枚举**（按 §3.2）
- [ ] **Step 2: 写 Media/Job/Vendor/Model TS 类型**
- [ ] **Step 3: 写工具输入 Zod schema**（analyze-product/generate-image/check-quality，按 §3.3）
- [ ] **Step 4: 写 API 请求/响应 Zod schema**
- [ ] **Step 5: vitest 测试 schema 解析**
- [ ] **Step 6: Commit**

#### Task 1.2：server/db — Drizzle schema + 建表（Agent-α）
**Files:** `packages/server/src/db/{schema.ts,client.ts}`, `migrations/0001.sql`

- [ ] **Step 1: 定义 Drizzle schema**（8 张 MVP 表，按 §4 字段）
- [ ] **Step 2: client.ts — better-sqlite3 + drizzle 初始化（WAL 模式）**
```typescript
// 参考 opencode database.ts:22-37 的 WAL 配置
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
```
- [ ] **Step 3: 生成迁移 SQL，运行建表**
- [ ] **Step 4: vitest 测试 CRUD**（每张表 insert/select/update/delete）
- [ ] **Step 5: Commit**

#### Task 1.3：server/storage — OSS 本地存储（Agent-α）
**Files:** `packages/server/src/storage/oss.ts`

- [ ] **Step 1: 移植 Toonflow oss.ts**（去掉 Electron 依赖，根目录改为 `data/oss/`）
保留：`resolveSafeLocalPath`（路径遍历防护）、`writeFile`（base64 自动解码）、`getFileUrl`、`getImageBase64`、`getSmallImageUrl`（sharp 缩略图）。
- [ ] **Step 2: 路径约定 `{productId}/{type}/{uuid}.ext`**
- [ ] **Step 3: vitest 测试**（写文件→读文件→生成 URL→缩略图）
- [ ] **Step 4: Commit**

#### Task 1.4：server/adapters — 受控适配器（Agent-α）
**Files:** `packages/server/src/adapters/{base.ts,openai-image.ts,jimeng.ts,aliyun-tryon.ts,registry.ts}`

- [ ] **Step 1: base.ts 定义 VendorAdapter 接口**
```typescript
export interface GenRequest {
  model: string; prompt: string; referenceImages?: string[]; // base64
  size?: string; quality?: string; mask?: string;
}
export interface GenResult { base64: string; mime: string; cost: number; meta?: any; }
export interface VendorAdapter {
  category: "image" | "video" | "tryon" | "vlm" | "matting";
  generate(req: GenRequest, creds: Record<string,string>): Promise<GenResult>;
}
```
- [ ] **Step 2: openai-image.ts** — 调 `/v1/images/generations` 与 `/edits`（含参考图保真）
- [ ] **Step 3: jimeng.ts** — 火山引擎即梦 seedream，**异步任务**（提交→轮询→下载，封装 `submitAndPoll` 辅助函数）
- [ ] **Step 4: aliyun-tryon.ts** — OutfitAnyone，异步任务（参考 Toonflow pollTask 模式）
- [ ] **Step 5: registry.ts — 注册表**
- [ ] **Step 6: vitest 集成测试**（每个适配器用 mock HTTP 测 happy path + 错误处理）
- [ ] **Step 7: Commit**

#### Task 1.5：server/model-manager — 门面 + 凭证加密（Agent-α）
**Files:** `packages/server/src/model-manager/{facade.ts,credentials.ts,task-slots.ts}`

- [ ] **Step 1: credentials.ts — AES-256-GCM 加解密**（主密钥从 env `MASTER_KEY`）
- [ ] **Step 2: task-slots.ts — resolveModel(slotKey) 查表得 modelId**
- [ ] **Step 3: facade.ts — Model.image/vlm 链式门面**（照搬 Toonflow ai.ts AiImage 结构）
```typescript
// 用法：await Model.image("main-image").generate({...}).save(path)
// 内部：查 task_slots["main-image"] → models → vendors → adapters → 调用 → 记 api_calls
```
- [ ] **Step 4: vitest 测试**（mock adapter 测门面全链路 + 凭证加解密往返）
- [ ] **Step 5: Commit**

> **Agent-α 完成 Task 1.1-1.5 后，β/γ 才能正式开工（依赖 shared）。**

---

### Phase 2：Agent 循环 + 前端（β/γ 并行，首里程碑）

#### Task 2.1：server/tools — 工具契约与注册（Agent-β）
**Files:** `packages/server/src/tools/{tool.ts,registry.ts,analyze-product.ts,generate-image.ts,check-quality.ts}`

- [ ] **Step 1: tool.ts — Tool 接口 + make 工厂**（照搬 opencode tool.ts:36-52）
```typescript
export interface Tool<I, O> {
  description: string;
  inputSchema: ZodSchema<I>;       // 自动转 JSON Schema 给 LLM
  execute: (input: I, ctx: ToolCtx) => Promise<O>;
  toModelOutput?: (input: I, output: O) => Content[];  // ⭐ 图片回灌
}
export type Content = {type:"text";text:string} | {type:"file";data:string;mime:string;name?:string};
export const make = <I,O>(cfg): Tool<I,O> => ({...});
```
- [ ] **Step 2: zod-to-json-schema 转换工具**（给 LLM 看）
- [ ] **Step 3: analyze-product.ts** — VLM 看图，返回属性 JSON（toModelOutput: text）
- [ ] **Step 4: generate-image.ts** — 调 Model.image，**toModelOutput 返回 file（base64+mime）**⭐ 这是 A3 假设的落地点
- [ ] **Step 5: check-quality.ts** — VLM 质检，返回评分
- [ ] **Step 6: registry.ts — 注册 3 工具**
- [ ] **Step 7: vitest 测试**（每工具测 execute + toModelOutput）
- [ ] **Step 8: Commit**

#### Task 2.2：server/agent — 主 Agent 循环（Agent-β）⭐核心
**Files:** `packages/server/src/agent/{loop.ts,event-bus.ts,runner.ts}`

- [ ] **Step 1: event-bus.ts — SSE 事件发布**（emit 进内存，routes/events 消费）
- [ ] **Step 2: loop.ts — 工具调用循环**（照搬 opencode runner/llm.ts 结构）
```typescript
const MAX_STEPS = 25;
async function runLoop(jobId, mainModel, tools, history, ctx) {
  for (let step = 0; step < MAX_STEPS; step++) {
    // 1. 调主 LLM（streamText），附带工具定义
    // 2. 收集 tool_calls
    // 3. 并发执行工具（Promise.all），每个工具 execute + toModelOutput
    // 4. 把工具结果（含 file 图片）追加到 history
    // 5. publish ToolCall/ToolResult 事件
    // 6. 若无 tool_call → 结束
  }
}
```
- [ ] **Step 3: runner.ts — 单任务执行入口**（从 jobs 表取任务→runLoop→更新状态）
- [ ] **Step 4: vitest 测试**（mock 主 LLM 返回预设 tool_calls，验证循环正确执行并回灌）
- [ ] **Step 5: Commit**

#### Task 2.3：server/routes — REST + SSE（Agent-β）
**Files:** `packages/server/src/routes/{jobs.ts,events.ts,oss-static.ts,products.ts}`, `src/index.ts`

- [ ] **Step 1: jobs.ts — POST /api/jobs（admit-then-run：插 jobs 表→立即返回 jobId→worker 异步 runLoop）**
- [ ] **Step 2: events.ts — GET /api/events（SSE，订阅 event-bus，按 jobId 过滤）**
- [ ] **Step 3: products.ts — POST /api/products（存图到 OSS→建 media→建 product）**
- [ ] **Step 4: oss-static.ts — /oss 静态服务 + sharp 缩略图中间件**
- [ ] **Step 5: index.ts — 组装 Express app**
- [ ] **Step 6: 集成测试**（supertest：提交 job→收到 SSE 事件流）
- [ ] **Step 7: Commit**

#### Task 2.4：web — SSE 客户端 + 状态（Agent-γ）
**Files:** `packages/web/src/context/{sse.tsx,api.ts,store.ts}`

- [ ] **Step 1: sse.tsx — SSE 客户端**（照搬 opencode server-sdk.tsx：EventSource + 16ms 帧合并 + 心跳重连）
- [ ] **Step 2: api.ts — REST 封装**（fetch /api/jobs, /api/products）
- [ ] **Step 3: store.ts — createStore**（jobs/media/events 全局状态，按 SSE 事件归约，照搬 opencode sync.tsx）
- [ ] **Step 4: vitest 测试归约逻辑**（给定事件序列→断言 store 状态）
- [ ] **Step 5: Commit**

#### Task 2.5：web — 对话工作台 UI（Agent-γ）
**Files:** `packages/web/src/pages/ChatPage.tsx`, `components/{MessageList.tsx,Composer.tsx,MediaCard.tsx}`

- [ ] **Step 1: Composer — 输入框 + 图片上传 + 提交（POST /api/jobs）**
- [ ] **Step 2: MessageList — Agent 轨迹**（按 tool.call/tool.result/agent.message 渲染时间线，工具调用链可视化）
- [ ] **Step 3: MediaCard — 图片展示**（img src 指向 /oss 缩略图）
- [ ] **Step 4: ChatPage 组装**
- [ ] **Step 5: 手动联调**（启动后端 + 前端，走完最小闭环）
- [ ] **Step 6: Commit**

> **Phase 2 Gate（首里程碑）**：浏览器上传产品图 → Agent 自动分析→出 1 张主图→自检→必要时重试 → 前端实时显示轨迹与图。**达成即可对外演示。**

---

### Phase 3：素材管理收尾（Week 4-5）

#### Task 3.1：媒体画廊 + 下载/删除
**Files:** `packages/web/src/pages/GalleryPage.tsx`, `packages/server/src/routes/assets.ts`

- [ ] **Step 1: 后端 GET /api/media（按 product 过滤，含 prompt_text）**
- [ ] **Step 2: 前端画廊页（网格 + 缩略图 + 点击看大图 + prompt 详情）**
- [ ] **Step 3: 删除（DELETE /api/media/:id，同步删 OSS 文件）**
- [ ] **Step 4: Commit**

#### Task 3.2：错误处理与重试加固
- [ ] **Step 1: 适配器错误分类（限流/网络/参数错误）与重试策略**
- [ ] **Step 2: Agent 循环的 tool 失败处理（不崩，记 error 继续或结束）**
- [ ] **Step 3: 前端错误态展示**
- [ ] **Step 4: Commit**

> **Phase 3 Gate**：MVP 可日常使用。之后进 Phase 4+（模板套图、试穿、视频、批量、模型管理 UI）——这些届时再单独出计划。

---

## 7. 关键假设验证时点（熔断点总表）

| 假设 | 验证 Task | 不通过的后果 |
|------|----------|-------------|
| A1 即梦/OutfitAnyone 保真 | Task 0.2 | 换 gpt-image-1 或加强保真参数；最差加本地 Flux 兜底 |
| A2 SSE 可移植 | Task 0.3 | 改用 WebSocket 或长轮询 |
| A3 多模态看回生图 | Task 0.4 ⭐ | **Agent 工具循环范式不成立**，退化为纯 Pipeline 模式（无看回重试） |

**规则**：Task 0.4 是最高风险点，必须最先或在 Phase 0 早期验证。若 A3 失败，整个 §5（多模型编排 Agent）设计需重做。

---

## 8. 执行方式

**推荐 Subagent-Driven Development**（本计划已为多 agent 并行设计）：
- Phase 0：单 agent 串行（3 个验证脚本，快速过熔断点）
- Phase 1：Agent-α 做 Task 1.1-1.5（阻塞链）
- Phase 2：β（tools/agent/routes）与 γ（web）在 α 完成后并行
- 每个 Task 完成后 review 再进下一个

**引用的 skills**：
- @superpowers:subagent-driven-development（推荐执行方式）
- @superpowers:test-driven-development（每个 Task 的 TDD 纪律）
- @superpowers:systematic-debugging（熔断点失败时的排查）
- @superpowers:verification-before-completion（每 Phase Gate 验收）
