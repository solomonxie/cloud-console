// Confirm / prompt dialogs (replace window.confirm/prompt), and
// click-outside-to-close for sheet-style dialogs.
import { icon } from "../lib/icons.ts";
import { els } from "./dom.ts";

export function confirmDialog({
  title,
  message,
  confirmLabel = "Delete",
}: {
  title: string;
  message: string;
  confirmLabel?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmIcon.innerHTML = icon("trash");
    els.confirmOkBtn.textContent = confirmLabel;

    const cleanup = (result: boolean) => {
      els.confirmDialog.close();
      els.confirmOkBtn.removeEventListener("click", onOk);
      els.confirmCancelBtn.removeEventListener("click", onCancel);
      els.confirmDialog.removeEventListener("cancel", onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    els.confirmOkBtn.addEventListener("click", onOk);
    els.confirmCancelBtn.addEventListener("click", onCancel);
    els.confirmDialog.addEventListener("cancel", onCancel);
    els.confirmDialog.showModal();
  });
}

export function promptDialog({
  title,
  label,
  value = "",
}: {
  title: string;
  label: string;
  value?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    els.promptTitle.textContent = title;
    els.promptLabel.textContent = label;
    els.promptInput.value = value;

    const cleanup = (result: string | null) => {
      els.promptDialog.close();
      els.promptForm.removeEventListener("submit", onSubmit);
      els.promptCancelBtn.removeEventListener("click", onCancel);
      els.promptDialog.removeEventListener("cancel", onCancel);
      resolve(result);
    };
    const onSubmit = (e: Event) => {
      e.preventDefault();
      cleanup(els.promptInput.value.trim() || null);
    };
    const onCancel = () => cleanup(null);

    els.promptForm.addEventListener("submit", onSubmit);
    els.promptCancelBtn.addEventListener("click", onCancel);
    els.promptDialog.addEventListener("cancel", onCancel);
    els.promptDialog.showModal();
    els.promptInput.focus();
    els.promptInput.select();
  });
}

// A click on the backdrop lands on the <dialog> itself (outside its content
// box), so treat that as "close" too — a bigger, more forgiving target than
// the close button alone.
export function closeOnBackdropClick(dialog: HTMLDialogElement, onRequestClose: () => void = () => dialog.close()): void {
  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) onRequestClose();
  });
}
