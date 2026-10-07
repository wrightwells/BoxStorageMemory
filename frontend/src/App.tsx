import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
const PhotoManagementView = lazy(() =>
  import("./components/PhotoManagementView").then((module) => ({
    default: module.PhotoManagementView,
  })),
);
const QrLabelView = lazy(() =>
  import("./components/ScanningViews").then((module) => ({
    default: module.QrLabelView,
  })),
);
const ScanView = lazy(() =>
  import("./components/ScanningViews").then((module) => ({
    default: module.ScanView,
  })),
);
const NfcManagementView = lazy(() =>
  import("./components/ScanningViews").then((module) => ({
    default: module.NfcManagementView,
  })),
);
import { Layout } from "./components/Layout";
import { StorageProvider } from "./components/StorageProvider";
import type { StorageSession } from "./services/session";
import {
  HomePage,
  LoginPage,
  LibraryPage,
  SearchPage,
  BoxPage,
  EditBoxPage,
  CreateBoxPage,
  ItemPage,
  SettingsPage,
  NotFoundPage,
} from "./pages/Pages";

export function AppRoutes({
  session,
  dataRouter = false,
}: { session?: StorageSession; dataRouter?: boolean } = {}) {
  return (
    <StorageProvider session={session}>
      <Routes>
        <Route element={<Layout dataRouter={dataRouter} />}>
          <Route index element={<HomePage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="library/new" element={<CreateBoxPage />} />
          <Route path="scan" element={<ScanView />} />
          <Route path="box/:boxId/label" element={<QrLabelView />} />
          <Route path="box/:boxId/tags" element={<NfcManagementView />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="box/:boxId" element={<BoxPage />} />
          <Route path="box/:boxId/edit" element={<EditBoxPage />} />
          <Route path="box/:boxId/item/:itemId" element={<ItemPage />} />
          <Route
            path="box/:boxId/item/:itemId/photos"
            element={<PhotoManagementView />}
          />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </StorageProvider>
  );
}
