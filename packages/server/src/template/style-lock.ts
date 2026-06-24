/**
 * server/template/style-lock.ts — Campaign Style Lock + 视觉母版
 *
 * 可行性报告 §6.4：多图任务先产出一段风格锁定文本（色板/冷暖调/光线/布局），
 * 拼到每张图 prompt 开头，保证整套图视觉一致。
 *
 * 纯逻辑生成（不调 LLM，省积分）。基于产品属性 + 平台规则产出固定风格描述。
 */
import type { ProductAttributes } from "./render";
import type { VisualDNA, VisualMasterSpec, PageBlueprint } from "@ecom/shared";

/** 生成 Campaign Style Lock 文本 */
export function generateStyleLock(attrs: ProductAttributes, platform?: string): string {
  const color = attrs.color || "中性色";
  const parts: string[] = [];

  // 色板（基于产品主色 + 中性背景）
  parts.push(`统一的色板：产品主色为${color}，中性白色/浅灰色背景，单一强调色用于点缀。`);

  // 冷暖调（按平台/默认）
  const warm = platform === "taobao" || platform === "douyin";
  parts.push(warm ? "整套图采用暖色调。" : "中性偏冷色调，干净专业。");

  // 光线
  parts.push("统一柔和影棚光，来自左上方，软阴影，无生硬高光。");

  // 布局
  parts.push("统一构图：产品居中或遵循三分法则，留白充足。");

  // 背景
  parts.push("整套图保持统一的极简背景。");

  return "[风格锁定：" + parts.join("") + "] ";
}

/** 把 Style Lock 注入到一组渲染后的 prompt 开头 */
export function applyStyleLock(rendered: Array<{ prompt: string }>, styleLock: string): void {
  for (const r of rendered) {
    if (!r.prompt.startsWith("[风格锁定")) {
      r.prompt = styleLock + r.prompt;
    }
  }
}

/** 生成视觉DNA */
export function generateVisualDNA(attrs: ProductAttributes, platform?: string): VisualDNA {
  const color = attrs.color || "中性色";
  const warm = platform === "taobao" || platform === "douyin";

  return {
    palette: [color, "#FFFFFF", "#F5F5F5", warm ? "#FFF5E6" : "#F0F5FF"],
    lighting: "柔和影棚光，左上方45度，软阴影",
    typography: "现代简约，标题粗体，正文常规",
    rhythm: "首屏高密度，中间屏中等密度，尾屏低密度",
    continuityMotifs: [
      `${color}产品轮廓`,
      "统一的背景世界",
      "一致的光线方向",
      "连贯的视觉流",
    ],
  };
}

/** 生成视觉母版规格 */
export function generateVisualMasterSpec(
  blueprint: PageBlueprint,
  attrs: ProductAttributes,
  platform?: string
): VisualMasterSpec {
  const visualDNA = blueprint.visualDNA;
  const warm = platform === "taobao" || platform === "douyin";

  return {
    textMaster: {
      palette: visualDNA.palette,
      lighting: visualDNA.lighting,
      space: "统一的背景空间，白色/浅灰色为主",
      materials: attrs.material || "优质材质",
      typography: "标题：24-32px粗体，副标题：16-20px常规，正文：12-14px",
      continuityMotifs: visualDNA.continuityMotifs,
      productIdentityRules: `产品颜色、形状、Logo、材质保持一致，${attrs.color || "中性色"}为主色调`,
      sectionRhythm: "首屏强，2-4屏中等，5-7屏变化，8屏收尾",
      informationDensity: "首屏高密度，中间屏中等，尾屏低密度",
      pageStructure: "8屏连贯长页，非独立海报",
    },
    imageMaster: {
      background: `统一的${warm ? "暖调" : "冷调"}背景，白色/浅灰色为主`,
      perspective: "平视或略俯视，保持一致的视角",
      productScale: "产品在画面中占40-60%，保持视觉主导",
      transitionLogic: "相邻屏幕共享背景元素、光线方向、视觉流",
      recurringMotifs: [
        `${attrs.color || "中性色"}产品元素`,
        "统一的光线方向",
        "一致的背景纹理",
        "连贯的视觉流线",
      ],
    },
  };
}

/** 生成视觉母版prompt（用于1:3图像母版生成） */
export function generateImageMasterPrompt(
  masterSpec: VisualMasterSpec,
  productName: string,
  screens: Array<{ sliceId: string; screenJob: string }>
): string {
  const { textMaster, imageMaster } = masterSpec;

  return `为${productName}生成一张 1:3 连续长滚动详情页母版。

视觉体系：
- 背景：${imageMaster.background}
- 视角：${imageMaster.perspective}
- 产品占比：${imageMaster.productScale}
- 过渡：${imageMaster.transitionLogic}

排版体系：
- ${textMaster.typography}
- 层级：${textMaster.sectionRhythm}

连贯性元素：
${textMaster.continuityMotifs.map((m) => `- ${m}`).join("\n")}

分屏结构：
${screens.map((s) => `- 第 ${s.sliceId} 屏：${s.screenJob}`).join("\n")}

这是一个空间连贯性参考图，不是最终交付物。母版应呈现一张连续的长页，保持一致的背景、光线和视觉流。需包含简体中文文案或预留的文字区域，以反映规划好的文案层级。`;
}

/** 生成9:21切片prompt（基于视觉母版） */
export function generateSlicePrompt(
  slicePlan: {
    sliceId: string;
    screenJob: string;
    textExact: Record<string, any>;
    compositionShift: string;
    topEdgeAnchor: string;
    bottomEdgeAnchor: string;
  },
  masterSpec: VisualMasterSpec,
  imageMasterUrl?: string
): string {
  const { textMaster, imageMaster } = masterSpec;

  let prompt = `生成一张 1024x2400 竖版详情页切片（第 ${slicePlan.sliceId} 屏），宽高比 9:21。

本屏任务：${slicePlan.screenJob}

视觉体系（继承自母版）：
- 背景：${imageMaster.background}
- 光线：${textMaster.lighting}
- 产品：${textMaster.productIdentityRules}
- 尺寸：1024x2400 像素（9:21 宽高比，适合长滚动详情页）

构图：${slicePlan.compositionShift}
- 顶部边缘：${slicePlan.topEdgeAnchor}
- 底部边缘：${slicePlan.bottomEdgeAnchor}

`;

  // 添加文案
  if (slicePlan.textExact) {
    prompt += "可见文案：\n";
    if (slicePlan.textExact.headline) {
      prompt += `- 主标题：${slicePlan.textExact.headline}\n`;
    }
    if (slicePlan.textExact.subheadline) {
      prompt += `- 副标题：${slicePlan.textExact.subheadline}\n`;
    }
    if (slicePlan.textExact.tags) {
      prompt += `- 标签：${slicePlan.textExact.tags.join("、")}\n`;
    }
    if (slicePlan.textExact.cta) {
      prompt += `- 行动号召：${slicePlan.textExact.cta}\n`;
    }
  }

  // 添加母版参考
  if (imageMasterUrl) {
    prompt += `\n参考 1:3 母版以保持空间连贯性。本切片应是同一长滚动页面体系中某个区域的详细展开，而不是独立海报。`;
  }

  return prompt;
}

