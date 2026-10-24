const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");
const { createClient } = require("@supabase/supabase-js");

const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;
const userFile = path.join(root, "user.json");
const sessionFile = path.join(root, "session.json");
const walletTransactionsFile = path.join(root, "wallet-transactions.json");
const orderFiles = {
  airtime: path.join(root, "airtime.json"),
  data: path.join(root, "data.json"),
  giftcard: path.join(root, "giftcard.json")
};
const transactionsFile = path.join(root, "transactions.json");
const sessionCookie = "toply_session";
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const paystackCurrency = process.env.PAYSTACK_CURRENCY || "NGN";
const supportedPaystackCurrencies = new Set(["NGN"]);
const minimumDepositMinor = 10_000;
const maximumDepositMinor = 1_000_000_000;
const vtpassNetworks = {
  mtn: { name: "MTN", airtime: "mtn", data: "mtn-data" },
  airtel: { name: "Airtel", airtime: "airtel", data: "airtel-data" },
  glo: { name: "Glo", airtime: "glo", data: "glo-data" },
  "9mobile": { name: "9mobile", airtime: "etisalat", data: "etisalat-data" }
};
const vtpassMode = process.env.VTPASS_ENV || "sandbox";
const protectedPages = new Set(["buy-data.html", "buy-airtime.html", "gift-cards.html", "settings.html", "transactions.html"]);
const publicFiles = new Map([
  ["index.html", "text/html; charset=utf-8"],
  ["buy-data.html", "text/html; charset=utf-8"],
  ["buy-airtime.html", "text/html; charset=utf-8"],
  ["gift-cards.html", "text/html; charset=utf-8"],
  ["settings.html", "text/html; charset=utf-8"],
  ["transactions.html", "text/html; charset=utf-8"],
  ["styles.css", "text/css; charset=utf-8"],
  ["script.js", "text/javascript; charset=utf-8"]
]);

function readLocalRecords(file) {
  const records = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(records)) throw new Error(`${path.basename(file)} must contain a JSON array.`);
  return records;
}

function writeLocalRecords(file, records) {
  fs.writeFileSync(file, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
}

let walletWriteQueue = Promise.resolve();
function withWalletWriteLock(callback) {
  const result = walletWriteQueue.then(callback);
  walletWriteQueue = result.catch(() => {});
  return result;
}

async function initializeStorage() {
  if (process.env.NODE_ENV === "production" && !supabase) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production.");
  }
  if (!supabase) {
    for (const file of [userFile, sessionFile, walletTransactionsFile, ...Object.values(orderFiles), transactionsFile]) {
      if (!fs.existsSync(file)) writeLocalRecords(file, []);
    }
    return;
  }
  for (const table of ["toply_users", "toply_sessions", "toply_orders", "toply_wallet_transactions"]) {
    const { error } = await supabase.from(table).select("*").limit(0);
    if (error) throw new Error(`Supabase table ${table} is not ready: ${error.message}`);
  }
  if (vtpassMode === "live" && process.env.VTPASS_LIVE_ENABLED === "true") {
    const debitCheck = await supabase.rpc("toply_debit_wallet", {
      p_user_id: "",
      p_reference: "",
      p_amount_minor: 0,
      p_currency: "NGN"
    });
    if (!debitCheck.error || !debitCheck.error.message.includes("INVALID_PURCHASE_AMOUNT")) {
      throw new Error(`Supabase live-wallet debit RPC is not ready: ${debitCheck.error?.message || "unexpected response"}`);
    }
    const refundCheck = await supabase.rpc("toply_refund_wallet", {
      p_user_id: "",
      p_purchase_reference: "",
      p_refund_reference: "",
      p_amount_minor: 0,
      p_currency: "NGN"
    });
    if (!refundCheck.error || !refundCheck.error.message.includes("USER_NOT_FOUND")) {
      throw new Error(`Supabase live-wallet refund RPC is not ready: ${refundCheck.error?.message || "unexpected response"}`);
    }
    const claimCheck = await supabase.rpc("toply_claim_vtpass_order", {
      p_user_id: "",
      p_order_id: ""
    });
    if (claimCheck.error || claimCheck.data !== false) {
      throw new Error(`Supabase VTpass order-claim RPC is not ready: ${claimCheck.error?.message || "unexpected response"}`);
    }
  }
}

async function findUserById(userId) {
  if (supabase) {
    const { data, error } = await supabase.from("toply_users")
      .select("id, name, email, password_hash, created_at").eq("id", userId).maybeSingle();
    if (error) throw error;
    return data ? { id: data.id, name: data.name, email: data.email, passwordHash: data.password_hash, createdAt: data.created_at } : null;
  }
  return readLocalRecords(userFile).find((user) => user.id === userId) || null;
}

async function findUserByEmail(email) {
  if (supabase) {
    const { data, error } = await supabase.from("toply_users")
      .select("id, name, email, password_hash, created_at").eq("email", email).maybeSingle();
    if (error) throw error;
    return data ? { id: data.id, name: data.name, email: data.email, passwordHash: data.password_hash, createdAt: data.created_at } : null;
  }
  return readLocalRecords(userFile).find((user) => user.email === email) || null;
}

async function insertUser(user) {
  if (supabase) {
    const { error } = await supabase.from("toply_users").insert({
      id: user.id, name: user.name, email: user.email,
      password_hash: user.passwordHash, created_at: user.createdAt
    });
    if (error) throw error;
    return;
  }
  const users = readLocalRecords(userFile);
  users.push(user);
  writeLocalRecords(userFile, users);
}

