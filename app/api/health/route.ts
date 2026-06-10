import { NextResponse } from "next/server";
import { isClickHouseConfigured, pingClickHouse } from "@/lib/clickhouse";
import { isOpenAIConfigured } from "@/lib/openai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health — connection status for the footer indicator.
 *   openai/clickhouse: "ok" | "unconfigured" | "error"
 *
 * The ClickHouse probe is a real `/ping` (so the dot reflects reachability, not
 * just env config), cached briefly in-process so navigating around the app
 * doesn't hammer the cluster.
 */

type Status = "ok" | "unconfigured" | "error";

const PING_TTL_MS = 30_000;
let pingCache: { at: number; status: Status } | null = null;

async function clickhouseStatus(now: number): Promise<Status> {
  if (!isClickHouseConfigured()) return "unconfigured";
  if (pingCache && now - pingCache.at < PING_TTL_MS) return pingCache.status;
  const status: Status = (await pingClickHouse()) ? "ok" : "error";
  pingCache = { at: now, status };
  return status;
}

export async function GET() {
  const clickhouse = await clickhouseStatus(Date.now());
  const openai: Status = isOpenAIConfigured() ? "ok" : "unconfigured";
  return NextResponse.json({ openai, clickhouse });
}
