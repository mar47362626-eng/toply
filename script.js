const destinations = {
  NG: { name: "Nigeria", flag: "🇳🇬", dial: "+234", currency: "NGN", symbol: "₦", placeholder: "801 234 5678", networks: ["MTN", "Airtel", "Glo", "9mobile"], plans: [["1 GB · 1 day", 400], ["3 GB · 7 days", 1500], ["10 GB · 30 days", 5000]] },
  GH: { name: "Ghana", flag: "🇬🇭", dial: "+233", currency: "GHS", symbol: "GH₵", placeholder: "24 123 4567", networks: ["MTN", "Telecel", "AirtelTigo"], plans: [["1 GB · 1 day", 8], ["5 GB · 7 days", 35], ["15 GB · 30 days", 100]] },
  KE: { name: "Kenya", flag: "🇰🇪", dial: "+254", currency: "KES", symbol: "KSh", placeholder: "712 345 678", networks: ["Safaricom", "Airtel", "Telkom"], plans: [["1 GB · 1 day", 99], ["5 GB · 7 days", 500], ["20 GB · 30 days", 1500]] },
  ZA: { name: "South Africa", flag: "🇿🇦", dial: "+27", currency: "ZAR", symbol: "R", placeholder: "82 123 4567", networks: ["Vodacom", "MTN", "Telkom", "Cell C"], plans: [["1 GB · 1 day", 29], ["5 GB · 7 days", 99], ["20 GB · 30 days", 299]] },
  US: { name: "United States", flag: "🇺🇸", dial: "+1", currency: "USD", symbol: "$", placeholder: "201 555 0123", networks: ["AT&T", "T-Mobile", "Verizon"], plans: [["1 GB · 7 days", 10], ["5 GB · 30 days", 25], ["15 GB · 30 days", 45]] },
  GB: { name: "United Kingdom", flag: "🇬🇧", dial: "+44", currency: "GBP", symbol: "£", placeholder: "7700 900123", networks: ["EE", "O2", "Vodafone", "Three"], plans: [["1 GB · 7 days", 5], ["5 GB · 30 days", 12], ["20 GB · 30 days", 25]] },
  IN: { name: "India", flag: "🇮🇳", dial: "+91", currency: "INR", symbol: "₹", placeholder: "98765 43210", networks: ["Jio", "Airtel", "Vi", "BSNL"], plans: [["1 GB · 1 day", 19], ["3 GB · 28 days", 299], ["10 GB · 28 days", 599]] },
  PH: { name: "Philippines", flag: "🇵🇭", dial: "+63", currency: "PHP", symbol: "₱", placeholder: "917 123 4567", networks: ["Globe", "Smart", "DITO"], plans: [["1 GB · 7 days", 50], ["5 GB · 7 days", 99], ["20 GB · 30 days", 399]] }
};

const form = document.querySelector("#topup-form");
const countrySelect = document.querySelector("#country");
const networkSelect = document.querySelector("#network");
const serviceRadios = [...document.querySelectorAll('input[name="service"]')];
const phoneField = document.querySelector("#phone-field");
const planField = document.querySelector("#plan-field");
const giftField = document.querySelector("#gift-field");
const amountField = document.querySelector("#amount-field");
const amountInput = document.querySelector("#amount");
const dialog = document.querySelector("#review-dialog");
const registerForm = document.querySelector("#register-form");
const registerScreen = document.querySelector("#register-screen");
const appShell = document.querySelector("#app-shell");
const loginForm = document.querySelector("#login-form");
const currencyFormatter = (currency, value) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
let authenticatedUser = null;
let vtpassEnabled = false;
let vtpassMode = "preview";
let vtpassWalletPurchasesEnabled = false;
loadCurrentUser();

