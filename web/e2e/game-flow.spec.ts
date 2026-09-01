import { test, expect, type BrowserContext, type Page } from "@playwright/test";

test.describe("ゲームの主要ブラウザフロー", () => {
  test("参加から結果発表までhostとプレイヤーが同期して進む", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const hostContext = await browser.newContext();
    const playerOneContext = await browser.newContext();
    const playerTwoContext = await browser.newContext();
    const host = await hostContext.newPage();
    const playerOne = await playerOneContext.newPage();
    let playerTwo = await playerTwoContext.newPage();
    let playerTwoReconnectContext: BrowserContext | null = null;
    const slowNetwork = await playerOneContext.newCDPSession(playerOne);
    host.on("dialog", (dialog) => void dialog.accept());
    // このE2EはAIなしの手動進行が成立することも検証する。
    await host.addInitScript(() => {
      localStorage.setItem(
        "reqgame_ai",
        JSON.stringify({ provider: "api", apiKey: "", remember: true }),
      );
    });

    try {
      await host.goto(`${baseURL}/#host`);
      await expect(host.locator(".room-code-chip")).toBeVisible({ timeout: 30_000 });
      const roomCode = (await host.locator(".room-code-chip").innerText()).replace(/[^A-Z0-9]/g, "");
      expect(roomCode).toHaveLength(6);

      await slowNetwork.send("Network.enable");
      await slowNetwork.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 300,
        downloadThroughput: 64 * 1024,
        uploadThroughput: 32 * 1024,
        connectionType: "cellular3g",
      });
      await Promise.all([
        joinAs(playerOne, roomCode, "プレイヤー1", baseURL),
        joinAs(playerTwo, roomCode, "プレイヤー2", baseURL),
      ]);
      await slowNetwork.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
        connectionType: "wifi",
      });
      await expect(host.locator(".player-tag")).toHaveCount(2, { timeout: 30_000 });
      const playerTwoStorage = await playerTwoContext.storageState();
      await playerTwoContext.close();
      await expect(host.locator(".player-tag.offline")).toContainText("プレイヤー2", { timeout: 30_000 });
      playerTwoReconnectContext = await browser.newContext({ storageState: playerTwoStorage });
      playerTwo = await playerTwoReconnectContext.newPage();
      await playerTwo.goto(`${baseURL}/#${roomCode}`);
      await expect(playerTwo.locator(".phase-banner h2")).toHaveText("ロビー", { timeout: 30_000 });
      await expect(host.locator(".player-tag.offline")).toHaveCount(0, { timeout: 30_000 });

      const selectedScenario = host.locator("button.scenario-item").first();
      const selectedScenarioId = await selectedScenario.getAttribute("data-scenario-id");
      expect(selectedScenarioId).toBeTruthy();
      await selectedScenario.click();
      await host.getByRole("button", { name: /ゲーム開始/ }).click();
      await expect(host.locator(".step.step-active .step-label")).toHaveText("ブリーフィング");
      await expect(playerOne.locator(".phase-banner h2")).toHaveText("ブリーフィング");
      await expect(playerOne.getByRole("heading", { name: "このフェーズの進め方" })).toBeVisible();
      await expect(playerOne.getByText("自分のロール・公開プロフィール・秘密情報を読む")).toBeVisible();
      await expect(playerOne.getByRole("button", { name: "🎭 あなたのロール" })).toBeVisible();

      await host.getByRole("button", { name: /次のフェーズへ/ }).click();
      await expect(host.locator(".step.step-active .step-label")).toHaveText("ヒアリング・議論");
      await expect(playerOne.locator(".phase-banner h2")).toHaveText("ヒアリング・議論");
      const eventIdeas = host.locator("details.ideas");
      await eventIdeas.locator("summary").click();
      await expect(eventIdeas).toContainText("発生条件:");
      await expect(eventIdeas).toContainText("狙い:");
      await expect(eventIdeas).toContainText("難易度:");

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
      const firstDocSection = playerOne.locator(".doc-section-edit").first();
      const firstDocField = firstDocSection.locator("textarea");
      const firstDocTitle = (await firstDocSection.locator("h4").innerText()).trim();
      await expect(firstDocTitle).toMatch(/^\d+\./);
      await expect(firstDocField).toHaveAccessibleName(firstDocTitle);
      await playerTwo.locator(".tabs").getByRole("button", { name: /📄 仕様書/ }).click();
      const secondDocSection = playerTwo.locator(".doc-section-edit").first();
      await expect(secondDocSection).toBeVisible();
      await firstDocField.fill("プレイヤー1の下書き");
      await secondDocSection.locator("textarea").fill("プレイヤー2の保存内容");
      await expect(secondDocSection.getByText(/✓ 保存済み/)).toBeVisible({ timeout: 5_000 });
      await expect(playerOne.getByRole("alert")).toContainText("同時編集を検知しました");
      await playerOne.getByRole("button", { name: "サーバー内容を採用" }).click();
      await expect(playerOne.getByRole("alert")).toHaveCount(0);
      await firstDocField.fill("ブラウザE2Eで保存状態を確認");
      await expect(firstDocSection.getByText(/✓ 保存済み/)).toBeVisible({ timeout: 5_000 });
      const downloadPromise = playerOne.waitForEvent("download");
      await playerOne.getByRole("button", { name: "Markdownを保存" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`requirements-${selectedScenarioId}.md`);
      await playerOne.emulateMedia({ media: "print" });
      await expect(playerOne.locator(".doc-editor")).toBeVisible();
      await expect(playerOne.locator(".topbar")).toBeHidden();
      await expect(playerOne.locator(".phase-guide")).toBeHidden();
      await playerOne.emulateMedia({ media: "screen" });
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
      await expect(host.getByText("判断材料として残った記録")).toBeVisible();
      await expect(host.getByText("プレイヤー1: 質問 0件 / 要求カード 1件(採用 1件)")).toBeVisible();

      await host.reload();
      await expect(host.locator(".restore-notice")).toBeVisible({ timeout: 30_000 });
      await expect(host.locator(".restore-notice")).toContainText("結果発表");
    } finally {
      await closeContext(hostContext);
      await closeContext(playerOneContext);
      await closeContext(playerTwoContext);
      if (playerTwoReconnectContext) await closeContext(playerTwoReconnectContext);
    }
  });

  test("hostはCodexブリッジの接続状態を画面で確認できる", async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    const host = await context.newPage();
    let bridgeOnline = false;
    await host.route("http://127.0.0.1:8787/healthz", (route) =>
      route.fulfill({
        status: bridgeOnline ? 200 : 503,
        contentType: "application/json",
        body: bridgeOnline
          ? JSON.stringify({ ok: true, service: "reqgame-codex-bridge" })
          : JSON.stringify({ ok: false, service: "reqgame-codex-bridge" }),
      }),
    );

    try {
      await host.goto(`${baseURL}/#host`);
      await expect(host.locator(".room-code-chip")).toBeVisible({ timeout: 30_000 });
      await host.getByRole("button", { name: "接続設定" }).click();
      await host.getByRole("button", { name: "接続確認" }).click();
      await expect(host.getByText("⚠ Codexブリッジの応答が異常です(503)")).toBeVisible();
      bridgeOnline = true;
      await host.getByRole("button", { name: "接続確認" }).click();
      await expect(host.getByText("✓ Codexブリッジに接続できます")).toBeVisible();
    } finally {
      await closeContext(context);
    }
  });

  test("hostはタイマーの状態と時間切れ後の延長導線を確認できる", async ({ browser, baseURL }) => {
    const context = await browser.newContext();
    const host = await context.newPage();

    try {
      await host.goto(`${baseURL}/#host`);
      await expect(host.locator(".room-code-chip")).toBeVisible({ timeout: 30_000 });
      await expect(host.getByText("推奨 10分")).toBeVisible();

      // 実時間を待たず、HTMLのmin属性に依存しない極小値で時間切れ状態を作る。
      await host.getByLabel("タイマーの設定時間(分)").fill("0.016");
      await host.getByRole("button", { name: "設定時間で開始" }).click();
      await expect(host.getByRole("button", { name: "⏸ 一時停止" })).toBeVisible();
      await expect(host.getByText("⏰ タイムアップ")).toBeVisible({ timeout: 5_000 });
      await expect(host.getByText("時間切れ: 延長または次へ")).toBeVisible();

      await host.getByRole("button", { name: "＋5分延長" }).click();
      await expect(host.getByRole("button", { name: "⏸ 一時停止" })).toBeVisible();
    } finally {
      await closeContext(context);
    }
  });

  test("hostはCodexの失敗後に手動採点へ切り替えられる", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const hostContext = await browser.newContext();
    const playerContexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const host = await hostContext.newPage();
    const players = await Promise.all(playerContexts.map((context) => context.newPage()));
    host.on("dialog", (dialog) => void dialog.accept());
    await host.addInitScript(() => {
      localStorage.setItem(
        "reqgame_ai",
        JSON.stringify({
          provider: "codex",
          apiKey: "",
          baseUrl: "",
          model: "",
          codexBridgeUrl: "http://127.0.0.1:8787",
          remember: true,
        }),
      );
    });
    await host.route("http://127.0.0.1:8787/run", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "bridge unavailable" }),
      }),
    );

    try {
      await host.goto(`${baseURL}/#host`);
      await expect(host.locator(".room-code-chip")).toBeVisible({ timeout: 30_000 });
      const roomCode = (await host.locator(".room-code-chip").innerText()).replace(/[^A-Z0-9]/g, "");
      await Promise.all(players.map((player, index) => joinAs(player, roomCode, `手動採点プレイヤー${index + 1}`, baseURL)));
      await expect(host.locator(".player-tag")).toHaveCount(2, { timeout: 30_000 });

      await host.locator("button.scenario-item").first().click();
      await host.getByRole("button", { name: /ゲーム開始/ }).click();
      for (const phase of ["ヒアリング・議論", "合意形成(投票)", "要件定義書の仕上げ", "結果発表"]) {
        await host.getByRole("button", { name: /次のフェーズへ/ }).click();
        await expect(host.locator(".step.step-active .step-label")).toHaveText(phase);
      }

      await host.getByRole("button", { name: /AI採点を実行/ }).click();
      await expect(host.getByText(/Codex実行エラー 503/)).toBeVisible();
      await expect(host.getByRole("button", { name: /再試行/ })).toBeVisible();
      await host.getByLabel("AIの回答(JSON)").fill(
        JSON.stringify({ teamScore: 50, axes: [], players: [], overallComment: "手動採点", improvement: "" }),
      );
      await host.getByRole("button", { name: "回答を反映する" }).click();
      await expect(host.getByText("✓ 反映しました")).toBeVisible();
      await expect(host.locator(".ai-status-manual-done")).toHaveText("手動対応済み");
    } finally {
      await closeContext(hostContext);
      await Promise.all(playerContexts.map(closeContext));
    }
  });

  test("複数ルームの結果発表で進め方を比較できる", async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const hostContext = await browser.newContext();
    const playerContexts = await Promise.all(Array.from({ length: 5 }, () => browser.newContext()));
    const host = await hostContext.newPage();
    const players = await Promise.all(playerContexts.map((context) => context.newPage()));
    host.on("dialog", (dialog) => void dialog.accept());

    try {
      await host.goto(`${baseURL}/#host`);
      await expect(host.locator(".room-code-chip")).toBeVisible({ timeout: 30_000 });
      const roomCode = (await host.locator(".room-code-chip").innerText()).replace(/[^A-Z0-9]/g, "");
      await Promise.all(players.map((player, index) => joinAs(player, roomCode, `比較プレイヤー${index + 1}`, baseURL)));
      await expect(host.locator(".player-tag")).toHaveCount(5, { timeout: 30_000 });

      await host.locator("button.scenario-item").first().click();
      await host.getByRole("button", { name: /ゲーム開始/ }).click();
      for (const phase of ["ヒアリング・議論", "合意形成(投票)", "要件定義書の仕上げ", "結果発表"]) {
        await host.getByRole("button", { name: /次のフェーズへ/ }).click();
        await expect(host.locator(".step.step-active .step-label")).toHaveText(phase);
      }
      await expect(host.locator(".room-comparison")).toBeVisible();
      await expect(host.locator(".room-comparison-item")).toHaveCount(2);
      await expect(host.locator(".cockpit-room")).toHaveCount(2);
      const firstCockpitRoom = host.locator(".cockpit-room").first();
      const firstRoomName = await firstCockpitRoom.locator("strong").innerText();
      const cockpitShownAt = Date.now();
      await firstCockpitRoom.click();
      await expect(host.locator(".room-tab-active")).toContainText(firstRoomName);
      await expect(host.locator(".host-selected-room")).toContainText(`対象: ${firstRoomName}`);
      expect(Date.now() - cockpitShownAt).toBeLessThan(5_000);
    } finally {
      await closeContext(hostContext);
      await Promise.all(playerContexts.map(closeContext));
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
