import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams.toString();
  const url = `${GO_CORE_URL}/api/photos/search${searchParams ? `?${searchParams}` : ""}`;
  const res = await fetch(url, {
    headers: buildProxyHeaders(req),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
