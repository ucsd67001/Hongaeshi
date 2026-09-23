/* ============================================================
   著者を直す ― 書誌から取り込んだ著者名を、人が決めた形に直す

     node 04_tools/著者を直す.mjs --下見
     node 04_tools/著者を直す.mjs
     node 04_tools/著者を直す.mjs --掃除   ← どの本も指していない主体を消す

   ⚠️⚠️ **書誌の著者欄は、著者と翻訳者を区別しない。**
      実際に取り込んだ38冊のうち、翻訳のある11冊すべてで
      訳者が著者として登録された（『モモ』の大島かおり、
      『ライ麦畑』の野崎孝、『1984』の高橋和久…）。
      openBD が「／訳」と役割を書いてくれるのは一部だけで、
      Google Books の authors 配列には役割がまったく無い。
      **機械には分けられない。人が決めるしかない。**

   ⚠️ **海外の著者はローマ字で入ってくる**（Michael Ende, DanteAlighieri）。
      日本語のサービスなので、読者が知っている表記（ミヒャエル・エンデ）に直す。
      これも機械にはできない（読みを当てる辞書が要る）。

   ⚠️ 直すのは books.authorText と books.to。**entities は消さない。**
      使われなくなった主体は --掃除 で別途消す（消す前に必ず下見すること）。

   環境変数: HONGAESHI_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { 主体のid, 出版社キー, 著者キー } from "../public/名寄せ.js";

/* ISBN → 正しい著者（複数可）。翻訳者は入れない（いまの方針） */
const 直す表 = {
  // 海外の著者：ローマ字 → 読者が知っている表記
  "9784001141276": ["ミヒャエル・エンデ"],            // モモ
  "9784041092453": ["ジョージ・オーウェル"],          // 1984
  "9784151200533": ["ジョージ・オーウェル"],          // 一九八四年
  "9784560070512": ["J.D.サリンジャー"],              // ライ麦畑でつかまえて
  "9784560090008": ["J.D.サリンジャー"],              // キャッチャー・イン・ザ・ライ
  "9784062922425": ["ダンテ・アリギエーリ"],          // 神曲 地獄篇
  "9784062922432": ["ダンテ・アリギエーリ"],          // 神曲 煉獄篇
  "9784062922449": ["ダンテ・アリギエーリ"],          // 神曲 天国篇
  "9784334110475": ["ウィリアム・シェイクスピア"],    // ロミオとジュリエット
  "9784560071328": ["ロバート・ニュートン・ペック"],  // 豚の死なない日

  // エルマー3部作：目録形式の生データ・著者なし・ローマ字がそれぞれ入っていた
  "9784834000139": ["ルース・スタイルス・ガネット"],  // エルマーのぼうけん
  "9784834000351": ["ルース・スタイルス・ガネット"],  // エルマーとりゅう
  "9784834000498": ["ルース・スタイルス・ガネット"],  // エルマーと16ぴきのりゅう

  // 2026-09-23 追加分
  "9784334752569": ["プラトン"],                      // ソクラテスの弁明
  "9784001140583": ["J.R.R.トールキン"],              // ホビットの冒険 上
  "9784001140590": ["J.R.R.トールキン"],              // ホビットの冒険 下
  "9784152099457": ["パオロ・ジョルダーノ"],          // コロナの時代の僕ら
  "9784990428808": ["太宰治"],                        // カチカチ山
  "9784041010624": ["水野良"],                        // ロードス島戦記（安田均は監修）
  "9784895831154": ["ペッパー・ホワイト"],            // アイディアファクトリー

  // 2026-09-23 追加分（その2）
  "9784001151213": ["木下順二"],                      // かにむかし（清水崑は絵）
  "9784003355015": ["レオナルド・ダ・ヴィンチ"],      // 手記 上
  "9784003355022": ["レオナルド・ダ・ヴィンチ"],      // 手記 下
  "9784101017525": ["ブレイディみかこ"],              // ぼくはイエローで…
  "9784101017532": ["ブレイディみかこ"],              // ぼくはイエローで… 2
  "9784334102197": ["ヨハン・ヴォルフガング・フォン・ゲーテ"], // 若きウェルテルの悩み
  "9784334753221": ["アリストテレス"],                // ニコマコス倫理学 上
  "9784334753245": ["アリストテレス"],                // ニコマコス倫理学 下
  "9784591091661": ["クリス・クラッチャー"],          // アイアンマン
  "9784794207265": ["ジョナサン・リットマン"],        // FBIが恐れた伝説のハッカー 上
  "9784794207272": ["ジョナサン・リットマン"],        // 同 下
  "9784003311516": ["岡倉覚三"],                      // 茶の本（村岡博は訳）
  "9784560090008": ["J.D.サリンジャー"],              // キャッチャー・イン・ザ・ライ
};

