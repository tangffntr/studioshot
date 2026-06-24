/**
 * shared/schemas/blueprint.ts — 详情页规划相关类型定义
 * 参考DetailFlow工作流，实现结构化的页面规划
 */

/** 文案结构模式 */
export type CopyStructurePattern =
  | "hero_claim_stack"      // 标题 + 副标题 + 标签
  | "question_answer"       // 问题 + 回答
  | "single_line_with_labels" // 单行标题 + 标签群
  | "annotation_map"        // 注释地图
  | "three_point_breakdown" // 三点分解
  | "scene_caption_cluster" // 场景说明群
  | "mini_steps"            // 迷你步骤
  | "trust_checklist"       // 信任清单
  | "quiet_closing";        // 安静收尾

/** 内容密度 */
export type ContentDensity = "low" | "medium" | "high";

/** 模块规格 */
export interface ModuleSpec {
  role: string;           // 模块角色
  areaRatio: number;      // 面积比例 (0-1)
  visualDirection: string; // 视觉方向
  message: string;        // 传达的信息
}

/** 文本内容 */
export interface TextContent {
  headline?: string;      // 标题
  subheadline?: string;   // 副标题
  body?: string;          // 正文
  tags?: string[];        // 标签
  labels?: string[];      // 标注
  annotations?: string[]; // 注释
  steps?: string[];       // 步骤
  trustNotes?: string[];  // 信任说明
  cta?: string;           // 行动号召
}

/** 屏幕规划 */
export interface ScreenPlan {
  sliceId: string;                    // 屏幕ID (01-08)
  buyerQuestion: string;              // 买家问题
  moduleType: string;                 // 模块类型 (hero/benefit/mechanism等)
  moduleLabel: string;                // 模块标签（内部用）
  claimSeed: string;                  // 卖点种子
  screenJob: string;                  // 屏幕任务
  evidenceType: string;               // 证据类型
  contentDensity: ContentDensity;     // 内容密度
  layoutArchetype: string;            // 布局原型
  copyModuleType: string;             // 文案模块类型
  copyStructurePattern: CopyStructurePattern; // 文案结构模式
  primaryModule: ModuleSpec;          // 主模块
  secondaryModules: ModuleSpec[];     // 次模块
  textExact: TextContent;             // 精确文案
  hierarchyStrategy: string;          // 层级策略
  compositionShift: string;           // 构图变化
  topEdgeAnchor: string;              // 顶部边缘锚点
  bottomEdgeAnchor: string;           // 底部边缘锚点
  visualComposition: string;          // 视觉构图
  referenceStyleNotes: string;        // 参考风格说明
  riskUnknowns: string[];             // 风险未知项
}

/** 视觉DNA */
export interface VisualDNA {
  palette: string[];        // 配色方案
  lighting: string;         // 光线风格
  typography: string;       // 排版风格
  rhythm: string;           // 节奏感
  continuityMotifs: string[]; // 连续性元素
}

/** 视觉母版规格 */
export interface VisualMasterSpec {
  textMaster: {
    palette: string[];
    lighting: string;
    space: string;
    materials: string;
    typography: string;
    continuityMotifs: string[];
    productIdentityRules: string;
    sectionRhythm: string;
    informationDensity: string;
    pageStructure: string;
  };
  imageMaster: {
    background: string;
    perspective: string;
    productScale: string;
    transitionLogic: string;
    recurringMotifs: string[];
  };
}

/** 页面规划 */
export interface PageBlueprint {
  id: string;
  productName: string;
  productCategory: string;
  targetAudience: string;
  claimSeeds: string[];           // 首屏卖点种子 (2-4个)
  screens: ScreenPlan[];          // 8屏规划
  visualDNA: VisualDNA;           // 视觉DNA
  visualMasterSpec?: VisualMasterSpec; // 视觉母版规格
  riskAssessment: string[];       // 风险评估
  createdAt: number;
}

/** 视觉样本包（用于第二次确认） */
export interface VisualSamplePackage {
  blueprintId: string;
  imageMasterUrl?: string;        // 1:3母版URL
  first2Slices: Array<{
    sliceId: string;
    url: string;
  }>;
  previewUrl?: string;            // 拼接预览URL
  auditResult: AuditResult;
}

/** 审核结果 */
export interface AuditResult {
  passed: boolean;
  productDrift: boolean;
  textQuality: boolean;
  continuity: boolean;
  unsupportedClaims: string[];
  issues: string[];
  recommendations: string[];
}

/** 确认请求 */
export interface ConfirmationRequest {
  jobId: string;
  type: "blueprint" | "visual_sample";
  data: PageBlueprint | VisualSamplePackage;
  status: "pending" | "approved" | "rejected";
  feedback?: string;
}
