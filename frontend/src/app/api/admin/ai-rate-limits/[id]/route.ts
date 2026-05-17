import { NextRequest, NextResponse } from "next/server";

const BASE = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.text();
  const res = await fetch(`${BASE}/api/admin/ai-rate-limits/${id}`, {
    method: "PUT",
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${BASE}/api/admin/ai-rate-limits/${id}`, {
    method: "DELETE",
    cache: "no-store",
    headers: { Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "" },
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
