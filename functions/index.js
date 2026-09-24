/* ============================================================
   本返し ― 知らせる（Cloud Functions）

   ⚠️⚠️ **ここは「知らせる」だけ。データベースには何も書かない。**
      README の方針「Cloud Functions を使わない」の理由は、書き込みの筋道を2本にしないこと
      （お金の整合性は firestore.rules だけで守る）。読むだけ・メールを送るだけの処理は
      それに当たらないので、2026-09-24 にこれだけ足した。**ここから Firestore に書かないこと。**

   知らせるもの（送信元・送信先とも 運営の Gmail）
     ・登録の申請（requests）     … 1件ごと
     ・訂正の連絡（reports）      … 1件ごと
     ・本返し・ことば・復刊を願う … 1日1回まとめて（毎晩21時・日本時間）

   ⚠️ 送り方は 送る() の1か所だけ。いまは Gmail のアプリ パスワード（Secret Manager の
      GMAIL_APP_PASSWORD）。独自ドメインと SendGrid などに移すときは、ここだけ差し替える。
   ⚠️ 書き出す名前（notifyRequest など）だけは ASCII。Cloud Functions の名前に日本語は使えない
      （Firestore の項目名と同じ事情）。
   ⚠️ パスワードはコードにもリポジトリにも置かない。登録は持ち主が手元で
      `firebase functions:secrets:set GMAIL_APP_PASSWORD --project hongaeshi`
   ============================================================ */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions, logger } from "firebase-functions/v2";
import { defineSecret, defineString } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import nodemailer from "nodemailer";

initializeApp();
const db = getFirestore();

/* ⚠️ Firestore が東京（asia-northeast1）にあるので、きっかけを受ける処理も東京に置く */
setGlobalOptions({ region: "asia-northeast1", maxInstances: 2 });

const Gmailのパスワード = defineSecret("GMAIL_APP_PASSWORD");
/* 送信元＝送信先。独自ドメインに移すまでは運営の Gmail。
   ⚠️ アドレスはコードに書かない（リポジトリは公開）。functions/.env の NOTIFY_ADDRESS に書く（.gitignore 済み） */
const 運営の宛先 = defineString("NOTIFY_ADDRESS");
const サイト = "https://hongaeshi.web.app";

/* ── 送る（ここだけ差し替えれば SendGrid などに移れる） ── */
async function 送る(件名, 本文){
  const 宛先 = 運営の宛先.value();
  const 送り手 = nodemailer.createTransport({
    service: "gmail",
    auth: { user: 宛先, pass: Gmailのパスワード.value() }
  });
  await 送り手.sendMail({ from: `本返し <${宛先}>`, to: 宛先, subject: `［本返し］${件名}`, text: 本文 });
  logger.info("送りました", { 件名 });
}

/* ── 読むための小道具 ── */
const 名を引く = async uid => {
  if(!uid) return "（不明）";
  const u = await db.doc(`users/${uid}`).get();
  return u.exists ? (u.data().name || "（名乗りなし）") : "（名乗りなし）";
};
const 題を引く = async isbn => {
  if(!isbn) return null;
  const b = await db.doc(`books/${isbn}`).get();
  if(!b.exists) return `（棚に無い本 ${isbn}）`;
  const x = b.data();
  return x.title + (x.subtitle ? " " + x.subtitle : "");
};
const 日本時間 = t => (t?.toDate ? t.toDate() : new Date())
  .toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

/* ── 登録の申請：1件ごと ── */
export const notifyRequest = onDocumentCreated(
  { document: "requests/{id}", secrets: [Gmailのパスワード] },
  async e => {
    const x = e.data?.data(); if(!x) return;
    await 送る(`登録の申請：${x.title}`, [
      `登録の申請が届きました。`,
      ``,
      `書名　　：${x.title}`,
      `著者　　：${x.author || "―"}`,
      `出版社　：${x.publisher || "―"}`,
      `ISBN　　：${x.isbn || "―"}`,
      `ひとこと：${x.memo || "―"}`,
      `申請した人：${await 名を引く(x.from)}`,
      `いつ　　：${日本時間(x.at)}`,
      ``,
      `管理画面で「本にする」か「見送り」を選んでください：`,
      `${サイト}/admin`
    ].join("\n"));
  });

/* ── 訂正の連絡：1件ごと ── */
export const notifyReport = onDocumentCreated(
  { document: "reports/{id}", secrets: [Gmailのパスワード] },
  async e => {
    const x = e.data?.data(); if(!x) return;
    const 対象 = x.book ? `本『${await 題を引く(x.book)}』\n${サイト}/b/${x.book}`
               : x.entity ? `相手「${x.entity}」\n${サイト}/e/${encodeURIComponent(x.entity)}`
               : "（全体）";
    await 送る(`訂正の連絡：${x.kind}`, [
      `訂正の連絡が届きました。`,
      ``,
      `どこ　：${対象}`,
      `なに　：${x.kind}`,
      `中身　：`,
      x.text,
      ``,
      `知らせた人：${await 名を引く(x.from)}`,
      `いつ　　　：${日本時間(x.at)}`,
      ``,
      `管理画面の「訂正」で処理済みにできます：${サイト}/admin`
    ].join("\n"));
  });

/* ── 本返し・ことば・復刊を願う：1日1回まとめて ──
   ⚠️ 1件ごとに送ると、増えたときにメールが埋まる。まとめて読むほうが
      「今日はどの本が推されたか」をつかみやすい（2026-09-24 決定）。
   ⚠️ 何も無かった日は送らない。 */
export const dailyDigest = onSchedule(
  { schedule: "0 21 * * *", timeZone: "Asia/Tokyo", secrets: [Gmailのパスワード] },
  async () => {
    const から = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
    const 読む = 名 => db.collection(名).where("at", ">=", から).orderBy("at", "asc").get();
    const [返, 声, 残] = await Promise.all([読む("returns"), 読む("voices"), 読む("keeps")]);
    if(返.empty && 声.empty && 残.empty){ logger.info("今日は何もありませんでした"); return; }

    const 行 = [];
    if(!返.empty){
      const 計 = 返.docs.reduce((s, d)=>s + (d.data().amount || 0), 0);
      行.push(`■ 本返し ${返.size}件（合計 ${計.toLocaleString()}pt）`);
      for(const d of 返.docs){ const x = d.data();
        行.push(`・『${await 題を引く(x.book)}』 ${x.amount.toLocaleString()}pt　${x.anon ? "匿名" : await 名を引く(x.from)}　${日本時間(x.at)}`); }
      行.push("");
    }
    if(!声.empty){
      行.push(`■ ことば ${声.size}件`);
      for(const d of 声.docs){ const x = d.data();
        行.push(`・『${await 題を引く(x.book)}』　${x.anon ? "匿名" : await 名を引く(x.from)}　${日本時間(x.at)}`);
        行.push(`　${String(x.text || "").replace(/\n/g, "\n　")}`); }
      行.push("");
    }
    if(!残.empty){
      行.push(`■ 復刊を願う ${残.size}件`);
      for(const d of 残.docs){ const x = d.data();
        行.push(`・『${await 題を引く(x.book)}』 ${x.pledge ? x.pledge.toLocaleString() + "pt の意思" : "ポイントは決めない"}　${await 名を引く(x.from)}`); }
      行.push("");
    }
    行.push(`（直した・消したことばは、書いた日で数えています）`, サイト);
    await 送る(`今日の推し：本返し ${返.size}・ことば ${声.size}・復刊 ${残.size}`, 行.join("\n"));
  });
