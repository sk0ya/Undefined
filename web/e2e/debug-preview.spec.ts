import { test, expect } from "@playwright/test";

test("準備・質問・仕様書を切り替えても入力が残る", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/#debug");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const toolbar = page.getByRole("complementary", { name: "画面プレビュー" });
  const reference = page.getByRole("navigation", { name: "作業の切り替え" });
  const index = page.getByRole("navigation", { name: "仕様書の項目へ移動" });
  await expect(page.locator(".secret-list")).toBeVisible();
  await expect(page.locator(".doc-focused")).toHaveCount(0);
  await reference.getByRole("button", { name: "仕様書", exact: true }).click();
  await expect(page.locator(".doc-section-edit:visible")).toHaveCount(1);
  await page.locator(".doc-section-edit textarea").first().fill("秘密の目標を確認しながら記入");
  await index.getByRole("button").nth(1).click();
  await expect(page.locator(".doc-section-edit:visible")).toHaveCount(1);
  await page.locator(".doc-section-edit textarea").nth(1).fill("電話を使うお客さま");
  await index.getByRole("button").first().click();
  await expect(page.locator(".doc-section-edit textarea").first()).toHaveValue("秘密の目標を確認しながら記入");
  await reference.getByRole("button", { name: "質問", exact: true }).click();
  await page.getByText("＋ NPCに質問する", { exact: true }).click();
  await page.getByLabel("NPCへの質問", { exact: true }).fill("切り替えても残る質問");
  await reference.getByRole("button", { name: "準備", exact: true }).click();
  await reference.getByRole("button", { name: "質問", exact: true }).click();
  await expect(page.getByLabel("NPCへの質問", { exact: true })).toHaveValue("切り替えても残る質問");
  await expect(page.locator(".doc-focused")).toBeHidden();
  await reference.getByRole("button", { name: "仕様書", exact: true }).click();
  await expect(page.locator(".doc-section-edit textarea").first()).toHaveValue("秘密の目標を確認しながら記入");
  const field = await page.locator(".doc-section-edit textarea").first().boundingBox();
  expect(field!.height).toBeLessThanOrEqual(260);
  const previewToolbar = await toolbar.boundingBox();
  expect(field!.y - previewToolbar!.height).toBeLessThan(320);
  const ready = await page.locator(".ready-bar").boundingBox();
  expect(ready!.y + ready!.height).toBeLessThanOrEqual(1000);
  await page.screenshot({ path: testInfo.outputPath("workspace.png"), fullPage: true });
  await page.getByRole("button", { name: "仕様書の確認完了" }).click();
  await expect(page.getByRole("button", { name: "✓ 準備OK(取り消す)" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".doc-section-edit:visible")).toHaveCount(await index.getByRole("button").count());
  await page.emulateMedia({ media: "screen" });
  for (const view of ["host", "player"]) {
    await toolbar.getByLabel("視点", { exact: true }).selectOption(view);
    for (const phase of ["lobby", "discussion", "finalize", "results"]) {
      await toolbar.getByLabel("フェーズ").selectOption(phase);
      await expect(page.locator(`.${view}-app`)).toBeVisible();
    }
  }
  await toolbar.getByLabel("シナリオ").selectOption("smart-factory");
  await expect(reference.getByRole("button", { name: "質問", exact: true })).toHaveCount(0);
  await toolbar.getByLabel("視点", { exact: true }).selectOption("join");
  await expect(page.getByRole("heading", { name: "ゲームに参加" })).toBeVisible();
  expect(errors).toEqual([]);
});
