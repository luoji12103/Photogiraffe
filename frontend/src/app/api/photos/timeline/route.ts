import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization") || "";
    const res = await fetch(`${INTERNAL_API_URL}/api/photos/timeline`, {
      headers: { Authorization: authHeader },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("timeline proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
