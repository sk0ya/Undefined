import { test, expect } from "@playwright/test";

test("再読み込み後に下書きを復元し、質問を絞り込み、仕様書の競合を解決できる", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [host, player, other] = await Promise.all(contexts.map((context) => context.newPage()));
  const errors: string[] = [];
  for (const page of [host, player, other]) page.on("pageerror", (e) => errors.push(e.message));
  host.on("dialog", (dialog) => void dialog.accept());
  await host.addInitScript(() => localStorage.setItem("reqgame_ai", JSON.stringify({ provider: "api", apiKey: "", remember: true })));
  try {
    await host.goto(`${baseURL}/#host`);
    await expect(host.locator(".room-code-chip")).toBeVisible({ timeout: 30000 });
    const code = (await host.locator(".room-code-chip").innerText()).replace(/[^A-Z0-9]/g, "");
    for (const [page, name] of [[player, "あき"], [other, "うみ"]] as const) {
      await page.goto(baseURL!);
      await page.getByLabel("ルームコード").fill(code);
      await page.getByLabel("あなたの名前").fill(name);
      await page.getByRole("button", { name: "参加する", exact: true }).click();
      await expect(page.getByText("ゲーム開始を待っています")).toBeVisible({ timeout: 30000 });
      await expect(page).toHaveURL(new RegExp(`#${code}$`));
    }
    await host.locator('[data-scenario-id="restaurant"]').click();
    await host.getByRole("button", { name: /ゲーム開始/ }).click();
    await player.locator(".tabs").getByRole("button", { name: "質問", exact: true }).click();
    await player.locator(".npc-picker").getByRole("button", { name: /常連客/ }).click();
    await player.getByLabel("NPCへの質問").fill("電話で予約したい理由は何ですか？");
    await player.reload();
    await player.locator(".tabs").getByRole("button", { name: "質問", exact: true }).click();
    await expect(player.locator(".npc-chip-on")).toContainText("常連客");
    await expect(player.getByLabel("NPCへの質問")).toHaveValue("電話で予約したい理由は何ですか？");
    await player.getByRole("button", { name: "質問する", exact: true }).click();
    await expect(host.getByLabel("常連客としての回答")).toBeVisible();
    await host.getByLabel("常連客としての回答").fill("ネットより電話の方が相談しやすいです。");
    await host.getByRole("searchbox", { name: "質問キューを検索" }).fill("存在しない質問");
    await expect(host.locator(".queue-item")).toHaveCount(0);
    await host.getByRole("button", { name: "絞り込みを解除" }).click();
    await expect(host.getByLabel("常連客としての回答")).toHaveValue("ネットより電話の方が相談しやすいです。");
    await host.reload();
    await expect(host.getByLabel("常連客としての回答")).toHaveValue("ネットより電話の方が相談しやすいです。", { timeout: 30000 });
    await host.getByRole("button", { name: "回答を送る", exact: true }).click();
    await expect(player.getByText("ネットより電話の方が相談しやすいです。", { exact: true })).toBeVisible({ timeout: 30000 });
    await player.getByLabel("NPCへの質問").fill("キャンセルしたいときはどうしていますか？");
    await player.getByRole("button", { name: "質問する", exact: true }).click();
    await expect(player.locator(".qa")).toHaveCount(2);
    await player.getByText("ヒアリング記録を検索・絞り込み", { exact: true }).click();
    await player.getByLabel("ヒアリング記録の絞り込み：回答状況").selectOption("回答待ち");
    await expect(player.locator(".qa")).toHaveCount(1);
    await expect(player.locator(".qa")).toContainText("キャンセル");
    await player.getByRole("button", { name: "絞り込みを解除" }).click();
    await player.getByRole("searchbox", { name: "ヒアリング記録を検索" }).fill("相談");
    await expect(player.locator(".qa")).toHaveCount(1);
    await expect(player.locator(".qa")).toContainText("電話の方");
    await player.locator(".tabs").getByRole("button", { name: "仕様書", exact: true }).click();
    await player.evaluate(() => {
      const original = window.setTimeout.bind(window);
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
        original(handler, timeout === 400 ? 10000 : timeout, ...args)) as typeof window.setTimeout;
    });
    await player.locator(".doc-section-edit textarea").first().fill("再読み込み前の未保存仕様");
    await player.reload();
    await expect(player.locator(".step-active")).toContainText("仕様書を作る", { timeout: 30000 });
    await player.locator(".tabs").getByRole("button", { name: "仕様書", exact: true }).click();
    await other.locator(".tabs").getByRole("button", { name: "仕様書", exact: true }).click();
    await other.locator(".doc-section-edit textarea").first().fill("別の参加者が保存した仕様");
    await expect(other.locator(".doc-save-saved")).toBeVisible();
    await expect(player.locator(".doc-section-edit textarea").first()).toHaveValue("再読み込み前の未保存仕様");
    await expect(player.getByRole("alert")).toContainText("同時編集を検知しました");
    await expect(player.getByRole("alert")).toContainText("別の参加者が保存した仕様");
    await player.getByRole("button", { name: "自分の下書きを再送" }).click();
    await expect(player.locator(".doc-save-saved")).toBeVisible();
    await expect(player.getByRole("alert")).toHaveCount(0);
    const dialogs: string[] = [];
    player.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.accept(); });
    await player.locator(".doc-section-edit textarea").first().fill("自分の仕様を続けて編集");
    await expect(player.locator(".doc-save-saved")).toBeVisible();
    expect(dialogs).toEqual([]);
    await player.reload();
    await expect(player.locator(".step-active")).toContainText("仕様書を作る", { timeout: 30000 });
    await player.locator(".tabs").getByRole("button", { name: "仕様書", exact: true }).click();
    await expect(player.locator(".doc-section-edit textarea").first()).toHaveValue("自分の仕様を続けて編集");
    await expect(player.getByText("未保存の仕様書を復元しました。内容を確認して再保存してください。")).toHaveCount(0);
    for (const [page, name] of [[player, "player-search"], [host, "host-search"]] as const) {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
    }
    await host.getByRole("button", { name: "リセット", exact: true }).click();
    await expect(player.getByText("ゲーム開始を待っています")).toBeVisible();
    await host.locator('[data-scenario-id="restaurant"]').click();
    await host.getByRole("button", { name: /ゲーム開始/ }).click();
    await player.locator(".tabs").getByRole("button", { name: "仕様書", exact: true }).click();
    await expect(player.locator(".doc-section-edit textarea").first()).toHaveValue("");
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});
