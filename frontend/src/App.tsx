import { PanelLayout } from "@/components/layout/PanelLayout";
import { useWebSocket } from "@/hooks/useWebSocket";

function App() {
  useWebSocket();

  return <PanelLayout />;
}

export default App
