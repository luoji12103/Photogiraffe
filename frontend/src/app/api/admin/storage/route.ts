import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function GET(request: NextRequest) {
  try {
    const res = await fetch(`${GO_CORE_URL}/api/admin/storage`, {
      cache: "no-store",
      headers: buildProxyHeaders(request),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("admin storage GET proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.text();
    const res = await fetch(`${GO_CORE_URL}/api/admin/storage`, {
      method: "PUT",
      headers: buildProxyHeaders(request, { "Content-Type": "application/json" }),
      body,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("admin storage PUT proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
