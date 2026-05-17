import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function POST(request: NextRequest) {
  try {
    const cookieHeader = request.headers.get("cookie") || "";
    const headers = buildProxyHeaders(request);
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }
    const res = await fetch(`${GO_CORE_URL}/api/auth/logout`, {
      method: "POST",
      headers,
    });
    const data = await res.json();
    const response = NextResponse.json(data, { status: res.status });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) response.headers.set("set-cookie", setCookie);
    return response;
  } catch (error) {
    console.error("Logout proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
