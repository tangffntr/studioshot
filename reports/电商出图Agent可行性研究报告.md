# 电商出图全流程 Agent + Skill 可行性研究报告（v4）

> 编制日期：2026-06-19（v4 修订）
> 调研范围：GitHub 开源电商出图项目、在线 API（出图/试穿/视频/抠图）、Agent/Skill 工程、**两个参考项目（opencode web 架构、Toonflow 模型与资产管理）**
> 目标：论证「用 Agent + Skill 模式从产品分析到设计出图全流程自研，并交付**可交互 Web 应用**，含**模型管理**、**素材管理**、**多模型编排 Agent**、**预设模板系统**」的可行性

## 📌 v4 修订要点（相对 v3）

> v3 把"多模型调用"和"预设模板"都弱化成了附属提及，**这两点对电商出图工具其实是核心**，v4 补成正式设计。

1. **新增「多模型编排 Agent」设计（§五）**：澄清 v3 "Agent 编排层"黑盒。确认采用 opencode 验证过的范式——**主 Agent 是一个多模态工具调用 Agent**（单一推理 LLM 驱动循环），把"看图/生图/生视频/试穿"都建模成**工具（tool）**，由主 LLM 在一个循环里并发调用、看回结果、继续推理。这让它从"流水线脚本"升级为"真 Agent"：能自适应「生图→看效果→不满意→换角度重试」。
2. **新增「预设模板系统」设计（§六）**：v3 仅把 25 模板作为引用，v4 把模板升级为**一类被管理的核心资产**——新增 `templates` 表族，结构化定义"图片序列（H1-H5 + D1-D9）+ 风格锁 + 平台尺寸规则 + 类目适配 + Prompt 占位"，并给出模板→prompt 的渲染管线。这是电商工具的内容资产底座。

## 📌 v3 修订要点（相对 v2）

1. **新增「可交互 Web 应用」架构**：借鉴 `D:\zcode\opencode` 的 SolidJS + Vite 前端 + Effect/HttpApi 后端 + REST/SSE 通信 + SQLite 持久化模式，作为交互层蓝本。
2. **新增「模型管理」设计**：借鉴 `D:\opc\Toonflow-app` 的 **vendor 插件架构**（每供应商一个 TS 文件 + vm2 沙箱执行）+ `o_vendorConfig`（供应商凭证表）+ `o_agentDeploy`（模型绑定任务槽）+ `ai.ts` 统一门面（`Ai.Text/Image/Video/Audio`）。并针对 v2 提到的"密钥明文存储"风险做了加固建议。
3. **新增「素材与提示词管理」设计**：借鉴 Toonflow 的 `o_assets`/`o_image`/`o_video`（资产 + 媒体分离）+ `o_prompt`/`o_modelPrompt`（提示词库 + 模型绑定）+ `o_tasks`（任务审计）+ OSS 本地文件存储抽象。
4. **把电商领域资产模型完整建模**：产品库、提示词库、出图库、出片库、版本树、SKU 关系，全部落到数据模型。

---

## 一、执行摘要（TL;DR）

**结论：可行性高，两个参考项目几乎提供了所有需要的工程范式，建议立项实施。**

1. **交互层**完全可复用 opencode 的成熟模式：SolidJS + Vite 前端、REST 下发命令 + 单一 SSE 流推送所有进度、SQLite（Drizzle/WAL）持久化、"admit-then-run"异步任务模型（提交即返回，worker 异步执行，天然支持排队/重试/续跑）。
2. **模型管理层**完全可复用 Toonflow 的 vendor 插件架构：每个供应商（OpenAI/即梦/阿里云/可灵/抠图）是一个 TS 文件，导出 `textRequest/imageRequest/videoRequest` 标准接口，在 vm2 沙箱执行；凭证存表、模型绑定到任务槽（主图/详情页/试穿/视频）。`ai.ts` 的 `Ai.Image("jimeng:seedream-4").run(config).save(path)` 链式门面可直接照搬。
3. **素材管理层**完全可复用 Toonflow 的资产模型：`o_assets`（逻辑资产：产品/SKU/模特）+ `o_image`/`o_video`（物理媒体：含生成状态机）+ `o_prompt`/`o_modelPrompt`（提示词库 + 模型绑定）+ `o_tasks`（任务审计），存储用本地 OSS 抽象（可平滑切 S3）。
4. **出图/试穿/视频全部走在线 API**（v2 结论不变）：gpt-image-1 + 即梦 seedream 4.0 双出图、OutfitAnyone 试穿、即梦/可灵视频。
5. **多模型编排 Agent（v4）**：经 opencode 源码核验，确认主 Agent 设计为**多模态工具调用 Agent**——一个多模态主推理 LLM（GPT-4o/GLM-4.5V）驱动循环，把看图/生图/生视频/试穿/抠图各建模成工具，自主并发调用并看回结果继续推理。这让它能处理"生图→看效果→不满意→重做"这类需看回结果再决策的场景，从流水线升级为真 Agent。
6. **预设模板系统（v4）**：电商出图有强行业惯例（5 主图 + 9 详情页为标配），v4 把模板升级为被管理核心资产——`templates`/`template_slots`/`platform_specs` 三表结构化定义图片序列+用途+尺寸+类目适配，内置 ecom-details-image 的 25 模板，并作为驱动 Agent 编排的"剧本"。
7. **主要新增工程量**相对 v2：① Web 前端（聊天式交互 + 素材浏览器）；② 四个管理表族（供应商/模型绑定、资产/媒体、提示词、模板）；③ 工具调用 Agent 循环；④ SSE 进度推送。这些都是成熟模式，无技术风险。
8. **预估**：含可交互 Web 应用 + 模型/素材/模板管理 + 多模型 Agent，**2 人 9-11 周**（前端 1 人 + 后端/Agent 1 人）可交付 MVP。

---

## 二、两个参考项目深度分析

### 2.1 opencode —— 可交互 Web 架构蓝本

> 位置：`D:\zcode\opencode`（Bun + Turborepo 单体仓库）

**架构总览**（按 `packages/` 划分）：

| 包 | 职责 | 对我们的价值 |
|----|------|-------------|
| `packages/app` | **Web 前端（SolidJS + Vite + Tailwind）** | ⭐ 交互层直接参考 |
| `packages/server` | HTTP API 层（Effect HttpApi） | ⭐ 后端路由参考 |
| `packages/core` | 领域核心：session 运行时、DB、模型、provider、tools、事件 | ⭐ Agent 核心参考 |
| `packages/llm` | **供应商无关的 LLM 客户端抽象**（stream/generate/generateObject） | ⭐ 模型抽象参考 |
| `packages/sdk/js` | 自动生成的类型化客户端（OpenAPI → TS） | 前后端契约参考 |
| `packages/opencode` | CLI + 本地 agent 运行时/服务器 | |

**核心可复用模式：**