async function loadCurrentUser() {
  try {
    const response = await fetch("/api/auth/me", { headers: { Accept: "application/json" } });
    if (response.status === 401) {
      if (!registerScreen) window.location.replace("index.html");
      return;
    }
    if (!response.ok) throw new Error("Could not check the current account.");
    const result = await response.json();
    if (!result.user) {
      if (!registerScreen) window.location.replace("index.html");
      return;
    }
    authenticatedUser = result.user;
    showAuthenticatedUser(authenticatedUser);
    await refreshWallet();
    await handlePaystackReturn();
  } catch {
    if (registerScreen) {
      document.querySelector("#register-message").textContent = "Could not connect to the account server. Start server.js and reload this page.";
    } else {
      window.location.replace("index.html");
    }
  }
}

function showAuthenticatedUser(user) {
  const accountName = document.querySelector("#account-name");
  if (accountName) accountName.textContent = user.name;
  const accountAvatar = document.querySelector("#account-avatar");
  if (accountAvatar) accountAvatar.textContent = user.name.charAt(0).toUpperCase();
  document.querySelectorAll("[data-account-name]").forEach((element) => {
    element.textContent = user.name;
  });
  document.querySelectorAll("[data-account-avatar]").forEach((element) => {
    element.textContent = user.name.charAt(0).toUpperCase();
  });
  const dashboardName = document.querySelector("#dashboard-name");
  if (dashboardName) dashboardName.textContent = user.name;
  const accountChip = document.querySelector("#account-chip");
  if (accountChip) accountChip.hidden = false;
  if (registerScreen && appShell) {
    registerScreen.hidden = true;
    appShell.hidden = false;
    document.title = "Dashboard — Toply";
  }
  loadSavedOrders();
  if (form) initializeVtpass();
}

async function refreshWallet() {
  const balance = document.querySelector("#wallet-balance");
  if (!balance) return;
  const note = document.querySelector("#wallet-balance-note");
  try {
    const response = await fetch("/api/wallet", { headers: { Accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load your wallet.");
    balance.textContent = currencyFormatter(result.currency, (result.balances[result.currency] || 0) / 100);
    const otherBalances = Object.entries(result.balances)
      .filter(([currency, amount]) => currency !== result.currency && amount > 0)
      .map(([currency, amount]) => `${currencyFormatter(currency, amount / 100)}`);
    document.querySelector("#wallet-other-balances").textContent = otherBalances.join(" · ");
  } catch {
    note.textContent = "Could not load your balance. Refresh and try again.";
  }
}

async function handlePaystackReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("payment") !== "paystack") return;
  const reference = params.get("reference") || params.get("trxref");
  params.delete("payment");
  params.delete("reference");
  params.delete("trxref");
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  const note = document.querySelector("#wallet-balance-note");
  if (!reference) {
    note.textContent = "Payment return received without a reference. Your balance has not changed.";
    return;
  }
  note.textContent = "Checking your payment with Paystack…";
  try {
    const response = await fetch("/api/payments/paystack/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ reference })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Paystack has not confirmed the deposit.");
    note.textContent = "Deposit confirmed. Your balance is updated.";
    await refreshWallet();
    await loadSavedOrders();
    note.textContent = "Deposit confirmed. Your balance is updated.";
  } catch (error) {
    note.textContent = `${error.message} Your balance has not changed. You can refresh to check again.`;
  }
}

function selectedService() {
  return document.querySelector('input[name="service"]:checked').value;
}

function updateDestination() {
  const destination = destinations[countrySelect.value];
  document.querySelector("#country-flag").textContent = destination.flag;
  document.querySelector("#dial-code").textContent = destination.dial;
  document.querySelector("#phone").placeholder = destination.placeholder;
  document.querySelector("#currency-symbol").textContent = destination.symbol;
  document.querySelector("#amount-hint").textContent = `in ${destination.currency}`;

  networkSelect.replaceChildren(...destination.networks.map((network) => new Option(network, network)));
  const planOptions = document.querySelector("#plan-options");
  if (planOptions) {
    planOptions.replaceChildren(...destination.plans.map(([label, price], index) => {
      const option = document.createElement("label");
      option.className = "plan-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "dataPlan";
      input.value = `${label}|${price}`;
      input.required = true;
      input.checked = index === 0;
      const name = document.createElement("span");
      name.className = "plan-option-name";
      name.textContent = label;
      const priceText = document.createElement("span");
      priceText.className = "plan-option-price";
      priceText.textContent = currencyFormatter(destination.currency, price);
      option.append(input, name, priceText);
      return option;
    }));
    planOptions.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => {
        planOptions.querySelectorAll(".plan-option").forEach((option) => {
          option.classList.toggle("selected", option.querySelector("input").checked);
        });
      });
    });
    planOptions.querySelector(".plan-option")?.classList.add("selected");
    if (vtpassEnabled && countrySelect.value === "NG" && selectedService() === "data") {
      loadVtpassDataPlans();
    }
  }
  updateService();
}

