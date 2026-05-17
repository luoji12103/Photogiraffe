import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function GET(req: NextRequest) {
  const res = await fetch(`${GO_CORE_URL}/api/stats`, {
    headers: buildProxyHeaders(req),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