1. **前后端通信：REST（命令）+ 单一 SSE（进度）**
   - 用户提交：`POST /api/session/:id/prompt` → 服务端"durable admit"一行输入后**立即返回**（`packages/server/src/handlers/session.ts:96-127`）
   - 所有实时进度（token 流、工具事件、状态）走**单一 SSE 流** `GET /api/event`（`packages/app/src/context/server-sdk.tsx:153-239`）
   - 客户端 16ms 帧合并、15s 心跳超时重连、250ms 退避自动重连、bfcache/visibility 重连——这套逻辑可直接照搬
   - **对我们的价值**：出图/出视频是长任务，SSE 推送进度（`generation.part.delta` / `generation.completed` / `generation.failed`）是最佳实践

2. **"admit-then-run" 异步任务模型**（`packages/core/src/session/`）
   - prompt 先持久化为一行 `session_input`，返回 task_id，worker 异步消费
   - **天然支持**：排队、重试、崩溃恢复、续跑——这正是电商批量出图（SKU 套装几十张图）需要的能力

3. **多供应商 Provider 注册表**（`packages/opencode/src/provider/provider.ts:107-134`）
   - `BUNDLED_PROVIDERS` 动态 import ~25 个 `@ai-sdk/*` 工厂
   - 模型引用格式 `provider/model`（如 `anthropic/claude-...`）
   - 凭证存 `auth.json`（mode 0o600），按 provider ID 查
   - **对我们的价值**：出图/试穿/视频的多供应商路由可照此设计

4. **持久化：SQLite（Drizzle，WAL 模式）+ S3 对象存储**
   - DB：WAL + synchronous=NORMAL + busy_timeout=5000（`packages/core/src/database/database.ts:22-37`）
   - 二进制资产：`@aws-sdk/client-s3`，infra 在 `infra/lake.ts`
   - **对我们的价值**：会话/消息/任务存 SQLite，图片/视频存 OSS（本地目录起步，可切 S3）

5. **配置分层**（`packages/opencode/src/config/config.ts`）：全局 JSON + 项目级 + 环境变量 + 远程/组织配置——适合多租户品牌包

**前端关键文件**（值得精读）：
- `packages/app/src/context/server-sdk.tsx` — SSE 客户端
- `packages/app/src/context/sync.tsx` — 事件→store 归约
- `packages/app/src/context/prompt.tsx:17-42` — 已含 `ImageAttachmentPart`，与出图工具天然契合
- `packages/app/src/pages/session/timeline/message-timeline.tsx` — 时间线视图

**opencode 的缺口**（需我们补）：无专门的"生成资产画廊/管理器"——这正是 Toonflow 补齐的部分。

### 2.2 Toonflow —— 模型管理与资产管理蓝本

> 位置：`D:\opc\Toonflow-app`（Electron + Express + better-sqlite3）

#### A. 模型管理：vendor 插件沙箱架构（核心创新）

Toonflow 把"每个 AI 供应商"做成一个**自包含的 TS 文件**（`data/vendor/*.ts`），在 **vm2 沙箱**里运行。这是极具扩展性的设计：

```ts
// data/vendor/openai.ts 示例结构
const vendor: VendorConfig = {
  id: "openai",
  version: "2.0",
  name: "OpenAI标准接口",
  inputs: [{ key: "apiKey", label: "API密钥", type: "password", required: true }, ...],
  inputValues: { apiKey: "", baseUrl: "https://api.openai.com/v1" },
  models: [ { name:"GPT-4o", modelName:"gpt-4o", type:"text", think:false }, ... ],
};
exports.vendor = vendor;
exports.textRequest  = (model, think) => createOpenAI({...}).chat(model.modelName);
exports.imageRequest = async (config, model) => {...};  // 返回 base64
exports.videoRequest = async (config, model) => {...};
exports.ttsRequest   = async (config, model) => {...};
```

**模型类型判别联合**（Zod 校验，`src/routes/setting/vendorConfig/addVendor.ts:25-58`）：
- `TextModel`：`{ type:"text", think:boolean }`
- `ImageModel`：`{ type:"image", mode:("text"|"singleImage"|"multiReference")[] }`
- `VideoModel`：`{ type:"video", mode:VideoMode[], audio, durationResolutionMap }`
- `TTSModel`：`{ type:"tts", voices }`

**两张核心表**：
- `o_vendorConfig`（`src/lib/initDB.ts:555-616`）：`{ id, inputValues(JSON凭证), models(JSON用户扩展模型), enable }`
- `o_agentDeploy`（`initDB.ts:64-117`）：`{ key(任务槽), model, modelName("vendorId:model"), vendorId, temperature, maxOutputTokens, disabled }`

**模型引用格式**：`"vendorId:modelName"`（如 `"jimeng:seedream-4"`），通过 `resolveModelName()` 把"任务槽"解析为具体模型。

**统一门面 `ai.ts`**（`src/utils/ai.ts`，**这是最值得照搬的文件**）：
```ts
// 链式调用，优雅
await u.Ai.Image("jimeng:seedream-4")
  .run({ prompt, referenceList, size:"1K", aspectRatio:"1:1" })
  .save(`/${projectId}/role/${uuid}.png`);
```
- `getVendorTemplateFn()`（`ai.ts:113-140`）：运行 vendor 代码 → 注入凭证 → 返回适配函数
- `AiText/AiImage/AiVideo/AiAudio` 四个类，统一的 `run().save()` 链
- `withTaskRecord()`（`ai.ts:142-162`）：每次调用自动记录 `o_tasks`（审计/计费）

**两种绑定模式**（`o_setting.agentUseMode`）：
- 简易模式（"0"）：一个模型绑主任务槽，子任务继承
- 高级模式（"1"）：每个子任务槽独立绑模型

#### B. 资产管理：逻辑资产 + 物理媒体分离（核心创新）

Toonflow 把"资产"和"媒体文件"分开建模——这正是电商出图需要的：

**`o_assets`（逻辑资产）**（`initDB.ts:444-465`）：
```
{ id, name, prompt, remark, type, describe, scriptId,
  imageId->o_image,  -- 当前代表图
  assetsId(自引用,父资产,用于变体),  -- ⭐ 变体树
  projectId, flowId, startTime,
  promptState, audioBindState, promptErrorReason }
```
- `type`：`role|scene|tool|clip|audio`（电商可映射为 `product|sku|model|scene|material`）
- `assetsId` 自引用 → **父子变体关系**（同一产品的多个 SKU/版本）

**`o_image`（物理媒体 + 生成状态机）**（`initDB.ts:468-482`）：
```
{ id, filePath, type, assetsId, model, resolution,
  state: "生成中"->"已完成"/"生成失败",  -- ⭐ 状态机
  errorReason }
```

**`o_video`**（`initDB.ts:522-535`）：`{ id, filePath, state, scriptId, projectId, ... }`

**OSS 本地存储抽象**（`src/utils/oss.ts`）：
- 根目录 `data/oss/`，路径约定 `/{projectId}/{type}/{uuid}.ext`
- `writeFile`（自动 base64 解码）、`getFileUrl`（生成 `/oss/...` 静态 URL）、`getSmallImageUrl`（`sharp` 即时缩略图，缓存 `oss/smallImage/`）
- 路径遍历防护（`isPathInside`）
- **可平滑切 S3**：抽象层换实现即可

#### C. 提示词管理：三套机制

