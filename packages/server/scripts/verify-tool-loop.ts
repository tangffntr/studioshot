/**
 * Task 0.4 验证脚本（熔断点 A3）：
 * 验证多模态主 LLM 能否"看回"生图工具返回的 base64 图。
 *
 * 闭环逻辑（对应 §5.4 Agent 第3-4回合的子集）：
 *   1. gpt-image-1 生成一张「红色马克杯在木桌上」的图 → 得到 base64
 *   2. 把 base64 作为 image part 喂给主 LLM（MiMo-V2.5）
 *   3. 问它："这张图里有什么？主体什么颜色？" → 看它能否正确描述
 *
 * 熔断判断标准：主 LLM 能正确识别「红色」和「杯子/马克杯」，
 * 即证明工具循环范式可行（生图→看回→决策）。
 *
 * 用法：
 *   1. 在 packages/server 目录创建 .env（从 ../../.env.example 复制）并填好：
 *        ORCHESTRATOR_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
 *        ORCHESTRATOR_API_KEY=<你的 MiMo key>
 *        ORCHESTRATOR_MODEL=mimo-v2.5
 *        OPENAI_API_KEY=<你的 OpenAI key>
 *        OPENAI_BASE_URL=https://api.openai.com/v1   （或中转地址）
 *   2. cd packages/server && pnpm script scripts/verify-tool-loop.ts
 */
import "dotenv/config";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------- 配置加载 ----------
function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`\n[缺少环境变量] ${key} 未设置。请在 packages/server/.env 填写后重试。`);
    process.exit(2);
  }
  return v;
}

const ORCH_BASE = requireEnv("ORCHESTRATOR_BASE_URL");
const ORCH_KEY = requireEnv("ORCHESTRATOR_API_KEY");
const ORCH_MODEL = requireEnv("ORCHESTRATOR_MODEL");
const OPENAI_KEY = requireEnv("OPENAI_API_KEY");
const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

// grsai 中转用异步两步式：host 提取 + 两端点
// 用户在 OPENAI_BASE_URL 填的可能是完整端点（含 /v1/api/generate）或 host；
// 这里统一归约为 host（取到 /v1 之前的部分），再拼 grsai 的两步式端点。
function grsaiHost(base: string): string {
  // 去掉末尾斜杠
  let b = base.replace(/\/+$/, "");
  // 若含 /v1，截断到 /v1 之前
  const idx = b.indexOf("/v1");
  if (idx > 0) b = b.slice(0, idx);
  return b;
}
// grsai 的 gpt-image 模型名（探测确认：本账号支持 gpt-image-2，不支持 gpt-image-1）
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-2";
const GRSAI_HOST = grsaiHost(OPENAI_BASE);

// 用于验证的明确 prompt：颜色+物体都指定，便于判断 LLM 是否真的"看见"
const GEN_PROMPT = "A single bright red ceramic coffee mug sitting on a rustic wooden table, soft natural lighting, minimalist product photography, white background, high detail";

