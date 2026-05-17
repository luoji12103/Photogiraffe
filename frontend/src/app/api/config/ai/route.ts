import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function GET(request: NextRequest) {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/api/config/ai`, {
      cache: "no-store",
      headers: { Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "" },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to fetch AI config" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${INTERNAL_API_URL}/api/config/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to save AI config" }, { status: 500 });
  }
}