async function findUserForSession(tokenHash) {
  if (supabase) {
    const { data, error } = await supabase.from("toply_sessions")
      .select("user_id").eq("token_hash", tokenHash).gt("expires_at", Date.now()).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const user = await findUserById(data.user_id);
    return user ? { id: user.id, name: user.name, email: user.email } : null;
  }
  const now = Date.now();
  const sessions = readLocalRecords(sessionFile);
  const validSessions = sessions.filter((session) => Number(session.expiresAt) > now);
  if (validSessions.length !== sessions.length) writeLocalRecords(sessionFile, validSessions);
  const session = validSessions.find((item) => item.tokenHash === tokenHash);
  if (!session) return null;
  const user = await findUserById(session.userId);
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

async function insertSession(userId, tokenHash, expiresAt) {
  if (supabase) {
    const { error } = await supabase.from("toply_sessions")
      .insert({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt });
    if (error) throw error;
    return;
  }
  const sessions = readLocalRecords(sessionFile);
  sessions.push({ userId, tokenHash, expiresAt });
  writeLocalRecords(sessionFile, sessions);
}

async function deleteSession(tokenHash) {
  if (supabase) {
    const { error } = await supabase.from("toply_sessions").delete().eq("token_hash", tokenHash);
    if (error) throw error;
    return;
  }
  writeLocalRecords(sessionFile, readLocalRecords(sessionFile).filter((session) => session.tokenHash !== tokenHash));
}

async function insertOrder(order) {
  if (supabase) {
    const { error } = await supabase.from("toply_orders").insert({
      id: order.id, user_id: order.userId, order_type: order.type,
      created_at: order.createdAt, data: order
    });
    if (error) throw error;
    return;
  }
  const typeRecords = readLocalRecords(orderFiles[order.type]);
  typeRecords.push(order);
  const allTransactions = readLocalRecords(transactionsFile);
  allTransactions.push(order);
  writeLocalRecords(orderFiles[order.type], typeRecords);
  writeLocalRecords(transactionsFile, allTransactions);
}

async function findOrderById(id, userId) {
  if (supabase) {
    const { data, error } = await supabase.from("toply_orders")
      .select("data").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data?.data || null;
  }
  return readLocalRecords(transactionsFile).find((order) => order.id === id && order.userId === userId) || null;
}

async function updateOrder(order) {
  if (supabase) {
    const { error } = await supabase.from("toply_orders").update({ data: order }).eq("id", order.id);
    if (error) throw error;
    return;
  }
  const allTransactions = readLocalRecords(transactionsFile);
  const orderIndex = allTransactions.findIndex((item) => item.id === order.id);
  if (orderIndex < 0) throw new Error("Order record was not found.");
  allTransactions[orderIndex] = order;
  writeLocalRecords(transactionsFile, allTransactions);
  if (order.type === "airtime" || order.type === "data") {
    const typeFile = orderFiles[order.type];
    const typeRecords = readLocalRecords(typeFile);
    const typeIndex = typeRecords.findIndex((item) => item.id === order.id);
    if (typeIndex >= 0) {
      typeRecords[typeIndex] = order;
      writeLocalRecords(typeFile, typeRecords);
    }
  }
}

async function listOrders(userId) {
  if (supabase) {
    const { data, error } = await supabase.from("toply_orders")
      .select("data").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data.map((row) => row.data);
  }
  return readLocalRecords(transactionsFile)
    .filter((order) => order.userId === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function listWalletTransactions(userId) {
  if (supabase) {
    const { data, error } = await supabase.from("toply_wallet_transactions")
      .select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data.map((row) => ({
      id: row.id, userId: row.user_id, reference: row.reference, type: row.type,
      amountMinor: Number(row.amount_minor), currency: row.currency, status: row.status,
      createdAt: row.created_at, paystackTransactionId: row.paystack_transaction_id,
      confirmedAt: row.confirmed_at
    }));
  }
  return readLocalRecords(walletTransactionsFile)
    .filter((transaction) => transaction.userId === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function findWalletTransactionByReference(reference) {
  if (supabase) {
    const { data, error } = await supabase.from("toply_wallet_transactions")
      .select("*").eq("reference", reference).maybeSingle();
    if (error) throw error;
    return data ? {
      id: data.id, userId: data.user_id, reference: data.reference, type: data.type,
      amountMinor: Number(data.amount_minor), currency: data.currency, status: data.status,
      createdAt: data.created_at, paystackTransactionId: data.paystack_transaction_id,
      confirmedAt: data.confirmed_at
    } : null;
  }
  return readLocalRecords(walletTransactionsFile).find((item) => item.reference === reference) || null;
}

async function insertWalletTransaction(transaction) {
  if (supabase) {
    const { error } = await supabase.from("toply_wallet_transactions").insert({
      id: transaction.id, user_id: transaction.userId, reference: transaction.reference,
      type: transaction.type, amount_minor: transaction.amountMinor, currency: transaction.currency,
      status: transaction.status, created_at: transaction.createdAt
    });
    if (error) throw error;
    return;
  }
  await withWalletWriteLock(() => {
    const transactions = readLocalRecords(walletTransactionsFile);
    if (transactions.some((item) => item.reference === transaction.reference)) {
      throw new Error("Paystack returned a duplicate payment reference.");
    }
    transactions.push(transaction);
    writeLocalRecords(walletTransactionsFile, transactions);
  });
}

async function confirmWalletTransaction(reference, userId, verified) {
  if (supabase) {
    const confirmedAt = new Date().toISOString();
    const { data, error } = await supabase.from("toply_wallet_transactions")
      .update({
        status: "success",
        paystack_transaction_id: String(verified.id),
        confirmed_at: confirmedAt
      })
      .eq("reference", reference)
      .eq("user_id", userId)
      .neq("status", "success")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const transaction = data
      ? {
          id: data.id, userId: data.user_id, reference: data.reference, type: data.type,
          amountMinor: Number(data.amount_minor), currency: data.currency, status: data.status,
          createdAt: data.created_at, paystackTransactionId: data.paystack_transaction_id,
          confirmedAt: data.confirmed_at
        }
      : await findWalletTransactionByReference(reference);
    if (!transaction || transaction.userId !== userId) {
      throw Object.assign(new Error("No pending deposit was found for this account."), { statusCode: 404 });
    }
    return { transaction, balances: await walletBalancesFor(userId) };
  }
  return withWalletWriteLock(() => {
    const transactions = readLocalRecords(walletTransactionsFile);
    const transaction = transactions.find((item) => item.reference === reference);
    if (!transaction || transaction.userId !== userId) {
      throw Object.assign(new Error("No pending deposit was found for this account."), { statusCode: 404 });
    }
    if (transaction.status !== "success") {
      transaction.status = "success";
      transaction.paystackTransactionId = String(verified.id);
      transaction.confirmedAt = new Date().toISOString();
      writeLocalRecords(walletTransactionsFile, transactions);
    }
    const balances = transactions
      .filter((item) => item.userId === userId && item.status === "success")
      .reduce((result, item) => {
        const direction = item.type === "purchase" ? -1 : 1;
        result[item.currency] = (result[item.currency] || 0) + direction * item.amountMinor;
        return result;
      }, {});
    return { transaction, balances };
  });
}

function jsonResponse(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function getCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";
  const match = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : "";
}

function cookieOptions(maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function setSessionCookie(response, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${secure}`);
}

async function currentUser(request) {
  const token = getCookie(request, sessionCookie);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return findUserForSession(tokenHash);
}

function validateRequestOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const contentType = request.headers["content-type"] || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      reject(Object.assign(new Error("Send account details as JSON."), { statusCode: 415 }));
      return;
    }
    if (Number(request.headers["content-length"] || 0) > 10_000) {
      reject(Object.assign(new Error("The request is too large."), { statusCode: 413 }));
      return;
    }
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 10_000) {
        tooLarge = true;
        reject(Object.assign(new Error("The request is too large."), { statusCode: 413 }));
      }
    });
    request.on("end", () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("The request body is not valid JSON."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function readRawBody(request, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > limit) {
        tooLarge = true;
        reject(Object.assign(new Error("The request is too large."), { statusCode: 413 }));
      }
    });
    request.on("end", () => {
      if (!tooLarge) resolve(body);
    });
    request.on("error", reject);
  });
}

function validateAccountInput(body, isRegistration) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Enter valid account details.";
  }
  if (typeof body.email !== "string" || body.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return "Enter a valid email address.";
  }
  if (typeof body.password !== "string" || body.password.length < (isRegistration ? 8 : 1) ||
      body.password.length > 128) {
    return isRegistration ? "Choose a password between 8 and 128 characters." : "Enter your password.";
  }
  if (isRegistration && (typeof body.name !== "string" || body.name.trim().length < 2 ||
      body.name.trim().length > 60)) {
    return "Enter a name between 2 and 60 characters.";
  }
  return "";
}

async function makePasswordHash(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

const dummyPasswordHash = makePasswordHash("toply-dummy-account-check");

async function verifyPassword(password, encodedHash) {
  const [scheme, saltHex, hashHex] = String(encodedHash).split("$");
  if (scheme !== "scrypt" || !/^[a-f0-9]{32}$/.test(saltHex) || !/^[a-f0-9]{128}$/.test(hashHex)) {
    throw new Error("Stored password hash is invalid.");
  }
  const actualHash = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(actualHash, Buffer.from(hashHex, "hex"));
}

async function createSession(response, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await insertSession(
    userId,
    crypto.createHash("sha256").update(token).digest("hex"),
    Date.now() + sessionLifetimeMs
  );
  setSessionCookie(response, token);
}

function validateOrder(body, type) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Enter valid order details.";
  if (typeof body.country !== "string" || body.country.trim().length < 2 || body.country.length > 60) {
    return "Choose a valid destination country.";
  }
  if (typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency)) {
    return "Choose a valid currency.";
  }
  if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0 || body.amount > 10_000_000) {
    return "Enter a valid amount.";
  }
  if (type === "giftcard") {
    if (typeof body.product !== "string" || !["Apple", "Amazon", "Steam", "Google Play", "PlayStation", "Spotify", "Netflix", "Xbox"].includes(body.product)) {
      return "Choose a valid gift card.";
    }
    if (typeof body.recipient !== "string" || body.recipient.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.recipient)) {
      return "Enter a valid recipient email address.";
    }
  } else {
    if (typeof body.network !== "string" || body.network.trim().length < 2 || body.network.length > 40) {
      return "Choose a valid mobile network.";
    }
    if (typeof body.phone !== "string" || !/^[+\d][\d\s()-]{5,24}$/.test(body.phone.trim())) {
      return "Enter a valid phone number.";
    }
    if (type === "data" && (typeof body.plan !== "string" || body.plan.length > 60)) {
      return "Choose a valid data plan.";
    }
  }
  return "";
}

async function saveOrder(user, type, body) {
  const order = {
    id: crypto.randomUUID(),
    userId: user.id,
    type,
    country: body.country.trim(),
    currency: body.currency,
    amount: body.amount,
    status: "preview",
    createdAt: new Date().toISOString()
  };
  if (type === "giftcard") {
    order.product = body.product;
    order.recipient = body.recipient.trim().toLowerCase();
  } else {
    order.network = body.network.trim();
    order.phone = body.phone.trim();
    if (type === "data") order.plan = body.plan.trim();
  }
  await insertOrder(order);
  return order;
}

function paystackConfigurationError() {
  const secret = process.env.PAYSTACK_SECRET_KEY || "";
  if (!secret) return "Paystack is not configured. Add your secret key to the server .env file.";
  if (!/^sk_(test|live)_/.test(secret)) return "The configured Paystack secret key is not valid.";
  if (!supportedPaystackCurrencies.has(paystackCurrency)) {
    return `Paystack deposits are not enabled for ${paystackCurrency}. Configure a currency enabled for your Paystack account.`;
  }
  if (process.env.NODE_ENV === "production") {
    if (process.env.PAYSTACK_LIVE_ENABLED !== "true" || !secret.startsWith("sk_live_")) {
      return "Live Paystack payments are disabled until the live account is explicitly enabled.";
    }
    if (!process.env.APP_BASE_URL || !process.env.APP_BASE_URL.startsWith("https://")) {
      return "Set APP_BASE_URL to your public HTTPS website before enabling live payments.";
    }
  } else if (!secret.startsWith("sk_test_")) {
    return "Use a Paystack test secret key while running locally.";
  }
  return "";
}

function paystackBaseUrl() {
  return "https://api.paystack.co";
}

async function paystackRequest(endpoint, options = {}) {
  const response = await fetch(`${paystackBaseUrl()}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      Accept: "application/json",
      ...options.headers
    }
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Paystack returned an unreadable response.");
  }
  if (!response.ok || result.status !== true) {
    throw new Error(result.message || "Paystack could not complete the payment request.");
  }
  return result.data;
}

function vtpassConfigurationError() {
  if (!process.env.VTPASS_API_KEY || !process.env.VTPASS_PUBLIC_KEY || !process.env.VTPASS_SECRET_KEY) {
    return `Configure the VTpass ${vtpassMode} API key, public key, and secret key in the server environment.`;
  }
  if (!["sandbox", "live"].includes(vtpassMode)) return "VTPASS_ENV must be sandbox or live.";
  if (vtpassMode === "live" && (process.env.NODE_ENV !== "production" || process.env.VTPASS_LIVE_ENABLED !== "true")) {
    return "VTpass live purchases are disabled. Enable them only after live API approval and testing.";
  }
  if (vtpassMode === "live" && !supabase) return "Live wallet purchases require the Supabase-backed wallet.";
  return "";
}

async function vtpassRequest(endpoint, { method = "GET", body } = {}) {
  const configurationError = vtpassConfigurationError();
  if (configurationError) throw Object.assign(new Error(configurationError), { statusCode: 503 });
  const baseUrl = vtpassMode === "live" ? "https://vtpass.com/api/" : "https://sandbox.vtpass.com/api/";
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.VTPASS_API_KEY,
      ...(method === "GET"
        ? { "public-key": process.env.VTPASS_PUBLIC_KEY }
        : { "secret-key": process.env.VTPASS_SECRET_KEY })
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw Object.assign(new Error(`VTpass ${endpoint} returned an unreadable response (HTTP ${response.status}).`), { statusCode: 502 });
  }
  if (!response.ok) {
    const description = result && typeof result.response_description === "string"
      ? result.response_description.slice(0, 300)
      : result && typeof result.message === "string" ? result.message.slice(0, 300) : "";
    const detail = description ? `: ${description}` : "";
    throw Object.assign(new Error(`VTpass ${endpoint} failed with HTTP ${response.status}${detail}.`), {
      statusCode: 502,
      providerStatus: response.status
    });
  }
  return result;
}

function vtpassRequestId() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${crypto.randomBytes(8).toString("hex")}`;
}

function vtpassServiceId(type, network) {
  const networkInfo = vtpassNetworks[network];
  return networkInfo && (type === "airtime" ? networkInfo.airtime : type === "data" ? networkInfo.data : null);
}

function normalizeNigerianPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (/^0\d{10}$/.test(digits)) return digits;
  if (/^234\d{10}$/.test(digits)) return `0${digits.slice(3)}`;
  return "";
}

async function vtpassDataPlans(network) {
  const serviceID = vtpassServiceId("data", network);
  if (!serviceID) throw Object.assign(new Error("Choose a supported Nigerian network."), { statusCode: 400 });
  const result = await vtpassRequest(`service-variations?serviceID=${encodeURIComponent(serviceID)}`);
  const variations = result.content && result.content.variations;
  if (!Array.isArray(variations)) throw Object.assign(new Error("VTpass did not return data plans for this network."), { statusCode: 502 });
  return variations.map((plan) => ({
    code: plan.variation_code,
    name: plan.name,
    amount: Number(plan.variation_amount),
    fixedPrice: plan.fixedPrice === "Yes"
  })).filter((plan) => typeof plan.code === "string" && plan.name && Number.isFinite(plan.amount) && plan.amount > 0);
}

async function debitWalletForPurchase(user, order) {
  if (!supabase) {
    throw Object.assign(new Error("Real purchases require the persistent Supabase wallet."), { statusCode: 503 });
  }
  const { error } = await supabase.rpc("toply_debit_wallet", {
    p_user_id: user.id,
    p_reference: order.id,
    p_amount_minor: Math.round(order.amount * 100),
    p_currency: "NGN"
  });
  if (error) {
    if (error.message && error.message.includes("INSUFFICIENT_BALANCE")) {
      throw Object.assign(new Error("Your NGN wallet balance is too low for this purchase."), { statusCode: 402 });
    }
    throw Object.assign(new Error(`Wallet debit could not be confirmed: ${error.message}`), { statusCode: 503 });
  }
}

async function refundWalletPurchase(userId, order) {
  if (!supabase) throw new Error("Cannot refund without the Supabase wallet.");
  const { error } = await supabase.rpc("toply_refund_wallet", {
    p_user_id: userId,
    p_purchase_reference: order.id,
    p_refund_reference: `refund-${order.id}`,
    p_amount_minor: Math.round(order.amount * 100),
    p_currency: "NGN"
  });
  if (error) throw new Error(`Wallet refund needs attention: ${error.message}`);
}

async function claimVtpassSubmission(userId, order) {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("toply_claim_vtpass_order", {
    p_user_id: userId,
    p_order_id: order.id
  });
  if (error) throw new Error(`Could not safely reserve this provider request: ${error.message}`);
  return data === true;
}

async function submitVtpassOrder(user, type, body) {
  const configurationError = vtpassConfigurationError();
  if (configurationError) throw Object.assign(new Error(configurationError), { statusCode: 503 });
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("The purchase request must be a JSON object."), { statusCode: 400 });
  }
  if (body.clientReference !== undefined &&
      (typeof body.clientReference !== "string" ||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientReference))) {
    throw Object.assign(new Error("The order reference is invalid."), { statusCode: 400 });
  }
  const orderId = body.clientReference || crypto.randomUUID();
  const existingOrder = await findOrderById(orderId, user.id);
  if (existingOrder) {
    if (existingOrder.type !== type || !existingOrder.provider?.startsWith("VTpass")) {
      throw Object.assign(new Error("This order reference was already used for a different order."), { statusCode: 409 });
    }
    return existingOrder;
  }
  const network = body.network;
  const serviceID = vtpassServiceId(type, network);
  const phone = typeof body.phone === "string" ? normalizeNigerianPhone(body.phone) : "";
  if (!serviceID) throw Object.assign(new Error("Choose a supported Nigerian airtime or data network."), { statusCode: 400 });
  if (!phone) throw Object.assign(new Error("Enter a valid Nigerian phone number."), { statusCode: 400 });

  let amount = body.amount;
  let variationCode;
  let planName;
  if (type === "data") {
    if (typeof body.variationCode !== "string" || body.variationCode.length > 100) {
      throw Object.assign(new Error("Choose a valid data plan."), { statusCode: 400 });
    }
    const plans = await vtpassDataPlans(network);
    const plan = plans.find((item) => item.code === body.variationCode);
    if (!plan) throw Object.assign(new Error("That data plan is no longer available. Refresh the plans and try again."), { statusCode: 409 });
    variationCode = plan.code;
    planName = plan.name;
    amount = plan.amount;
  } else if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 50 || amount > 100_000) {
    throw Object.assign(new Error("Enter an airtime amount between ₦50 and ₦100,000."), { statusCode: 400 });
  }

  const order = {
    id: orderId,
    userId: user.id,
    type,
    country: "Nigeria",
    currency: "NGN",
    amount,
    status: "pending",
    createdAt: new Date().toISOString(),
    network: vtpassNetworks[network].name,
    phone,
    requestId: vtpassRequestId(),
    serviceID,
    ...(variationCode ? { variationCode } : {}),
    provider: vtpassMode === "sandbox" ? "VTpass sandbox" : "VTpass",
    sandbox: vtpassMode === "sandbox",
    walletAmountMinor: vtpassMode === "live" ? Math.round(amount * 100) : 0,
    providerAttempted: false
  };
  if (type === "data") order.plan = planName;
  try {
    await insertOrder(order);
  } catch (error) {
    if (error.code === "23505") {
      const existing = await findOrderById(order.id, user.id);
      if (existing && existing.type === type && existing.provider?.startsWith("VTpass")) return existing;
    }
    throw error;
  }

  if (vtpassMode === "live") {
    try {
      await debitWalletForPurchase(user, order);
      order.walletDebited = true;
      await updateOrder(order);
    } catch (error) {
      order.status = error.statusCode === 402 ? "failed" : "pending";
      order.providerMessage = error.statusCode === 402
        ? error.message
        : "Wallet debit is being verified. Check this order before trying again.";
      try {
        await updateOrder(order);
      } catch (persistError) {
        console.error("VTpass wallet-debit status could not be saved:", persistError.message);
        throw Object.assign(new Error("Wallet debit could not be confirmed. Do not submit this purchase again; check the order status or contact support."), {
          statusCode: 503, requestId: order.requestId, orderId: order.id
        });
      }
      if (error.statusCode !== 402) {
        throw Object.assign(new Error(order.providerMessage), {
          statusCode: 503, requestId: order.requestId, orderId: order.id
        });
      }
      throw Object.assign(error, { orderId: order.id, requestId: order.requestId });
    }
  }
  try {
    return await submitVtpassToProvider(user, order);
  } catch (error) {
    throw Object.assign(error, {
      statusCode: error.statusCode || 503,
      requestId: error.requestId || order.requestId,
      orderId: error.orderId || order.id
    });
  }
}

async function settleVtpassResult(user, order, providerResult) {
  const providerStatus = String(providerResult.content && providerResult.content.transactions &&
    providerResult.content.transactions.status || "").toLowerCase();
  order.providerCode = providerResult.code || "";
  order.providerMessage = providerResult.response_description || "";
  order.providerTransactionId = providerResult.content && providerResult.content.transactions &&
    String(providerResult.content.transactions.transactionId || "");
  order.status = providerStatus === "delivered" ? "delivered"
    : ["failed", "reversed"].includes(providerStatus) || String(providerResult.code) === "016" ? "failed" : "pending";
  await updateOrder(order);
  if (!order.sandbox && order.status === "failed" && order.walletDebited && !order.walletRefunded) {
    try {
      await refundWalletPurchase(user.id, order);
      order.walletRefunded = true;
      await updateOrder(order);
    } catch (error) {
      console.error("VTpass failed order refund failed:", error.message);
      throw Object.assign(new Error("The provider reported failure but the wallet refund did not complete. Do not retry the purchase; contact support."), {
        statusCode: 503, orderId: order.id
      });
    }
  }
  return order;
}

async function submitVtpassToProvider(user, order) {
  if (!order.providerAttempted) {
    if (!order.sandbox) {
      const claimed = await claimVtpassSubmission(user.id, order);
      if (!claimed) {
        const latestOrder = await findOrderById(order.id, user.id);
        if (!latestOrder) throw new Error("The order could not be found after checking its submission state.");
        return requeryVtpassOrder(user, latestOrder);
      }
    }
    order.providerAttempted = true;
    order.providerAttemptedAt = new Date().toISOString();
    await updateOrder(order);
  }
  let providerResult;
  try {
    providerResult = await vtpassRequest("pay", {
      method: "POST",
      body: {
        request_id: order.requestId,
        serviceID: order.serviceID,
        amount: order.amount,
        phone: order.phone,
        ...(order.variationCode ? { variation_code: order.variationCode } : {})
      }
    });
  } catch (error) {
    order.status = "pending";
    order.providerMessage = "The provider response could not be confirmed. Check the transaction status before trying again.";
    await updateOrder(order);
    throw Object.assign(new Error(order.providerMessage), {
      statusCode: 503, requestId: order.requestId, orderId: order.id
    });
  }
  return settleVtpassResult(user, order, providerResult);
}

async function requeryVtpassOrder(user, order) {
  if (order.status === "failed") {
    if (!order.sandbox && order.walletDebited && !order.walletRefunded) {
      await refundWalletPurchase(user.id, order);
      order.walletRefunded = true;
      await updateOrder(order);
    }
    return order;
  }
  if (Boolean(order.sandbox) !== (vtpassMode === "sandbox")) {
    throw Object.assign(new Error("This order was created in a different VTpass environment. Restore its original environment before checking it."), {
      statusCode: 503
    });
  }
  if (order.status !== "pending") return order;
  if (!order.sandbox && !order.walletDebited) {
    try {
      await debitWalletForPurchase(user, order);
    } catch (error) {
      if (error.statusCode === 402) {
        order.status = "failed";
        order.providerMessage = error.message;
        await updateOrder(order);
        return order;
      }
      throw error;
    }
    order.walletDebited = true;
    await updateOrder(order);
  }
  if (!order.providerAttempted) return submitVtpassToProvider(user, order);
  const attemptedAt = Date.parse(order.providerAttemptedAt || "");
  if (!Number.isFinite(attemptedAt) || Date.now() - attemptedAt < 30_000) {
    order.providerMessage = "The provider submission is still being confirmed. Wait briefly, then check again.";
    order.statusCheckedAt = new Date().toISOString();
    await updateOrder(order);
    return order;
  }
  const result = await vtpassRequest("requery", {
    method: "POST",
    body: { request_id: order.requestId }
  });
  await settleVtpassResult(user, order, result);
  order.statusCheckedAt = new Date().toISOString();
  await updateOrder(order);
  return order;
}

async function walletBalancesFor(userId) {
  return (await listWalletTransactions(userId))
    .filter((transaction) => transaction.userId === userId && transaction.status === "success")
    .reduce((balances, transaction) => {
      const direction = transaction.type === "purchase" ? -1 : 1;
      balances[transaction.currency] = (balances[transaction.currency] || 0) + direction * transaction.amountMinor;
      return balances;
    }, {});
}

async function verifyPaystackReference(reference, userId) {
  const configurationError = paystackConfigurationError();
  if (configurationError) throw Object.assign(new Error(configurationError), { statusCode: 503 });
  if (typeof reference !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(reference)) {
    throw Object.assign(new Error("Payment reference is invalid."), { statusCode: 400 });
  }
  const pending = await findWalletTransactionByReference(reference);
  if (!pending || pending.userId !== userId) {
    throw Object.assign(new Error("No pending deposit was found for this account."), { statusCode: 404 });
  }
  const verified = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (verified.status !== "success" || verified.reference !== pending.reference ||
      verified.amount !== pending.amountMinor || verified.currency !== pending.currency) {
    throw Object.assign(new Error("Paystack has not confirmed this deposit. Your balance has not changed."), { statusCode: 409 });
  }
  return confirmWalletTransaction(reference, userId, verified);
}

async function handlePaystackWebhook(request, response) {
  const configurationError = paystackConfigurationError();
  if (configurationError) return jsonResponse(response, 503, { error: configurationError });
  const rawBody = await readRawBody(request);
  const receivedSignature = request.headers["x-paystack-signature"];
  const expectedSignature = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
  if (typeof receivedSignature !== "string" || !/^[a-f0-9]{128}$/i.test(receivedSignature) ||
      !crypto.timingSafeEqual(Buffer.from(receivedSignature, "hex"), Buffer.from(expectedSignature, "hex"))) {
    return jsonResponse(response, 401, { error: "Paystack webhook signature is invalid." });
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse(response, 400, { error: "Webhook body is not valid JSON." });
  }
  if (event.event !== "charge.success" || !event.data || typeof event.data.reference !== "string") {
    return jsonResponse(response, 200, { received: true });
  }
  const pending = await findWalletTransactionByReference(event.data.reference);
  if (!pending) return jsonResponse(response, 200, { received: true });
  try {
    await verifyPaystackReference(pending.reference, pending.userId);
    return jsonResponse(response, 200, { received: true });
  } catch (error) {
    console.error("Paystack webhook verification failed:", error.message);
    return jsonResponse(response, 503, { error: "Payment confirmation is pending verification." });
  }
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/paystack/webhook" && request.method === "POST") {
    return handlePaystackWebhook(request, response);
  }

  if (pathname === "/api/providers/vtpass/status" && request.method === "GET") {
    return jsonResponse(response, 200, {
      enabled: !vtpassConfigurationError(),
      environment: vtpassMode,
      walletPurchasesEnabled: vtpassMode === "live" && !vtpassConfigurationError()
    });
  }

  if (pathname === "/api/providers/vtpass/data-plans" && request.method === "GET") {
    const user = await currentUser(request);
    if (!user) return jsonResponse(response, 401, { error: "Please log in to view data plans." });
    try {
      const plans = await vtpassDataPlans(new URL(request.url, `http://${request.headers.host || "localhost"}`).searchParams.get("network"));
      return jsonResponse(response, 200, { currency: "NGN", plans });
    } catch (error) {
      return jsonResponse(response, error.statusCode || 502, { error: error.message });
    }
  }

  const vtpassOrderMatch = pathname.match(/^\/api\/providers\/vtpass\/orders\/(airtime|data)$/);
  if (vtpassOrderMatch && request.method === "POST") {
    if (!validateRequestOrigin(request)) return jsonResponse(response, 403, { error: "Request origin was rejected." });
    const user = await currentUser(request);
    if (!user) return jsonResponse(response, 401, { error: "Please log in before placing an order." });
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return jsonResponse(response, error.statusCode || 400, { error: error.message });
    }
    try {
      const order = await submitVtpassOrder(user, vtpassOrderMatch[1], body);
      return jsonResponse(response, 201, { order });
    } catch (error) {
      if (error.orderId) {
        return jsonResponse(response, error.statusCode || 503, {
          error: error.message, requestId: error.requestId, orderId: error.orderId
        });
      }
      console.error("VTpass order failed:", error.message);
      return jsonResponse(response, error.statusCode || 502, { error: error.message });
    }
  }

  const vtpassRequeryMatch = pathname.match(/^\/api\/providers\/vtpass\/orders\/([0-9a-f-]{36})\/requery$/i);
  if (vtpassRequeryMatch && request.method === "POST") {
    if (!validateRequestOrigin(request)) return jsonResponse(response, 403, { error: "Request origin was rejected." });
    const user = await currentUser(request);
    if (!user) return jsonResponse(response, 401, { error: "Please log in before checking an order." });
    try {
      const order = await findOrderById(vtpassRequeryMatch[1], user.id);
      if (!order || !order.requestId || !order.provider?.startsWith("VTpass")) {
        return jsonResponse(response, 404, { error: "VTpass order was not found." });
      }
      return jsonResponse(response, 200, { order: await requeryVtpassOrder(user, order) });
    } catch (error) {
      console.error("VTpass order status check failed:", error.message);
      return jsonResponse(response, error.statusCode || 502, { error: error.message });
    }
  }

  if (pathname === "/api/wallet" && request.method === "GET") {
    const user = await currentUser(request);
    if (!user) return jsonResponse(response, 401, { error: "You are not signed in." });
    const deposits = (await listWalletTransactions(user.id))
      .filter((transaction) => transaction.type === "deposit")
      .map(({ id, amountMinor, currency, status, createdAt }) => ({ id, amountMinor, currency, status, createdAt }));
    const refunds = (await listWalletTransactions(user.id))
      .filter((transaction) => transaction.type === "refund")
      .map(({ id, amountMinor, currency, status, createdAt }) => ({ id, amountMinor, currency, status, createdAt }));
    return jsonResponse(response, 200, { currency: paystackCurrency, balances: await walletBalancesFor(user.id), deposits, refunds });
  }

  if (pathname === "/api/payments/paystack/initialize" && request.method === "POST") {
    if (!validateRequestOrigin(request)) return jsonResponse(response, 403, { error: "Request origin was rejected." });
    const user = await currentUser(request);
    if (!user) return jsonResponse(response, 401, { error: "Please log in before adding money." });
    const configurationError = paystackConfigurationError();
    if (configurationError) return jsonResponse(response, 503, { error: configurationError });
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return jsonResponse(response, error.statusCode || 400, { error: error.message });
    }
    const amount = body && body.amount;
    const amountMinor = amount * 100;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) ||
        !Number.isSafeInteger(amountMinor) || amountMinor < minimumDepositMinor || amountMinor > maximumDepositMinor) {
      return jsonResponse(response, 400, { error: "Deposit must be between ₦100 and ₦10,000,000." });
    }
    if (!process.env.APP_BASE_URL && process.env.NODE_ENV === "production") {
      return jsonResponse(response, 503, { error: "Set APP_BASE_URL to your public HTTPS website before accepting payments." });
    }
    const baseUrl = (process.env.APP_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, "");
    if (process.env.NODE_ENV === "production" && !baseUrl.startsWith("https://")) {
      return jsonResponse(response, 503, { error: "Live payments require a public HTTPS APP_BASE_URL." });
    }
    try {
      const data = await paystackRequest("/transaction/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          amount: amountMinor,
          currency: paystackCurrency,
          callback_url: `${baseUrl}/index.html?payment=paystack`,
          metadata: { userId: user.id, purpose: "wallet_funding" }
        })
      });
      if (typeof data.reference !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(data.reference) ||
          typeof data.authorization_url !== "string" || !data.authorization_url.startsWith("https://")) {
        throw new Error("Paystack returned invalid checkout details.");
      }
      await insertWalletTransaction({
        id: crypto.randomUUID(),
        userId: user.id,
        reference: data.reference,
        type: "deposit",
        amountMinor,
        currency: paystackCurrency,
        status: "pending",
        createdAt: new Date().toISOString()
      });
      return jsonResponse(response, 201, { authorizationUrl: data.authorization_url, reference: data.reference });
    } catch (error) {
      console.error("Paystack initialization failed:", error.message);
      return jsonResponse(response, 502, { error: "Paystack could not start checkout. Please try again." });
    }
  }

  if (pathname === "/api/payments/paystack/verify" && request.method === "POST") {
    if (!validateRequestOrigin(request)) return jsonResponse(response, 403, { error: "Request origin was rejected." });
    const user = await currentUser(request);
    if (!user) return jsonResponse(response, 401, { error: "Please log in to verify this deposit." });
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return jsonResponse(response, error.statusCode || 400, { error: error.message });
    }
    try {
      const result = await verifyPaystackReference(body.reference, user.id);
      return jsonResponse(response, 200, result);
    } catch (error) {
      return jsonResponse(response, error.statusCode || 502, { error: error.message });
    }
  }

  if (pathname === "/api/auth/me" && request.method === "GET") {
    const user = await currentUser(request);
    if (!user) return jsonResponse(response, 200, { user: null });
    return jsonResponse(response, 200, { user });
  }

  if (pathname === "/api/auth/logout" && request.method === "POST") {
    if (!validateRequestOrigin(request)) {
      return jsonResponse(response, 403, { error: "Request origin was rejected." });
    }
    const token = getCookie(request, sessionCookie);
    if (/^[a-f0-9]{64}$/.test(token)) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await deleteSession(tokenHash);
    }
    return jsonResponse(response, 200, { ok: true }, { "Set-Cookie": cookieOptions(0) });
  }

  if (pathname === "/api/orders" && request.method === "GET") {
    const user = await currentUser(request);
    if (!user) return jsonResponse(response, 401, { error: "You are not signed in." });
    const orders = await listOrders(user.id);
    return jsonResponse(response, 200, { orders });
  }

  const orderMatch = pathname.match(/^\/api\/orders\/(airtime|data|giftcard)$/);
  if (orderMatch && request.method === "POST") {
    if (!validateRequestOrigin(request)) {
      return jsonResponse(response, 403, { error: "Request origin was rejected." });
    }
    const user = await currentUser(request);
    if (!user) return jsonResponse(response, 401, { error: "Please log in before saving an order." });
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return jsonResponse(response, error.statusCode || 400, { error: error.message });
    }
    const type = orderMatch[1];
    const validationError = validateOrder(body, type);
    if (validationError) return jsonResponse(response, 400, { error: validationError });
    const order = await saveOrder(user, type, body);
    return jsonResponse(response, 201, { order });
  }

  if ((pathname === "/api/auth/register" || pathname === "/api/auth/login") && request.method === "POST") {
    if (!validateRequestOrigin(request)) {
      return jsonResponse(response, 403, { error: "Request origin was rejected." });
    }
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return jsonResponse(response, error.statusCode || 400, { error: error.message });
    }
    const isRegistration = pathname.endsWith("/register");
    const validationError = validateAccountInput(body, isRegistration);
    if (validationError) return jsonResponse(response, 400, { error: validationError });

    const email = body.email.trim().toLowerCase();
    if (isRegistration) {
      const passwordHash = await makePasswordHash(body.password);
      if (await findUserByEmail(email)) {
        return jsonResponse(response, 409, { error: "An account with this email already exists. Try logging in." });
      }
      const name = body.name.trim().replace(/\s+/g, " ");
      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        passwordHash,
        createdAt: new Date().toISOString()
      };
      try {
        await insertUser(user);
      } catch (error) {
        if (error.code === "23505") {
          return jsonResponse(response, 409, { error: "An account with this email already exists. Try logging in." });
        }
        throw error;
      }
      await createSession(response, user.id);
      return jsonResponse(response, 201, { user: { id: user.id, name: user.name, email: user.email } });
    }

    const user = await findUserByEmail(email);
    const passwordMatches = user
      ? await verifyPassword(body.password, user.passwordHash)
      : await verifyPassword(body.password, await dummyPasswordHash);
    if (!user || !passwordMatches) {
      return jsonResponse(response, 401, { error: "Email or password is incorrect." });
    }
    await createSession(response, user.id);
    return jsonResponse(response, 200, { user: { id: user.id, name: user.name, email: user.email } });
  }

  return jsonResponse(response, 404, { error: "API route not found." });
}

async function handleRequest(request, response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return handleApi(request, response, url.pathname);

  const filename = path.basename(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  const contentType = publicFiles.get(filename);
  if (!contentType || request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  if (protectedPages.has(filename) && !await currentUser(request)) {
    response.writeHead(303, { Location: "/index.html", "Cache-Control": "no-store" });
    response.end();
    return;
  }

  const content = fs.readFileSync(path.join(root, filename));
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "Content-Length": content.length
  });
  response.end(request.method === "HEAD" ? undefined : content);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error("Request failed:", error);
    if (!response.headersSent) {
      jsonResponse(response, 500, { error: "The server could not complete this request." });
    } else {
      response.destroy();
    }
  });
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
initializeStorage().then(() => {
  server.listen(port, host, () => {
    console.log(`Toply is running at http://${host}:${port}`);
  });
}).catch((error) => {
  console.error("Storage initialization failed:", error);
  process.exitCode = 1;
});
