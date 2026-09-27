import { test, expect } from "@playwright/test";

test("40人10ルームの画面で質問を絞り込み、全ルームの成果物へ移動できる", async ({ page }, testInfo) => {
  await page.route("**/src/main.tsx*", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('"/src/App.tsx"', '"/test/fixtures/ScaleHost.tsx"');
    expect(body).toContain('/test/fixtures/ScaleHost.tsx');
    await route.fulfill({ response, body });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#host");
  await expect(page.locator(".cockpit-room")).toHaveCount(10);
  await expect(page.locator(".queue-item")).toHaveCount(40);
  await page.getByLabel("質問キューの絞り込み：ルーム").selectOption("ルーム10");
  await expect(page.locator(".queue-item")).toHaveCount(4);
  await expect(page.locator(".queue-item").first()).toContainText("ルーム10の確認1");
  await page.getByLabel("質問キューの絞り込み：質問先").selectOption("店長");
  await expect(page.locator(".queue-item")).toHaveCount(1);
  await page.getByLabel("店長としての回答").fill("対象ルームだけに届く回答");
  await page.getByRole("button", { name: "回答を送る", exact: true }).click();
  await expect(page.locator(".queue-item")).toHaveCount(0);
  await page.getByRole("button", { name: "絞り込みを解除", exact: true }).click();
  await expect(page.locator(".queue-item")).toHaveCount(39);
  await page.getByRole("button", { name: /ルームの成果物/ }).click();
  for (let i = 1; i <= 10; i++) {
    await page.locator(".room-tabs").getByRole("button", { name: new RegExp(`ルーム${i}(?!\\d)`) }).click();
    await expect(page.locator(".host-selected-room")).toHaveText(`対象: ルーム${i}`);
    await expect(page.locator(".proposal")).toHaveCount(4);
    await expect(page.locator(".proposal-title").first()).toHaveText(`ルーム${i}の要求1`);
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`host-10-rooms-${width}.png`) });
  }
  await expect(page.getByLabel("タイマーの設定時間(分)")).toBeHidden();
  await page.getByRole("button", { name: "時間の変更・クリア" }).click();
  await expect(page.getByLabel("タイマーの設定時間(分)")).toBeVisible();
  await page.getByRole("button", { name: "時間の変更・クリア" }).click();
  const lane = await page.locator(".cockpit-lane").boundingBox();
  expect(lane!.height).toBeLessThan(160);
});
