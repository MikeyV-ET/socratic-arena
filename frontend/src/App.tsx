import { PanelLayout } from "@/components/layout/PanelLayout";
import { PopoutPanel } from "@/components/workbench/PopoutPanel";
import { useWebSocket } from "@/hooks/useWebSocket";

function App() {
  useWebSocket();

  const params = new URLSearchParams(window.location.search);
  const popoutPanel = params.get("panel");
  const popoutType = params.get("type");

  if (popoutPanel && popoutType) {
    return <PopoutPanel instanceId={popoutPanel} type={popoutType} config={JSON.parse(params.get("config") || "{}")} />;
  }

  return <PanelLayout />;
}

export default App
