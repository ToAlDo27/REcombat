import OBR from "@owlbear-rodeo/sdk"
import { PREFIX } from "./types"

export const TOKEN_WINDOW_ID = `${PREFIX}/token-window`

/** A dedicated modal keeps token editing available with the tracker closed. */
export async function openTokenWindow(
  tokenId: string,
  tab: "data" | "lss" = "data",
): Promise<void> {
  const url = new URL("token.html", document.baseURI)
  url.searchParams.set("token", tokenId)
  url.searchParams.set("tab", tab)
  await OBR.modal.open({
    id: TOKEN_WINDOW_ID,
    url: url.href,
    width: 560,
    height: 820,
  })
}
