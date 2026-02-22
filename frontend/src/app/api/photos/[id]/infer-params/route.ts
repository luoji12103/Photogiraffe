import { NextResponse } from "next/server";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";

  try {
    const res = await fetch(`${internalApiUrl}/api/photos/${id}/infer-params`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to trigger param inference" },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error triggering param inference:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
