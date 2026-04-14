export const runtime = "edge";

import { validateRequest, proxyResponse, optionsResponse } from "../../_lib/proxy-utils";

export async function POST(request: Request) {
  const denied = validateRequest(request);
  if (denied) return denied;

  const body = await request.text();

  const upstream = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.QWEN_KEY}`,
      },
      body,
    }
  );

  return proxyResponse(upstream);
}

export async function OPTIONS() {
  return optionsResponse();
}
