/* ============================================================
   紹介を入れる ― 本のページの「この本について」を書き込む

     node 04_tools/紹介を入れる.mjs --下見 <紹介.json>
     node 04_tools/紹介を入れる.mjs <紹介.json>

   紹介.json は { "<ISBN13>": ["紹介の文（200字以内）", "出どころ"], … }

   ⚠️⚠️ **紹介は、確かめた出どころに基づいて書く。**出どころの無い本には作らない（2026-09-26 持ち主の決定）。
      探す順：openBD の内容紹介 → Google Books → 出版社・書店 → ブクログ・読書メーター。
      それでも無ければ「保留」にして持ち主に知らせ、持ち主が本を探して書く。
      出どころの文は写さず、自分の言葉で書く。結末には触れない。
   ⚠️ 書くのは Claude Code（案A）。持ち主が最後に確かめて直す。
   ⚠️⚠️ **持ち主が管理画面で直した紹介（intro.checkedAt がある）は上書きしない。**
   ⚠️ 200字を超えるものは書かずに止める。

   books/{isbn}.intro : { text, source, madeBy:"AI", madeAt, checkedAt|null }

   環境変数: HONGAESHI_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const 引数 = process.argv.slice(2);
const 下見 = 引数.includes("--下見");
const ファイル = 引数.find(x=>!x.startsWith("--"));
if(!ファイル){ console.error("× 紹介.json を渡してください。"); process.exit(1); }

const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){ console.error("× HONGAESHI_KEY を渡してください。"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const 紹介ら = JSON.parse(readFileSync(ファイル, "utf8"));
const 長すぎ = Object.entries(紹介ら).filter(([, [t]])=>[...t].length > 200);
if(長すぎ.length){
  長すぎ.forEach(([k, [t]])=>console.error(`× ${k} が ${[...t].length}字です（200字まで）`));
  process.exit(1);
}

const 束 = db.batch();
const 数 = { 入れる:0, 直し済みで触らない:0, 棚に無い:0 };
const 今 = new Date().toISOString();
for(const [isbn, [text, source]] of Object.entries(紹介ら)){
  const d = await db.doc(`books/${isbn}`).get();
  if(!d.exists){ 数.棚に無い++; console.log(`  × ${isbn} は棚にありません`); continue; }
  if(d.data().intro?.checkedAt){ 数.直し済みで触らない++; console.log(`  ― ${d.data().title}（持ち主が直し済み。触らない）`); continue; }
  数.入れる++;
  束.update(d.ref, { intro: { text, source: source || null, madeBy:"AI", madeAt:今, checkedAt:null } });
}
console.log(`\n入れる ${数.入れる}冊 ／ 直し済みで触らない ${数.直し済みで触らない}冊 ／ 棚に無い ${数.棚に無い}冊`);
if(下見){ console.log("（下見なので、何も書いていません）"); process.exit(0); }
if(数.入れる) await 束.commit();
console.log("✓ 書きました。");
process.exit(0);
