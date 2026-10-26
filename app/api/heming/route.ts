/**
 * POST /api/heming —— 双盘合盘 AI 分析
 *
 * 请求：{ chartA: ZiweiChart, chartB: ZiweiChart, question?: string }
 * 响应：SSE，`data: {"delta":{"text":"..."}}`，结束为 `data: [DONE]`
 */
import type { ZiweiChart } from '@/lib/ziwei/types';
import { chartToText } from '@/lib/ai/chart-text';
import { getClient, OUTPUT_FORMAT_RULES, jsonError, streamChatAsSSE } from '@/lib/ai/llm';
import {
  HEMING_METHODOLOGY,
  STAR_IN_FUQI_GU,
  SIHUA_IN_FUQI_GU,
  MARRIAGE_STARS_BRIEF,
  HEMING_SCORE_CRITERIA,
} from '@/lib/ziwei/heming-knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function knowledgeText(): string {
  const fuqi = Object.entries(STAR_IN_FUQI_GU)
    .map(([star, d]) => `- ${star}：${d.summary}。吉：${d.good}。凶：${d.bad}。配偶：${d.spouse_traits}。婚期：${d.timing}${d.ni_quote ? `。倪师：「${d.ni_quote}」` : ''}`)
    .join('\n');
  const sihua = Object.entries(SIHUA_IN_FUQI_GU).map(([k, v]) => `- ${k}：${v}`).join('\n');
  const stars = Object.entries(MARRIAGE_STARS_BRIEF).map(([k, v]) => `- ${k}：${v}`).join('\n');
  const score = Object.entries(HEMING_SCORE_CRITERIA).map(([k, v]) => `- ${k}：${v}`).join('\n');
  return `${HEMING_METHODOLOGY}

## 十四主星在夫妻宫断语
${fuqi}

## 四化在夫妻宫
${sihua}

## 婚恋辅星
${stars}

## 合盘评级标准
${score}`;
}

const SYSTEM_PROMPT = `你是一位精通倪海厦《天纪》体系的紫微斗数命理师，专长合盘（两人缘分匹配）。
分析严格依据下面的合盘方法论与断语库，并以两张命盘的实际星曜、四化为证据；每条结论都要说明来自哪一方的哪个宫、哪颗星。
倪师明言斗数批六亲本来就比较差，涉及亲子、兄弟的论断点到为止。
语气沉稳直接，不恐吓、不灌鸡汤。

${OUTPUT_FORMAT_RULES}

${knowledgeText()}`;

const DEFAULT_TASK = `请对甲乙双方做完整合盘分析，按以下结构输出：

**【缘分总评】**
一句话定性两人的缘分类型，并给出评级（一星到五星）与理由。

**【双方命格】**
各自命宫、身宫、福德宫的星性与格局，是否般配或互补。

**【夫妻宫互参】**
甲方夫妻宫主星是否对应乙方命宫/三合方，反之亦然；是否构成天作之合或单向对应。

**【四化交互】**
双方生年四化、当前大限四化互相飞入对方命宫、夫妻宫、福德宫的影响，重点看化忌冲照。

**【福德宫与长久度】**
双方福德宫判断感情深层基础与能否长久。

**【当前大限走势】**
两人各自当前大限对这段关系的影响与关键年份。

**【相处建议】**
基于以上分析的具体可操作建议。`;

interface Body {
  chartA?: ZiweiChart;
  chartB?: ZiweiChart;
  question?: string;
}

export async function POST(req: Request) {
  const client = getClient();
  if (!client) return jsonError('服务端未配置 OPENAI_API_KEY', 500);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }
  const { chartA, chartB, question } = body;
  if (!chartA?.palaces || !chartB?.palaces) return jsonError('缺少 chartA 或 chartB', 400);

  const q = typeof question === 'string' && question.trim() ? question.trim() : '';
  const task = q
    ? `针对这两张命盘的合盘，回答以下问题（用 **【标题】** 分 2–4 个小节）：\n${q}`
    : DEFAULT_TASK;

  return streamChatAsSSE(
    client,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${chartToText(chartA, '甲方命盘')}\n\n${chartToText(chartB, '乙方命盘')}\n\n${task}` },
    ],
    10000,
  );
}