async function initializeVtpass() {
  try {
    const response = await fetch("/api/providers/vtpass/status", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Could not check the VTpass service.");
    const result = await response.json();
    vtpassEnabled = result.enabled === true;
    vtpassMode = vtpassEnabled ? result.environment : "preview";
    vtpassWalletPurchasesEnabled = result.walletPurchasesEnabled === true;
    const mode = document.querySelector("#provider-mode");
    const disclaimer = document.querySelector("#provider-disclaimer");
    if (mode) mode.textContent = vtpassWalletPurchasesEnabled ? "LIVE" : vtpassMode.toUpperCase();
    if (disclaimer) {
      disclaimer.textContent = vtpassWalletPurchasesEnabled
        ? "Nigeria airtime/data orders are real. The displayed NGN amount is deducted from your Toply wallet. Verify the phone number before you buy."
        : vtpassEnabled
          ? "Nigeria orders use VTpass sandbox funds only. No Toply wallet balance or real airtime is charged or delivered. Other countries remain previews."
          : "Orders are previews until VTpass is configured. No wallet funds are charged and nothing is delivered.";
    }
    updateService();
    if (vtpassEnabled && countrySelect.value === "NG" && selectedService() === "data") {
      await loadVtpassDataPlans();
    }
  } catch {
    const message = form.querySelector(".form-message");
    message.textContent = "Could not check VTpass availability. Orders remain previews.";
  }
}

async function loadVtpassDataPlans() {
  if (!vtpassEnabled || countrySelect.value !== "NG") return;
  const network = networkSelect.value.toLowerCase();
  const planOptions = document.querySelector("#plan-options");
  const message = form.querySelector(".form-message");
  try {
    const response = await fetch(`/api/providers/vtpass/data-plans?network=${encodeURIComponent(network)}`, {
      headers: { Accept: "application/json" }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load VTpass data plans.");
    if (countrySelect.value !== "NG" || networkSelect.value.toLowerCase() !== network) return;
    if (!result.plans.length) throw new Error("VTpass has no data plans for this network.");
    planOptions.replaceChildren(...result.plans.map((plan, index) => {
      const option = document.createElement("label");
      option.className = `plan-option${index === 0 ? " selected" : ""}`;
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "dataPlan";
      input.value = plan.code;
      input.dataset.amount = String(plan.amount);
      input.required = true;
      input.checked = index === 0;
      const name = document.createElement("span");
      name.className = "plan-option-name";
      name.textContent = plan.name;
      const price = document.createElement("span");
      price.className = "plan-option-price";
      price.textContent = currencyFormatter("NGN", plan.amount);
      option.append(input, name, price);
      input.addEventListener("change", () => {
        planOptions.querySelectorAll(".plan-option").forEach((item) => {
          item.classList.toggle("selected", item.querySelector("input").checked);
        });
      });
      return option;
    }));
    message.textContent = "";
  } catch (error) {
    message.textContent = `${error.message} Existing example plans are previews only.`;
  }
}

function updateService() {
  const service = selectedService();
  document.querySelectorAll(".service-option").forEach((option) => {
    option.classList.toggle("selected", option.querySelector("input").checked);
  });
  const isAirtime = service === "airtime";
  const isData = service === "data";
  const isGift = service === "giftcard";
  phoneField.hidden = isGift;
  document.querySelector("#network-field").hidden = isGift;
  planField.hidden = !isData;
  giftField.hidden = !isGift;
  amountField.hidden = isData;
  document.querySelector("#phone").required = !isGift;
  networkSelect.required = !isGift;
  amountInput.required = !isData;
  document.querySelectorAll('input[name="dataPlan"]').forEach((input) => {
    input.required = isData;
  });
  document.querySelector("#gift").required = isGift;
  if (!isData) amountInput.value = "";
  document.querySelector("#amount-label-text").textContent = isGift ? "Gift card amount" : "Top-up amount";
  document.querySelector("#amount-help").textContent = isGift
    ? "Choose a gift card value in your selected destination’s currency."
    : "Choose an amount in your selected destination’s currency.";
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.firstChild.textContent = vtpassWalletPurchasesEnabled && countrySelect.value === "NG"
      ? "Buy with wallet "
      : vtpassEnabled && countrySelect.value === "NG"
        ? "Send sandbox test "
      : "Save order preview ";
  }
  form.querySelector(".form-message").textContent = "";
}

function showSavedOrderReview(type, order) {
  let details;
  if (type === "giftcard") {
    details = [
      ["Service", "Gift card order preview"],
      ["Gift card", order.product],
      ["Destination", order.country],
      ["Recipient", order.recipient],
      ["Amount", currencyFormatter(order.currency, order.amount)]
    ];
  } else {
    details = [
      ["Service", type === "data" ? "Data bundle preview" : "Airtime order preview"],
      ["Destination", order.country],
      ["Network", order.network],
      ["Phone", order.phone],
      ...(type === "data" ? [["Plan", order.plan]] : []),
      ["Amount", currencyFormatter(order.currency, order.amount)]
    ];
  }
  details.push(["Reference", order.id]);
  document.querySelector("#dialog-title").textContent = "Order preview saved";
  document.querySelector("#review-dialog > p").textContent = "This order preview is saved in your account history. No payment was taken and no recharge or gift card was delivered.";
  document.querySelector("#review-details").replaceChildren(...details.map(([term, description]) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = description;
    row.append(dt, dd);
    return row;
  }));
  const checkButton = document.querySelector("#provider-requery");
  if (checkButton) checkButton.hidden = true;
  dialog.showModal();
}

function showVtpassReview(order) {
  const title = document.querySelector("#dialog-title");
  const message = document.querySelector("#review-dialog > p");
  const detailsList = document.querySelector("#review-details");
  if (!title || !message || !detailsList || !dialog) return;
  if (authenticatedUser && order.status !== "pending") {
    localStorage.removeItem(`toply-vtpass-order-${authenticatedUser.id}-${order.type}`);
  }
  const details = [
    ["Service", order.type === "data" ? "VTpass data" : "VTpass airtime"],
    ["Network", order.network],
    ["Phone", order.phone],
    ...(order.type === "data" ? [["Plan", order.plan]] : []),
    ["Amount", currencyFormatter("NGN", order.amount)],
    ...(!order.sandbox ? [["Wallet charged", currencyFormatter("NGN", order.walletAmountMinor / 100)]] : []),
    [order.sandbox ? "Sandbox status" : "Order status", order.status],
    ["VTpass request ID", order.requestId],
    ["Toply reference", order.id]
  ];
  title.textContent = order.sandbox ? "Sandbox order submitted" : "Airtime/data order submitted";
  message.textContent = order.sandbox
    ? "This was sent to the VTpass sandbox. It did not debit your Toply wallet and does not deliver real airtime or data."
    : "Your wallet was charged. If the provider status is pending, check it here before attempting another purchase.";
  detailsList.replaceChildren(...details.map(([term, description]) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = description;
    row.append(dt, dd);
    return row;
  }));
  const checkButton = document.querySelector("#provider-requery");
  if (checkButton) {
    checkButton.hidden = order.status !== "pending";
    checkButton.onclick = async () => {
      checkButton.disabled = true;
      checkButton.textContent = "Checking…";
      try {
        const response = await fetch(`/api/providers/vtpass/orders/${encodeURIComponent(order.id)}/requery`, {
          method: "POST",
          headers: { Accept: "application/json" }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not check order status.");
        showVtpassReview(result.order);
        await refreshWallet();
        await loadSavedOrders();
      } catch (error) {
        const reviewMessage = document.querySelector("#review-dialog > p");
        if (reviewMessage) reviewMessage.textContent = error.message;
      } finally {
        checkButton.disabled = false;
        checkButton.textContent = "Check status";
      }
    };
  }
  if (!dialog.open) dialog.showModal();
}

async function loadSavedOrders() {
  const recentActivity = document.querySelector("#recent-activity");
  const transactionRows = document.querySelector("#transaction-rows");
  if (!recentActivity && !transactionRows) return;
  try {
    const response = await fetch("/api/orders", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Could not load saved orders.");
    const { orders } = await response.json();
    const walletResponse = await fetch("/api/wallet", { headers: { Accept: "application/json" } });
    if (!walletResponse.ok) throw new Error("Could not load wallet activity.");
    const wallet = await walletResponse.json();
    const deposits = wallet.deposits.map((deposit) => ({
      ...deposit,
      type: "deposit",
      product: "Wallet deposit · Paystack",
      amount: deposit.amountMinor / 100
    }));
    const refunds = wallet.refunds.map((refund) => ({
      ...refund,
      type: "refund",
      product: "Wallet refund · VTpass",
      amount: refund.amountMinor / 100
    }));
    const activities = [...orders, ...deposits, ...refunds].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    if (recentActivity) renderRecentActivity(recentActivity, activities.slice(0, 4));
    if (transactionRows) {
      const filter = document.querySelector("#transaction-filter");
      const render = () => renderTransactions(transactionRows, [...orders, ...refunds], deposits, filter.value);
      filter.onchange = render;
      render();
    }
  } catch {
    if (recentActivity) recentActivity.textContent = "Could not load saved orders. Refresh and try again.";
    if (transactionRows) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.textContent = "Could not load saved orders. Refresh and try again.";
      row.append(cell);
      transactionRows.replaceChildren(row);
    }
  }
}

function formatOrderType(type) {
  return type === "deposit" ? "Wallet deposit" : type === "refund" ? "Wallet refund"
    : type === "giftcard" ? "Gift card" : type === "data" ? "Data bundle" : "Airtime";
}

function formatOrderAmount(order) {
  return currencyFormatter(order.currency, order.amount);
}

function renderRecentActivity(container, orders) {
  if (!orders.length) {
    container.innerHTML = '<span>↻</span><strong>No transactions yet</strong><p>Your saved orders will show up here.</p>';
    return;
  }
  container.classList.add("recent-order-list");
  container.replaceChildren(...orders.map((order) => {
    const item = document.createElement("div");
    item.className = "recent-order-item";
    const label = document.createElement("strong");
    label.textContent = ["deposit", "refund", "giftcard"].includes(order.type)
      ? order.product
      : `${formatOrderType(order.type)} · ${order.country}`;
    const meta = document.createElement("span");
    const status = ["deposit", "refund"].includes(order.type) ? order.status === "success" ? "Confirmed" : "Pending"
      : order.sandbox ? `VTpass sandbox · ${order.status}`
        : order.provider?.startsWith("VTpass") ? `VTpass · ${order.status}` : "Saved preview";
    meta.textContent = `${new Date(order.createdAt).toLocaleDateString()} · ${status}`;
    const amount = document.createElement("b");
    amount.textContent = formatOrderAmount(order);
    item.append(label, meta, amount);
    return item;
  }));
}

function renderTransactions(container, orders, deposits, filter) {
  const activities = [...orders, ...deposits].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const filteredActivities = activities.filter((item) => filter === "all" ||
    (filter === "topups" && ["airtime", "data"].includes(item.type)) ||
    (filter === "giftcard" && item.type === "giftcard") ||
    (filter === "deposits" && item.type === "deposit"));
  if (!filteredActivities.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "No saved orders found.";
    row.append(cell);
    container.replaceChildren(row);
    return;
  }
  container.replaceChildren(...filteredActivities.map((order) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = ["deposit", "refund"].includes(order.type)
      ? order.product
      : order.type === "giftcard"
        ? `${order.product} gift card · ${order.country}`
        : `${formatOrderType(order.type)} · ${order.network} · ${order.country}`;
    const date = document.createElement("td");
    date.textContent = new Date(order.createdAt).toLocaleString();
    const status = document.createElement("td");
    const statusText = document.createElement("span");
    status.setAttribute("aria-live", "polite");
    statusText.textContent = ["deposit", "refund"].includes(order.type) ? order.status === "success" ? "Confirmed" : "Pending"
      : order.sandbox ? `VTpass sandbox · ${order.status}`
        : order.provider?.startsWith("VTpass") ? `VTpass · ${order.status}` : "Saved preview";
    status.append(statusText);
    if (order.provider?.startsWith("VTpass") && order.status === "pending") {
      const feedback = document.createElement("div");
      feedback.className = "transaction-status-feedback";
      feedback.setAttribute("role", "alert");
      feedback.hidden = true;
      const checkButton = document.createElement("button");
      checkButton.type = "button";
      checkButton.className = "transaction-requery";
      checkButton.textContent = "Check status";
      checkButton.addEventListener("click", async () => {
        checkButton.disabled = true;
        checkButton.textContent = "Checking…";
        feedback.hidden = false;
        feedback.textContent = "Checking status with VTpass…";
        try {
          const response = await fetch(`/api/providers/vtpass/orders/${encodeURIComponent(order.id)}/requery`, {
            method: "POST",
            headers: { Accept: "application/json" }
          });
          let result;
          try {
            result = await response.json();
          } catch {
            throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`);
          }
          if (!response.ok) throw new Error(result.error || "Could not check order status.");
          statusText.textContent = `${result.order.sandbox ? "VTpass sandbox" : "VTpass"} · ${result.order.status}`;
          feedback.textContent = result.order.status === "pending"
            ? "VTpass still reports this order as pending. Do not submit it again."
            : `Status updated: ${result.order.status}.`;
          await refreshWallet();
          await loadSavedOrders();
        } catch (error) {
          feedback.textContent = `Status check failed: ${error.message} The order remains pending; do not submit it again.`;
        } finally {
          checkButton.disabled = false;
          checkButton.textContent = "Check status";
        }
      });
      status.append(document.createElement("br"), checkButton, feedback);
    }
    const amount = document.createElement("td");
    amount.className = "amount-column";
    amount.textContent = formatOrderAmount(order);
    row.append(name, date, status, amount);
    return row;
  }));
}

async function saveOrder(type, payload, formElement) {
  const message = formElement.querySelector(".form-message");
  const button = formElement.querySelector('button[type="submit"]');
  button.disabled = true;
  message.textContent = "";
  try {
    const response = await fetch(`/api/orders/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      message.textContent = result.error || "The order preview could not be saved.";
      return;
    }
    showSavedOrderReview(type, result.order);
  } catch {
    message.textContent = "Could not connect to the server. Your order preview was not saved.";
  } finally {
    button.disabled = false;
  }
}

async function submitVtpassOrder(type, payload, formElement) {
  const message = formElement.querySelector(".form-message");
  const button = formElement.querySelector('button[type="submit"]');
  button.disabled = true;
  message.textContent = vtpassWalletPurchasesEnabled ? "Submitting your real order…" : "Submitting to the VTpass sandbox…";
  try {
    const referenceKey = `toply-vtpass-order-${authenticatedUser.id}-${type}`;
    const clientReference = localStorage.getItem(referenceKey) || crypto.randomUUID();
    localStorage.setItem(referenceKey, clientReference);
    const response = await fetch(`/api/providers/vtpass/orders/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...payload, clientReference })
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.orderId) {
        const checkResponse = await fetch(`/api/providers/vtpass/orders/${encodeURIComponent(result.orderId)}/requery`, {
          method: "POST",
          headers: { Accept: "application/json" }
        });
        const checked = await checkResponse.json();
        if (checkResponse.ok) {
          showVtpassReview(checked.order);
          await refreshWallet();
          await loadSavedOrders();
          return;
        }
      }
      const requestInfo = result.requestId
        ? ` VTpass request ID: ${result.requestId}${result.orderId ? ` (Toply order ${result.orderId})` : ""}. Do not submit it again; check status or contact support.`
        : "";
      throw new Error(`${result.error || "VTpass order failed."}${requestInfo}`);
    }
    showVtpassReview(result.order);
    await refreshWallet();
    await loadSavedOrders();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

if (form) {
  countrySelect.addEventListener("change", updateDestination);
  networkSelect.addEventListener("change", loadVtpassDataPlans);
  serviceRadios.forEach((radio) => radio.addEventListener("change", updateService));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (selectedService() !== "data" && Number(amountInput.value) <= 0) {
      form.querySelector(".form-message").textContent = "Enter an amount greater than zero.";
      return;
    }
    const service = selectedService();
    const destination = destinations[countrySelect.value];
    const payload = {
      country: destination.name,
      currency: destination.currency
    };
    if (service === "data") {
      const selectedPlan = document.querySelector('input[name="dataPlan"]:checked');
      if (vtpassEnabled && countrySelect.value === "NG" && selectedPlan && selectedPlan.dataset.amount) {
        submitVtpassOrder("data", {
          network: networkSelect.value.toLowerCase(),
          phone: document.querySelector("#phone").value.trim(),
          variationCode: selectedPlan.value
        }, form);
        return;
      }
      const [plan, price] = selectedPlan.value.split("|");
      Object.assign(payload, { network: networkSelect.value, phone: document.querySelector("#phone").value.trim(), plan, amount: Number(price) });
    } else {
      if (vtpassEnabled && countrySelect.value === "NG") {
        submitVtpassOrder("airtime", {
          network: networkSelect.value.toLowerCase(),
          phone: document.querySelector("#phone").value.trim(),
          amount: Number(amountInput.value)
        }, form);
        return;
      }
      Object.assign(payload, { network: networkSelect.value, phone: document.querySelector("#phone").value.trim(), amount: Number(amountInput.value) });
    }
    saveOrder(service === "data" ? "data" : "airtime", payload, form);
  });
  updateDestination();
}

async function submitAuthForm(form, endpoint, messageSelector) {
  if (!form.reportValidity()) return;
  const button = form.querySelector('button[type="submit"]');
  const message = document.querySelector(messageSelector);
  const payload = Object.fromEntries(new FormData(form));
  payload.email = payload.email.trim().toLowerCase();
  if (payload.name) payload.name = payload.name.trim().replace(/\s+/g, " ");
  button.disabled = true;
  message.textContent = "";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      message.textContent = result.error || "The account request could not be completed.";
      return;
    }
    authenticatedUser = result.user;
    showAuthenticatedUser(authenticatedUser);
    await refreshWallet();
  } catch {
    message.textContent = "Could not connect to the account server. Check that server.js is running and try again.";
  } finally {
    button.disabled = false;
  }
}

if (registerForm) registerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAuthForm(registerForm, "/api/auth/register", "#register-message");
});
if (loginForm) loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAuthForm(loginForm, "/api/auth/login", "#login-message");
});
const depositDialog = document.querySelector("#deposit-dialog");
const depositForm = document.querySelector("#deposit-form");
document.querySelector("#open-deposit")?.addEventListener("click", () => {
  document.querySelector("#deposit-message").textContent = "";
  depositDialog.showModal();
});
if (depositForm) {
  depositForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!depositForm.reportValidity()) return;
    const button = depositForm.querySelector('button[type="submit"]');
    const message = document.querySelector("#deposit-message");
    button.disabled = true;
    message.textContent = "";
    try {
      const response = await fetch("/api/payments/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ amount: Number(document.querySelector("#deposit-amount").value) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start Paystack checkout.");
      if (!result.authorizationUrl || !result.authorizationUrl.startsWith("https://")) {
        throw new Error("Paystack returned an invalid checkout link.");
      }
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const isLogin = button.dataset.authMode === "login";
    document.querySelectorAll("[data-auth-mode]").forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    registerForm.hidden = isLogin;
    loginForm.hidden = !isLogin;
    document.querySelector("#register-title").innerHTML = isLogin
      ? "Welcome<br />back."
      : "Your next top-up<br />starts right here.";
    document.querySelector(".register-description").textContent = isLogin
      ? "Log in with the email and password you used to create your account."
      : "Create an account to open your dashboard and explore the top-up experience.";
    document.querySelector("#register-message").textContent = "";
    document.querySelector("#login-message").textContent = "";
  });
});
document.querySelectorAll("[data-sign-out]").forEach((button) => {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("The server could not end this session.");
      window.location.replace("index.html");
    } catch (error) {
      button.disabled = false;
      window.alert(`${error.message} Please try again.`);
    }
  });
});
document.querySelector("#dialog-done")?.addEventListener("click", () => dialog.close());
document.querySelector("#gift-purchase-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const giftForm = event.currentTarget;
  if (!giftForm.reportValidity()) return;
  saveOrder("giftcard", {
    product: giftForm.elements.product.value,
    country: giftForm.elements.country.value,
    recipient: giftForm.elements.email.value.trim(),
    amount: Number(giftForm.elements.amount.value),
    currency: giftForm.elements.currency.value
  }, giftForm);
});
document.querySelectorAll("[data-gift-product]").forEach((button) => {
  button.addEventListener("click", () => {
    const product = button.dataset.giftProduct;
    const productInput = document.querySelector("#gift-product");
    if (!productInput) return;
    productInput.value = product;
    document.querySelector("#selected-gift-name").textContent = product;
    document.querySelector("#gift-order-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  });
});
document.querySelector("#gift-country")?.addEventListener("change", (event) => {
  const currency = event.target.selectedOptions[0].dataset.currency;
  document.querySelector("#gift-currency").value = currency;
  document.querySelector("#gift-currency-label").textContent = currency;
  const symbol = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).formatToParts(1).find((part) => part.type === "currency").value;
  document.querySelector("#gift-symbol").textContent = symbol;
});
document.querySelectorAll(".catalog-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const category = tab.dataset.category;
    document.querySelectorAll(".catalog-tab").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll(".gift-tile[data-category]").forEach((tile) => {
      tile.hidden = category !== "all" && tile.dataset.category !== category;
    });
  });
});
const selectedGift = new URLSearchParams(window.location.search).get("product");
if (selectedGift) {
  const matchingGift = [...document.querySelectorAll("[data-gift-product]")].find((button) => button.dataset.giftProduct === selectedGift);
  matchingGift?.click();
}
const yearElement = document.querySelector("#year");
if (yearElement) yearElement.textContent = new Date().getFullYear();
