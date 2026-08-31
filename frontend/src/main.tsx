import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";

import App from "./App";
import Properties from "./pages/Properties";
import Tracker from "./pages/Tracker";
import PropertyDetail from "./pages/PropertyDetail";
import PropertyForm from "./pages/PropertyForm";
import Tuning from "./pages/Tuning";
import Cities from "./pages/Cities";
import Compare from "./pages/Compare";
import "./styles.css";

// Hash routing keeps deep links working on static hosts such as GitHub Pages.
const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Properties /> },
      { path: "add", element: <PropertyForm /> },
      { path: "property/:id", element: <PropertyDetail /> },
      { path: "property/:id/edit", element: <PropertyForm /> },
      { path: "tracker", element: <Tracker /> },
      { path: "cities", element: <Cities /> },
      { path: "tuning", element: <Tuning /> },
      { path: "compare", element: <Compare /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
