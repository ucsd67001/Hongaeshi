/* ============================================================
   版を差し替える ― 棚の本を、別の版（たいてい文庫）に入れ替える

     node 04_tools/版を差し替える.mjs --下見
     node 04_tools/版を差し替える.mjs

   入れ替える組は、このファイルの「入れ替え」に書く。

   ⚠️⚠️ **なぜ入れ替えるのか。**
      Amazonで買えるのは文庫版なのに、棚には単行本が入っている、
      という食い違いが実際に起きた。本返しの単位は「作品」なので、
      **読者が実際に買える版に寄せる**という方針にした。
      （相談のうえ「B：文庫版に差し替える」を選んだ。2026-09-23）

   ⚠️⚠️ **本のIDは ISBN なので、差し替えは delete + create になる。**
      つまり **その本に届いた返しの記録は、行き先を失う。**
      いまは返しが1件も無いので安全だが、
      **トライアルを始めたあとは、この道具を使ってはいけない。**
      始まったあとに版を変えるなら、作品IDを別に持つ作りへ直すこと。

   ⚠️ 著者・出版社の主体は、あれば使い、無ければ作る（冪等）。
      古い本しか指していない主体が残ることがあるが、消さない。
      統合や整理は管理画面から人がやる。

   環境変数: HONGAESHI_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { openBDで引く, 著者をばらす, 読める名に, 主体のid, 出版社キー, 著者キー, 無い主体を作る } from "./書誌.mjs";

/* 消す本 → 入れる本（複数可）。巻で分かれているものは複数書く */
const 入れ替え = [
  { 消す:"9784163510804", 入れる:["9784167330088"] },   // ぼくはこんな本を読んできた 単行本→文庫
  { 消す:"9784163564807", 入れる:["9784167330125"] },   // 21世紀知の挑戦
  { 消す:"9784103955061", 入れる:["9784101387246"] },   // 新世紀デジタル講義
  { 消す:"9784163573106", 入れる:["9784167330156"] },   // ぼくが読んだ面白い本…
  { 消す:"9784163578507", 入れる:["9784167330163"] },   // 東大生はバカになったか
  { 消す:"9784103955030", 入れる:["9784270101544","9784270101551"] }, // 二十歳のころ → I / II
];

/* openBD に無い本の、手で入れる書誌（Google Books と Amazon で確かめたもの） */
const 手で補う = {
  "9784167330156": { 題:"ぼくが読んだ面白い本・ダメな本そしてぼくの大量読書術・驚異の速読術",
                     著:"立花隆", 版元:"文藝春秋", 年:2003 },
  "9784270101544": { 題:"二十歳のころ", 副題:"立花ゼミ『調べて書く』共同製作 I（1937-1958）",
                     著:"立花隆", 版元:"ランダムハウス講談社", 年:2008, 頁:613 },
  "9784270101551": { 題:"二十歳のころ", 副題:"立花ゼミ『調べて書く』共同製作 II（1960-2001）",
                     著:"立花隆", 版元:"ランダムハウス講談社", 年:2008, 頁:661 },
};

const 下見 = process.argv.includes("--下見");
const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){ console.error("× HONGAESHI_KEY を渡してください。"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const 棚 = new Map((await db.collection("books").get()).docs.map(d=>[d.id, d.data()]));
const 主体 = new Map();
const 作る本 = [], 消す本 = [];

for(const 組 of 入れ替え){
  const 旧 = 棚.get(組.消す);
  console.log(`\n■ ${旧 ? 旧.title : "(棚に無い)"}  ${組.消す}`);
  if(!旧){ console.log("   × 棚に無いので飛ばします"); continue; }

  for(const isbn of 組.入れる){
    const 補 = 手で補う[isbn];
    const o = await openBDで引く(isbn);
    if(!o && !補){ console.log(`   × ${isbn} の書誌が取れません`); continue; }

    const [題, ...副] = String(補?.題 ?? o.題).split(/\s*:\s*/);
    const 副題 = 補?.副題 ?? (副.join(" : ") || null);
    const 著者名ら = 補?.著 ? [補.著]
      : 著者をばらす(o.著).filter(a=>a.役 === "著").map(a=>読める名に(a.名));
    const 版元 = 補?.版元 ?? o.版元;

    const 受取 = [];
    const 足す = (type, 名)=>{
      if(!名) return;
      const id = 主体のid(type, 名);
      if(!主体.has(id)) 主体.set(id, {
        type, name:名, key: type==="publisher" ? 出版社キー(名) : 著者キー(名)
      });
      if(!受取.includes(id)) 受取.push(id);
    };
    著者名ら.forEach(n=>足す("author", n));
    足す("publisher", 版元);

    const 中身 = {
      isbn, title:題, subtitle:副題,
      authorText: 著者名ら.join("、"),
      publisherText: 版元 || null,
      year: Number(補?.年 ?? o?.年) || null,
      pubDate: null,
      pages: 補?.頁 ?? 旧.pages ?? null,     // ⚠️ あとで表紙をつける.mjs が正しい値に直す
      cover: null, coverAlt: null,
      amazonLinks: [], amazonUrl: null,
      to: 受取, status: "流通",
      addedBy: "admin", addedAt: 旧.addedAt || new Date().toISOString(), public: true
    };
    console.log(`   → ${題}${副題 ? " : " + 副題 : ""}`);
    console.log(`      ${中身.authorText} ／ ${版元} ／ ${中身.year}   ISBN ${isbn}`);
    console.log(`      届け先 ${受取.join("  ")}`);
    作る本.push({ id:isbn, 中身 });
  }
  消す本.push(組.消す);
}

console.log(`\n${"=".repeat(64)}`);
console.log(`入れる ${作る本.length}冊 ／ 消す ${消す本.length}冊 ／ 新しい主体 ${主体.size}件`);
[...主体].forEach(([id])=>console.log(`   ${id}`));

if(下見){ console.log("\n（下見なので、何も書いていません）"); process.exit(0); }

const 束 = db.batch();
await 無い主体を作る(db, 束, [...主体].map(([id, e])=>({ ...e, id })));   // ⚠️ 既にある主体には書かない
作る本.forEach(x=>束.set(db.collection("books").doc(x.id), x.中身, { merge:true }));
消す本.forEach(id=>束.delete(db.collection("books").doc(id)));
await 束.commit();
console.log(`\n✓ 入れ替えました。`);
process.exit(0);
