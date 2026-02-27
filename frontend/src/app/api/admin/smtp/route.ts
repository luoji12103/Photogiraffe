import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization") || "";
    const res = await fetch(`${INTERNAL_API_URL}/api/admin/smtp`, {
      headers: { Authorization: authHeader },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("smtp GET proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization") || "";
    const body = await request.text();
    const res = await fetch(`${INTERNAL_API_URL}/api/admin/smtp`, {
      method: "PUT",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("smtp PUT proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
