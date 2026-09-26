/* ============================================================
   在庫を入れる ― Amazon で調べた「流通中／品切れ」を本に書き込む

     node 04_tools/在庫を入れる.mjs --下見 <判定.json> [--日 2026-09-24]
     node 04_tools/在庫を入れる.mjs <判定.json> [--日 2026-09-24]

   判定.json は { "<ASIN(=ISBN-10)>": ["流通"|"品切れ"|"要確認", "題"], … }。
   作り方は README の「品切れを調べる」。

   ⚠️⚠️ **判定そのものは、この道具ではできない。**Amazon は手元のプログラム（Node の fetch や curl）に
      ブラウザとは別の中身を返す（表紙で踏んだのと同じ）。**ブラウザの中で** amazon.co.jp を開いた
      タブから fetch('/dp/…') して判定し、その結果のファイルをここで書き込む。
   ⚠️ 判定の決まり（2026-09-24、全89冊で見立てと合った）：
        新品の購入欄があり、販売元が Amazon.co.jp  → 流通
        新品の購入欄が無く、中古だけ              → 品切れ（status:"絶版"）
        新品を売っているのが書店（古書店）だけ    → 要確認（流通のまま。人が決める）
        新品も中古も出品が1つも無い              → 出品なし（status:"絶版"。2026-09-26 に足した）
   ⚠️ **「Amazon に新品が無い」は「絶版」ではなく「品切れ」。**一時的な在庫切れも拾うので、
      画面では「品切れ」と書き、判定の日と根拠を必ず添える（statusNote / statusCheckedAt）。
   ⚠️ **管理者が手で決めた本（statusNote が「管理者が設定」）は上書きしない。**
   ⚠️ 要確認は status を変えない（日付と根拠だけ残す）。

   環境変数: HONGAESHI_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const 引数 = process.argv.slice(2);
const 下見 = 引数.includes("--下見");
const 日の位置 = 引数.indexOf("--日");
const 日 = 日の位置 >= 0 ? 引数[日の位置 + 1] : new Date().toISOString().slice(0, 10);
const ファイル = 引数.find((x, i) => !x.startsWith("--") && 引数[i - 1] !== "--日");
if(!ファイル){ console.error("× 判定.json を渡してください。"); process.exit(1); }

const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){ console.error("× HONGAESHI_KEY を渡してください。"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const 判定 = JSON.parse(readFileSync(ファイル, "utf8"));
const 根拠 = { 流通:"Amazon で新品あり", 品切れ:"Amazon で新品なし（中古のみ）",
               出品なし:"Amazon で新品・中古とも出品なし",
               要確認:"Amazon では書店の新品のみ（要確認）" };

/* ISBN-13 → ISBN-10（＝本の ASIN） */
function ISBN10(isbn13){
  const d = String(isbn13 || "").replace(/[^0-9]/g, "");
  if(d.length !== 13 || !d.startsWith("978")) return null;
  const 体 = d.slice(3, 12); let 和 = 0;
  for(let i = 0; i < 9; i++) 和 += Number(体[i]) * (10 - i);
  const 余 = 11 - (和 % 11);
  return 体 + (余 === 11 ? "0" : 余 === 10 ? "X" : String(余));
}

const 本ら = await db.collection("books").get();
const 束 = db.batch();
const 数 = { 流通:0, 品切れ:0, 出品なし:0, 要確認:0, 変わる:0, 手で決めた:0, 判定なし:0 };

/* 1つの版（作品の本体か editions の1件）を判定する。書き込む項目を返す。判定が無い・手で決めたなら null
   ⚠️ 版（2026-09-26〜）も同じ決まりで見る。作品が「品切れ」と出るのは、全部の版が品切れのとき（共通.js） */
function 見る(x, isbn, 名){
  const url = (x.amazonLinks && x.amazonLinks[0]?.url) || x.amazonUrl || "";
  const asin = (url.match(/\/dp\/([0-9A-Z]{10})/) || [])[1] || ISBN10(isbn);
  const 結果 = 判定[asin]?.[0];
  if(!結果){ 数.判定なし++; return null; }
  if(x.statusNote === "管理者が設定"){ 数.手で決めた++; return null; }
  数[結果]++;
  const 新しい = (結果 === "品切れ" || 結果 === "出品なし") ? "絶版" : 結果 === "流通" ? "流通" : (x.status || "流通");
  if(新しい !== (x.status || "流通")){
    数.変わる++;
    console.log(`  ${x.status || "流通"} → ${新しい}   ${名}`);
  }
  return { status: 新しい, statusNote: 根拠[結果], statusCheckedAt: 日 };
}

for(const d of 本ら.docs){
  const x = d.data();
  const 名 = `${x.title}${x.subtitle ? " " + x.subtitle : ""}`;
  const 本体 = 見る(x, d.id, 名);
  const 版ら = x.editions || [];
  const 新しい版ら = 版ら.map(v=>{ const w = 見る(v, v.isbn, `${名}（${v.label}）`); return w ? { ...v, ...w } : v; });
  const 版が変わる = 新しい版ら.some((v, i)=>v !== 版ら[i]);
  if(本体 || 版が変わる) 束.update(d.ref, { ...(本体 || {}), ...(版が変わる ? { editions: 新しい版ら } : {}) });
}

console.log(`\n流通 ${数.流通} ／ 品切れ ${数.品切れ} ／ 出品なし ${数.出品なし} ／ 要確認 ${数.要確認}` +
  `　（状態が変わる ${数.変わる}冊・手で決めた本は触らない ${数.手で決めた}冊・判定なし ${数.判定なし}冊）`);
if(下見){ console.log("（下見なので、何も書いていません）"); process.exit(0); }
await 束.commit();
console.log(`✓ 書きました（${日} 時点）。`);
process.exit(0);
