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
      .filter((item) => item.userId === userId && item.type === "deposit" && item.status === "success")
      .reduce((result, item) => {
        result[item.currency] = (result[item.currency] || 0) + item.amountMinor;
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

async function walletBalancesFor(userId) {
  return (await listWalletTransactions(userId))
    .filter((transaction) => transaction.userId === userId && transaction.type === "deposit" && transaction.status === "success")
    .reduce((balances, transaction) => {
      balances[transaction.currency] = (balances[transaction.currency] || 0) + transaction.amountMinor;
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

  if (pathname === "/api/wallet" && request.method === "GET") {
    const user = await currentUser(request);
    if (!user) return jsonResponse(response, 401, { error: "You are not signed in." });
    const deposits = (await listWalletTransactions(user.id))
      .filter((transaction) => transaction.type === "deposit")
      .map(({ id, amountMinor, currency, status, createdAt }) => ({ id, amountMinor, currency, status, createdAt }));
    return jsonResponse(response, 200, { currency: paystackCurrency, balances: await walletBalancesFor(user.id), deposits });
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
