import { useGame } from "./useGame";
import PlayerApp from "./PlayerApp";
import HostApp from "./HostApp";

export default function App() {
  const conn = useGame();
  const isHostRoute = location.pathname.startsWith("/host");
  return isHostRoute ? <HostApp conn={conn} /> : <PlayerApp conn={conn} />;
}
