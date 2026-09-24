/* ============================================================
   登録する ― 候補.json から Firestore へ本と主体を書き込む

     node 04_tools/登録する.mjs --下見          ← 書かずに、書く内容だけ見せる
     node 04_tools/登録する.mjs                 ← 実際に書く

   ⚠️ 鍵の場所は環境変数で渡す。**リポジトリの中に置かない。**
        set HONGAESHI_KEY=C:\Users\…\.hongaeshi\鍵.json     (cmd)
        $env:HONGAESHI_KEY="C:\Users\…\.hongaeshi\鍵.json"  (PowerShell)
        export HONGAESHI_KEY=/c/Users/…/.hongaeshi/鍵.json  (bash)

   ── 入れもの ──────────────────────────────
     books/{isbn13}
       isbn title subtitle authorText publisherText year pubDate cover
       to[] status addedBy addedAt public
     entities/{type:正規化キー}          例 author:立花隆 / publisher:文芸春秋
       type name key aliases[] claimed claimedBy detail updatedAt

   ⚠️ **項目名は ASCII。**セキュリティルールの言語が日本語の識別子を
      受け付けないため、Firestore の中は全部 ASCII で揃えてある。
      画面に出すときは public/共通.js が日本語に読み替える。

   ⚠️ **主体のIDは型込みの正規化キー。**こうすると「あれば取得、無ければ作成」が
      検索なしで冪等にできる。同じ出版社が何冊に出てきても1つにまとまる。
   ⚠️ 別名は上書きせず足していく。あとで管理画面から統合するときの手がかりになる。
   ============================================================ */

import { readFileSync } from "node:fs";
/* ⚠️ ESM では `import admin from "firebase-admin"` の既定エクスポートに
      credential が生えない。**サブパスから読むこと。** */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { 主体のid, 著者をばらす, 読める名に, 出版社キー, 著者キー, 無い主体を作る } from "./書誌.mjs";

const 下見 = process.argv.includes("--下見");

/* ── どの候補を採るか ──────────────────────────
   「まとめてさがす」の出力に対する人の判断。番号は1から。
   ここに無いものは 1 番を採る。 */
const えらび = { 2:2, 13:2 };

/* ── 著者を差し替えるもの ───────────────────────
   ⚠️ 書誌上の著者が実態と合わないときだけ、人が上書きする。
      【3】立花隆のすべて は編著で著者が「文芸春秋」になっており、
      そのままだと author:文芸春秋 という主体ができて
      publisher:文藝春秋 と二重になる。
      【4】二十歳のころ は東大教養学部・立花ゼミ・立花隆の3者。 */
const 著者の上書き = { 3:["立花隆"], 4:["立花隆"] };

const 候補ら = JSON.parse(readFileSync("04_tools/候補.json", "utf8"));

/* ── 書く中身を組み立てる ───────────────────── */
const 主体 = new Map();     // id → {type, 名, キー, 別名:Set}
const 本ら = [];

候補ら.forEach((r, i) => {
  const 番 = i + 1;
  const c = r.候補[(えらび[番] || 1) - 1];
  if(!c){ console.log(`⚠ 【${番}】${r.もと.題} は候補が無いので飛ばします`); return; }

  // 題に「: 副題」が入っていることが多いので割る
  const [題, ...副] = String(c.題).split(/\s*:\s*/);
  const 副題 = 副.join(" : ") || null;

  // 著者：上書きがあればそれを、無ければ書誌から「著」だけ拾う
  const 著者名ら = 著者の上書き[番]
    || 著者をばらす(c.著).filter(a=>a.役 === "著").map(a=>読める名に(a.名));

  const 受取 = [];
  /* ⚠️ 同じ主体が複数の表記で出てくる（文藝春秋 / 文芸春秋）。
        IDは正規化キーで1つにまとまるが、**画面に出す名称はどれを採るか**が残る。
        いちばん多く出てきた表記を採る（同数なら先に出たほう）。 */
  const 足す = (type, 名) => {
    if(!名) return;
    const id = 主体のid(type, 名);
    if(!主体.has(id)) 主体.set(id, {
      type, キー: type === "publisher" ? 出版社キー(名) : 著者キー(名), 表記: new Map()
    });
    const e = 主体.get(id);
    e.表記.set(名, (e.表記.get(名) || 0) + 1);
    if(!受取.includes(id)) 受取.push(id);
  };
  著者名ら.forEach(n => 足す("author", n));
  足す("publisher", c.版元);

  本ら.push({
    id: c.isbn,
    中身: {
      isbn: c.isbn,
      title: 題,
      subtitle: 副題,
      authorText: 著者名ら.join("、"),
      publisherText: c.版元 || null,
      year: Number(c.年) || null,
      pubDate: r.もと.日 || null,
      cover: c.書影 || null,
      to: 受取,                              // ⚠️ 最大4件（firestore.rules の前提）
      status: "流通",
      addedBy: "admin",
      addedAt: new Date().toISOString(),
      public: true
    }
  });
});

/* ── 見せる ──────────────────────────────── */
console.log(`\n本 ${本ら.length}冊 ／ 主体 ${主体.size}件\n` + "=".repeat(70));
本ら.forEach(b=>{
  console.log(`\n  ${b.中身.title}${b.中身.subtitle ? " : " + b.中身.subtitle : ""}`);
  console.log(`    ${b.中身.authorText} ／ ${b.中身.publisherText} ／ ${b.中身.year}`);
  console.log(`    ISBN ${b.id}${b.中身.cover ? "　書影あり" : "　書影なし"}`);
  console.log(`    受取 ${b.中身.to.join("  ")}`);
});
/* 表記の多数決で正式名称を決める */
const 名称 = e => [...e.表記].sort((a,b)=>b[1]-a[1])[0][0];

console.log("\n" + "=".repeat(70) + "\n主体:");
for(const [id, e] of [...主体].sort()){
  const 全表記 = [...e.表記].map(([n,c])=>`${n}×${c}`).join(" / ");
  console.log(`  ${id}`);
  console.log(`      名称「${名称(e)}」  表記 ${全表記}` +
    (e.表記.size > 1 ? "   ⚠ ゆれを1つにまとめた" : ""));
}

const 受取が多い = 本ら.filter(b=>b.中身.to.length > 4);
if(受取が多い.length){
  console.error(`\n⚠ 受取が5件以上の本があります（firestore.rules は4件まで）:`);
  受取が多い.forEach(b=>console.error(`   ${b.中身.title}  ${b.中身.to.length}件`));
  process.exit(1);
}

if(下見){ console.log("\n（下見なので、何も書いていません）"); process.exit(0); }

/* ── 書く ──────────────────────────────── */
const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){
  console.error("\n× 環境変数 HONGAESHI_KEY に鍵の場所を入れてください。");
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const 束 = db.batch();
/* ⚠️ 既にある主体には書かない（書誌.mjs の 無い主体を作る）。前は merge で claimed と aliases を上書きしていた */
await 無い主体を作る(db, 束, [...主体].map(([id, e])=>({
  id, type:e.type, name:名称(e), key:e.キー, aliases:[...e.表記.keys()] })));
for(const b of 本ら) 束.set(db.collection("books").doc(b.id), b.中身, { merge: true });
await 束.commit();

console.log(`\n✓ 書きました。本 ${本ら.length}冊、主体 ${主体.size}件。`);
console.log(`  https://console.firebase.google.com/project/hongaeshi/firestore/data`);
process.exit(0);
