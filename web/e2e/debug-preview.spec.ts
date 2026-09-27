import { test, expect } from "@playwright/test";

test("通信なしで各画面を確認し、サンプルを操作・リセットできる", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/https?:\/\/[^/]*peerjs\.com|\/v1\/chat\/completions/, (route) => route.abort());
  await page.goto("/#debug");
  const toolbar = page.getByRole("complementary", { name: "画面プレビュー" });
  await expect(toolbar).toBeVisible();
  await expect(page.locator(".player-app")).toBeVisible();
  await expect(page.locator(".tabs").getByRole("button", { name: /ヒアリング/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("NPCへの質問", { exact: true })).toBeHidden();
  await page.getByText("＋ NPCに質問する", { exact: true }).click();
  await page.getByLabel("NPCへの質問", { exact: true }).fill("切り替えても残る質問");
  await page.locator(".tabs").getByRole("button", { name: /要求カード/ }).click();
  await expect(page.getByLabel("要求カードのタイトル", { exact: true })).toBeHidden();
  await page.getByText("＋ 要求カードを作成", { exact: true }).click();
  await page.getByLabel("要求カードのタイトル", { exact: true }).fill("画面整理の確認");
  await page.getByRole("button", { name: "提出する", exact: true }).click();
  await expect(page.getByText("画面整理の確認", { exact: true })).toBeVisible();
  await page.locator(".tabs").getByRole("button", { name: /ヒアリング/ }).click();
  await expect(page.getByLabel("NPCへの質問", { exact: true })).toHaveValue("切り替えても残る質問");
  await page.getByText("＋ NPCに質問する", { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "議論はここまででOK" }).click();
  await expect(page.getByRole("button", { name: "✓ 準備OK(取り消す)" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/debug-preview.png", fullPage: true });
  for (const view of ["host", "player"]) {
    await toolbar.getByLabel("視点", { exact: true }).selectOption(view);
    for (const phase of ["lobby", "briefing", "discussion", "voting", "finalize", "results"]) {
      await toolbar.getByLabel("フェーズ").selectOption(phase);
      await expect(page.locator(`.${view}-app`)).toBeVisible();
    }
    await expect(page.getByText("画面確認用のサンプル採点です。").first()).toBeVisible();
  }
  await toolbar.getByLabel("シナリオ").selectOption("smart-factory");
  await expect(toolbar.getByLabel("フェーズ")).toHaveValue("discussion");
  await toolbar.getByLabel("視点", { exact: true }).selectOption("join");
  await expect(page.getByRole("heading", { name: "質問から、いい仕様を。" })).toBeVisible();
  await toolbar.getByRole("button", { name: "サンプルをリセット" }).click();
  expect(errors).toEqual([]);
});
