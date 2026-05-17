import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const res = await fetch(
    `${GO_CORE_URL}/api/photos/tags/autocomplete?q=${encodeURIComponent(q)}`,
    { headers: buildProxyHeaders(req) }
  );
  return NextResponse.json(await res.json(), { status: res.status });
}
