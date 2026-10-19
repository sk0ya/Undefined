import { test, expect } from "@playwright/test";

test("製品UIの参加導線と各画面が画面幅に収まる", async ({ page }, testInfo) => {
  await page.goto("/#debug");
  const toolbar = page.getByRole("complementary", { name: "画面プレビュー" });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const view of ["join", "player", "host"]) {
      await toolbar.getByLabel("視点", { exact: true }).selectOption(view);
      await expect(page.locator(view === "join" ? ".join-experience" : `.${view}-app`)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} at ${width}px`).toBe(true);
      if (view === "join") {
        await expect(page.getByRole("button", { name: "参加する", exact: true })).toBeDisabled();
        await page.getByLabel("あなたの名前").fill("デザイン確認");
        await expect(page.getByRole("button", { name: "参加する", exact: true })).toBeEnabled();
      }
      await page.screenshot({ path: testInfo.outputPath(`${view}-${width}.png`), fullPage: true });
    }
  }
});
