// Frontend mirror of backend/contactSecurityFilter.ts.
//
// This exists so the user gets instant feedback instead of a round-trip, NOT as the
// enforcement point. The server runs the same checks independently — anything here can be
// bypassed by calling the API directly, so this file must never be the only barrier.
//
// Keep the rules in sync with the backend file. See that file for why bare contact
// keywords do not block on their own.
//
// v483: a message stopped HERE never reached the server, so it was never recorded (Admin → Chat moderation
// showed 0) and the strike system could not count it. Now every block is also reported in the background;
// the server checks the text again before it counts.
import * as core from "../../backend/contactSecurityFilter";
import { reportChatBlock, noteChatThread } from "./abuseFilter";

export * from "../../backend/contactSecurityFilter";
export { default } from "../../backend/contactSecurityFilter";

export function checkComprehensiveDisallowedContent(text, opts = {}) {
  noteChatThread(opts?.threadId);
  const r = core.checkComprehensiveDisallowedContent(text, opts);
  if (r?.blocked) reportChatBlock({ text, threadId: opts?.threadId, kind: "contact" });
  return r;
}

export function splitNumberAcrossMessages(text, previous = []) {
  const hit = core.splitNumberAcrossMessages(text, previous);
  if (hit) reportChatBlock({ text, kind: "split", previous });
  return hit;
}
