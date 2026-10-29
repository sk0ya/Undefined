import { test, expect, type Page } from "@playwright/test";

test("参加エラーを修正し、下書きを失わず質問・仕様書・管理者回答を往復できる", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [host, player, other] = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  for (const page of [host, player, other]) page.on("pageerror", (error) => errors.push(error.message));
  host.on("dialog", (dialog) => void dialog.accept());
  await host.addInitScript(() => localStorage.setItem("reqgame_ai", JSON.stringify({ provider: "api", apiKey: "", remember: true })));
  const capture = async (page: Page, name: string) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  };
  try {
    await host.goto(`${baseURL}/#host`);
    await expect(host.locator(".room-code-chip")).toBeVisible({ timeout: 30_000 });
    const code = (await host.locator(".room-code-chip").innerText()).replace(/[^A-Z0-9]/g, "");
    await player.goto(baseURL!);
    await player.getByLabel("ルームコード").fill(code);
    await player.getByLabel("あなたの名前").fill("あき");
    await player.getByRole("button", { name: "参加する", exact: true }).click();
    await expect(player.getByText("ゲーム開始を待っています")).toBeVisible({ timeout: 30_000 });
    await other.goto(`${baseURL}/#${code}`);
    await other.getByLabel("あなたの名前").fill("あき");
    await other.getByRole("button", { name: "参加する", exact: true }).click();
    await expect(other.getByRole("alert")).toContainText("その名前は既に使われています", { timeout: 30_000 });
    await expect(other.getByLabel("あなたの名前")).toBeEnabled();
    await other.getByLabel("あなたの名前").fill("うみ");
    await other.getByRole("button", { name: "参加する", exact: true }).click();
    await expect(host.locator(".player-tag")).toHaveCount(2, { timeout: 30_000 });
    // Joining from the blank landing page must also restore the correct room.
    await player.goto(`${baseURL}/#${code}`);
    await expect(player.getByText("ゲーム開始を待っています")).toBeVisible({ timeout: 30_000 });
    await host.locator('[data-scenario-id="restaurant"]').click();
    await host.getByRole("button", { name: /ゲーム開始/ }).click();
    await player.locator(".tabs").getByRole("button", { name: "仕様書", exact: true }).click();
    await expect(player.locator(".doc-editor")).toBeVisible();

    await player.locator(".tabs").getByRole("button", { name: "質問", exact: true }).click();
    await player.getByLabel("質問内容").fill("電話予約は誰が記録していますか？");
    await player.locator(".tabs").getByRole("button", { name: "準備", exact: true }).click();
    await player.locator(".tabs").getByRole("button", { name: "質問", exact: true }).click();
    await expect(player.getByLabel("質問内容")).toHaveValue("電話予約は誰が記録していますか？");
    await player.getByRole("button", { name: "質問する", exact: true }).click();
    await expect(host.getByLabel("店長としての回答")).toBeVisible();
    await host.getByLabel("店長としての回答").fill("ホール担当が紙の台帳に記録します。");
    await host.getByRole("button", { name: /ホスト用資料/ }).click();
    await host.getByRole("button", { name: /質問に回答/ }).click();
    await expect(host.getByLabel("店長としての回答")).toHaveValue("ホール担当が紙の台帳に記録します。");
    await host.getByRole("button", { name: "回答を送る", exact: true }).click();
    await expect(player.getByText("ホール担当が紙の台帳に記録します。", { exact: true })).toBeVisible();
    await capture(player, "player-hearing");
    await capture(host, "host-questions");
    await host.getByRole("button", { name: /ルームの成果物/ }).click();
    await expect(host.locator(".doc-editor")).toBeVisible();
    await capture(host, "host-deliverables");
    for (const page of [player, host]) {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await capture(page, page === player ? "player-mobile" : "host-mobile");
    }
    await player.setViewportSize({ width: 1280, height: 900 });
    await host.setViewportSize({ width: 1280, height: 900 });
    // Delay autosave to exercise pending edits and reconnection.
    await player.evaluate(() => {
      const original = window.setTimeout.bind(window);
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        original(handler, timeout === 400 ? 5000 : timeout, ...args)) as typeof window.setTimeout;
    });
    await player.locator(".tabs").getByRole("button", { name: "仕様書", exact: true }).click();
    const lastSection = player.locator(".doc-section-edit textarea").last();
    await player.getByRole("navigation", { name: "仕様書の項目へ移動" }).getByRole("button").last().click();
    await expect(lastSection).toBeFocused();
    await player.getByRole("navigation", { name: "仕様書の項目へ移動" }).getByRole("button").first().click();
    await player.locator(".doc-section-edit textarea").first().fill("自動保存を待っている最新の仕様");
    await expect(player.locator(".doc-export")).toHaveCount(0);
    await capture(player, "document-navigation");
    await expect(player.locator(".doc-section-edit").first().getByText(/✓ 保存済み/)).toBeVisible({ timeout: 10000 });
    await player.getByRole("navigation", { name: "仕様書の項目へ移動" }).getByRole("button").last().click();
    await player.locator(".doc-section-edit textarea").last().fill("切断前の未保存の仕様");
    await host.close();
    await expect(player.locator(".conn-badge")).toBeVisible({ timeout: 30000 });
    await expect(player.locator(".doc-section-edit textarea").last()).toHaveValue("切断前の未保存の仕様");
    await expect(player.getByRole("button", { name: "接続を確認して再保存" })).toBeDisabled();
    const restoredHost = await contexts[0].newPage();
    await restoredHost.goto(`${baseURL}/#host`);
    await expect(restoredHost.locator(".restore-notice")).toBeVisible({ timeout: 30000 });
    await expect(player.locator(".conn-badge")).toHaveCount(0, { timeout: 30000 });
    await player.getByRole("button", { name: "接続を確認して再保存" }).click();
    await expect(player.locator(".doc-section-edit").last().getByText(/✓ 保存済み/)).toBeVisible({ timeout: 10000 });
    await expect(other.locator(".conn-badge")).toHaveCount(0, { timeout: 30000 });
    await other.locator(".tabs").getByRole("button", { name: "仕様書", exact: true }).click();
    await expect(other.locator(".doc-section-edit textarea").last()).toHaveValue("切断前の未保存の仕様");
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("接続待ちを中止してルームコードを修正できる", async ({ page, baseURL }) => {
  await page.goto(baseURL!);
  await page.getByLabel("ルームコード").fill("ZZZZZZ");
  await page.getByLabel("あなたの名前").fill("確認用");
  await page.getByRole("button", { name: "参加する", exact: true }).click();
  await page.getByRole("button", { name: "接続を中止して入力し直す" }).click();
  await expect(page.getByLabel("ルームコード")).toBeEnabled();
  await page.getByLabel("ルームコード").fill("ABC234");
  await expect(page.getByRole("button", { name: "参加する", exact: true })).toBeEnabled();
});
