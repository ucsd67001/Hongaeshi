/* ============================================================
   欠けを埋める ― 出版社や刊行年が入っていない本を、国会図書館で補う

     node 04_tools/欠けを埋める.mjs --下見
     node 04_tools/欠けを埋める.mjs

   ⚠️ openBD に無い本を Google Books で拾うと、**出版社が入らないことが多い**
      （publisher が null で返る）。刊行年も欠けることがある。
      そこを国会図書館で埋める。

   ⚠️⚠️ **ここだけは OpenSearch を使う。**書名検索では使い物にならない
      （関連度で並ばない）が、**isbn= で引く分には正確**。
      SRU の `isbn="…"` は 0件しか返さなかった（2026-09-23 確認）。
      「OpenSearch は使わない」という他の道具の方針と食い違うが、
      **用途が違う。書名で探すな、ISBNで引け。**

   ⚠️ 出版社を埋めると届け先（to）も足りなくなるので、主体を作って足す。

   ⚠️⚠️ **ページ数は3か所に分かれている。**Google Books（表紙をつける.mjs）、
      openBD の ONIX Extent（書誌.mjs）、そして国会図書館の dc:extent。
      日本の本は Google に無いことが多いので、**ここが最後の砦**。

   環境変数: HONGAESHI_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { 取得 } from "./書誌.mjs";
import { 主体のid, 出版社キー, 名前をととのえる } from "../public/名寄せ.js";

const 下見 = process.argv.includes("--下見");
const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){ console.error("× HONGAESHI_KEY を渡してください。"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const 抜く = (x, t) => (x.match(new RegExp(`<${t}>([^]*?)</${t}>`)) || [])[1]?.trim() || null;

async function NDLでISBNを引く(isbn){
  const xml = await 取得(
    `https://ndlsearch.ndl.go.jp/api/opensearch?isbn=${isbn}&cnt=3`, 40, 2);
  const 件ら = [...xml.matchAll(/<item>([^]*?)<\/item>/g)].map(m=>({
    題: 抜く(m[1], "dc:title"),
    版元: 抜く(m[1], "dc:publisher"),
    年: (抜く(m[1], "dcterms:issued") || 抜く(m[1], "dc:date") || "").match(/\d{4}/)?.[0] || null,
    /* ⚠️ 実物は "308p ; 15cm" や "163p" や "2冊"。**「数字＋p」だけ取る。**
          寸法の 15cm を頁として拾わないよう、単位まで見ること。 */
    頁: Number((抜く(m[1], "dc:extent") || "").match(/(\d{1,5})\s*p/)?.[1]) || null
  }));
  /* ⚠️ 同じISBNで複数返ることがある。版元と年と頁の埋まっているものを優先 */
  const 点 = x => (x.版元?1:0) + (x.年?1:0) + (x.頁?1:0);
  return 件ら.sort((a,b)=>点(b) - 点(a))[0] || null;
}

const 本ら = await db.collection("books").get();
const 欠け = 本ら.docs.filter(d=>{
  const x = d.data(); return !x.publisherText || !x.year || !x.pages; });
console.log(`棚 ${本ら.docs.length}冊。欠けている本 ${欠け.length}冊を見ます。\n`);

const 直す = [], 作る主体 = new Map();
for(const d of 欠け){
  const x = d.data();
  const n = await NDLでISBNを引く(x.isbn);
  const 版元 = x.publisherText || 名前をととのえる(n?.版元 || "") || null;
  const 年   = x.year || (n?.年 ? Number(n.年) : null);
  const 頁   = x.pages || n?.頁 || null;

  const 中身 = {};
  if(!x.publisherText && 版元) 中身.publisherText = 版元;
  if(!x.year && 年) 中身.year = 年;
  if(!x.pages && 頁) 中身.pages = 頁;

  /* 出版社を足したなら、届け先にも足す */
  if(中身.publisherText){
    const id = 主体のid("publisher", 版元);
    if(!(x.to || []).includes(id)){
      中身.to = [...(x.to || []), id];
      作る主体.set(id, { id, type:"publisher", name:版元, key:出版社キー(版元) });
    }
  }

  const 印 = Object.keys(中身).length ? "◎" : "×";
  console.log(`  ${印} ${(x.title||"").slice(0,26)}`);
  console.log(`      版元 ${x.publisherText || "（なし）"} → ${版元 || "（取れず）"}`);
  console.log(`      年   ${x.year || "（なし）"} → ${年 || "（取れず）"}`);
  console.log(`      頁   ${x.pages || "（なし）"} → ${頁 || "（取れず）"}`);
  if(Object.keys(中身).length) 直す.push({ id:d.id, 中身 });
  await new Promise(r=>setTimeout(r, 400));   // ⚠️ 国会図書館は並列に弱い
}

console.log(`\n直す ${直す.length}冊 ／ 作る主体 ${作る主体.size}件`);
if(下見){ console.log("（下見なので、何も書いていません）"); process.exit(0); }
if(!直す.length) process.exit(0);

const 束 = db.batch();
for(const [, e] of 作る主体)
  束.set(db.collection("entities").doc(e.id),
    { type:e.type, name:e.name, key:e.key, aliases:[e.name],
      claimed:false, claimedBy:null, detail:{}, updatedAt:new Date().toISOString() },
    { merge:true });
直す.forEach(x=>束.update(db.collection("books").doc(x.id), x.中身));
await 束.commit();
console.log(`✓ 埋めました。`);
process.exit(0);