1. **`o_prompt`**（`initDB.ts:338-372`）：命名提示词模板，`type` 枚举（事件抽取/脚本资产/视频提示词/音频绑定），`data` 存大段 markdown
2. **`o_modelPrompt`**（`initDB.ts:374-386`）：**把提示词文件绑定到具体模型** `{ vendorId, model, fileName, path }`——不同视频模型用不同提示词模板
3. **Skill markdown 文件**（`data/skills/*.md`）：agent 行为定义，`o_skillList` 跟踪（含 md5/embedding/health state）

#### D. 任务审计：`o_tasks`（`database.d.ts:188-198`）

`{ id, describe, model, projectId, reason, relatedObjects(JSON), startTime, state, taskClass }`
- `u.task()` helper（`src/utils/taskRecord.ts:15-60`）：插入 `state:"进行中"`，返回 `done(1|-1, reason?)` 闭包
- **每次 AI 调用自动记录**：用了哪个模型、关联哪个对象、成功/失败原因——这是计费与可观测性的基础

#### E. Toonflow 的不足（我们需改进）

1. **API 密钥明文存储**（`o_vendorConfig.inputValues` 是明文 JSON）→ 我们应加密（见 §五 5.2）
2. **vm2 沙箱**有性能开销且已停止维护 → 我们可简化为 JSON 注册表 + 受控适配器（见 §五 5.1）
3. **Electron 桌面形态** → 我们要 Web 多用户

---

## 三、总体架构设计（v3 新增）

融合 opencode（交互 + Agent 运行时）与 Toonflow（模型 + 资产管理）：

```
┌─────────────────────────────────────────────────────────────────┐
│              Web Frontend (SolidJS + Vite + Tailwind)            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ 对话/任务工作台│ │ 素材浏览器    │ │ 设置(供应商/模型/提示词) │ │
│  │ (类opencode)  │ │ (资产+媒体库) │ │ (模型绑定/品牌包)        │ │
│  └──────┬───────┘ └──────┬───────┘ └────────────┬─────────────┘ │
│         │  REST(命令)    │  REST(查询)          │               │
│         └────────────────┴───────────┬──────────┴───────────────┘ │
│              单一 SSE 流 ◄───────────┘ (进度/事件推送)            │
└──────────────────────────────────────┬──────────────────────────┘
                                       │ HTTP
┌──────────────────────────────────────▼──────────────────────────┐
│           Backend Server (Node/Bun + Effect or Express)          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐│
│  │ Agent 编排层 │  │ API 适配层    │  │ 素材/提示词管理服务       ││
│  │(读AGENTS.md)│  │(Model Mgr)   │  │ (Asset/Prompt Service)   ││
│  │ DAG 调度Skill│◄─┤ vendor 路由   │  │                          ││
│  └──────┬──────┘  └──────┬───────┘  └────────────┬─────────────┘│
│         │                │                       │              │
│         ▼                ▼                       ▼              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │   Persistence (SQLite/Drizzle, WAL) + OSS(本地/S3)       │   │
│  │  sessions │ assets │ images │ videos │ prompts │ tasks    │   │
│  │  vendorConfig │ modelDeploy │ products │ skus │ models    │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────┬──────────────────────────┘
                                       │ 在线 API
                     ┌─────────────────┼──────────────────┐
                     ▼                 ▼                  ▼
              出图(gpt-image/      试穿(OutfitAnyone)  视频(即梦/可灵)
                   即梦seedream)    抠图(阿里云分割)
```

---

## 四、数据模型设计（v3 新增核心）

基于 Toonflow 表族，按电商领域重新建模。全部 SQLite 表，Drizzle ORM。

### 4.1 模型管理层表族

#### `vendors`（供应商注册表）— 简化版，JSON 配置代替 vm2
```sql
CREATE TABLE vendors (
  id          TEXT PRIMARY KEY,        -- "openai" / "jimeng" / "aliyun-tryon" / "kling"
  name        TEXT NOT NULL,           -- 显示名
  category    TEXT NOT NULL,           -- "image"|"video"|"tryon"|"matting"|"vlm"
  adapter     TEXT NOT NULL,           -- 适配器标识(指向受控代码)
  base_url    TEXT,
  inputs      TEXT NOT NULL,           -- JSON: 凭证字段定义 [{key,label,type,required}]
  created_at  INTEGER
);
```

#### `vendor_credentials`（供应商凭证）— 加密存储（改进 Toonflow 明文问题）
```sql
CREATE TABLE vendor_credentials (
  vendor_id   TEXT PRIMARY KEY REFERENCES vendors(id),
  values_enc  BLOB NOT NULL,           -- ⭐ AES 加密的凭证 JSON
  enabled     INTEGER DEFAULT 1,
  updated_at  INTEGER
);
```

#### `models`（模型目录）
```sql
CREATE TABLE models (
  id          TEXT PRIMARY KEY,        -- "jimeng:seedream-4"
  vendor_id   TEXT NOT NULL REFERENCES vendors(id),
  model_name  TEXT NOT NULL,           -- API 实际模型名 "doubao-seedream-4-0"
  display_name TEXT,
  type        TEXT NOT NULL,           -- "image"|"video"|"tryon"|"vlm"|"matting"
  modes       TEXT,                    -- JSON: ["text","singleImage","multiReference"]
  capabilities TEXT,                   -- JSON: {size:[], quality:[], maxRef:16}
  pricing     TEXT,                    -- JSON: {unit, price} 用于成本估算
  enabled     INTEGER DEFAULT 1
);
```

#### `task_slots`（模型绑定任务槽）— 对应 Toonflow `o_agentDeploy`
```sql
CREATE TABLE task_slots (
  slot_key    TEXT PRIMARY KEY,        -- "product-analyze"|"main-image"|"detail-page"
                                        --|"tryon"|"video"|"bg-remove"|"sku-swap"
  model_id    TEXT REFERENCES models(id),
  params      TEXT,                    -- JSON: {temperature, quality, size, ...}
  description TEXT
);
```
> 一个 slot 绑一个模型，Skill 按 slot 调用，切换模型只改绑定。

### 4.2 素材管理层表族（电商领域）

#### `products`（产品库）
```sql
CREATE TABLE products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT,                    -- 类目: 服饰/3C/美妆/家居...
  attributes  TEXT,                    -- JSON: VLM 分析出的 SKU 属性
  selling_points TEXT,                 -- JSON: 卖点 + 转化驱动力分类
  brand_kit_id TEXT,                   -- 关联品牌包(色板/字体/logo)
  created_at  INTEGER
);
```

#### `assets`（逻辑资产）— 对应 Toonflow `o_assets`，含变体树
```sql
CREATE TABLE assets (
  id          TEXT PRIMARY KEY,
  product_id  TEXT REFERENCES products(id),
  parent_id   TEXT REFERENCES assets(id),  -- ⭐ 父资产(变体/迭代)
  type        TEXT NOT NULL,               -- "main"|"detail"|"model"|"video"|"scene-swap"
  scene_template TEXT,                    -- 关联场景模板(25模板之一)
  prompt_id   TEXT REFERENCES prompts(id), -- 使用的提示词
  status      TEXT DEFAULT 'draft',       -- "draft"|"generating"|"done"|"failed"
  cover_media_id TEXT,                    -- 代表图(指向 media)
  tags        TEXT,                       -- JSON: ["亚马逊","夏季","白底"]
  created_at  INTEGER
);
```

