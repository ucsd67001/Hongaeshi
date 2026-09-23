/* ============================================================
   管理者にする ― admins に uid を入れる／外す

     node 04_tools/管理者にする.mjs                 ← いまの管理者を並べる
     node 04_tools/管理者にする.mjs <uid> [名前]     ← 管理者にする
     node 04_tools/管理者にする.mjs --外す <uid>     ← 管理者をやめさせる

   ⚠️ **admins コレクションはルールで書き込み禁止にしてある。**
      管理者を増やせるのは、この道具（Admin SDK）からだけ。
      画面から管理者を増やせるようにすると、
      「管理者が自分で管理者を作れる」入口ができてしまう。

   ⚠️ uid は Firebase コンソールの Authentication か、
      wallets コレクションのドキュメントIDで分かる。
   ============================================================ */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){
  console.error("× 環境変数 HONGAESHI_KEY に鍵の場所を入れてください。");
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const 引数 = process.argv.slice(2);

if(!引数.length){
  const s = await db.collection("admins").get();
  console.log(`管理者 ${s.size}人`);
  s.docs.forEach(d=>console.log(`  ${d.id}  ${d.data().name || ""}`));
  process.exit(0);
}

if(引数[0] === "--外す"){
  const uid = 引数[1];
  if(!uid){ console.error("× uid を指定してください。"); process.exit(1); }
  await db.collection("admins").doc(uid).delete();
  console.log(`✓ ${uid} を管理者から外しました。`);
  process.exit(0);
}

const [uid, 名前] = 引数;
await db.collection("admins").doc(uid).set({
  name: 名前 || "", addedAt: new Date().toISOString()
});
console.log(`✓ ${uid} を管理者にしました。${名前 ? `（${名前}）` : ""}`);
process.exit(0);
