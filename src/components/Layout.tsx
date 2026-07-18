import { NavLink, Outlet } from "react-router-dom";

export function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink className="brand" to="/">
          <span aria-hidden="true" className="brand-mark">波</span>
          <span>
            <strong>Pronunciation Lab</strong>
            <small>Japanese shadowing workspace</small>
          </span>
        </NavLink>
      </header>
      <main className="main-content">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <NavLink to="/" end>
          <span aria-hidden="true">▤</span>
          Library
        </NavLink>
        <NavLink to="/settings">
          <span aria-hidden="true">⚙</span>
          Storage
        </NavLink>
        <NavLink to="/help">
          <span aria-hidden="true">?</span>
          Help
        </NavLink>
      </nav>
    </div>
  );
}

export function EmptyState({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="empty-state">
      <span className="empty-icon" aria-hidden="true">音</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

export function ErrorNotice({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="notice error" role="alert">{message}</p>;
}
