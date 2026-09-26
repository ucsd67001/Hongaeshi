/* ============================================================
   絶版にする ― 絶版だと確かめた本に、根拠を添えて「絶版」を付ける

     node 04_tools/絶版にする.mjs --下見 <ISBN> "<根拠>"
     node 04_tools/絶版にする.mjs        <ISBN> "<根拠>"
     node 04_tools/絶版にする.mjs --品切れに戻す <ISBN>

   ⚠️⚠️ **「絶版」と出すのは、確かめた本だけ**（2026-09-26 決定 C）。
      Amazon に新品が無いだけなら「品切れ」のまま（在庫を入れる.mjs）。出版社の多くは
      「品切・重版未定」とし、絶版とは言わない。言い切ると出版社との関係を損ねかねない。
      根拠の例：出版社のページに「絶版」とある／出版社がもう無い（解散・廃業）
   ⚠️ 管理画面の「直す」で「絶版（確かめた）」を選ぶのと同じ記録を残す：
      status "絶版"・outOfPrint { note, checkedAt }・statusNote "管理者が設定"（自動の判定で上書きさせない）

   環境変数: HONGAESHI_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const 引数 = process.argv.slice(2);
const 下見 = 引数.includes("--下見");
const 戻す = 引数.includes("--品切れに戻す");
const [isbn, 根拠] = 引数.filter(x=>!x.startsWith("--"));
if(!isbn || (!戻す && !根拠)){
  console.error('× 使い方：node 04_tools/絶版にする.mjs [--下見] <ISBN> "<根拠>"  ／  --品切れに戻す <ISBN>');
  process.exit(1);
}
if(根拠 && 根拠.length > 80){ console.error("× 根拠は80字までにしてください。"); process.exit(1); }

const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){ console.error("× HONGAESHI_KEY を渡してください。"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const 本 = db.doc(`books/${isbn}`);
const x = (await 本.get()).data();
if(!x){ console.error(`× ${isbn} は棚にありません（作品の ISBN を渡してください）。`); process.exit(1); }
const 今日 = new Date().toISOString().slice(0, 10);
const いま = x.status !== "絶版" ? "流通中" : x.outOfPrint?.note ? `絶版（${x.outOfPrint.note}）` : "品切れ";
const 書く = 戻す
  ? { status: "絶版", outOfPrint: null, statusNote: "管理者が設定", statusCheckedAt: 今日 }
  : { status: "絶版", outOfPrint: { note: 根拠, checkedAt: 今日 }, statusNote: "管理者が設定", statusCheckedAt: 今日 };

console.log(`『${x.title}${x.subtitle ? " " + x.subtitle : ""}』 ${isbn}`);
console.log(`   いま：${いま}`);
console.log(`   → ${戻す ? "品切れ" : `絶版（${根拠}・${今日}時点）`}`);
if((x.editions || []).some(v=>v.status === "流通"))
  console.log("⚠ 買える版があります。画面では「流通中」のままになります（作品の状態は版をまとめて決まる）。");
if(下見){ console.log("（下見なので、何も書いていません）"); process.exit(0); }
await 本.update(書く);
console.log("✓ 書きました。");
process.exit(0);
