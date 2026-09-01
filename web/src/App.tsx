import { useEffect, useState } from "react";
import PlayerApp from "./PlayerApp";
import HostApp from "./HostApp";
import { parseRoute, savedName, savedPlayerRoomCode, useHostGame, usePlayerGame } from "./useGame";

/**
 * ルーティングはハッシュのみ。GitHub Pages はリポジトリ名のサブパス配下で
 * 配信され、未知のパスは404になるため、パスベースでは成立しない。
 *   #host      → ホストコンソール
 *   #ABC123    → そのルームへ参加
 */
export default function App() {
  const [route, setRoute] = useState(parseRoute);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ホストとプレイヤーでフックの構成が違うので、コンポーネントごと切り替える
  return route.isHost ? <HostRoot /> : <PlayerRoot initialCode={route.roomCode} />;
}

function HostRoot() {
  const conn = useHostGame();
  return <HostApp conn={conn} />;
}

function PlayerRoot({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode);
  const [pendingName, setPendingName] = useState<string | null>(() => {
    if (!initialCode || savedPlayerRoomCode() !== initialCode) return null;
    const name = savedName().trim();
    return name || null;
  });
  const conn = usePlayerGame(code);

  // 接続が開いてから参加を送る(コード入力と同時に押せるようにするため)
  useEffect(() => {
    if (pendingName && conn.status === "open" && !conn.joined) {
      conn.join({ name: pendingName });
    }
  }, [pendingName, conn.status, conn.joined, conn.join]);

  // ルームコードを変えたら参加待ちを解除する
  useEffect(() => {
    if (conn.joined) setPendingName(null);
  }, [conn.joined]);

  return (
    <PlayerApp
      conn={conn}
      roomCode={code}
      connecting={!!pendingName && !conn.joined}
      onSubmitJoin={(nextCode, name) => {
        if (nextCode !== code) setCode(nextCode);
        setPendingName(name);
      }}
    />
  );
}
