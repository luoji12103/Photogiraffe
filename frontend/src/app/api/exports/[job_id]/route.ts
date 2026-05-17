import { NextRequest, NextResponse } from "next/server";

const BASE = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ job_id: string }> }
) {
  const { job_id } = await params;
  const res = await fetch(`${BASE}/api/exports/${job_id}`, {
    headers: { Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "" },
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ job_id: string }> }
) {
  const { job_id } = await params;
  const res = await fetch(`${BASE}/api/exports/${job_id}`, {
    method: "DELETE",
    headers: { Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "" },
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
