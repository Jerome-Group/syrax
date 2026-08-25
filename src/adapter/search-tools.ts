/**
 * The search unit as an agent reaches it: one MCP connection per chat that searches, and the scope
 * carried by that connection's own header.
 *
 * A connection per chat rather than one shared one is what makes the scope a property of the
 * configuration (ADR-0004). The unit reads scope from a header and refuses one it does not
 * recognise, so a chat cannot widen its own reach; were scope a tool parameter, one confused turn
 * could. That is also why the servers are named per chat: the tool a model sees is
 * `syrax-search-<chat>__search`, and the only one it is given is its own chat's.
 *
 * `read` rides the same connection as `search` deliberately. It is bounded by the blocklist rather
 * than by the index, so General reaches a document the Academic chat owns without reaching
 * Academic's tools — the capability boundary sits on the tool layer, not on the corpus.
 */

import type { Chat } from "./chats.ts";
import { everyChat } from "./chats.ts";
import type { Deployment } from "./deployment.ts";

/** The header the unit reads a connection's scope from. */
export const scopeHeader = "X-Syrax-Scope";

export function searchesTheCorpus(chat: Chat): boolean {
  return chat.searches !== undefined;
}

/** Its connection carries a scope, which the search unit maps to a root by the chat's own name. */
export function searchesOneScope(chat: Chat): boolean {
  return chat.searches === "this chat's own scope";
}

/** Its corpus is the index entire, which is what the redirect has to be told not to reach into. */
export function searchesEverything(chat: Chat): boolean {
  return chat.searches === "everything indexed";
}

/** What the unit serves, in the order a turn reaches them. */
export type SearchUnitTool = "search" | "choose" | "capture" | "attach" | "read";

export const everySearchUnitTool: readonly SearchUnitTool[] = [
  "search",
  "choose",
  "capture",
  "attach",
  "read",
];

function serverName(chat: Chat): string {
  return `syrax-search-${chat.id}`;
}

/** The name a model calls one of the unit's tools by: the runtime prefixes each with its server. */
export function searchTool(chat: Chat, tool: SearchUnitTool): string {
  return `${serverName(chat)}__${tool}`;
}

export function searchServers(deployment: Deployment) {
  const searching = everyChat.filter(searchesTheCorpus);
  return Object.fromEntries(
    searching.map((chat) => [serverName(chat), searchServer(deployment, chat)]),
  );
}

function searchServer(deployment: Deployment, chat: Chat) {
  return {
    url: `http://127.0.0.1:${deployment.searchPort}/mcp`,
    transport: "streamable-http",
    ...(searchesOneScope(chat) ? { headers: { [scopeHeader]: chat.id } } : {}),
  };
}

/**
 * A scope the unit does not know is refused at the first query rather than at startup, which is a
 * chat that answers nothing and says why nowhere. So the generator refuses before it writes.
 */
export function unconfiguredScopes(deployment: Deployment): string[] {
  return everyChat
    .filter(searchesOneScope)
    .map((chat) => chat.id)
    .filter((scope) => deployment.searchScopes[scope] === undefined);
}