#### `media`（物理媒体）— 对应 Toonflow `o_image`/`o_video`
```sql
CREATE TABLE media (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT REFERENCES assets(id),
  type        TEXT NOT NULL,           -- "image"|"video"
  file_path   TEXT NOT NULL,           -- OSS 路径 /{product}/{type}/{uuid}.ext
  thumb_path  TEXT,                    -- 缩略图路径
  model_id    TEXT REFERENCES models(id),  -- 由哪个模型生成
  prompt_text TEXT,                    -- ⭐ 当时用的完整 prompt(留痕)
  params      TEXT,                    -- JSON: {size, quality, referenceList...}
  gen_state   TEXT,                    -- "queued"|"running"|"done"|"failed"
  error_reason TEXT,
  cost        REAL,                    -- 本次生成成本(用于计费)
  width       INTEGER, height INTEGER, duration REAL,
  created_at  INTEGER
);
```
> ⭐ `prompt_text` 留痕是关键：每张图都记录"用什么提示词、什么参数、哪个模型生成的"，支持复现与调优。

#### `media_versions`（版本树）— 改进：同资产多次迭代
```sql
CREATE TABLE media_versions (
  id          TEXT PRIMARY KEY,
  media_id    TEXT REFERENCES media(id),
  version     INTEGER NOT NULL,        -- 版本号
  file_path   TEXT NOT NULL,
  prompt_text TEXT,                    -- 该版本 prompt
  diff_note   TEXT,                    -- 相对上版的改动说明
  created_at  INTEGER
);
```

### 4.3 提示词管理层表族

#### `prompts`（提示词库）— 对应 Toonflow `o_prompt`
```sql
CREATE TABLE prompts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,           -- "image"|"video"|"system"|"negative"
  category    TEXT,                    -- "hero"|"detail"|"social"|"vton"|"video-main"
  template    TEXT NOT NULL,           -- 含 {变量} 占位的模板
  variables   TEXT,                    -- JSON: 变量定义 [{key,desc,default}]
  negative    TEXT,                    -- 负面约束
  style_lock  TEXT,                    -- Campaign Style Lock 文本
  tags        TEXT,
  created_at  INTEGER, updated_at INTEGER
);
```

#### `prompt_model_bindings`（提示词↔模型绑定）— 对应 Toonflow `o_modelPrompt`
```sql
CREATE TABLE prompt_model_bindings (
  prompt_id   TEXT REFERENCES prompts(id),
  model_id    TEXT REFERENCES models(id),
  override_template TEXT,              -- 该模型专用的模板变体
  PRIMARY KEY (prompt_id, model_id)
);
```
> 不同模型对 prompt 风格敏感（即梦中文友好、gpt-image 英文友好），可绑不同模板。

### 4.4 任务与审计表族

#### `jobs`（异步任务）— 对应 opencode admit-then-run
```sql
CREATE TABLE jobs (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,           -- "single-image"|"batch-sku"|"video"|"tryon"
  product_id  TEXT, asset_id TEXT,
  payload     TEXT NOT NULL,           -- JSON: 任务参数
  status      TEXT DEFAULT 'queued',   -- "queued"|"running"|"done"|"failed"|"canceled"
  progress    INTEGER DEFAULT 0,       -- 0-100
  result      TEXT,                    -- JSON: 输出 media_ids
  error       TEXT,
  created_at  INTEGER, started_at INTEGER, finished_at INTEGER
);
```

#### `api_calls`（API 调用审计 + 计费）— 对应 Toonflow `o_tasks`，强化计费
```sql
CREATE TABLE api_calls (
  id          TEXT PRIMARY KEY,
  job_id      TEXT REFERENCES jobs(id),
  model_id    TEXT REFERENCES models(id),
  vendor_id   TEXT,
  request_summary TEXT,                -- 请求摘要(不含敏感)
  duration_ms INTEGER,
  cost        REAL,                    -- 本次成本
  status      TEXT,                    -- "success"|"failed"
  error       TEXT,
  created_at  INTEGER
);
```

### 4.5 ER 关系总览

```
products ──< assets ──< media ──< media_versions
              │           │
              │           └─(prompt_text 留痕)
              ├─> prompts ──< prompt_model_bindings >── models
              │                                              │
              └──(status 状态机)                          vendors ──< vendor_credentials
                                                              │
jobs ──< api_calls ──────────────────────────────────────────┘
task_slots ──> models (绑定)
```

---

## 五、多模型编排 Agent 设计（v4 新增核心）

> 这一节澄清 v3 里被写成黑盒的"Agent 编排层"。核心问题：**主 Agent 如何同时驾驭文本模型、看图模型（VLM）、生图模型、视频模型、试穿模型？**

### 5.1 关键设计决策：主 Agent = 多模态工具调用 Agent

经对 opencode agent 循环的源码核验（`packages/core/src/session/runner/llm.ts`），确认采用其验证过的范式：

- **一个"主推理 LLM"驱动整个循环**（文本/多模态均可，建议用多模态大模型如 GPT-4o / GLM-4.5V，本身能读图）
- **每种专用能力（看图分析、生图、生视频、试穿、抠图）建模成一个「工具 tool」**，注册到工具表
- 主 LLM 在循环里**自主决定调用哪个工具、传什么参数**，工具并发执行（opencode 用 `FiberSet.run` 并发 settle，`llm.ts:280`），结果回灌给主 LLM 继续推理
- 循环有**最大步数控制**（opencode `MAX_STEPS = 25`，`llm.ts:88`），防止无限调用

**为什么不是"流水线脚本"？** 流水线（A→B→C 写死）无法应对"生图后看效果不满意→换角度重试""试穿后 VLM 发现版型歪了→换模特重试"这类**需要看回结果再决策**的场景。工具调用 Agent 天然支持：主 LLM 调 `generate_image` → 工具返回图（经 `toModelOutput` 转成 `file` 内容部分，opencode `tool/read.ts:46-53`）→ 主 LLM 在下一回合真的"看见"这张图 → 自主判断满意/重做。

### 5.2 工具清单（每类模型 = 一个工具）

每个工具内部用各自的专用模型（独立于主推理 LLM 的模型解析）：

| 工具名 | 对应模型类型 | 内部调用 | 输入 | 输出（回灌主 LLM） |
|--------|------------|---------|------|-------------------|
| `analyze_product` | **看图 VLM** | Qwen2.5-VL / GLM-4.5V / GPT-4o | 产品图 | 结构化属性 JSON（text） |
| `render_brief` | **文本 LLM** | 主 LLM 或独立文本模型 | 属性 + 卖点 | Visual Brief + 图片序列计划（text） |
| `generate_image` | **生图模型** | gpt-image-1 / 即梦 seedream | prompt + 参考图 + size | 生成图（file: base64+mime）⭐ 主 LLM 可见 |
| `generate_video` | **视频模型** | 即梦视频 3.0 Pro / 可灵 | 主图 + prompt | 生成视频帧/链接（text+file） |
| `virtual_tryon` | **试穿模型** | OutfitAnyone / ManekenAI | 服装平铺图 + 模特图 | 试穿图（file） |
| `remove_bg` | **抠图模型** | 阿里云分割 | 产品图 | 透明底图（file） |
| `scene_swap` | **生图(编辑)** | gpt-image edit / 即梦图生图 | 对标图 + 自家产品 + mask | 换产品图（file） |
| `compose_layout` | **生图+排版** | gpt-image edit + Pillow | 生成图 + 文案 | 含文详情页图（file） |
| `check_quality` | **看图 VLM** | 同 analyze | 待检图 | 合规/保真/一致性评分（text） |

