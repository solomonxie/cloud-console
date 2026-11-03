// Saves through an <a download> click rather than chrome.downloads: when
// another extension listens to onDeterminingFilename, Chrome drops
// downloads.download's `filename` and a blob: URL saves as its UUID. The
// anchor's name is the page's own suggestion, which survives that.
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
