import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";

  try {
    const res = await fetch(`${internalApiUrl}/api/admin/invite-codes`, {
      cache: "no-store",
      headers: {
        Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "",
      },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("Invite codes proxy error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";

  try {
    const body = await request.text();
    const res = await fetch(`${internalApiUrl}/api/admin/invite-codes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "",
      },
      body: body || "{}",
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("Invite codes create proxy error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
