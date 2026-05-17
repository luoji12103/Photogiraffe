import { NextRequest, NextResponse } from "next/server";

const BASE = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function GET(request: NextRequest) {
  const res = await fetch(`${BASE}/api/admin/ai-rate-limits`, {
    cache: "no-store",
    headers: { Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "" },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const res = await fetch(`${BASE}/api/admin/ai-rate-limits`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "",
      "Content-Type": "application/json",
    },
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
