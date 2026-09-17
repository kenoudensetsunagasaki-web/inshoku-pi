
// Sends the "your listing is about to expire" reminder email via Gmail
// SMTP. Uses an App Password rather than the account's normal password —
// generate one at https://myaccount.google.com/apppasswords (requires
// 2-Step Verification to be turned on for the Google account first), then
// set EMAIL_USER and EMAIL_APP_PASSWORD in the server's environment (on
// Render: Dashboard → your service → Environment). See .env.example.
const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) return null;
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
  });
  return transporter;
}

// APP_URL lets the "renew here" link point at the right place in any
// environment; defaults to the production URL if not set.
const APP_URL = process.env.APP_URL || "https://inshoku-pi.onrender.com";

async function sendExpiryReminder({ to, storeName, expiresAt }) {
  const t = getTransporter();
  if (!t) {
    console.warn(
      "⚠ EMAIL_USER / EMAIL_APP_PASSWORD not set — skipping expiry reminder email. See .env.example."
    );
    return false;
  }

  const dateStr = new Date(expiresAt).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  await t.sendMail({
    from: `"PiFood & PiDrinks" <${process.env.EMAIL_USER}>`,
    to,
    subject: `【PiFood & PiDrinks】「${storeName}」の掲載期限のお知らせ`,
    text: `${storeName} 様

いつもPiFood & PiDrinksをご利用いただきありがとうございます。

ご登録いただいている店舗「${storeName}」の掲載期限が ${dateStr} に迫っています。
期限までに更新のお手続き(1π)をしていただかないと、掲載が検索結果から非表示になります。

更新はこちらのページから行えます:
${APP_URL}/mystore.html

このメールに心当たりがない場合は、お手数ですが破棄してください。

PiFood & PiDrinks 運営`,
  });

  return true;
}

module.exports = { sendExpiryReminder };
