/**
 * What a provider says about its own allowance, read off a response to a call that was being made
 * anyway (ADR-0006). Nothing here reaches a provider: this is the parser, and the callers are the
 * things that already hold a response.
 *
 * The header names are per provider because the providers do not agree on them — Mistral suffixes
 * its rungs with the window they are counted over, Groq states a reset duration beside each rung,
 * and two of the four say nothing at all on a successful call. A provider whose headers stop
 * parsing is *unknown* rather than full: a report that reads an absence as headroom is worse than
 * one that admits it cannot see.
 */

import type { ProviderId } from "../adapter/lane.ts";

/** One rung of an allowance as the provider states it. */
export type ReportedRung = { window: string; remaining: number; limit: number };

export type Reported = { requests?: ReportedRung; tokens?: ReportedRung };

export type HeaderSource = { get(name: string): string | null };

/**
 * Where a provider's numbers are read from, per provider. An empty entry is a provider that
 * reports nothing on the inference path — Gemini and Z.AI, which is why one of them is counted
 * here instead and the other has no allowance to count.
 */
const reportedRungs: Record<ProviderId, { window: string; requests: string; tokens: string }[]> = {
  "syrax-mistral": [{ window: "minute", requests: "req-minute", tokens: "tokens-minute" }],
  "syrax-groq": [{ window: "current", requests: "requests", tokens: "tokens" }],
  "syrax-gemini": [],
  "syrax-zai": [],
};

export function reportsItsOwnTelemetry(provider: ProviderId): boolean {
  return reportedRungs[provider].length > 0;
}

/**
 * The provider's own words, or nothing. Nothing covers both a provider that never speaks and one
 * whose headers have changed shape — the caller cannot tell them apart and does not need to, since
 * both mean *this source did not say*.
 */
export function readReported(provider: ProviderId, headers: HeaderSource): Reported | null {
  const reported: Reported = {};
  for (const rung of reportedRungs[provider]) {
    const requests = readRung(headers, rung.window, rung.requests);
    const tokens = readRung(headers, rung.window, rung.tokens);
    if (requests !== null) reported.requests = requests;
    if (tokens !== null) reported.tokens = tokens;
  }
  return reported.requests === undefined && reported.tokens === undefined ? null : reported;
}

function readRung(headers: HeaderSource, window: string, suffix: string): ReportedRung | null {
  const remaining = readNumber(headers, `x-ratelimit-remaining-${suffix}`);
  const limit = readNumber(headers, `x-ratelimit-limit-${suffix}`);
  if (remaining === null || limit === null) return null;
  return { window, remaining, limit };
}

function readNumber(headers: HeaderSource, name: string): number | null {
  const value = headers.get(name);
  if (value === null) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}