> 主 LLM 选型建议：**多模态大模型**（能直接看 `generate_image` 返回的图），如 GLM-4.5V / GPT-4o / Qwen2.5-VL。这样"看图→决策"闭环在一个模型内完成，无需把图转文本再喂回去。

### 5.3 工具定义范式（照搬 opencode Tool.make）

```ts
// 工具契约（照搬 opencode packages/core/src/tool/tool.ts:36-52）
interface ToolConfig {
  description: string;        // 给主 LLM 看的工具说明
  input: Schema;              // Effect/Zod Schema → 自动转 JSON Schema 给模型
  execute: (input, ctx) => Promise<Output>;
  toModelOutput?: (input) => Content[];   // ⭐ 决定结果如何回灌主 LLM
}
type Content =
  | { type: "text"; text: string }
  | { type: "file"; data: string; mime: string; name?: string };  // 图片回灌用

// 示例：生图工具（参考 opencode tool/read.ts:46-53 的图片回灌模式）
const generateImage = Tool.make({
  description: "按 prompt 和参考产品图生成电商图。用于主图/场景图/详情页。",
  input: Schema.Struct({
    prompt: Schema.String,
    referenceImageAssetIds: Schema.Array(Schema.String),
    size: Schema.Literal("1024x1024"),  // 由模板决定
    purpose: Schema.String,             // 主 LLM 说明用途，便于审计
  }),
  execute: async (input, ctx) => {
    const refs = await loadAssets(input.referenceImageAssetIds);
    // 内部用 Model.image(task_slot="main-image") 取绑定模型（见 §4.1 task_slots）
    return await Model.image("main-image")
      .generate({ prompt: input.prompt, referenceImages: refs, size: input.size })
      .save(`/${ctx.productId}/${ctx.type}/${uuid()}.png`);  // 落 OSS + 建 media 记录
  },
  toModelOutput: ({ output }) => [
    { type: "text", text: `已生成 ${output.purpose}：${output.mediaId}` },
    { type: "file", data: output.base64, mime: "image/png", name: output.filename },  // ⭐ 主 LLM 下一回合能看见这张图
  ],
});
```

**关键点**：`generate_image` 内部的"用哪个模型"由 `task_slots` 表绑定决定（§4.1），与主推理 LLM 解耦。换出图模型只改绑定，不动工具代码。

### 5.4 编排循环示意（一个真实电商任务的 Agent 轨迹）

```
用户："基于白底图 NEW002.jpg 生成亚马逊详情页全套"
  ↓ 主 LLM 第1回合：调用 analyze_product(图=NEW002)
  ← 工具返回：{category:"衬衫", color:"白", material:"棉", ...}（text）
  ↓ 主 LLM 第2回合：调用 render_brief(属性, 平台=亚马逊)
  ← 工具返回：Brief + 序列计划[H1..H5, D1..D9]（text）
  ↓ 主 LLM 第3回合：并发调用 generate_image×5（H1-H5，各自 prompt + 参考图）
  ← 工具返回：5 张图（file×5）⭐ 主 LLM 现在能看见这 5 张主图
  ↓ 主 LLM 第4回合：调用 check_quality(图=H1)（自主抽查）
  ← 工具返回：{score:0.6, issues:["Logo 文字变形"]}
  ↓ 主 LLM 第5回合：判断不满意 → 调用 generate_image(prompt+负面约束, size) 重做 H1
  ← ...
  ↓ 主 LLM 第N回合：序列全部满意 → 汇总输出 media_ids，结束
```

这正是"真 Agent"而非"流水线"的价值——**主 LLM 基于看回的图自主决策重试/调整**。

### 5.5 与 v3 模型管理的关系

| 概念 | 归属 | 说明 |
|------|------|------|
| **主推理 LLM** | `task_slots["orchestrator"]` | Agent 循环唯一驱动模型，建议多模态 |
| **专用模型（生图/视频/试穿/VLM）** | 各自 `task_slots["main-image"/"video"/"tryon"/...]` | 被工具内部调用，与主 LLM 解耦 |
| **工具** | 受控代码（注册表） | 封装"调专用模型 + 回灌结果"，对主 LLM 暴露统一接口 |

→ v3 的 `task_slots` 表无需改动即可承载本设计：新增一个 `orchestrator` 槽绑主推理 LLM，其余槽绑各专用模型。

### 5.6 兜底：确定性编排模式（可选）

对于"标准流程无需 LLM 自主决策"的批量场景（如 SKU 套装几十张图），可提供**确定性 DAG 编排模式**作为补充：直接按模板序列顺序调工具，不经过主 LLM 推理，省 token、更稳定、可批量。两种模式共存：
- **Agent 模式**（默认）：单商品、需灵活决策、主 LLM 自主编排
- **Pipeline 模式**（批量）：多 SKU、标准流程、确定性 DAG，工具调用顺序由模板固定

---

## 六、预设模板系统设计（v4 新增核心）

> v3 仅把 25 模板作为外部引用。对电商工具，**预设模板是内容资产底座**——它定义"一套图该有哪些张、每张什么用途、什么尺寸、什么 prompt 骨架"。v4 升级为被管理的核心资产。

### 6.1 为什么模板是核心资产

电商出图有强行业惯例（验证于 ecom-details-image 的 H1-H5/D1-D9 与站酷行业数据：**消费者通常滑完 5 张主图就决策**）。这些"图片序列的信息架构"不应散落在 prompt 里，而应结构化为模板：

- **可复用**：一套好模板服务无数商品
- **可差异化**：亚马逊/淘宝/抖音各平台尺寸与序列规则不同
- **可沉淀**：运营经验（哪张图放对比、哪张放 FAQ）固化进模板而非每次重写
- **可驱动 Agent**：模板告诉主 Agent"该按什么序列调用 generate_image"（§5.4 的序列计划即来自模板）

### 6.2 模板结构定义（`templates` 表 + 子表）

#### `templates`（模板主表）
```sql
CREATE TABLE templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,           -- "亚马逊PDP标准套图" / "抖音主图5张" / "服饰模特试穿套"
  category    TEXT NOT NULL,           -- "pdp"|"hero-only"|"social"|"tryon"|"seasonal"
  platform    TEXT,                    -- "amazon"|"taobao"|"jd"|"douyin"|"shopify"|null(通用)
  product_category TEXT,               -- 适配类目 "服饰"|"3C"|"美妆"|null(全类目)
  description TEXT,
  is_builtin  INTEGER DEFAULT 0,       -- 内置(随产品发布) vs 用户自建
  version     INTEGER DEFAULT 1,
  created_at  INTEGER, updated_at INTEGER
);
```

