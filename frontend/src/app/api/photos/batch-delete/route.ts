import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";

  try {
    const body = await request.text();
    const res = await fetch(`${internalApiUrl}/api/photos/batch-delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: request.headers.get("Authorization") || "",
      },
      body,
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("Batch delete proxy error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
