export const runtime = "edge";

import { validateRequest, proxyResponse, optionsResponse } from "../../_lib/proxy-utils";

export async function POST(request: Request) {
  const denied = validateRequest(request);
  if (denied) return denied;

  const body = await request.text();

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );

  return proxyResponse(upstream);
}

export async function OPTIONS() {
  return optionsResponse();
}
