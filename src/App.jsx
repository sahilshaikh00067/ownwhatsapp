import { Routes, Route, Navigate } from "react-router-dom";

import Login from "./components/Login";
import Header from "./components/Header";
import Dashboard from "./components/Dashboard";
import AdminRoute from "./components/category/AdminRoute";

import WappCampaign from "./components/category/WappCampaign";

// 🔥 NEW: Report hub (5 boxes) + Campaign Activity report
// (purani WappReports.jsx ki ab zarurat nahi, uska logic WappCampaignActivity.jsx me hai)
import WappReportHub from "./components/category/WappReportHub";
import WappCampaignActivity from "./components/category/WappCampaignActivity";

import AddUser from "./components/AddUser";
import ManageUser from "./components/ManageUser";
import Logout from "./components/Logout";

import PageNotFound from "./components/PageNotFound";
import WhatsappScan from "./components/WhatsappScan";

// 🔥 NEW: Config hub (Channel & Templates + Contact Manager) — DP Campaign ki jagah
import WappConfigHub from "./components/category/WappConfigHub";

// 🔥 NEW: Automation hub (Chatbot, Flows, QR Codes, Widget + Email Provider) — Credit History ki jagah
import WappAutomationHub from "./components/category/WappAutomationHub";

// 🔥 NEW: Catalog hub (Manage Catalog + Catalog Activity) — Change Password ki jagah
import WappCatalogHub from "./components/category/WappCatalogHub";

// 🔥 NEW: Agent hub (Live Agents, History, Agent List, Chat Config, Agent Campaign) — WA Scan ki jagah
import WappAgentHub from "./components/category/WappAgentHub";

// 🔥 NEW: Payment page (Configurations + Transactions) — Credit Manage ki jagah
import WappPayment from "./components/category/WappPayment";

// 🔥 NEW: API Console (full page, RapiDoc) — sidebar "API" par khulta hai
import WappApiConsole from "./components/category/WappApiConsole";
import ProviderIntegrations from "./components/category/ProviderIntegrations";

// Products Home page (login ke baad yahi khulega)
import ProductsHome from "./components/Productshome";
// 🔥 Login ke baad pehle ProductsHome dikhao.
// Jab tak user ProductsHome nahi dekh leta, Header/Sidebar wale pages redirect ho jaayenge.
function HomeGate({ children }) {
  return sessionStorage.getItem("homeSeen") ? children : <Navigate to="/productshome" replace />;
}

// 🔥 Role check har baar render par sessionStorage se hota hai
// (pehle `user` App ke upar ek baar padha jaata tha, login ke baad reload tak purana null rehta tha)
function RoleGate({ allow, children }) {
  let role = "";
  try {
    role = (JSON.parse(sessionStorage.getItem("user"))?.role || sessionStorage.getItem("role") || "").toLowerCase();
  } catch {
    role = (sessionStorage.getItem("role") || "").toLowerCase();
  }
  return allow(role) ? children : <Navigate to="/dashboard" replace />;
}
const isAdmin = (r) => r === "admin";
const notUser = (r) => r !== "user";

function App() {

  return (
    <Routes>

      {/* DEFAULT */}
      <Route path="/" element={<Navigate to="/login" />} />

      {/* PUBLIC */}
      <Route path="/login" element={<Login />} />

      {/* PROTECTED */}
      <Route element={<AdminRoute />}>

        {/* PRODUCTS HOME (bina sidebar/header layout ke) */}
        <Route path="/productshome" element={<ProductsHome />} />

        {/* 🔥 API CONSOLE — poora page (sidebar/header ke bina), jaisa original console */}
        <Route path="/wappapi" element={<WappApiConsole />} />
          <Route path="/provider-integrations" element={<RoleGate allow={isAdmin}><ProviderIntegrations /></RoleGate>} />

        {/* HEADER + SIDEBAR LAYOUT */}
        <Route element={<HomeGate><Header /></HomeGate>}>

          <Route path="/dashboard" element={<Dashboard />} />

          {/* ALL USERS */}
          <Route path="/wappcampaign" element={<WappCampaign />} />
          {/* 🔥 CONFIG (pehle yahan DP Campaign tha) */}
          <Route path="/wappconfig" element={<WappConfigHub />} />

          {/* 🔥 REPORTS: pehle hub (5 boxes), phir Campaign Activity */}
          <Route path="/wappreports" element={<WappReportHub />} />
          <Route path="/wappreports/campaignactivity" element={<WappCampaignActivity />} />

          {/* 🔥 AUTOMATION (pehle yahan Credit History tha) */}
          <Route path="/wappautomation" element={<WappAutomationHub />} />

          {/* 🔥 CATALOG (pehle yahan Change Password tha) */}
          <Route path="/wappcatalog" element={<WappCatalogHub />} />
          <Route path="/logout" element={<Logout />} />

          {/* 🔥 AGENT (pehle yahan WA Scan tha) — ADMIN ONLY */}
          <Route path="/wappagent" element={<RoleGate allow={isAdmin}><WappAgentHub /></RoleGate>} />
          {/* 1st box "Live Agents" -> ye QR scan wala page */}
          <Route path="/wappagent/scan" element={<RoleGate allow={isAdmin}><WhatsappScan /></RoleGate>} />
          {/* purana link /whatsappscan ab naye path par bhej deta hai */}
          <Route path="/whatsappscan" element={<Navigate to="/wappagent/scan" replace />} />

          {/* ADMIN + RESELLER */}
          <Route path="/adduser" element={<RoleGate allow={notUser}><AddUser /></RoleGate>} />
          <Route path="/manageuser" element={<RoleGate allow={notUser}><ManageUser /></RoleGate>} />
          {/* 🔥 PAYMENT (pehle yahan Credit Manage tha) */}
          <Route path="/wapppayment" element={<RoleGate allow={notUser}><WappPayment /></RoleGate>} />

        </Route>
      </Route>

      {/* 404 */}
      <Route path="*" element={<PageNotFound />} />

    </Routes>
  );
}

export default App;

