/* ============================================================
   名寄せを点検 ― 取りこぼしをさがして、直せるものは直す

     node 04_tools/名寄せを点検.mjs            ← さがすだけ
     node 04_tools/名寄せを点検.mjs --ととのえる ← 名称の見た目だけ直す
     node 04_tools/名寄せを点検.mjs --統合 <残すid> <消すid> …

   さがすのは3種類:
     ① 名称の乱れ    末尾の空白、長音符のかわりの全角ハイフン、全角ローマ字
     ② 同じかもしれない主体   「ゆるいキー」が一致するもの
     ③ 2人が1人になっているもの  名前の中に空白があるもの

   ⚠️⚠️ **②③は候補を出すだけ。自動で統合しない。**
      ゆるいキーは記号と長音符を全部落として比べるので、別人を同じに見せる。
      同姓同名を潰す事故は取り返しがつかない（記録は消せない）。

   ⚠️ 統合すると、**消すほうを指している本を全部書き換える。**
      returns の parts/toIds は書き換えない（記録は消さない・直さない）。
      そのかわり残すほうに oldIds を持たせる。管理画面の統合と同じ。

   環境変数: HONGAESHI_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { 名前をととのえる, ゆるいキー } from "../public/名寄せ.js";

const 引数 = process.argv.slice(2);
const ととのえる = 引数.includes("--ととのえる");
const 統合 = 引数.includes("--統合") ? 引数.slice(引数.indexOf("--統合") + 1) : null;

const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){ console.error("× HONGAESHI_KEY を渡してください。"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const 本ら = await db.collection("books").get();
const 主体ら = await db.collection("entities").get();
const 冊 = id => 本ら.docs.filter(d=>(d.data().to || []).includes(id)).length;

/* ── 統合 ──────────────────────────────── */
if(統合){
  const [残すid, ...消すら] = 統合;
  const 残 = 主体ら.docs.find(d=>d.id === 残すid);
  if(!残){ console.error(`× 残す主体 ${残すid} がありません。`); process.exit(1); }

  const 束 = db.batch();
  const 旧 = new Set(残.data().oldIds || []);
  const 別名 = new Set(残.data().aliases || [残.data().name]);

  for(const 消すid of 消すら){
    const 消 = 主体ら.docs.find(d=>d.id === 消すid);
    if(!消){ console.log(`  × ${消すid} がありません`); continue; }
    旧.add(消すid);
    (消.data().oldIds || []).forEach(x=>旧.add(x));
    (消.data().aliases || [消.data().name]).forEach(x=>別名.add(x));

    const 対象 = 本ら.docs.filter(d=>(d.data().to || []).includes(消すid));
    console.log(`  ${消.data().name}（${対象.length}冊）→ ${残.data().name}`);
    対象.forEach(d=>束.update(d.ref,
      { to: [...new Set((d.data().to || []).map(x=>x === 消すid ? 残すid : x))] }));
    /* authorText / publisherText も残すほうの名前に寄せる */
    対象.forEach(d=>{
      const x = d.data();
      const 欄 = 消.data().type === "publisher" ? "publisherText" : "authorText";
      if(x[欄] && x[欄].includes(消.data().name))
        束.update(d.ref, { [欄]: x[欄].split("、").map(n=>
          n === 消.data().name ? 残.data().name : n).join("、") });
    });
    束.delete(消.ref);
  }
  束.update(残.ref, { oldIds:[...旧], aliases:[...別名], updatedAt:new Date().toISOString() });
  await 束.commit();
  console.log("✓ 統合しました。");
  process.exit(0);
}

/* ── ① 名称の乱れ ─────────────────────────── */
const 乱れ = 主体ら.docs
  .map(d=>({ d, 前:d.data().name, 後:名前をととのえる(d.data().name) }))
  .filter(x=>x.前 !== x.後);

console.log(`\n① 名称の乱れ：${乱れ.length}件`);
乱れ.forEach(x=>console.log(`   ${JSON.stringify(x.前)}  →  ${JSON.stringify(x.後)}`));

/* ── ② 同じかもしれない主体 ─────────────────── */
const 束ね = new Map();
主体ら.docs.forEach(d=>{
  const k = d.data().type + ":" + ゆるいキー(名前をととのえる(d.data().name));
  (束ね.get(k) || 束ね.set(k, []).get(k)).push(d);
});
const 候補 = [...束ね.values()].filter(ら=>ら.length > 1);

console.log(`\n② 同じかもしれない主体：${候補.length}組`);
候補.forEach(ら=>{
  console.log(`   ${ら.map(d=>`${d.data().name}(${冊(d.id)}冊)`).join("  と  ")}`);
  console.log(`     統合するなら: node 04_tools/名寄せを点検.mjs --統合 ${ら.map(d=>d.id).join(" ")}`);
});

/* ── ③ 2人が1人になっていそうなもの ──────────── */
/* ⚠️ 日本語の姓名にも空白は入る（大島 かおり）。**候補でしかない。** */
const 怪しい = 主体ら.docs.filter(d=>{
  const n = 名前をととのえる(d.data().name);
  if(!/\s/.test(n)) return false;
  /* ⚠️ 欧文の「名 姓」（Jonathan Littman）は正常なので拾わない。
        和文が混ざっていて空白があるものを拾う。
        「大島 かおり」のような正しい姓名も拾ってしまうが、**候補でしかない。** */
  return /[ぁ-んァ-ヶ一-龥]/.test(n);
});
console.log(`\n③ 2人が1人になっていそうなもの：${怪しい.length}件`);
怪しい.forEach(d=>console.log(`   ${d.data().name}（${冊(d.id)}冊）  [${d.id}]`));

/* ── ①を直す ──────────────────────────── */
if(!ととのえる){
  console.log(`\n（--ととのえる を付けると、①の名称だけ直します）`);
  process.exit(0);
}
if(!乱れ.length){ console.log("\n直す名称がありません。"); process.exit(0); }

const 束 = db.batch();
乱れ.forEach(x=>{
  束.update(x.d.ref, { name: x.後, updatedAt: new Date().toISOString() });
  /* 本の表示欄にも同じ名前が入っているので、そちらも直す */
  const 欄 = x.d.data().type === "publisher" ? "publisherText" : "authorText";
  本ら.docs.filter(b=>(b.data()[欄] || "").includes(x.前)).forEach(b=>
    束.update(b.ref, { [欄]: b.data()[欄].split("、").map(n=>n === x.前 ? x.後 : n).join("、") }));
});
await 束.commit();
console.log(`\n✓ ${乱れ.length}件の名称を直しました。`);
process.exit(0);
