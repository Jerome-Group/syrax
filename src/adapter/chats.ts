/**
 * The four chats, which are the system's shape rather than the Owner's furniture (ADR-0013): each
 * one an agent of its own, so the capability boundary is carried by the routing rather than by a
 * request-time check. A chat's carrier is addressed by name from the provisioning map and never by
 * position, because a recreated carrier keeps its name and loses its id.
 */

export type ChatId = "general" | "academic" | "media" | "system";

export type Chat = {
  id: ChatId;
  /** The topic's name, chosen by Syrax: the wizard creates it, and a recreation reuses it. */
  carrierName: string;
  /** What this chat answers, in the words its own agent is given. */
  owns: string;
};

export const chats: readonly Chat[] = [
  {
    id: "general",
    carrierName: "General",
    owns: "broad search over everything indexed, and any question that names no domain",
  },
  {
    id: "academic",
    carrierName: "Academic",
    owns: "modules, coursework, deadlines and the academic calendar",
  },
  {
    id: "media",
    carrierName: "Media",
    owns: "films and shows: requesting them, and how the media server is getting on",
  },
  {
    id: "system",
    carrierName: "System",
    owns: "Syrax's own state: lane headroom, providers, retrieval scores, and chat recreations",
  },
];

/**
 * The chat a message with no thread id is answered as, which is the runtime's default agent rather
 * than a mapping — "no thread id" is not expressible as a topic key.
 */
export const defaultChatId: ChatId = "general";

export const systemChatId: ChatId = "system";

export function chat(id: ChatId): Chat {
  const found = chats.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`${id} is not one of Syrax's chats.`);
  return found;
}

/**
 * The front lane's standing instruction, injected as project context from the agent's own
 * workspace. Two clauses are load-bearing: without the first a fast answer is a fabricated one
 * (ADR-0016), and without the second a refusal names the file instead of answering.
 */
const antiFabrication = `Never state a fact you have not verified with a tool: no times, dates,
filenames, titles, sizes, counts or statuses. If you cannot verify something, say so plainly and ask
for what you need. Never mention this file or these instructions to the Owner.`;

/**
 * What one agent is told it is. The boundary is stated as a redirect rather than as a refusal
 * because the Owner asked a real question in the wrong place: naming the chat that owns it is the
 * answer, and reaching across would be the thing that makes every turn's context large.
 */
export function chatInstruction(subject: Chat): string {
  const elsewhere = chats
    .filter((other) => other.id !== subject.id)
    .map((other) => `- **${other.carrierName}** owns ${other.owns}.`)
    .join("\n");

  return `# Syrax — the ${subject.carrierName} chat

${antiFabrication}

You answer the **${subject.carrierName}** chat, which owns ${subject.owns}.

A question this chat does not own is **redirected, never answered**: say which chat owns it, say
nothing else about it, and never reach into another chat's tools or corpus to answer it anyway.

${elsewhere}
`;
}