#### `template_slots`（模板的图片序列定义）⭐ 核心
一个模板由若干"图位"组成，每个图位定义该位置的图该怎么出：
```sql
CREATE TABLE template_slots (
  id          TEXT PRIMARY KEY,
  template_id TEXT REFERENCES templates(id),
  slot_code   TEXT NOT NULL,           -- "H1"|"D3"|"M1"  (H=主图/D=详情/M=模特)
  purpose     TEXT NOT NULL,           -- "首图卖点"|"痛点放大"|"模特上身"
  sequence    INTEGER NOT NULL,        -- 序号
  scene_type  TEXT,                    -- 关联场景类型(hero/lifestyle/flatlay/before-after...)
  size_preset TEXT,                    -- "1024x1024"|"1024x1536" (平台尺寸规则)
  prompt_template_id TEXT REFERENCES prompts(id),  -- 该图位的 prompt 骨架
  required    INTEGER DEFAULT 1,       -- 是否必出
  depends_on  TEXT,                    -- JSON: 依赖其他图位(如模特图依赖服装图)
  notes       TEXT                     -- 出图注意事项(给主 Agent 看)
);
```

#### `platform_specs`（平台尺寸与规则）
```sql
CREATE TABLE platform_specs (
  platform    TEXT PRIMARY KEY,        -- "amazon"|"taobao"|"jd"|"douyin"
  hero_size   TEXT,                    -- 主图尺寸 "1000x1000"
  detail_size TEXT,                    -- 详情页尺寸 "750x(不限)"
  hero_count  INTEGER,                 -- 主图张数 5/6
  rules       TEXT,                    -- JSON: 平台规则(如亚马逊首图必须白底无文字)
  text_render_pref TEXT                -- "中文"|"英文" 影响 prompt 语言
);
```

### 6.3 标准模板示例：亚马逊 PDP 套图（行业标配信息架构）

> 来源验证：ecom-details-image 的 H1-H5 + D1-D9；站酷行业数据"消费者滑完 5 主图即决策"。

| 图位 | 用途 | scene_type | size | prompt 骨架要点 |
|------|------|-----------|------|----------------|
| H1 | 首图卖点—一眼可懂的视觉主张 | hero/白底 | 1024² | 产品主体居中、白底、一句核心卖点 |
| H2 | 核心功能/质感特写 | detail-macro | 1024² | 局部材质/工艺特写 |
| H3 | 使用场景匹配 | lifestyle | 1024² | 真实使用场景 |
| H4 | 普通方案 vs 升级方案对比 | before-after | 1024² | 左右对比 |
| H5 | 优惠/物流/保障/CTA | infographic | 1024² | 信息图+CTA |
| D1 | 首屏承接—为谁解决什么 | hero | 1024×1536 | 痛点+产品承诺 |
| D2 | 痛点放大 | lifestyle | 1024×1536 | 用户当前不便 |
| D3 | 机制解释 | infographic | 1024×1536 | 产品原理可视化 |
| D4 | 核心利益 | infographic | 1024×1536 | 2-4 利益信息图 |
| D5 | 使用步骤 | infographic | 1024×1536 | 3-4 步说明 |
| D6 | 场景覆盖 | lifestyle | 1024×1536 | 典型场景 |
| D7 | 对比选择 | before-after | 1024×1536 | 普通方案 vs 本品 |
| D8 | 信任背书 | infographic | 1024×1536 | 材料/质检/保障 |
| D9 | FAQ/风险逆转/CTA | infographic | 1024×1536 | 常见问题+CTA |

### 6.4 模板 → Prompt 渲染管线

模板不直接是 prompt，而是**驱动 prompt 生成 + 驱动 Agent 编排**的中枢：

```
用户选 产品X + 模板"亚马逊PDP套图"
  ① 加载 template_slots（14 个图位 H1-D9）
  ② 对每个图位：
       a. platform_specs 注入尺寸/规则（亚马逊首图白底）
       b. prompts 表取该图位 prompt_template，填入：
            - 产品属性（来自 product-analyze 的 JSON）
            - 卖点（来自 render_brief）
            - Campaign Style Lock（来自 style-lock，整套图一致）
       c. 渲染出最终 prompt（含负面约束）
  ③ 把 14 个 (图位, prompt, size, 参考图) 喂给主 Agent（§5.4）
  ④ 主 Agent 按序列调 generate_image（Agent 模式）或按固定顺序（Pipeline 模式）
```

### 6.5 内置模板库（首期）

吸收 ecom-details-image 的 25 模板（MIT 可商用）作为内置 `is_builtin=1`，按 `category`+`platform`+`product_category` 三维分类：

| 类别 | 示例模板 |
|------|---------|
| pdp（详情页套图） | 亚马逊PDP(14张)/淘宝详情页/抖音商品卡 |
| hero-only（仅主图） | 白底主图5张/多角度网格 |
| social（社媒） | Twitter推文×3/小红书种草/Instagram |
| tryon（试穿套） | 服饰模特上身(多模特)/虚拟试穿 |
| seasonal（季节营销） | 双11/黑五/春节 Campaign |
| scene-swap（场景替换） | SKU同构图换色/换产品 |

### 6.6 模板与其他资产的联动

```
templates ──< template_slots >── prompts (prompt 骨架)
                │                       │
                │                  prompt_model_bindings >── models (不同模型用不同骨架变体)
                ▼
          platform_specs (尺寸/规则)
                │
                ▼
       驱动主 Agent 的图片序列计划 → generate_image 工具
```

> 模板把"出什么图（slots）+ 怎么出（prompts）+ 多大（platform_specs）+ 给哪个模型（bindings）"全部串联，是驱动 §五 多模型 Agent 的"剧本"。

---

## 七、关键设计细节（v3）

### 7.1 模型管理：受控适配器 + JSON 注册表（简化 Toonflow vm2）

Toonflow 用 vm2 沙箱跑任意 TS，灵活但有维护/性能成本。**建议简化为"受控适配器"模式**：

```ts
// 适配器接口（受控，非任意代码）
interface VendorAdapter {
  category: "image" | "video" | "tryon" | "matting" | "vlm";
  generate(req: GenRequest, creds: Credentials): Promise<GenResult>;
  // GenRequest: { model, prompt, referenceImages, mask, size, quality, ... }
  // GenResult: { base64 | url, cost, meta }
}

// 注册表（受控代码，非用户可编辑）
const adapters: Record<string, VendorAdapter> = {
  "openai-image": new OpenAIImageAdapter(),
  "jimeng": new JimengAdapter(),        // 即梦 seedream + 视频
  "aliyun-tryon": new OutfitAnyoneAdapter(),
  "aliyun-matting": new AliyunMattingAdapter(),
  "kling": new KlingAdapter(),
};
```

**好处**：① 避免 vm2 维护风险；② 每个适配器封装"提交→轮询→下载"异步逻辑（OutfitAnyone/即梦视频都是异步）；③ 凭证从 DB 注入，不进代码。

供应商的**可配置部分**（baseUrl/模型列表/计价）走 JSON（`vendors`/`models` 表），**适配逻辑**走受控代码。这是 Toonflow "code + config 分离"思想的简化版。

### 7.2 凭证安全（改进 Toonflow 明文问题）

