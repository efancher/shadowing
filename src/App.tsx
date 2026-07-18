import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LibraryPage } from "./pages/LibraryPage";
import { SentencePage } from "./pages/SentencePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SourcePage } from "./pages/SourcePage";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<LibraryPage />} />
          <Route path="sources/:sourceId" element={<SourcePage />} />
          <Route path="sentences/:sentenceId" element={<SentencePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
