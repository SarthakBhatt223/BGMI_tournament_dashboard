import { Link, Navigate, Route, Routes } from 'react-router-dom';
import AdminPage from './routes/AdminPage.jsx';
import DisplayPage from './routes/DisplayPage.jsx';

function NotFoundPage() {
  return (
    <main className="plain-page">
      <h1>Page not found</h1>
      <p>
        Go to <Link to="/admin">/admin</Link> or <Link to="/display">/display</Link>.
      </p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/display" element={<DisplayPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