- **加密存储**：`vendor_credentials.values_enc` 用 AES-256-GCM 加密，主密钥存环境变量/KMS，不落库
- **运行时注入**：适配器调用前从 DB 解密注入，日志脱敏
- **可选**：多租户时每租户独立密钥

### 7.3 统一门面（照搬 Toonflow ai.ts 链式风格）

```ts
// 业务代码极简
const result = await Model.image("main-image")        // 按任务槽取模型
  .generate({
    prompt: renderedPrompt,                            // 由 prompt-engine 渲染
    referenceImages: [productImage],                   // 参考图保真
    size: "1024x1024",
    quality: "high",
  })
  .save(`/${productId}/main/${uuid}.png`);            // 落 OSS + 建 media 记录
// 自动：记录 api_calls(成本/审计)、更新 asset.cover_media_id、推送 SSE 进度
```

### 7.4 SSE 进度推送（照搬 opencode）

```ts
// 后端发布事件（单一 SSE 流 /api/events）
emit({ type: "job.progress", jobId, progress: 30, message: "生成主图3/9" });
emit({ type: "media.completed", mediaId, thumbUrl });
emit({ type: "job.failed", jobId, error });
// 前端归约到 store（类 opencode sync.tsx），批量任务进度条 + 增量更新画廊
```

### 7.5 提示词与素材的闭环

这是 v3 的核心价值——**提示词、生成参数、产出媒体三者强关联，可复现可调优**：

```
用户选产品 + 场景模板
  → prompt-engine 读 prompts 表模板 + style_lock，填入产品属性 → 渲染 prompt
  → Model.image 生成 → 落 media 表（prompt_text/params/model_id 全留痕）
  → 用户"再来一版/微调" → media_versions 新增版本
  → 标记为满意 → 存入资产库，可复用为后续参考图
```

任何一张图都能回答："它是用什么提示词、什么模型、什么参数、哪几个参考图生成的？"——这是 Toonflow `o_image.model` + `media.prompt_text` 设计的直接价值。

### 7.6 SKU 批量与套装（吸收三万图）

`jobs.type = "batch-sku"` 的编排逻辑：
```
输入: 母版图 + SKU 清单[{color, variant}...]
  → 对每个 SKU:
      sku-swap Skill(保构图换主体) → media
      tryon Skill(若服饰) → media
  → 批量 SSE 进度
  → 输出: 套装组合图(multi-product 模板)
```

---

## 八、技术选型汇总（v3）

| 层 | 选型 | 理由 |
|----|------|------|
| **前端** | SolidJS + Vite + Tailwind 4 | 照搬 opencode，性能优、SSE 支持好 |
| **状态管理** | Solid createStore + TanStack Query | opencode 同款 |
| **后端框架** | Node/Bun + Effect HttpApi 或 Express | Effect 强类型；Express 上手快（Toonflow 同款） |
| **数据库** | SQLite（Drizzle，WAL）→ 可迁 Postgres | opencode/Toonflow 同款，单机起步够用 |
| **对象存储** | 本地 OSS 抽象 → S3/MinIO | Toonflow oss.ts 抽象，可平滑切 |
| **实时通信** | SSE（单一流） | opencode 同款，比 WebSocket 简单 |
| **ORM** | Drizzle（opencode）/ Knex（Toonflow） | 二选一，Drizzle 更现代 |
| **缩略图** | sharp 即时生成 + 缓存 | Toonflow 同款 |
| **AI SDK** | Vercel AI SDK v6（文本）+ 受控适配器（图/视频） | Toonflow 同款 |

---

## 九、可行性评估（v4 更新）

| 维度 | 评级 | 依据 |
|------|------|------|
| **技术可行性** | 🟢 高 | opencode + Toonflow 已验证所有模式；在线 API 齐全 |
| **架构可行性** | 🟢 高 | 两个参考项目直接提供交互层 + 模型层 + 资产层范式 |
| **模型管理** | 🟢 高 | Toonflow vendor 插件 + task_slot 绑定，成熟可简化 |
| **素材管理** | 🟢 高 | Toonflow assets/media/prompts/tasks 表族，电商化即可 |
| **多模型编排 Agent（v4）** | 🟢 高 | opencode 工具调用循环已验证（Tool.make + 并发 settle + 图片回灌），范式直接照搬 |
| **预设模板系统（v4）** | 🟢 高 | 行业信息架构成熟（5主图+9详情页标配）；ecom-details-image 25 模板可直接内置（MIT） |
| **交互体验** | 🟢 高 | opencode SSE + 对话工作台可直接复用 |
| **成本可行性** | 🟢 高 | SQLite 起步零成本；在线 API 单商品 ¥3-35 |
| **安全可行性** | 🟡 中-高 | 需补 Toonflow 缺失的凭证加密（已给方案） |
| **工程可行性** | 🟢 高 | 模式成熟，2 人 9-11 周 MVP |
| **时间可行性** | 🟢 高 | MVP 9-11 周，含 Web + 管理 + 模板 + 多模型 Agent + 出图全链路 |


---

## 十、主要风险与对策（v3 更新）

| 风险 | 影响 | 对策 |
|------|------|------|
| **凭证明文存储**（Toonflow 通病） | 高 | AES-256-GCM 加密 + KMS/环境变量主密钥（§5.2） |
| **vm2 沙箱维护风险** | 中 | 简化为受控适配器 + JSON 注册表（§5.1） |
| **多用户/多租户** | 中 | SQLite 起步单机，预留 tenant_id 字段；规模化迁 Postgres |
| **大文件存储** | 中 | OSS 抽象起步本地，配额监控；超量迁 S3/MinIO |
| **API 密钥泄露** | 高 | 加密 + 日志脱敏 + 最小权限 key + 用量监控 |
| （v2 风险）产品保真/版型/API 封禁 | 高/中 | 见 v2 对策（图生图+参考图、OutfitAnyone、双供应商、本地备选） |

---

## 十一、实施路线图（v4 更新）

### Phase 0：原型验证（第 1-2 周）
- [x] 调研（本报告 v4）
- [ ] 跑通即梦 seedream + OutfitAnyone demo，验证保真度
- [ ] 验证 opencode SSE + 工具调用循环（Tool.make）+ Toonflow ai.ts 门面可移植性
- [ ] 验证多模态主 LLM（GLM-4.5V/GPT-4o）能"看回"生图工具返回的图

### Phase 1：基础设施（第 3-5 周）—— 后端骨架
- [ ] SQLite + Drizzle，建全部表族（§四 + §六 templates）
- [ ] 模型管理：vendors/models/task_slots（含 orchestrator 槽）+ 凭证加密
- [ ] 受控适配器：OpenAI-image / Jimeng / OutfitAnyone / Kling
- [ ] 统一门面 `Model.image/video/tryon` + OSS 存储 + api_calls 审计
- [ ] SSE 事件总线

### Phase 1.5：多模型 Agent 循环（第 5-6 周）⭐ v4 新增
- [ ] 实现 Tool.make 工具契约 + 注册表（照搬 opencode tool.ts）
- [ ] 注册 9 个工具（analyze_product/render_brief/generate_image/.../check_quality）
- [ ] 主 Agent 循环（主推理 LLM + 工具并发 settle + 图片回灌 + MAX_STEPS）
- [ ] 内置 ecom-details-image 25 模板到 templates/template_slots + 平台尺寸 platform_specs
- [ ] 模板→prompt 渲染管线 + Agent/Pipeline 双模式开关

