import { Header } from "@/components/layout/Header";
import { PanelLayout } from "@/components/layout/PanelLayout";
import { useWebSocket } from "@/hooks/useWebSocket";

function App() {
  useWebSocket();

  return (
    <>
      <Header />
      <PanelLayout />
    </>
  );
}

export default App
