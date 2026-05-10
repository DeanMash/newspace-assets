import { useMemo, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

async function apiFetch(path, token, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function App() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [summary, setSummary] = useState(null);
  const [balances, setBalances] = useState([]);
  const [period, setPeriod] = useState("daily");
  const [status, setStatus] = useState("Ready");
  const [timeline, setTimeline] = useState([]);
  const [payments, setPayments] = useState([]);
  const [clients, setClients] = useState([]);
  const [events, setEvents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [upcomingReminders, setUpcomingReminders] = useState([]);
  const [showPermissions, setShowPermissions] = useState(true);
  const [reminderLogs, setReminderLogs] = useState([]);
  const [logSearch, setLogSearch] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [showBalances, setShowBalances] = useState(true);
  const [showPayments, setShowPayments] = useState(true);
  const [balanceSearch, setBalanceSearch] = useState("");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [assignForm, setAssignForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    allowEmail: false,
    allowWhatsapp: false,
    code: "",
    title: "",
    assetType: "sale",
    location: "",
    assetCondition: "available",
    totalValue: "",
    initialPayment: "",
    completionDate: "",
    monthlyPlanAmount: "",
  });
  const [eventForm, setEventForm] = useState({
    title: "",
    details: "",
    startsAt: "",
    remindMinutesBefore: 60,
  });
  const [projectForm, setProjectForm] = useState({
    name: "",
    projectType: "town_planning",
    clientName: "",
    status: "active",
    budget: "",
    summary: "",
  });

  const isLoggedIn = useMemo(() => Boolean(token), [token]);

  async function login(e) {
    e.preventDefault();
    try {
      const data = await apiFetch("/api/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
      await loadDashboardWithToken(data.token);
      setStatus("Logged in - dashboard loaded");
    } catch (err) {
      setStatus(`Login failed: ${err.message}`);
    }
  }

  async function loadDashboardWithToken(authToken) {
    try {
      const s = await apiFetch(`/api/reports/summary?period=${period}`, authToken);
      const b = await apiFetch("/api/balances", authToken);
      const t = await apiFetch(`/api/reports/timeline?period=${period}`, authToken);
      const p = await apiFetch("/api/payments", authToken);
      const c = await apiFetch("/api/clients", authToken);
      const e = await apiFetch("/api/events", authToken);
      const r = await apiFetch("/api/events/reminders/upcoming?minutes=240", authToken);
      const pr = await apiFetch("/api/projects", authToken);
      const logs = await apiFetch("/api/reminders/logs", authToken);
      setSummary(s);
      setBalances(b);
      setTimeline(t.rows || []);
      setPayments(p || []);
      setClients(c || []);
      setEvents(e || []);
      setUpcomingReminders(r.events || []);
      setProjects(pr || []);
      setReminderLogs(logs || []);
      setStatus("Dashboard refreshed");
    } catch (err) {
      setStatus(`Load failed: ${err.message}`);
    }
  }

  async function loadDashboard() {
    if (!token) return;
    await loadDashboardWithToken(token);
  }

  function applySearch() {
    const v = searchText.trim().toLowerCase();
    setSearchApplied(v);
    setBalanceSearch(v);
    setPaymentSearch(v);
    setStatus("Search applied");
  }

  const filteredBalances = useMemo(() => {
    const effective = (balanceSearch || searchApplied || "").trim().toLowerCase();
    if (!effective) return balances;
    return balances.filter((b) => {
      const client = String(b.client_name || "").toLowerCase();
      const asset = String(b.asset_title || "").toLowerCase();
      const due = String(b.completion_date || "").toLowerCase();
      return client.includes(effective) || asset.includes(effective) || due.includes(effective);
    });
  }, [balances, searchApplied, balanceSearch]);

  const filteredPayments = useMemo(() => {
    const effective = (paymentSearch || searchApplied || "").trim().toLowerCase();
    if (!effective) return payments;
    return payments.filter((p) => {
      const client = String(p.client_name || "").toLowerCase();
      const asset = String(p.asset_title || "").toLowerCase();
      const date = String(p.payment_date || "").toLowerCase();
      const amount = String(p.amount || "").toLowerCase();
      return (
        client.includes(effective) ||
        asset.includes(effective) ||
        date.includes(effective) ||
        amount.includes(effective)
      );
    });
  }, [payments, paymentSearch]);

  const filteredReminderLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    if (!q) return reminderLogs;
    return reminderLogs.filter((l) => {
      const client = String(l.client_name || "").toLowerCase();
      const channel = String(l.channel || "").toLowerCase();
      const stamp = String(l.sent_at || "").toLowerCase();
      const msg = String(l.message || "").toLowerCase();
      return client.includes(q) || channel.includes(q) || stamp.includes(q) || msg.includes(q);
    });
  }, [reminderLogs, logSearch]);

  async function createAssignment(e) {
    e.preventDefault();
    try {
      const client = await apiFetch("/api/clients", token, {
        method: "POST",
        body: JSON.stringify({
          fullName: assignForm.fullName,
          phone: assignForm.phone,
          email: assignForm.email,
          allowEmail: assignForm.allowEmail,
          allowWhatsapp: assignForm.allowWhatsapp,
        }),
      });

      const asset = await apiFetch("/api/assets", token, {
        method: "POST",
        body: JSON.stringify({
          code: assignForm.code,
          title: assignForm.title,
          assetType: assignForm.assetType,
          location: assignForm.location,
          status: assignForm.assetCondition,
          totalValue: Number(assignForm.totalValue || 0),
        }),
      });

      const allocation = await apiFetch("/api/allocations", token, {
        method: "POST",
        body: JSON.stringify({
          clientId: client.id,
          assetId: asset.id,
          completionDate: assignForm.completionDate || undefined,
          initialDepositAmount: Number(assignForm.initialPayment || 0),
          monthlyExpectedAmount: assignForm.monthlyPlanAmount
            ? Number(assignForm.monthlyPlanAmount)
            : undefined,
          notes: `Asset condition: ${assignForm.assetCondition}`,
        }),
      });

      const initialPayment = Number(assignForm.initialPayment || 0);
      if (initialPayment > 0) {
        await apiFetch("/api/payments", token, {
          method: "POST",
          body: JSON.stringify({
            allocationId: allocation.id,
            amount: initialPayment,
            method: "cash",
            notes: "Initial payment",
          }),
        });
      }

      setAssignForm({
        fullName: "",
        phone: "",
        email: "",
        allowEmail: false,
        allowWhatsapp: false,
        code: "",
        title: "",
        assetType: "sale",
        location: "",
        assetCondition: "available",
        totalValue: "",
        initialPayment: "",
        completionDate: "",
        monthlyPlanAmount: "",
      });
      setShowAssignPanel(false);
      setStatus("Client, asset, and assignment saved");
      await loadDashboard();
    } catch (err) {
      setStatus(`Assign failed: ${err.message}`);
    }
  }

  async function makePayment(allocationId) {
    const amountText = window.prompt("Enter amount paid:");
    if (!amountText) return;
    const amount = Number(amountText);
    if (!amount || amount <= 0) {
      setStatus("Invalid amount entered");
      return;
    }
    try {
      await apiFetch("/api/payments", token, {
        method: "POST",
        body: JSON.stringify({
          allocationId,
          amount,
          method: "cash",
        }),
      });
      setStatus("Payment added successfully");
      await loadDashboard();
    } catch (err) {
      setStatus(`Payment failed: ${err.message}`);
    }
  }

  async function deleteClient(clientId) {
    if (!window.confirm("Delete this client? This will remove related assignments and payments.")) return;
    try {
      await apiFetch(`/api/clients/${clientId}`, token, { method: "DELETE" });
      setStatus("Client deleted");
      await loadDashboard();
    } catch (err) {
      setStatus(`Delete client failed: ${err.message}`);
    }
  }

  async function deleteAsset(assetId) {
    if (!window.confirm("Delete this asset? This will remove related assignments and payments.")) return;
    try {
      await apiFetch(`/api/assets/${assetId}`, token, { method: "DELETE" });
      setStatus("Asset deleted");
      await loadDashboard();
    } catch (err) {
      setStatus(`Delete asset failed: ${err.message}`);
    }
  }

  async function viewReceipt(paymentId) {
    try {
      const receipt = await apiFetch(`/api/payments/${paymentId}/receipt`, token);
      const data = receipt.payload_json;
      const logoUrl = `${window.location.origin}${data.company.logoPath}`;
      const html = `
        <html>
          <head>
            <title>Receipt ${data.receiptNumber}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
              .head { display:flex; align-items:center; gap:12px; border-bottom:1px solid #ddd; padding-bottom:10px; margin-bottom:16px; }
              .head img { width:64px; height:64px; object-fit:contain; }
              .muted { color:#475569; }
              .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; margin-top: 12px; }
              .actions { margin-top: 18px; }
              .actions button { margin-right: 8px; padding: 8px 12px; border: none; border-radius: 6px; cursor: pointer; background: #0b2b4a; color: #fff; }
            </style>
          </head>
          <body>
            <div class="head">
              <img src="${logoUrl}" alt="logo" />
              <div>
                <h2>${data.company.name}</h2>
                <div class="muted">${data.company.address}</div>
                <div class="muted">${data.company.phone} | ${data.company.email}</div>
              </div>
            </div>
            <h3>Payment Receipt: ${data.receiptNumber}</h3>
            <div class="grid">
              <div><strong>Client:</strong> ${data.payment.client_name}</div>
              <div><strong>Asset:</strong> ${data.payment.asset_title}</div>
              <div><strong>Amount:</strong> $${data.payment.amount}</div>
              <div><strong>Method:</strong> ${data.payment.method || "cash"}</div>
              <div><strong>Payment Date:</strong> ${data.payment.payment_date}</div>
              <div><strong>Timestamp:</strong> ${data.payment.created_at}</div>
              <div><strong>Reference:</strong> ${data.payment.reference || "-"}</div>
            </div>
            <div class="actions">
              <button onclick="window.print()">Print Receipt</button>
              <button onclick="window.print()">Download PDF</button>
            </div>
          </body>
        </html>
      `;
      const w = window.open("", "_blank");
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (err) {
      setStatus(`View receipt failed: ${err.message}`);
    }
  }

  async function editPayment(payment) {
    const amountText = window.prompt("Update payment amount:", payment.amount);
    if (!amountText) return;
    const amount = Number(amountText);
    if (!amount || amount <= 0) {
      setStatus("Invalid amount entered");
      return;
    }
    const method = window.prompt("Update payment method:", payment.method || "cash") || "cash";
    const reference = window.prompt("Update reference:", payment.reference || "") || "";
    const paymentDate = window.prompt("Update payment date (YYYY-MM-DD):", payment.payment_date) || payment.payment_date;

    try {
      await apiFetch(`/api/payments/${payment.id}`, token, {
        method: "PUT",
        body: JSON.stringify({
          amount,
          method,
          reference,
          paymentDate,
        }),
      });
      setStatus("Payment updated and receipt regenerated");
      await loadDashboard();
    } catch (err) {
      setStatus(`Update payment failed: ${err.message}`);
    }
  }

  async function downloadCsv() {
    try {
      const res = await fetch(`${API}/api/reports/export.csv?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `newspace-${period}-report.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("CSV report downloaded");
    } catch (err) {
      setStatus(`CSV download failed: ${err.message}`);
    }
  }

  async function sendClientMessage(clientId, channel) {
    const message = window.prompt(
      `Enter ${channel} message:`,
      "Hello from New Space Properties. Please contact us for your asset update."
    );
    if (!message) return;
    try {
      await apiFetch(`/api/notifications/client/${clientId}/send`, token, {
        method: "POST",
        body: JSON.stringify({ channel, message }),
      });
      setStatus(`${channel} message sent`);
    } catch (err) {
      if (channel === "email") {
        const client = clients.find((c) => c.id === clientId);
        if (client?.email) {
          window.open(
            `mailto:${encodeURIComponent(client.email)}?subject=${encodeURIComponent(
              "New Space Properties Update"
            )}&body=${encodeURIComponent(message)}`
          );
          setStatus("SMTP not ready. Opened your email app as fallback.");
          return;
        }
      }
      setStatus(`Message failed: ${err.message}`);
    }
  }

  async function updateConsent(clientId, allowEmail, allowWhatsapp) {
    try {
      await apiFetch(`/api/clients/${clientId}/consent`, token, {
        method: "PATCH",
        body: JSON.stringify({ allowEmail, allowWhatsapp }),
      });
      setStatus("Client permissions updated");
      await loadDashboard();
    } catch (err) {
      setStatus(`Update consent failed: ${err.message}`);
    }
  }

  async function addEvent(e) {
    e.preventDefault();
    try {
      await apiFetch("/api/events", token, {
        method: "POST",
        body: JSON.stringify({
          ...eventForm,
          startsAt: new Date(eventForm.startsAt).toISOString(),
          remindMinutesBefore: Number(eventForm.remindMinutesBefore || 60),
        }),
      });
      setEventForm({ title: "", details: "", startsAt: "", remindMinutesBefore: 60 });
      setStatus("Event created");
      await loadDashboard();
    } catch (err) {
      setStatus(`Event create failed: ${err.message}`);
    }
  }

  async function addProject(e) {
    e.preventDefault();
    try {
      await apiFetch("/api/projects", token, {
        method: "POST",
        body: JSON.stringify({
          ...projectForm,
          budget: Number(projectForm.budget || 0),
        }),
      });
      setProjectForm({
        name: "",
        projectType: "town_planning",
        clientName: "",
        status: "active",
        budget: "",
        summary: "",
      });
      setStatus("Project created");
      await loadDashboard();
    } catch (err) {
      setStatus(`Project create failed: ${err.message}`);
    }
  }

  async function runProjectAnalysis(projectId) {
    try {
      await apiFetch(`/api/projects/${projectId}/analysis`, token, { method: "POST" });
      setStatus("Critical analysis generated");
      await loadDashboard();
    } catch (err) {
      setStatus(`Analysis failed: ${err.message}`);
    }
  }

  return (
    <main className="app">
      <header className="app-header">
        <img
          src="/logo.jpeg"
          alt="New Space Properties logo"
          className="app-logo"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = "/logo.JPEG";
          }}
        />
        <h1>New Space Properties - Asset Management</h1>
      </header>

      {!isLoggedIn && (
        <section className="card">
          <h2>Director Login</h2>
          <form onSubmit={login} className="stack">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="director@email.com"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="password"
            />
            <button type="submit">Login</button>
          </form>
        </section>
      )}

      {isLoggedIn && (
        <>
          <section className="card row">
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
            <button onClick={loadDashboard}>Load Reports & Balances</button>
            <button onClick={downloadCsv}>Download CSV</button>
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search client or asset"
            />
            <button onClick={applySearch}>Search</button>
          </section>

          {summary && (
            <section className="card">
              <h2>{summary.period} Report</h2>
              <p>From: {summary.from}</p>
              <p>Collected: ${summary.collected}</p>
              <p>Outstanding: ${summary.outstanding}</p>
            </section>
          )}

          <section className="card">
            <div className="section-head">
              <h2>Client Asset Balances</h2>
              <div>
                <button onClick={() => setShowBalances((v) => !v)}>
                  {showBalances ? "Minimize" : "Open Balances"}
                </button>
                <button onClick={() => setShowAssignPanel((v) => !v)}>
                  {showAssignPanel ? "Close Add" : "Add Client Asset"}
                </button>
              </div>
            </div>

            {showAssignPanel && (
              <form onSubmit={createAssignment} className="assign-grid">
                <input
                  placeholder="Client name (e.g. T Chidindi)"
                  value={assignForm.fullName}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, fullName: e.target.value }))
                  }
                  required
                />
                <input
                  placeholder="Client phone"
                  value={assignForm.phone}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, phone: e.target.value }))
                  }
                />
                <input
                  placeholder="Client email"
                  value={assignForm.email}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, email: e.target.value }))
                  }
                />
                <input
                  placeholder="Asset code (e.g. MVTB-001)"
                  value={assignForm.code}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, code: e.target.value }))
                  }
                  required
                />
                <input
                  placeholder="Asset name (e.g. Masvingo Town Building)"
                  value={assignForm.title}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, title: e.target.value }))
                  }
                  required
                />
                <select
                  value={assignForm.assetType}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, assetType: e.target.value }))
                  }
                >
                  <option value="sale">Buying</option>
                  <option value="rental">Renting</option>
                </select>
                <input
                  placeholder="Asset location"
                  value={assignForm.location}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, location: e.target.value }))
                  }
                />
                <select
                  value={assignForm.assetCondition}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, assetCondition: e.target.value }))
                  }
                >
                  <option value="available">Available</option>
                  <option value="good">Good</option>
                  <option value="under_maintenance">Under Maintenance</option>
                  <option value="occupied">Occupied/Allocated</option>
                </select>
                <input
                  placeholder="Asset cost (e.g. 23000)"
                  value={assignForm.totalValue}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, totalValue: e.target.value }))
                  }
                  required
                />
                <input
                  placeholder="Payments made / initial paid (e.g. 3000)"
                  value={assignForm.initialPayment}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, initialPayment: e.target.value }))
                  }
                />
                <input
                  type="date"
                  value={assignForm.completionDate}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, completionDate: e.target.value }))
                  }
                  title="Payment completion date"
                />
                <input
                  placeholder="Monthly plan amount (optional, auto if blank)"
                  value={assignForm.monthlyPlanAmount}
                  onChange={(e) =>
                    setAssignForm((v) => ({ ...v, monthlyPlanAmount: e.target.value }))
                  }
                />
                <label>
                  <input
                    type="checkbox"
                    checked={assignForm.allowEmail}
                    onChange={(e) =>
                      setAssignForm((v) => ({ ...v, allowEmail: e.target.checked }))
                    }
                  />
                  Allow Email
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={assignForm.allowWhatsapp}
                    onChange={(e) =>
                      setAssignForm((v) => ({ ...v, allowWhatsapp: e.target.checked }))
                    }
                  />
                  Allow WhatsApp
                </label>
                <button type="submit">Save Assignment</button>
              </form>
            )}

            {showBalances && (
            <>
            <div className="row" style={{ marginBottom: "8px" }}>
              <input
                value={balanceSearch}
                onChange={(e) => setBalanceSearch(e.target.value)}
                placeholder="Filter balances by client, asset, or due date"
              />
            </div>
            <div className="table">
              <div className="th">Client</div>
              <div className="th">Asset</div>
              <div className="th">Type</div>
              <div className="th">Completion Date</div>
              <div className="th">Monthly Plan</div>
              <div className="th">Amount Paid</div>
              <div className="th">Outstanding</div>
              <div className="th">Actions</div>
              {filteredBalances.map((b) => (
                <div className="table-row" key={b.allocation_id}>
                  <div>{b.client_name}</div>
                  <div>{b.asset_title}</div>
                  <div>{b.asset_type}</div>
                  <div>{b.completion_date || "-"}</div>
                  <div>${b.monthly_expected_amount || 0}</div>
                  <div>${b.paid_amount}</div>
                  <div>${b.outstanding_balance}</div>
                  <div>
                    <button onClick={() => makePayment(b.allocation_id)}>
                      Make Payment
                    </button>
                    <button onClick={() => deleteClient(b.client_id)}>Delete Client</button>
                    <button onClick={() => deleteAsset(b.asset_id)}>Delete Asset</button>
                  </div>
                </div>
              ))}
            </div>
            </>
            )}
          </section>

          <section className="card">
            <h2>Collection Timeline ({period})</h2>
            {timeline.length === 0 ? (
              <p>No payments in this period yet.</p>
            ) : (
              <div className="table timeline">
                <div className="th">Period Bucket</div>
                <div className="th">Collected</div>
                {timeline.map((row) => (
                  <div className="table-row two-col" key={row.bucket}>
                    <div>{row.bucket}</div>
                    <div>${row.total}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Payment History (Date & Timestamp)</h2>
              <button onClick={() => setShowPayments((v) => !v)}>
                {showPayments ? "Minimize" : "Open Payments"}
              </button>
            </div>
            {showPayments && (
            <>
            <div className="row" style={{ marginBottom: "8px" }}>
              <input
                value={paymentSearch}
                onChange={(e) => setPaymentSearch(e.target.value)}
                placeholder="Filter payments by client, asset, date, or amount"
              />
            </div>
            <div className="table payments">
              <div className="th">Client</div>
              <div className="th">Asset</div>
              <div className="th">Amount</div>
              <div className="th">Payment Date</div>
              <div className="th">Timestamp</div>
              <div className="th">Actions</div>
              {filteredPayments.map((p) => (
                <div className="table-row payments-row" key={p.id}>
                  <div>{p.client_name}</div>
                  <div>{p.asset_title}</div>
                  <div>${p.amount}</div>
                  <div>{p.payment_date}</div>
                  <div>{p.created_at}</div>
                  <div>
                    <button onClick={() => editPayment(p)}>Edit Payment</button>
                    <button onClick={() => viewReceipt(p.id)}>View Receipt</button>
                  </div>
                </div>
              ))}
            </div>
            </>
            )}
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Client Contact Permissions</h2>
              <button onClick={() => setShowPermissions((v) => !v)}>
                {showPermissions ? "Minimize" : "Open Permissions"}
              </button>
            </div>
            {showPermissions && (
              <div className="table permissions">
                <div className="th">Client</div>
                <div className="th">Email Permission</div>
                <div className="th">WhatsApp Permission</div>
                <div className="th">Actions</div>
                {clients.map((c) => (
                  <div className="table-row permissions-row" key={c.id}>
                    <div>{c.full_name}</div>
                    <div>{c.allow_email ? "Allowed" : "Blocked"}</div>
                    <div>{c.allow_whatsapp ? "Allowed" : "Blocked"}</div>
                    <div>
                      <button onClick={() => updateConsent(c.id, !c.allow_email, c.allow_whatsapp)}>
                        Toggle Email
                      </button>
                      <button onClick={() => updateConsent(c.id, c.allow_email, !c.allow_whatsapp)}>
                        Toggle WhatsApp
                      </button>
                      <button onClick={() => sendClientMessage(c.id, "email")}>Send Email</button>
                      <button onClick={() => sendClientMessage(c.id, "whatsapp")}>Send WhatsApp</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <h2>Calendar Events & Notifications</h2>
            <form onSubmit={addEvent} className="assign-grid">
              <input
                placeholder="Event title"
                value={eventForm.title}
                onChange={(e) => setEventForm((v) => ({ ...v, title: e.target.value }))}
                required
              />
              <input
                placeholder="Details"
                value={eventForm.details}
                onChange={(e) => setEventForm((v) => ({ ...v, details: e.target.value }))}
              />
              <input
                type="datetime-local"
                value={eventForm.startsAt}
                onChange={(e) => setEventForm((v) => ({ ...v, startsAt: e.target.value }))}
                required
              />
              <input
                type="number"
                min="1"
                placeholder="Reminder minutes before"
                value={eventForm.remindMinutesBefore}
                onChange={(e) =>
                  setEventForm((v) => ({ ...v, remindMinutesBefore: e.target.value }))
                }
              />
              <button type="submit">Add Event</button>
            </form>
            <p><strong>Upcoming reminders (next 4 hours):</strong> {upcomingReminders.length}</p>
            <div className="table events">
              <div className="th">Event</div>
              <div className="th">Starts At</div>
              <div className="th">Reminder (mins)</div>
              <div className="th">Notified</div>
              {events.map((e) => (
                <div className="table-row events-row" key={e.id}>
                  <div>{e.title}</div>
                  <div>{e.starts_at}</div>
                  <div>{e.remind_minutes_before}</div>
                  <div>{e.is_notified ? "Yes" : "No"}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Projects & Critical Analysis</h2>
            <form onSubmit={addProject} className="assign-grid">
              <input
                placeholder="Project name"
                value={projectForm.name}
                onChange={(e) => setProjectForm((v) => ({ ...v, name: e.target.value }))}
                required
              />
              <select
                value={projectForm.projectType}
                onChange={(e) => setProjectForm((v) => ({ ...v, projectType: e.target.value }))}
              >
                <option value="town_planning">Town Planning</option>
                <option value="civil_engineering">Civil Engineering</option>
              </select>
              <input
                placeholder="Client name"
                value={projectForm.clientName}
                onChange={(e) => setProjectForm((v) => ({ ...v, clientName: e.target.value }))}
              />
              <input
                placeholder="Status"
                value={projectForm.status}
                onChange={(e) => setProjectForm((v) => ({ ...v, status: e.target.value }))}
              />
              <input
                placeholder="Budget"
                value={projectForm.budget}
                onChange={(e) => setProjectForm((v) => ({ ...v, budget: e.target.value }))}
              />
              <input
                placeholder="Summary"
                value={projectForm.summary}
                onChange={(e) => setProjectForm((v) => ({ ...v, summary: e.target.value }))}
              />
              <button type="submit">Add Project</button>
            </form>
            <div className="table projects">
              <div className="th">Project</div>
              <div className="th">Type</div>
              <div className="th">Status</div>
              <div className="th">Budget</div>
              <div className="th">Critical Analysis</div>
              <div className="th">Action</div>
              {projects.map((p) => (
                <div className="table-row projects-row" key={p.id}>
                  <div>{p.name}</div>
                  <div>{p.project_type}</div>
                  <div>{p.status}</div>
                  <div>${p.budget || 0}</div>
                  <div>{p.critical_analysis || "Not generated yet"}</div>
                  <div>
                    <button onClick={() => runProjectAnalysis(p.id)}>Generate Analysis</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Admin Reminder Log</h2>
            <div className="row" style={{ marginBottom: "8px" }}>
              <input
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Filter logs by client, channel, message, or timestamp"
              />
            </div>
            <div className="table logs">
              <div className="th">Client</div>
              <div className="th">Channel</div>
              <div className="th">Timestamp</div>
              <div className="th">Status</div>
              <div className="th">Message</div>
              {filteredReminderLogs.map((l) => (
                <div className="table-row logs-row" key={l.id}>
                  <div>{l.client_name || "-"}</div>
                  <div>{l.channel}</div>
                  <div>{l.sent_at}</div>
                  <div>{l.status}</div>
                  <div>{l.message}</div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <p className="status">{status}</p>
      <footer className="app-footer">
        <p>Powered by MashTech IT Solution</p>
        <p>Copyright 2026 New Space Properties Pvt Ltd</p>
      </footer>
    </main>
  );
}
