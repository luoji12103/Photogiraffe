import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://go-core:8080";

// No auth required — public endpoint
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const res = await fetch(`${INTERNAL_API_URL}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("reset-password proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
