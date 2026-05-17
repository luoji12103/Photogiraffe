import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function GET(req: NextRequest) {
  const res = await fetch(`${GO_CORE_URL}/api/storage/usage`, {
    headers: buildProxyHeaders(req),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
