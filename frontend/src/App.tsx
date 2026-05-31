import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import InterviewAnalyzer from "./pages/InterviewAnalyzer";

export default function App() {
  return (
    <Routes>
      <Route
        path="/interview"
        element={
          <AppLayout>
            <InterviewAnalyzer />
          </AppLayout>
        }
      />
      <Route path="/" element={<Navigate to="/interview" replace />} />
      <Route path="*" element={<Navigate to="/interview" replace />} />
    </Routes>
  );
}
