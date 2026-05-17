import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";

  const res = await fetch(`${internalApiUrl}/api/admin/flags`, {
    cache: "no-store",
    headers: { Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "" },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
