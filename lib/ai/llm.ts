/**
 * lib/ai/llm —— OpenAI 客户端与 SSE 工具（OpenAI 兼容协议，可接任何兼容网关）
 *
 * 环境变量：
 *   OPENAI_API_KEY           必填
 *   OPENAI_BASE_URL          可选，走 OpenAI 兼容网关（DeepSeek / 自建等）时设置
 *   OPENAI_MODEL             可选，默认 gpt-5.5
 *   OPENAI_REASONING_EFFORT  可选，low | medium | high；不设则不传（兼容不支持该参数的网关）
 *
 * 前端（InsightPanel / ChatPanel / heming）约定的流格式：
 *   data: {"delta":{"text":"..."}}\n\n   …   data: [DONE]\n\n
 */
import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';

export const MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';

type Effort = 'low' | 'medium' | 'high';
const EFFORTS: Effort[] = ['low', 'medium', 'high'];
export const REASONING_EFFORT: Effort | undefined = EFFORTS.includes(process.env.OPENAI_REASONING_EFFORT as Effort)
  ? (process.env.OPENAI_REASONING_EFFORT as Effort)
  : undefined;

let client: OpenAI | null = null;

/** 没配 API Key 时返回 null，由路由返回 500 并说明 */
export function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI();
  return client;
}

/** 通用输出口径：前端 AiContent 只识别 `**【标题】**` 独占一行的小节标题和行内 `**加粗**` */
export const OUTPUT_FORMAT_RULES = `输出格式要求（必须遵守）：
- 用简体中文。
- 小节标题单独成行，写成 **【标题】** 的形式；用户若已指定结构，严格按用户给的小节顺序输出。
- 正文用普通段落，重点词可用 **加粗**；不要用 #、>、表格、代码块，不要用编号列表嵌套。
- 直接给出解读，不要开场白、不要重复用户的问题、结尾不要加免责声明。
- 引用倪海厦原话时注明出自《天纪》；不确定的出处不要编造。
- 每个小节 2–5 句，整体控制在 600–1200 字；追问类问题 200–500 字。`;

export function jsonError(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

type ChatMessage = ChatCompletionCreateParamsStreaming['messages'][number];

/**
 * 发起流式对话并转成前端约定的 SSE。
 * 流中途出错时把错误文字作为最后一段 delta 发出去，再发 [DONE]，避免前端卡在空气泡。
 */
export function streamChatAsSSE(client: OpenAI, messages: ChatMessage[], maxTokens: number): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text } })}\n\n`));
      try {
        const params: ChatCompletionCreateParamsStreaming = {
          model: MODEL,
          messages,
          stream: true,
          max_completion_tokens: maxTokens,
          ...(REASONING_EFFORT ? { reasoning_effort: REASONING_EFFORT } : {}),
        };
        const stream = await client.chat.completions.create(params, { signal: abort.signal });
        let finish: string | null | undefined;
        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const text = choice.delta?.content;
          if (text) send(text);
          if (choice.finish_reason) finish = choice.finish_reason;
        }
        if (finish === 'length') send('\n\n（输出已达长度上限，可继续追问。）');
        else if (finish === 'content_filter') send('\n\n（内容被模型安全策略拦截，请换个问法再试。）');
      } catch (e) {
        const msg = e instanceof OpenAI.AuthenticationError
          ? '解读失败：OPENAI_API_KEY 无效，请检查服务端配置'
          : e instanceof OpenAI.RateLimitError
            ? '解读失败：上游限流，请稍后重试'
            : e instanceof OpenAI.APIError
              ? `解读失败：上游返回 ${e.status ?? ''} ${e.message}`
              : `解读失败：${e instanceof Error ? e.message : String(e)}`;
        console.error('[llm stream]', e);
        send(`\n\n（${msg}）`);
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
