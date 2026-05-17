import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function GET(req: NextRequest) {
  const res = await fetch(`${GO_CORE_URL}/api/smart-albums`, {
    headers: buildProxyHeaders(req),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const res = await fetch(`${GO_CORE_URL}/api/smart-albums`, {
    method: "POST",
    headers: buildProxyHeaders(req, { "Content-Type": "application/json" }),
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
