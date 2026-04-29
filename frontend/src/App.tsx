import { BrowserRouter, Route, Routes } from "react-router-dom";
import { WarRoomShell } from "./components/layout/war-room-shell";

function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WarRoomShell />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
