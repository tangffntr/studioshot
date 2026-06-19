/**
 * Task 0.2 验证脚本（熔断点 A1）：
 * 验证 gpt-image-2（经 grsai）对真实产品图的保真度。
 *
 * 闭环逻辑（电商出图的核心能力）：
 *   1. 输入：Task 0.4 的红色杯子图（作为"白底产品图"）
 *   2. 图生图：把杯子放进新场景"阳光下的窗台"，要求保留杯子原貌
 *   3. 用 MiMo-V2.5 对比原图和生成图，判断杯子是否失真
 *
 * 熔断判断标准：
 *   - 生成图里的杯子仍是"红色"（颜色不失真）
 *   - 仍是"杯子/马克杯"形状（形状不失真）
 *   - 场景确实变成了窗台（指令被遵循）
 *   → 若通过，证明图生图保真可用于电商出图
 *
 * 用法：
 *   cd packages/server && npx tsx scripts/verify-fidelity.ts
 */
import "dotenv/config";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import * as fs from "node:fs";
import * as path from "node:path";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`[缺少环境变量] ${key} 未设置。`);
    process.exit(2);
  }
  return v;
}

const ORCH_BASE = requireEnv("ORCHESTRATOR_BASE_URL");
const ORCH_KEY = requireEnv("ORCHESTRATOR_API_KEY");
const ORCH_MODEL = requireEnv("ORCHESTRATOR_MODEL");
const OPENAI_KEY = requireEnv("OPENAI_API_KEY");
const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-2";

function grsaiHost(base: string): string {
  let b = base.replace(/\/+$/, "");
  const idx = b.indexOf("/v1");
  if (idx > 0) b = b.slice(0, idx);
  return b;
}
const GRSAI_HOST = grsaiHost(OPENAI_BASE);

// grsai 官方推荐端点 /v1/api/generate（同步返回，images 数组传参考图）
// 文档：https://qmy27nhsd9.apifox.cn/452409160e0
async function generateWithRef(refImageB64: string, prompt: string): Promise<string> {
  const res = await fetch(`${GRSAI_HOST}/v1/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      images: [`data:image/png;base64,${refImageB64}`], // 参考图数组（图生图）
      aspectRatio: "1024x1024",
      replyType: "json",
    }),
  });
  if (!res.ok) {
    throw new Error(`生成请求失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  // 同步返回：{ id, status: "succeeded", results: [{url}] }
  const url: string | undefined = data?.results?.[0]?.url;
  if (!url) throw new Error(`未返回图片 url：${JSON.stringify(data).slice(0, 200)}`);
  console.log(`    ✓ 任务 ${data?.id} 状态=${data?.status}`);

  // 下载转 base64
  const imgRes = await fetch(url);
  return Buffer.from(await imgRes.arrayBuffer()).toString("base64");
}

(async () => {
  console.log("========================================");
  console.log(" Task 0.2 熔断点 A1 验证：生图保真度（图生图）");
  console.log("========================================");
  console.log(`生图: ${IMAGE_MODEL} @ ${GRSAI_HOST}`);
  console.log(`评审: ${ORCH_MODEL}`);

  // 读取原图（Task 0.4 的杯子图）
  const srcPath = path.resolve(__dirname, "../data/verify/task0.4-generated.png");
  if (!fs.existsSync(srcPath)) {
    console.error(`\n缺少原图：${srcPath}\n请先跑 Task 0.4 生成杯子图。`);
    process.exit(1);
  }
  const srcB64 = fs.readFileSync(srcPath).toString("base64");
  console.log(`\n[1] 原图（产品）：${srcPath}`);

  // 图生图：杯子→阳光窗台场景
  const prompt = "Place this exact red ceramic mug on a sunny windowsill with soft morning light, green plants blurred in background, keep the mug's original shape, color and appearance unchanged, lifestyle product photography";
  console.log(`\n[2] 图生图指令：${prompt}`);
  console.log(`[2] 调用 ${IMAGE_MODEL} 图生图（保留产品原貌换场景）...`);
  const genB64 = await generateWithRef(srcB64, prompt);

  // 保存生成图
  const outDir = path.resolve(__dirname, "../data/verify");
  const outFile = path.join(outDir, "task0.2-fidelity-result.png");
  fs.writeFileSync(outFile, Buffer.from(genB64, "base64"));
  console.log(`[2] ✓ 生成图已保存：${outFile}`);

  // 用 MiMo 对比判断保真度
  console.log(`\n[3] 用 ${ORCH_MODEL} 对比原图与生成图，判断保真度...`);
  const orchestrator = createOpenAI({ apiKey: ORCH_KEY, baseURL: ORCH_BASE });
  const result = await generateText({
    model: orchestrator(ORCH_MODEL),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "第一张图是产品原图（白底），第二张图是AI生成图。请对比并回答：1）生成图里的主体物品颜色是否和原图一致（原图是红色）？2）形状是否一致（都是杯子/马克杯）？3）场景是否变成了窗台/阳光？请简短回答。" },
          { type: "image", image: `data:image/png;base64,${srcB64}` },
          { type: "image", image: `data:image/png;base64,${genB64}` },
        ],
      },
    ],
  });
  console.log(`[3] 评审回复：\n${result.text}\n`);

  // 判断（中英文都识别）
  const low = result.text.toLowerCase();
  const colorOk =
    (low.includes("红") || low.includes("red")) &&
    (low.includes("一致") || low.includes("相同") || low.includes("均为") || low.includes("保持") || low.includes("same") || low.includes("unchanged") || low.includes("一致"));
  const shapeOk = low.includes("杯") || low.includes("mug") || low.includes("cup");
  const sceneOk = low.includes("窗台") || low.includes("window") || low.includes("阳光") || low.includes("sunny") || low.includes("绿植") || low.includes("morning") || low.includes("plant");
  const pass = colorOk && shapeOk && sceneOk;
  console.log(`[4] 判断：颜色保真=${colorOk}，形状保真=${shapeOk}，场景变换=${sceneOk} → ${pass ? "✅ 通过" : "❌ 需人工复核"}`);

  // 写结论
  const report = `# Phase 0 验证结论 — A1: 生图保真度\n\n- 时间: ${new Date().toISOString()}\n- 生图: ${IMAGE_MODEL} @ ${GRSAI_HOST}（图生图，端点 /v1/api/generate，images 数组传参考图，同步返回）\n- 评审: ${ORCH_MODEL}\n\n## 结论: ${pass ? "✅ 通过" : "⚠️ 需人工复核"}\n\n${result.text}\n\n## 判断\n- 颜色保真: ${colorOk}\n- 形状保真: ${shapeOk}\n- 场景变换: ${sceneOk}\n\n## 实物\n- 原图: packages/server/data/verify/task0.4-generated.png\n- 生成图: packages/server/data/verify/task0.2-fidelity-result.png\n`;
  fs.writeFileSync(path.resolve(__dirname, "../../../docs/verify-phase0-a1.md"), report);
  console.log(`\n结论已写入 docs/verify-phase0-a1.md`);

  if (!pass) {
    console.log("\n⚠️ 自动判断未通过——建议人工肉眼对照两张图确认（可能 MiMo 措辞触发误判）。");
  } else {
    console.log("\n🎉 A1 验证通过！Phase 0 全部熔断点通过，可进入 Phase 1。");
  }
})();