### Phase 2：Web 前端（第 6-8 周）
- [ ] SolidJS 脚手架（参考 opencode packages/app）
- [ ] 对话/任务工作台 + SSE 进度消费 + Agent 轨迹可视化（工具调用链）
- [ ] 素材浏览器（产品/资产/媒体画廊，含缩略图）
- [ ] 模板库浏览 + 选模板生成（§六）
- [ ] 设置页（供应商配置、模型绑定、提示词库、模板编辑）

### Phase 3：全链路联调（第 8-10 周）
- [ ] 3 个真实商品端到端跑通（1 服饰 + 1 3C + 1 美妆）
- [ ] 验证 Agent 模式"生图→看回→重试"闭环
- [ ] 验证 Pipeline 模式 SKU 批量
- [ ] 视频延展、质量自检

### Phase 4（按需）：扩展与降本
- [ ] 多租户、品牌包
- [ ] 高频场景切本地 Flux 降本
- [ ] 数据合规（全本地化）选项

---

## 十二、结论与建议

1. **可行性判定：高度可行，强烈建议立项。** opencode 提供交互与 Agent 运行时范式，Toonflow 提供模型与资产管理范式，两者几乎覆盖全部工程需求；在线 API 覆盖全部能力。

2. **核心设计取舍**：
   - 交互层 → 复用 opencode（SolidJS + REST + SSE + admit-then-run）
   - 模型层 → 借鉴 Toonflow vendor 插件，**简化为受控适配器 + JSON 注册表**（去 vm2）
   - 资产层 → 借鉴 Toonflow assets/media/prompts/tasks，**电商化建模 + 凭证加密**
   - 编排层（v4）→ **多模态工具调用 Agent**（主 LLM 驱动 + 9 工具 + 图片回灌 + 双模式）
   - 内容层（v4）→ **预设模板系统**（templates/slots/platform_specs，25 内置模板）
   - 能力层 → 在线 API 为主，本地 GPU 备选

3. **相对 v3 的增量价值（v4）**：① 把"Agent 编排层"从黑盒落实为可落地的工具调用循环，系统从"流水线脚本"升级为"能看回结果自主重试的真 Agent"；② 把"预设模板"从附属引用升级为核心被管理资产，承载电商行业信息架构并驱动 Agent 编排。

4. **首要验证点**：Phase 0 需确认 ① 即梦/OutfitAnyone 保真度达标；② opencode 工具调用循环 + Toonflow 门面移植可行；③ 多模态主 LLM 能正确"看回"生图工具返回的图。三者通过即可全速推进。

5. **成本预期**：MVP（2 人 9-11 周）后，单商品图片全套 ¥3-20、含视频 ¥10-35；运行成本（SQLite + 本地存储起步）近乎为零。

---

## 附录 A：核心参考资料

### 参考项目（本地）
- `D:\zcode\opencode` — Web 交互架构蓝本（SolidJS + SSE + admit-then-run + 多 provider）
  - 关键文件：`packages/app/src/context/server-sdk.tsx`（SSE）、`packages/core/src/session/runner/llm.ts`（agent 循环）、`packages/opencode/src/provider/provider.ts` + `auth/index.ts`（多供应商+密钥）
- `D:\opc\Toonflow-app` — 模型与资产管理蓝本（vendor 插件 + assets/media/prompts/tasks）
  - 关键文件：`src/utils/ai.ts`（统一门面）、`src/utils/vendor.ts`+`vm.ts`（插件沙箱）、`src/lib/initDB.ts`（全部表 schema）、`src/utils/oss.ts`（存储抽象）、`src/routes/assetsGenerate/generateAssets.ts`（生成流）

### 在线 API（v2 核心，保留）
- [即梦 AI - 火山引擎](https://www.volcengine.com/product/jimeng) / [视频生成 API](https://www.volcengine.com/docs/85621/1829013)
- [OpenAI gpt-image-1 指南](https://developers.openai.com/api/docs/guides/image-generation) / [定价](https://openai.com/api/pricing/)
- [阿里云 OutfitAnyone AI 试衣](https://help.aliyun.com/zh/model-studio/outfitanyone-api)
- [ManekenAI](https://www.aidc-ai.com/manekenai) / [可灵开放平台](https://klingai.com/dev)
- [三万图 AI（3wanai.com）](https://3wanai.com/) — 产品形态标杆

### 开源样板
- [liangdabiao/ecom-details-image](https://github.com/liangdabiao/ecom-details-image) — Skill 结构 + 25 模板
- [Ceeon/jimeng-mcp-volcengine](https://github.com/Ceeon/jimeng-mcp-volcengine) — 即梦 API 封装

### Agent/Skill 工程
- [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)
- [Claude Code Skills 文档](https://code.claude.com/docs/en/skills)

---

## 附录 B：数据模型字段速查（v4 新增模板表族）

| 表 | 关键字段 | 对应 Toonflow | 用途 |
|----|---------|--------------|------|
| `vendors` | id, category, adapter, inputs | `o_vendorConfig`(部分) | 供应商注册 |
| `vendor_credentials` | vendor_id, **values_enc(加密)** | `o_vendorConfig.inputValues`(改进) | 凭证(加密) |
| `models` | id, vendor_id, type, modes, pricing | vendor.models(代码内) | 模型目录 |
| `task_slots` | slot_key, model_id, params | `o_agentDeploy` | 任务↔模型绑定（含 orchestrator 主 LLM 槽）|
| `products` | id, category, attributes, selling_points | （新增） | 产品库 |
| `assets` | id, product_id, **parent_id(变体)**, type, status | `o_assets` | 逻辑资产 |
| `media` | id, asset_id, **prompt_text(留痕)**, model_id, gen_state, cost | `o_image`/`o_video` | 物理媒体 |
| `media_versions` | media_id, version, prompt_text | （新增） | 版本树 |
| `prompts` | id, type, template, variables, **style_lock** | `o_prompt` | 提示词库 |
| `prompt_model_bindings` | prompt_id, model_id | `o_modelPrompt` | 提示词↔模型 |
| **`templates`** ⭐v4 | id, name, category, **platform, product_category**, is_builtin | （新增，类 ecom-details 25模板） | 模板主表 |
| **`template_slots`** ⭐v4 | template_id, **slot_code(H1/D3..)**, purpose, scene_type, size_preset, prompt_template_id | （新增） | 图片序列定义 |
| **`platform_specs`** ⭐v4 | platform, hero_size, detail_size, hero_count, rules | （新增） | 平台尺寸规则 |
| `jobs` | id, type, status, progress, result | （新增,类opencode input） | 异步任务 |
| `api_calls` | job_id, model_id, **cost**, status | `o_tasks`(强化) | 审计+计费 |

> v4 新增 3 张模板表。工具（tools）作为受控代码注册，不落表（与 opencode 一致，工具是代码而非数据）；主 Agent 的"工具调用轨迹"可由 `jobs`+`api_calls` 审计回溯。