// ---------- Step 1: 用 gpt-image-1（经 grsai 中转）生成测试图 ----------
// grsai 是异步两步式：POST /v1/draw/completions 得 taskId → POST /v1/draw/result 轮询取图片 URL
async function generateTestImage(): Promise<string> {
  console.log(`\n[Step 1] 调用 gpt-image-1（grsai ${GRSAI_HOST}）生成测试图（红色马克杯）...`);

  // 1a. 提交任务（返回 data.id）
  const submitUrl = `${GRSAI_HOST}/v1/draw/completions`;
  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt: GEN_PROMPT,
      webHook: "-1", // 轮询模式
    }),
  });
  if (!submitRes.ok) {
    throw new Error(`提交任务失败 ${submitRes.status}: ${await submitRes.text()}`);
  }
  const submitData = (await submitRes.json()) as any;
  const taskId: string | undefined = submitData?.data?.id || submitData?.data?.taskId;
  if (!taskId) throw new Error(`提交任务未返回 id：${JSON.stringify(submitData)}`);
  console.log(`[Step 1a] ✓ 任务已提交，id=${taskId}，开始轮询...`);

  // 1b. 轮询取结果（请求体 {id}，返回 data.status + data.url/data.results）
  const resultUrl = `${GRSAI_HOST}/v1/draw/result`;
  const start = Date.now();
  let imageUrl: string | undefined;
  while (Date.now() - start < 120000) {
    await new Promise((r) => setTimeout(r, 4000));
    const pollRes = await fetch(resultUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({ id: taskId }), // ⚠️ 字段名是 id 不是 taskId
    });
    if (!pollRes.ok) {
      throw new Error(`查询结果失败 ${pollRes.status}: ${await pollRes.text()}`);
    }
    const pollData = (await pollRes.json()) as any;
    const d = pollData?.data;
    if (!d) continue;
    const status: string = (d.status || "").toLowerCase();
    if (status === "failed") throw new Error(`生成失败：${d.error || d.failure_reason || JSON.stringify(d)}`);
    // 结果可能在 url 或 results 数组
    if (status === "completed" || status === "success" || d.url || (Array.isArray(d.results) && d.results.length)) {
      imageUrl =
        d.url ||
        (Array.isArray(d.results) ? (typeof d.results[0] === "string" ? d.results[0] : d.results[0]?.url) : undefined);
    }
    if (imageUrl) break;
    console.log(`    ... 轮询中（${Math.round((Date.now() - start) / 1000)}s, status=${status || "?"}, progress=${d.progress ?? "?"}）`);
  }
  if (!imageUrl) throw new Error("轮询超时，未取到图片结果");

  // 1c. 下载图片转 base64
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`下载图片失败 ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const b64 = buf.toString("base64");

  // 保存到文件以便人工肉眼对照
  const outDir = path.resolve(__dirname, "../data/verify");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "task0.4-generated.png");
  fs.writeFileSync(outFile, buf);
  console.log(`[Step 1] ✓ 图片已生成并保存：${outFile}`);
  return b64;
}

// ---------- Step 2: 把图喂给主 LLM，问它内容 ----------
async function askOrchestratorAboutImage(imageB64: string): Promise<string> {
  console.log("\n[Step 2] 把生成的图喂给主 LLM（MiMo-V2.5），问它看到了什么...");
  const orchestrator = createOpenAI({
    apiKey: ORCH_KEY,
    baseURL: ORCH_BASE,
    // 兼容性：显式指定模型名
  });

  const result = await generateText({
    model: orchestrator(ORCH_MODEL),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "请仔细看这张图，回答两个问题：1）图里的主体物品是什么？2）它是什么颜色？只回答这两个问题，简短即可。" },
          { type: "image", image: `data:image/png;base64,${imageB64}` },
        ],
      },
    ],
  });

  console.log(`[Step 2] ✓ 主 LLM 回复：\n${result.text}\n`);
  return result.text;
}

// ---------- Step 3: 熔断判断 ----------
function judge(reply: string): boolean {
  const low = reply.toLowerCase();
  // 主 LLM 是否识别出「红色」和「杯/mug」
  const hasRed = low.includes("red") || low.includes("红") || low.includes("红色");
  const hasMug =
    low.includes("mug") ||
    low.includes("cup") ||
    low.includes("杯") ||
    low.includes("马克杯") ||
    low.includes("杯子");
  const pass = hasRed && hasMug;
  console.log(`[Step 3] 判断：识别红色=${hasRed}，识别杯子=${hasMug} → ${pass ? "✅ 通过" : "❌ 未通过"}`);
  return pass;
}

// ---------- 主流程 ----------
(async () => {
  console.log("========================================");
  console.log(" Task 0.4 熔断点 A3 验证：多模态主 LLM 能否看回生图");
  console.log("========================================");
  console.log(`主 LLM: ${ORCH_MODEL} @ ${ORCH_BASE}`);
  console.log(`生图: ${IMAGE_MODEL} @ ${GRSAI_HOST}（grsai 异步两步式）`);

  try {
    const imageB64 = await generateTestImage();
    const reply = await askOrchestratorAboutImage(imageB64);
    const pass = judge(reply);

    // 写结论（从 packages/server/scripts 上溯三级到项目根 docs）
    const reportDir = path.resolve(__dirname, "../../../docs");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, "verify-phase0.md");
    const stamp = new Date().toISOString();
    const conclusion = pass
      ? "A3 通过：多模态主 LLM 能正确识别生图工具返回的 base64 图。工具循环范式可行。"
      : "A3 未通过：主 LLM 未能正确描述图。需排查：① MiMo-V2.5 是否真支持图片输入 ② image part 格式 ③ 考虑退化为纯文本描述回灌。";
    const report = `# Phase 0 验证结论\n\n## A3: 多模态主 LLM 看回生图\n- 时间: ${stamp}\n- 主LLM: ${ORCH_MODEL} @ ${ORCH_BASE}\n- 生图: gpt-image-1\n- 生成 prompt: ${GEN_PROMPT}\n- 主LLM回复:\n\`\`\`\n${reply}\n\`\`\`\n- 结论: ${pass ? "✅ 通过" : "❌ 未通过"}\n- ${conclusion}\n`;
    fs.writeFileSync(reportPath, report);
    console.log(`\n结论已写入：${reportPath}`);

    if (!pass) process.exit(1);
    console.log("\n🎉 A3 验证通过，可继续 Phase 0 其余任务与 Phase 1。");
  } catch (e: any) {
    console.error("\n💥 验证执行出错：", e?.message || e);
    console.error("（注意：出错不等于范式不可行，可能是 API 凭证/网络/格式问题，需排查）");
    process.exit(1);
  }
})();
