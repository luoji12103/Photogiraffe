import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";

  try {
    const res = await fetch(`${internalApiUrl}/photos`, {
      cache: "no-store",
      headers: {
        Authorization: request.headers.get("Authorization") || "",
      },
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to fetch photos" },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching photos:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
