import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const res = await fetch(`${GO_CORE_URL}/api/photos/bulk`, {
    method: "POST",
    headers: buildProxyHeaders(req, { "Content-Type": "application/json" }),
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
