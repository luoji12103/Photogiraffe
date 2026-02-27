import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization") || "";
    const res = await fetch(`${INTERNAL_API_URL}/api/admin/smtp/test`, {
      method: "POST",
      headers: { Authorization: authHeader },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("smtp/test proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
