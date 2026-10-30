import { expect, test } from "vitest";
import { duplicateKey, renamedKey } from "../src/operation-queue.ts";

test("duplicate keys get a -copy suffix before the extension", () => {
  expect(duplicateKey("img/logo.png", false)).toBe("img/logo-copy.png");
  expect(duplicateKey("README", false)).toBe("README-copy");
  expect(duplicateKey("backups/2026/", true)).toBe("backups/2026-copy/");
  expect(duplicateKey("archive.tar.gz", false)).toBe("archive.tar-copy.gz");
});

test("renames stay in the same parent folder", () => {
  expect(renamedKey("img/logo.png", false, "brand.png")).toBe("img/brand.png");
  expect(renamedKey("top.txt", false, "new.txt")).toBe("new.txt");
  expect(renamedKey("a/b/", true, "c")).toBe("a/c/");
});
