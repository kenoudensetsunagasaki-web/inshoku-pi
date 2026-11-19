// App-to-User (A2U) test payout.
//
// Pi Developer Portal requires the paired Testnet app to have made A2U
// payments to 5 unique wallets before it grants a Mainnet app wallet. This
// route lets a signed-in Pioneer press one button on /a2u-test.html and
// receive a tiny payout from the app wallet.
//
// It is OFF unless A2U_TEST_ENABLED=true, and it needs PI_API_KEY (the
// Testnet app's key) plus PI_WALLET_PRIVATE_SEED (the Testnet app wallet's
// secret seed, starts with "S"). The seed is read only from the environment,
// is never logged and is never sent anywhere except to sign the transaction
// locally.
//
// Flow (same steps as Pi's official pi-nodejs library):
//   1. POST /v2/payments            -> Pi creates the A2U payment
//   2. build + sign + submit a Stellar payment from the app wallet to the
//      user's wallet (memo = payment identifier) on Pi's Horizon server
//   3. POST /v2/payments/{id}/complete with the transaction id
const express = require("express");
const router = express.Router();

const PI_API_BASE = "https://api.minepi.com/v2";
const PI_API_KEY = process.env.PI_API_KEY || "";

const NETWORKS = {
  testnet: { horizon: "https://api.testnet.minepi.com", passphrase: "Pi Testnet" },
  mainnet: { horizon: "https://api.mainnet.minepi.com", passphrase: "Pi Network" },
};

const PAYOUT_AMOUNT_PI = 0.01;
const MAX_PAYOUTS_PER_PROCESS = 20;

// Users already paid by this process (one test payout per Pioneer).
const paidUids = new Set();

// Only one payout at a time: they all share one wallet, and two parallel
// transactions from the same account would collide on the sequence number.
let queue = Promise.resolve();
function runExclusive(fn) {
  const next = queue.then(fn);
  queue = next.catch(() => {});
  return next;
}

function piHeaders() {
  return {
    Authorization: `Key ${PI_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function piFetch(path, { method = "GET", body } = {}) {
  const r = await fetch(`${PI_API_BASE}${path}`, {
    method,
    headers: piHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    // Pi's error text (never contains our key) makes failures diagnosable from the logs.
    const detail = (await r.text().catch(() => "")).slice(0, 300);
    throw new Error(`Pi API ${method} ${path.split("?")[0]} failed: ${r.status} ${detail}`);
  }
  return r.json();
}

// Who is calling? Ask Pi, using the user's own access token.
async function verifyUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const r = await fetch(`${PI_API_BASE}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const me = await r.json();
  if (!me || typeof me.uid !== "string" || !me.uid) return null;
  return { uid: me.uid, username: me.username || "" };
}

// A server payment left half-finished (for example after a crash) blocks
// creating a new one, so finish or cancel it first.
async function recoverIncomplete() {
  const data = await piFetch("/payments/incomplete_server_payments");
  for (const p of data.incomplete_server_payments || []) {
    const txid = p.transaction && p.transaction.txid;
    if (txid) {
      await piFetch(`/payments/${encodeURIComponent(p.identifier)}/complete`, {
        method: "POST",
        body: { txid },
      });
    } else {
      await piFetch(`/payments/${encodeURIComponent(p.identifier)}/cancel`, { method: "POST" });
    }
  }
}

// Build, sign and submit the Stellar transaction. Returns the transaction id.
async function submitStellarPayment(payment) {
  // Loaded here, not at the top of the file, so a problem with this module
  // can never stop the rest of the app from starting.
  const StellarSdk = require("@stellar/stellar-sdk");

  const seed = process.env.PI_WALLET_PRIVATE_SEED || "";
  if (!/^S[A-Z2-7]{55}$/.test(seed)) throw new Error("PI_WALLET_PRIVATE_SEED is not set or not valid");

  const keypair = StellarSdk.Keypair.fromSecret(seed);
  if (keypair.publicKey() !== payment.from_address) {
    throw new Error("PI_WALLET_PRIVATE_SEED does not belong to this app's wallet");
  }

  const isTestnet = String(payment.network || "").toLowerCase().includes("test");
  const net = isTestnet ? NETWORKS.testnet : NETWORKS.mainnet;

  const horizon = new StellarSdk.Horizon.Server(net.horizon);
  const account = await horizon.loadAccount(keypair.publicKey());
  const fee = await horizon.fetchBaseFee();
  const timebounds = await horizon.fetchTimebounds(180);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: String(fee),
    networkPassphrase: net.passphrase,
    timebounds,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: payment.to_address,
        asset: StellarSdk.Asset.native(),
        amount: String(payment.amount),
      })
    )
    .addMemo(StellarSdk.Memo.text(payment.identifier))
    .build();
  tx.sign(keypair);

  const result = await horizon.submitTransaction(tx);
  const txid = result && (result.id || result.hash);
  if (!txid) throw new Error("Horizon did not return a transaction id");
  return txid;
}

router.use((req, res, next) => {
  if (process.env.A2U_TEST_ENABLED !== "true") return res.status(404).json({ error: "not enabled" });
  next();
});

// POST /api/a2u/test-payout — Authorization: Bearer <Pi access token>
router.post("/test-payout", async (req, res) => {
  if (!PI_API_KEY) return res.status(503).json({ error: "PI_API_KEY is not configured" });
  try {
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: "sign in with Pi first" });
    if (paidUids.has(user.uid)) return res.status(409).json({ error: "already paid out to this Pioneer" });
    if (paidUids.size >= MAX_PAYOUTS_PER_PROCESS) return res.status(429).json({ error: "test payout limit reached" });

    const result = await runExclusive(async () => {
      if (paidUids.has(user.uid)) return { duplicate: true };

      await recoverIncomplete().catch((err) => console.warn("[a2u] recover failed:", err.message));

      const payment = await piFetch("/payments", {
        method: "POST",
        body: {
          payment: {
            amount: PAYOUT_AMOUNT_PI,
            memo: "PiFood & PiDrinks A2U test",
            metadata: { type: "a2u_test" },
            uid: user.uid,
          },
        },
      });

      let txid;
      try {
        txid = await submitStellarPayment(payment);
      } catch (err) {
        // Nothing was sent: release the Pi payment so the next try can start clean.
        await piFetch(`/payments/${encodeURIComponent(payment.identifier)}/cancel`, { method: "POST" }).catch(() => {});
        throw err;
      }

      await piFetch(`/payments/${encodeURIComponent(payment.identifier)}/complete`, {
        method: "POST",
        body: { txid },
      });
      paidUids.add(user.uid);
      console.log(`[a2u] test payout sent (${paidUids.size} so far)`);
      return { txid };
    });

    if (result.duplicate) return res.status(409).json({ error: "already paid out to this Pioneer" });
    res.json({ ok: true, amount: PAYOUT_AMOUNT_PI, txid: result.txid });
  } catch (err) {
    console.error("[a2u] test payout error:", err.message);
    res.status(502).json({ error: "payout failed" });
  }
});

module.exports = router;
