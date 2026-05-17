import { NextRequest, NextResponse } from "next/server";

const BASE = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = searchParams.get("page") || "1";
  const limit = searchParams.get("limit") || "20";
  const status = searchParams.get("status") || "";

  const params = new URLSearchParams({ page, limit });
  if (status) params.set("status", status);

  const res = await fetch(`${BASE}/api/exports?${params.toString()}`, {
    headers: { Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "" },
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
