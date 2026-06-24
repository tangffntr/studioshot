/**
 * server/storage/text-overlay.ts — 文字叠加工具函数
 * 使用sharp在图片上叠加准确的文字，解决AI生成图片中文字变形、扭曲的问题
 */
import sharp from 'sharp';
import * as os from 'node:os';

/** 文字叠加选项 */
export interface TextOverlayOptions {
  text: string;
  position: string;  // 位置描述（中文或英文）
  fontSize?: number;  // 字号（默认72）
  color?: string;     // 颜色（默认白色）
  backgroundColor?: string;  // 背景色（可选）
  padding?: number;   // 内边距（默认20）
  maxWidth?: number;  // 最大宽度（默认图片宽度的80%）
  fontfile?: string;  // 字体文件路径
}

/** 文字位置 */
interface TextPosition {
  top?: number;
  left?: number;
  gravity?: string;
}

/**
 * 获取系统中文字体路径
 */
function getChineseFontPath(): string {
  const platform = os.platform();

  if (platform === 'win32') {
    // Windows字体路径
    const windowsFonts = [
      'C:/Windows/Fonts/msyh.ttc',      // 微软雅黑
      'C:/Windows/Fonts/simhei.ttf',     // 黑体
      'C:/Windows/Fonts/simsun.ttc',     // 宋体
    ];
    return windowsFonts[0];
  } else if (platform === 'darwin') {
    // macOS字体路径
    return '/System/Library/Fonts/PingFang.ttc';
  } else {
    // Linux字体路径
    const linuxFonts = [
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    ];
    return linuxFonts[0];
  }
}

/**
 * 解析自然语言位置描述为sharp composite参数
 * 支持：左上角/右上角/左下角/右下角/居中/顶部/底部/左侧/右侧
 */
export function parsePositionDescription(
  description: string,
  imageWidth: number,
  imageHeight: number,
  padding: number = 20
): TextPosition {
  const desc = description.toLowerCase().trim();

  // 中文位置关键词映射
  const positionMap: Record<string, TextPosition> = {
    '左上': { top: padding, left: padding },
    '左上角': { top: padding, left: padding },
    'top-left': { top: padding, left: padding },
    'topleft': { top: padding, left: padding },

    '右上': { top: padding, left: imageWidth - padding },
    '右上角': { top: padding, left: imageWidth - padding },
    'top-right': { top: padding, left: imageWidth - padding },
    'topright': { top: padding, left: imageWidth - padding },

    '左下': { top: imageHeight - padding, left: padding },
    '左下角': { top: imageHeight - padding, left: padding },
    'bottom-left': { top: imageHeight - padding, left: padding },
    'bottomleft': { top: imageHeight - padding, left: padding },

    '右下': { top: imageHeight - padding, left: imageWidth - padding },
    '右下角': { top: imageHeight - padding, left: imageWidth - padding },
    'bottom-right': { top: imageHeight - padding, left: imageWidth - padding },
    'bottomright': { top: imageHeight - padding, left: imageWidth - padding },

    '居中': { gravity: 'centre' },
    '中间': { gravity: 'centre' },
    'center': { gravity: 'centre' },
    '中央': { gravity: 'centre' },

    '顶部': { gravity: 'north' },
    '上方': { gravity: 'north' },
    'top': { gravity: 'north' },

    '底部': { gravity: 'south' },
    '下方': { gravity: 'south' },
    'bottom': { gravity: 'south' },

    '左侧': { gravity: 'west' },
    '左边': { gravity: 'west' },
    'left': { gravity: 'west' },

    '右侧': { gravity: 'east' },
    '右边': { gravity: 'east' },
    'right': { gravity: 'east' },
  };

  // 按关键词长度排序，优先匹配更长的关键词
  const sortedKeys = Object.keys(positionMap).sort((a, b) => b.length - a.length);

  for (const keyword of sortedKeys) {
    if (desc.includes(keyword)) {
      return positionMap[keyword];
    }
  }

  // 默认居中
  return { gravity: 'centre' };
}

/**
 * 从prompt中提取文字叠加信息
 * 支持格式：
 * - 在[位置]添加文字'[内容]'
 * - 在[位置]写上'[内容]'
 * - 在[位置]放上'[内容]'
 * - 在[位置]标注'[内容]'
 */
export function extractTextFromPrompt(prompt: string): { text: string; position: string } | null {
  // 匹配模式：在[位置]添加/叠加/写上/放上/标注文字[内容]
  const patterns = [
    /在(.+?)(?:添加|叠加|写上|放上|标注|显示|放置)(?:文字|文本|字样|标题)[：:]?\s*['""](.+?)['"]/,
    /在(.+?)(?:位置|处)(?:添加|叠加|写上|放上|标注)(?:文字|文本|字样)[：:]?\s*['""](.+?)['"]/,
    /(.+?)(?:添加|叠加|写上|放上|标注)(?:文字|文本|字样)[：:]?\s*['""](.+?)['"]/,
    /文字['"](.+?)['"](?:放在|置于|显示在|添加到)(.+?)/,
    /添加['"](.+?)['"](?:到|在)(.+?)/,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match) {
      // 根据模式返回位置和文字
      if (pattern === patterns[3] || pattern === patterns[4]) {
        return {
          text: match[1],
          position: match[2],
        };
      }
      return {
        position: match[1],
        text: match[2],
      };
    }
  }

  return null;
}

/**
 * 在图片上叠加文字
 */
export async function addTextOverlay(
  imageBuffer: Buffer,
  options: TextOverlayOptions
): Promise<Buffer> {
  // 获取图片元数据
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;

  // 解析位置
  const position = parsePositionDescription(
    options.position,
    width,
    height,
    options.padding || 20
  );

  // 获取字体路径
  const fontfile = options.fontfile || getChineseFontPath();

  // 计算文字区域大小（相对于图片）
  const maxWidth = options.maxWidth || Math.floor(width * 0.8);
  const fontSize = options.fontSize || 72;

  // 构建文字叠加配置
  const textConfig: sharp.OverlayOptions = {
    input: {
      text: {
        text: options.text,
        font: 'sans',
        fontfile: fontfile,
        width: maxWidth,
        height: 0,  // 自动高度
        align: 'centre',
        dpi: fontSize,
        rgba: true,
      }
    },
    ...position,
  };

  // 如果指定了背景色，添加背景
  if (options.backgroundColor) {
    // 创建背景SVG
    const bgSvg = Buffer.from(`
      <svg width="${width}" height="${height}">
        <rect x="0" y="0" width="${width}" height="${height}" fill="${options.backgroundColor}" opacity="0.7"/>
      </svg>
    `);

    return sharp(imageBuffer)
      .composite([
        { input: bgSvg, top: 0, left: 0 },
        textConfig,
      ])
      .png()
      .toBuffer();
  }

  return sharp(imageBuffer)
    .composite([textConfig])
    .png()
    .toBuffer();
}

/**
 * 检测系统中可用的中文字体
 */
export async function detectAvailableFonts(): Promise<string[]> {
  const fontPath = getChineseFontPath();
  const fs = await import('node:fs/promises');

  try {
    await fs.access(fontPath);
    return [fontPath];
  } catch {
    // 如果默认字体不可用，尝试其他路径
    const alternativeFonts = [
      'C:/Windows/Fonts/simhei.ttf',
      'C:/Windows/Fonts/simsun.ttc',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ];

    const available: string[] = [];
    for (const font of alternativeFonts) {
      try {
        await fs.access(font);
        available.push(font);
      } catch {
        // 字体不存在，跳过
      }
    }
    return available;
  }
}