const 下見 = process.argv.includes("--下見");
const 掃除 = process.argv.includes("--掃除");

const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){ console.error("× HONGAESHI_KEY を渡してください。"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const 本ら = await db.collection("books").get();
const 主体ら = await db.collection("entities").get();
const 主体表 = new Map(主体ら.docs.map(d=>[d.id, d.data()]));

const 直す = [], 作る主体 = new Map();

for(const d of 本ら.docs){
  const x = d.data();
  const 新著者 = 直す表[d.id];
  if(!新著者) continue;

  /* 出版社は元のまま。著者だけ差し替える */
  const 出版社ら = (x.to || []).filter(id=>主体表.get(id)?.type === "publisher");
  const 新受取 = [];
  新著者.forEach(名=>{
    const id = 主体のid("author", 名);
    新受取.push(id);
    作る主体.set(id, { id, type:"author", name:名, key:著者キー(名) });
  });
  新受取.push(...出版社ら);

  console.log(`\n  ${x.title}`);
  console.log(`    前: ${x.authorText || "（なし）"}`);
  console.log(`    後: ${新著者.join("、")}`);
  console.log(`    届け先 ${(x.to||[]).join(" ")}`);
  console.log(`         → ${新受取.join(" ")}`);
  直す.push({ id: d.id, authorText: 新著者.join("、"), to: 新受取 });
}

/* どの本からも指されなくなる主体をさがす */
const 直したあとの参照 = new Set();
本ら.docs.forEach(d=>{
  const 直し = 直す.find(x=>x.id === d.id);
  (直し ? 直し.to : (d.data().to || [])).forEach(id=>直したあとの参照.add(id));
});
作る主体.forEach((_, id)=>直したあとの参照.add(id));
const 孤児 = 主体ら.docs.filter(d=>!直したあとの参照.has(d.id));

console.log(`\n${"=".repeat(64)}`);
console.log(`直す本 ${直す.length}冊 ／ 作る主体 ${作る主体.size}件`);
if(孤児.length){
  console.log(`\nどの本も指さなくなる主体 ${孤児.length}件${掃除 ? "（消します）" : "（--掃除 で消せます）"}:`);
  孤児.forEach(d=>console.log(`   ${d.id}   ${d.data().name}`));
}

if(下見){ console.log("\n（下見なので、何も書いていません）"); process.exit(0); }
if(!直す.length && !(掃除 && 孤児.length)){ console.log("直すものがありません。"); process.exit(0); }

const 束 = db.batch();
for(const [, e] of 作る主体)
  束.set(db.collection("entities").doc(e.id),
    { type:e.type, name:e.name, key:e.key, aliases:[e.name],
      claimed:false, claimedBy:null, detail:{}, updatedAt:new Date().toISOString() },
    { merge:true });
直す.forEach(x=>束.update(db.collection("books").doc(x.id),
  { authorText: x.authorText, to: x.to }));
if(掃除) 孤児.forEach(d=>束.delete(d.ref));
await 束.commit();
console.log(`\n✓ 直しました。`);
process.exit(0);
