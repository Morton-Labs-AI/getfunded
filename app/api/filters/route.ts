import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * NL → constrained filter JSON for /browse. The AI sets the same controls the
 * user could set by hand — its work is always inspectable and correctable
 * (visible, removable chips). Not free SQL: a fixed schema, validated here.
 */
const FILTER_TOOL: Anthropic.Tool = {
  name: "set_filters",
  description: "Set the browse filters that match the user's description.",
  input_schema: {
    type: "object" as const,
    properties: {
      segment: {
        type: "string",
        enum: ["foundations", "advisers", "funds", "companies", "agencies"],
      },
      state: { type: "string", description: "Two-letter US state code" },
      q: { type: "string", description: "Keyword full-text terms (names/thesis), e.g. 'science energy'" },
      minAssets: { type: "number", description: "Minimum assets/AUM in dollars" },
      maxAssets: { type: "number" },
      ntee: {
        type: "string",
        description: "NTEE major-group letter (A-Z), e.g. U = science & technology",
      },
      era: { type: "string", enum: ["era", "ria"] },
      fundType: {
        type: "string",
        enum: ["Venture Capital Fund", "Private Equity Fund", "Hedge Fund"],
      },
    },
    required: ["segment"],
  },
};

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "AI not configured" }, { status: 503 });
  const { text } = await req.json().catch(() => ({ text: "" }));
  if (!text || typeof text !== "string")
    return Response.json({ error: "Bad request" }, { status: 400 });

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 500,
    system:
      "Translate funder-discovery descriptions into browse filters via set_filters. " +
      "foundations = private foundations/charities (IRS; assets, NTEE); advisers = VC/PE/RIAs (SEC; AUM, era); " +
      "funds = private funds; companies = SBIR awardees; agencies = federal. " +
      "NTEE major groups: U=science/tech research, T=philanthropy, others by letter. Always call the tool.",
    tools: [FILTER_TOOL],
    tool_choice: { type: "tool", name: "set_filters" },
    messages: [{ role: "user", content: text }],
  });

  const call = msg.content.find((b) => b.type === "tool_use");
  if (!call || call.type !== "tool_use")
    return Response.json({ error: "No filters produced" }, { status: 422 });
  return Response.json({ filters: call.input });
}
