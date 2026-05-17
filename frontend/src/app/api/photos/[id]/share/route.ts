import { NextRequest, NextResponse } from "next/server";

const INTERNAL = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${INTERNAL}/api/photos/${id}/share`, {
    cache: "no-store",
    headers: { Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "" },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.text();
  const res = await fetch(`${INTERNAL}/api/photos/${id}/share`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "",
      "Content-Type": "application/json",
    },
    body: body || "{}",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
