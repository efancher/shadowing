import { lazy, Suspense } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";

const HelpPage = lazy(() => import("./pages/HelpPage").then((module) => ({ default: module.HelpPage })));
const LibraryPage = lazy(() =>
  import("./pages/LibraryPage").then((module) => ({ default: module.LibraryPage }))
);
const SentencePage = lazy(() =>
  import("./pages/SentencePage").then((module) => ({ default: module.SentencePage }))
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage }))
);
const SourcePage = lazy(() =>
  import("./pages/SourcePage").then((module) => ({ default: module.SourcePage }))
);

export default function App() {
  return (
    <HashRouter>
      <Suspense fallback={<p className="page muted" role="status">Loading…</p>}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<LibraryPage />} />
            <Route path="sources/:sourceId" element={<SourcePage />} />
            <Route path="sentences/:sentenceId" element={<SentencePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="help" element={<HelpPage />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
