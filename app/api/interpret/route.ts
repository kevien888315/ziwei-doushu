/**
 * POST /api/interpret —— 单盘 AI 解读（InsightPanel 主题解读 / ChatPanel 追问）
 *
 * 请求：{ chart: ZiweiChart, messages: { role: 'user'|'assistant', content: string }[] }
 * 响应：SSE，`data: {"delta":{"text":"..."}}`，结束为 `data: [DONE]`
 */
import type { ZiweiChart } from '@/lib/ziwei/types';
import { chartToText } from '@/lib/ai/chart-text';
import { getClient, OUTPUT_FORMAT_RULES, jsonError, streamChatAsSSE } from '@/lib/ai/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_HISTORY = 20;

const SYSTEM_PROMPT = `你是一位精通倪海厦《天纪》体系的紫微斗数命理师。你的解读以倪师的论法为本：
- 看命先定格局：命宫主星定性，再看三方四正（财帛、官禄、迁移）联动，命宫与福德宫并看。
- 四化是斗数的灵魂：生年四化定一生基调，大限四化定十年运势，宫干自化看得失；化忌所在宫位与所冲宫位是关键。
- 星曜亮度（庙旺得利平不陷）影响吉凶程度，煞星（擎羊、陀罗、火星、铃星、地空、地劫）与吉星（左辅、右弼、文昌、文曲、天魁、天钺、禄存）的会照要一并考量。
- 空宫借对宫星曜论断。
- 倪师明言斗数批六亲（父母、兄弟、子女）本来就比较差，涉及六亲的论断要点到为止、标明仅供参考。
- 论断要有命盘依据：每条结论都指出是哪个宫、哪颗星、哪个四化推出来的，不要泛泛而谈。
- 语气沉稳、直接、有温度，像一位有经验的老师在讲解，不恐吓、不灌鸡汤。

${OUTPUT_FORMAT_RULES}`;

interface Body {
  chart?: ZiweiChart;
  messages?: { role?: string; content?: string }[];
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
  const { chart, messages } = body;
  if (!chart || !Array.isArray(chart.palaces) || !Array.isArray(messages)) {
    return jsonError('缺少 chart 或 messages', 400);
  }

  const history = messages
    .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
      (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim() !== '')
    .slice(-MAX_HISTORY)
    .map(m => ({ role: m.role, content: m.content }));
  // 首条必须是 user
  while (history.length && history[0].role !== 'user') history.shift();
  if (!history.length) return jsonError('messages 为空', 400);

  return streamChatAsSSE(
    client,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: `以下是命主的命盘资料，所有解读都必须以此为依据：\n\n${chartToText(chart)}` },
      ...history,
    ],
    8000,
  );
}
