// A2U test payout page. Signs the Pioneer in with Pi, then asks the server
// to send a small test payout. The server verifies the access token with Pi.
(function () {
  var btn = document.getElementById("go");
  var out = document.getElementById("result");

  function show(msg, cls) {
    out.textContent = msg;
    out.className = cls || "";
  }

  if (typeof Pi === "undefined") {
    show("Pi Browser で開いてください。", "ng");
    btn.disabled = true;
    return;
  }

  Pi.init({ version: "2.0", sandbox: false });

  btn.addEventListener("click", async function () {
    btn.disabled = true;
    show("Pi にサインインしています…");
    try {
      var auth = await Pi.authenticate(["username", "wallet_address"], function () {});
      show("送金しています…(数十秒かかることがあります)");
      var res = await fetch("/api/a2u/test-payout", {
        method: "POST",
        headers: { Authorization: "Bearer " + auth.accessToken },
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data.ok) {
        show("送金しました: " + data.amount + " Test-π", "ok");
      } else if (res.status === 409) {
        show("すでに送金済みです。ありがとうございました。", "ok");
      } else {
        show("送金できませんでした(" + res.status + ")。" + (data.error || ""), "ng");
        btn.disabled = false;
      }
    } catch (e) {
      show("エラーが発生しました。もう一度お試しください。", "ng");
      btn.disabled = false;
    }
  });
})();
