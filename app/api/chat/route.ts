import Anthropic from "@anthropic-ai/sdk";
import { DB_TOOLS, runDbTool } from "@/lib/ai/tools";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";
const EFFORT = (process.env.CHAT_EFFORT ?? "medium") as
  | "low"
  | "medium"
  | "high"
  | "max";
const MAX_TOOL_ROUNDS = 8;

interface InMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Set ANTHROPIC_API_KEY to enable the analyst." }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }

  let incoming: InMessage[];
  try {
    const body = await req.json();
    incoming = Array.isArray(body?.messages) ? body.messages : [];
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const history: Anthropic.MessageParam[] = incoming
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return new Response("Expected a trailing user message", { status: 400 });
  }

  const client = new Anthropic();
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const messages: Anthropic.MessageParam[] = [...history];

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const params = {
            model: MODEL,
            max_tokens: 16000,
            system,
            thinking: { type: "adaptive" },
            output_config: { effort: EFFORT },
            tools: DB_TOOLS,
            messages,
          } as unknown as Anthropic.MessageStreamParams;

          const s = client.messages.stream(params);
          s.on("text", (delta) => send({ type: "text", text: delta }));
          const final = await s.finalMessage();

          if (final.usage) {
            send({
              type: "usage",
              cache_read: final.usage.cache_read_input_tokens ?? 0,
              input: final.usage.input_tokens,
              output: final.usage.output_tokens,
            });
          }

          if (final.stop_reason !== "tool_use") break;

          messages.push({ role: "assistant", content: final.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
            send({ type: "tool", name: block.name });
            const out = await runDbTool(
              block.name,
              (block.input ?? {}) as Record<string, unknown>,
              send
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: out,
            });
          }
          messages.push({ role: "user", content: toolResults });
        }

        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
