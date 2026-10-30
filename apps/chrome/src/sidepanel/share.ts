// Share sheet: provider URI, unsigned HTTP link, and a signed link with a
// chosen expiry (hidden when the client can't presign).
import { els, setStatus, withStatus } from "./dom.ts";
import { open } from "./state.ts";

export async function copyToClipboard(text: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied to clipboard.");
  } catch {
    setStatus("Couldn't copy to clipboard.", { error: true });
  }
}

export function openShareMenu(key: string, name: string): void {
  const { client, bucket } = open();
  els.shareModalTitle.textContent = `Share "${name}"`;
  els.shareModal.dataset.key = key;
  els.shareUriLabel.textContent = `${client.scheme}:// URI`;
  els.shareS3Uri.value = client.resourceUri(bucket, key);
  els.shareHttpUrl.value = client.unsignedUrl(bucket, key);
  els.shareSignedUrl.value = "";
  els.shareSignedRow.hidden = !client.canPresign;
  els.shareModal.showModal();
}

export function wireShare(): void {
  els.copyS3UriBtn.addEventListener("click", () => copyToClipboard(els.shareS3Uri.value));
  els.copyHttpUrlBtn.addEventListener("click", () => copyToClipboard(els.shareHttpUrl.value));
  els.copySignedUrlBtn.addEventListener("click", () => copyToClipboard(els.shareSignedUrl.value));
  els.generateSignedBtn.addEventListener("click", async () => {
    const key = els.shareModal.dataset.key ?? "";
    const expiresIn = Number(els.shareExpiry.value);
    try {
      const { client, bucket } = open();
      els.shareSignedUrl.value = await withStatus(client.presignedUrl(bucket, key, expiresIn), "Signing…");
      await copyToClipboard(els.shareSignedUrl.value);
    } catch {
      // withStatus already surfaced the error
    }
  });
  els.shareCloseBtn.addEventListener("click", () => els.shareModal.close());
}
