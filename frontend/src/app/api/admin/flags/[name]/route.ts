import { NextRequest, NextResponse } from "next/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";

  const body = await request.text();
  const res = await fetch(`${internalApiUrl}/api/admin/flags/${name}`, {
    method: "PUT",
    headers: {
      Authorization: request.headers.get("Authorization") || "",
      "Content-Type": "application/json",
    },
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
