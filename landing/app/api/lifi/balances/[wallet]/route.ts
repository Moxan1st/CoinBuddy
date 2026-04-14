export const runtime = "edge";

import { validateRequest, proxyResponse, optionsResponse } from "../../../_lib/proxy-utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ wallet: string }> }
) {
  const denied = validateRequest(request);
  if (denied) return denied;

  const { wallet } = await params;
  const { searchParams } = new URL(request.url);

  const upstream = await fetch(
    `https://li.quest/v1/wallets/${wallet}/balances?${searchParams}`,
    {
      headers: {
        accept: "application/json",
        "x-lifi-api-key": process.env.LIFI_KEY!,
      },
    }
  );

  return proxyResponse(upstream);
}

export async function OPTIONS() {
  return optionsResponse();
}
