import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT || 5180);
if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
  throw new Error("PLAYWRIGHT_PORT は1024〜65535の整数で指定してください");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: {
      // 同一マシン上のhost/player間でWebRTCのローカル候補を解決しやすくする。
      args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
    },
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    // 本番Pagesと同じ参加リンク生成をローカルE2Eでも検証する。
    env: {
      VITE_PUBLIC_GAME_URL: "https://sk0ya.github.io/Undefined/",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
