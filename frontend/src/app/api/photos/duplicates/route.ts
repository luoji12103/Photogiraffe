import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function GET(request: NextRequest) {
  const res = await fetch(`${INTERNAL_API_URL}/api/photos/duplicates`, {
    cache: "no-store",
    headers: {
      Authorization: request.headers.get("Authorization") || "",
    },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
