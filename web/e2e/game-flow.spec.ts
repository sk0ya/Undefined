import { test, expect, type BrowserContext, type Page } from "@playwright/test";

test.describe("ゲームの主要ブラウザフロー", () => {
  test("参加から結果発表までhostとプレイヤーが同期して進む", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const hostContext = await browser.newContext();
    const playerOneContext = await browser.newContext();
    const playerTwoContext = await browser.newContext();
    const host = await hostContext.newPage();
    const playerOne = await playerOneContext.newPage();
    const playerTwo = await playerTwoContext.newPage();
    host.on("dialog", (dialog) => void dialog.accept());

    try {
      await host.goto(`${baseURL}/#host`);
      await expect(host.locator(".room-code-chip")).toBeVisible({ timeout: 30_000 });
      const roomCode = (await host.locator(".room-code-chip").innerText()).replace(/[^A-Z0-9]/g, "");
      expect(roomCode).toHaveLength(6);

      await Promise.all([
        joinAs(playerOne, roomCode, "プレイヤー1", baseURL),
        joinAs(playerTwo, roomCode, "プレイヤー2", baseURL),
      ]);
      await expect(host.locator(".player-tag")).toHaveCount(2, { timeout: 30_000 });

      await host.locator("button.scenario-item").first().click();
      await host.getByRole("button", { name: /ゲーム開始/ }).click();
      await expect(host.locator(".step.step-active .step-label")).toHaveText("ブリーフィング");
      await expect(playerOne.locator(".phase-banner h2")).toHaveText("ブリーフィング");

      await host.getByRole("button", { name: /次のフェーズへ/ }).click();
      await expect(host.locator(".step.step-active .step-label")).toHaveText("ヒアリング・議論");
      await expect(playerOne.locator(".phase-banner h2")).toHaveText("ヒアリング・議論");

      await playerOne.setViewportSize({ width: 390, height: 844 });
      await expect(playerOne.locator(".discussion-action-hub")).toBeVisible();
      expect(
        await playerOne.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
      await playerTwo.reload();
      await expect(playerTwo.locator(".phase-banner h2")).toHaveText("ヒアリング・議論", { timeout: 30_000 });
      await playerOne
        .locator(".discussion-action-hub")
        .getByRole("button", { name: /📝 要求カード/ })
        .click();
      await playerOne.getByPlaceholder(/要求のタイトル/).fill("ブラウザE2Eの要求");
      await playerOne.getByRole("button", { name: "提出する" }).click();
      await expect(playerOne.getByText("ブラウザE2Eの要求")).toBeVisible();
      await expect(playerOne.getByRole("button", { name: /📝 要求カード.*自分の提出 1/ })).toBeVisible();

      await playerTwo.getByPlaceholder(/要求のタイトル/).fill("他メンバーからの要求");
      await playerTwo.getByRole("button", { name: "提出する" }).click();
      await expect(playerOne.getByText("他メンバーからの要求")).toBeVisible();
      await expect(playerOne.getByRole("button", { name: /📝 要求カード.*新着 1.*自分の提出 1/ })).toBeVisible();
      await playerOne.locator(".tabs").getByRole("button", { name: /📄 仕様書/ }).click();
      await expect(playerOne.getByRole("button", { name: "要件定義書を印刷" })).toBeVisible();
      await playerOne
        .locator(".discussion-action-hub")
        .getByRole("button", { name: /📝 要求カード/ })
        .click();

      await host.getByRole("button", { name: /次のフェーズへ/ }).click();
      await expect(playerOne.locator(".phase-banner h2")).toHaveText("合意形成(投票)");
      await expect(playerTwo.locator(".phase-banner h2")).toHaveText("合意形成(投票)");

      for (const player of [playerOne, playerTwo]) {
        await player.getByRole("button", { name: /🗳 投票/ }).click();
        const approveButtons = player.getByRole("button", { name: "👍 採用に賛成" });
        await approveButtons.nth(0).click();
        await approveButtons.nth(1).click();
      }

      await host.getByRole("button", { name: /次のフェーズへ/ }).click();
      await expect(playerOne.locator(".phase-banner h2")).toHaveText("要件定義書の仕上げ");

      await host.getByRole("button", { name: /次のフェーズへ/ }).click();
      await expect(host.locator(".step.step-active .step-label")).toHaveText("結果発表");
      await expect(playerOne.locator(".phase-banner h2")).toHaveText("結果発表");
      await expect(playerTwo.locator(".phase-banner h2")).toHaveText("結果発表");

      await host.reload();
      await expect(host.locator(".restore-notice")).toBeVisible({ timeout: 30_000 });
      await expect(host.locator(".restore-notice")).toContainText("結果発表");
    } finally {
      await closeContext(hostContext);
      await closeContext(playerOneContext);
      await closeContext(playerTwoContext);
    }
  });
});

async function joinAs(page: Page, roomCode: string, name: string, baseURL?: string) {
  await page.goto(`${baseURL ?? "http://127.0.0.1:5173"}/#${roomCode}`);
  await expect(page.getByPlaceholder("あなたの名前(ニックネーム可)")).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("あなたの名前(ニックネーム可)").fill(name);
  await page.getByRole("button", { name: "参加する" }).click();
  await expect(page.locator(".phase-banner h2")).toHaveText("ロビー", { timeout: 30_000 });
}

async function closeContext(context: BrowserContext) {
  await context.close().catch(() => undefined);
}
