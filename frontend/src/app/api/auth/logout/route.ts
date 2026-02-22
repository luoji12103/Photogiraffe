import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization") || "";
    const cookieHeader = request.headers.get("cookie") || "";
    const res = await fetch(`${INTERNAL_API_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: authHeader, Cookie: cookieHeader },
    });
    const data = await res.json();
    const response = NextResponse.json(data, { status: res.status });
    // Clear the cookie in the browser too
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) response.headers.set("set-cookie", setCookie);
    return response;
  } catch (error) {
    console.error("Logout proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
