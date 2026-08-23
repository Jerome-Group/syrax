/**
 * The four chats, which are the system's shape rather than the Owner's furniture (ADR-0013): each
 * one an agent of its own, so the capability boundary is carried by the routing rather than by a
 * request-time check. A chat's carrier is addressed by name from the provisioning map and never by
 * position, because a recreated carrier keeps its name and loses its id.
 */

export type ChatId = "general" | "academic" | "media" | "system";

/**
 * How far a chat's search reaches. `this chat's own scope` binds it to the search unit's scope of
 * the same name as the chat, so the two configurations meet on the chat's id rather than on a
 * second name free to drift from it. A chat with neither has no search connection at all, which is
 * how Media and System stay off the corpus.
 */
export type Retrieval = "everything indexed" | "this chat's own scope";

export type Chat = {
  id: ChatId;
  /** The topic's name, chosen by Syrax: the wizard creates it, and a recreation reuses it. */
  carrierName: string;
  /** What this chat answers, in the words its own agent is given. */
  owns: string;
  /**
   * What the Owner has to do about this chat coming back on a new carrier. Only Media has one:
   * Seerr holds its carrier id in its own configuration and posts there on Syrax's bot token, so a
   * recreated Media chat leaves it writing into a dead thread — and its `400` is invisible here.
   */
  recreationNote?: (carrier: number) => string;
  /**
   * How far this chat searches, bound to the connection its agent is given rather than passed as a
   * tool argument (ADR-0004): a scope a model could name is a boundary a model could widen.
   */
  searches?: Retrieval;
};

export const chats: Record<ChatId, Chat> = {
  general: {
    id: "general",
    carrierName: "General",
    owns: "broad search over everything indexed, and any question that names no domain",
    searches: "everything indexed",
  },
  academic: {
    id: "academic",
    carrierName: "Academic",
    owns: "modules, coursework, deadlines and the academic calendar",
    searches: "this chat's own scope",
  },
  media: {
    id: "media",
    carrierName: "Media",
    owns: "films and shows: requesting them, and how the media server is getting on",
    recreationNote: (carrier) =>
      `Seerr still posts availability into the old carrier: re-point it at ${carrier}.`,
  },
  system: {
    id: "system",
    carrierName: "System",
    owns: "Syrax's own state: lane headroom, providers, retrieval scores, and chat recreations",
  },
};

/** The order the chats are provisioned and configured in, General first because it is the default. */
export const everyChat: readonly Chat[] = Object.values(chats);

/**
 * The chat a message with no thread id is answered as, which is the runtime's default agent rather
 * than a mapping — "no thread id" is not expressible as a topic key.
 */
export const defaultChat = chats.general;

export const systemChat = chats.system;
