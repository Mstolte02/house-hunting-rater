import { NavLink, Outlet } from "react-router-dom";

export default function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          House Hunt<span>Mark &amp; Rachel</span>
        </div>
        <nav className="nav">
          <NavLink to="/" end>Properties</NavLink>
          <NavLink to="/add">Add</NavLink>
          <NavLink to="/compare">Compare</NavLink>
          <NavLink to="/tuning">Tuning</NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
