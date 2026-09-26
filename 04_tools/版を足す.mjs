/* ============================================================
   版を足す ― 棚にある作品に、別の版（文庫・単行本など）を足す

     node 04_tools/版を足す.mjs --下見 <作品のISBN> <版のISBN か AmazonのURL> --版 文庫 [--この本は 単行本]
     node 04_tools/版を足す.mjs        <作品のISBN> <版のISBN か AmazonのURL> --版 文庫 [--この本は 単行本]

     openBD に無い版は、手で補う：--題 … --副題 … --版元 … --年 … --頁 …

   ⚠️⚠️ **1作品1ページ**（2026-09-26 決定）。同じ作品の別の版は、新しい本にしない。
      作品のページ（books/{最初に入った ISBN}）の editions に足す。
      本返し・ことば・復刊を願うの記録はページの id に付いているので、**何も移さなくて済む。**
      前の「版を差し替える.mjs」は本を消して作り直すので記録の行き先が消える。**もう使わない。**
   ⚠️ **届け先：その版の出版社を to[] に足す**（決定 2-b。読んだ版は聞かず、分けて届ける）。
      出版社が同じなら何も足さない。**to[] が4件を超えるなら止める**（firestore.rules の前提）。
   ⚠️ 同じ作品かどうかは人にしか決められない。題と著者が作品と違って見えたら ⚠ を出すので、
      **必ず --下見 で確かめてから**書く。
   ⚠️ 版の ISBN が別の本として棚にあるときは止める。まとめるには記録の移し替えが要る（この道具ではしない）。
   ⚠️ 主体は 書誌.mjs の 無い主体を作る() を通す（既にある主体には書かない）。

   あとですること：
     ・品切れの判定（在庫を入れる.mjs は版の ISBN も見る）
     ・申請から来た版なら `node 04_tools/申請.mjs 並べた <申請id> <版のISBN>`

   環境変数: HONGAESHI_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { openBDで引く, 著者をばらす, 読める名に, 主体のid, 出版社キー, 無い主体を作る, Amazonを読む, ISBN13にする }
  from "./書誌.mjs";

const 引数 = process.argv.slice(2);
const 下見 = 引数.includes("--下見");
const 値 = 名 => { const i = 引数.indexOf(名); return i >= 0 ? 引数[i + 1] : null; };
const 名のある = new Set(["--版","--この本は","--題","--副題","--版元","--年","--頁"]);
const 並び = 引数.filter((x, i)=>!x.startsWith("--") && !名のある.has(引数[i - 1]));
const [作品id, 版の指定] = 並び;
const 版の名 = 値("--版");
if(!作品id || !版の指定 || !版の名){
  console.error("× 使い方：node 04_tools/版を足す.mjs [--下見] <作品のISBN> <版のISBN か AmazonのURL> --版 文庫 [--この本は 単行本]");
  process.exit(1);
}

const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){ console.error("× HONGAESHI_KEY を渡してください。"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

/* ── 版の ISBN（URL なら Amazon から読む） ── */
let isbn, 正 = null;
if(/^https?:/.test(版の指定)){
  const 読 = await Amazonを読む(版の指定);
  if(!読?.isbn){ console.error("× Amazon のURLから紙の本の ISBN を読めませんでした（Kindle版などは不可）。"); process.exit(1); }
  ({ isbn, 正 } = 読);
}else{
  const d = 版の指定.replace(/[^0-9Xx]/g, "");
  isbn = d.length === 10 ? ISBN13にする(d) : d;
}
if(!/^\d{13}$/.test(isbn || "")){ console.error(`× ISBN が読めません：${版の指定}`); process.exit(1); }

/* ── 棚と照らす ── */
const 棚 = new Map((await db.collection("books").get()).docs.map(d=>[d.id, d.data()]));
const 作品 = 棚.get(作品id);
if(!作品){ console.error(`× 作品 ${作品id} が棚にありません。`); process.exit(1); }
if(isbn === 作品id){ console.error("× 作品と同じ ISBN です。"); process.exit(1); }
const 版の持ち主 = [...棚].find(([, b])=>(b.editions || []).some(v=>v.isbn === isbn));
if(版の持ち主){ console.error(`× ${isbn} は、もう『${版の持ち主[1].title}』（${版の持ち主[0]}）の版です。`); process.exit(1); }
if(棚.has(isbn)){
  console.error(`× ${isbn} は別の本『${棚.get(isbn).title}』として棚にあります。\n` +
    `  まとめるには、その本の記録（本返し・ことば・復刊を願う・申請）を移す必要があります。この道具ではしません。`);
  process.exit(1);
}
const 版の持ち主の作品 = [...棚].find(([, b])=>(b.editions || []).some(v=>v.isbn === 作品id));
if(版の持ち主の作品){ console.error(`× ${作品id} は『${版の持ち主の作品[1].title}』の版です。作品のISBN（${版の持ち主の作品[0]}）を渡してください。`); process.exit(1); }

/* ── 書誌（openBD。無ければ手で補う） ── */
const o = await openBDで引く(isbn);
if(!o && !値("--版元")){
  console.error(`× ${isbn} の書誌が openBD にありません。--題 --版元 --年（あれば --頁）で補ってください。`);
  process.exit(1);
}
const [題, ...副] = String(値("--題") ?? o?.題 ?? 作品.title).split(/\s*:\s*/);
const 副題 = 値("--副題") ?? (副.join(" : ") || null);
const 版元 = 値("--版元") ?? o.版元;
const 年 = Number(値("--年") ?? o?.年) || null;
const 頁 = Number(値("--頁") ?? o?.頁) || null;

/* 同じ作品らしいか（題の頭と著者）。違って見えても止めない。人が下見で決める */
const 題の鍵 = t => String(t || "").normalize("NFKC").replace(/[\s:：・=＝「」『』"“”]/g, "").slice(0, 8);
const 気がかり = [];
if(題の鍵(題) !== 題の鍵(作品.title)) 気がかり.push(`題が違って見えます：作品『${作品.title}』／この版『${題}』`);
if(o?.著){
  const 版の著者 = 著者をばらす(o.著).map(a=>読める名に(a.名));
  if(!版の著者.some(n=>(作品.authorText || "").includes(n)))
    気がかり.push(`著者が違って見えます：作品「${作品.authorText}」／この版「${o.著}」`);
}

/* ── 届け先：この版の出版社 ──
   ⚠️ 名寄せで既にある主体（別名や key が同じもの）を先に探す。無ければ新しく作る */
const 主体ら = (await db.collection("entities").where("type", "==", "publisher").get()).docs;
const 鍵 = 出版社キー(版元);
const 既に = 主体ら.find(d=>d.data().key === 鍵 || (d.data().aliases || []).includes(版元));
const 版元id = 既に ? 既に.id : 主体のid("publisher", 版元);
/* ⚠️ 表記は主体の名にそろえる。openBD は「文芸春秋」、棚は「文藝春秋」のように揺れる（2026-09-26 の下見で出た） */
const 版元の表記 = 既に ? 既に.data().name : 版元;
const 新しい主体 = 既に ? [] : [{ id: 版元id, type: "publisher", name: 版元, key: 鍵 }];
const to = [...(作品.to || [])];
const 届け先が増える = !to.includes(版元id);
if(届け先が増える) to.push(版元id);
if(to.length > 4){
  console.error(`× 届け先が ${to.length}件になります（firestore.rules は4件まで）。どうするか持ち主に相談してください。`);
  process.exit(1);
}

const 版 = {
  isbn, label: 版の名,
  title: 題, subtitle: 副題,
  publisherText: 版元の表記 || null, year: 年, pages: 頁,
  amazonLinks: 正 ? [{ label: "", url: 正 }] : [],
  cover: o?.書影 || null,
  /* ⚠️⚠️ status は書かない（＝未判定）。「流通」で足すと、品切れの作品が流通に変わって
        「復刊を願う」が消える（2026-09-26 の下見で気づいた。文庫が品切れの本に古い単行本を足す例）。
        作品を流通にするのは、Amazon で「流通」と判定された版があるときだけ（共通.js）。足したら品切れを調べる */
  addedAt: new Date().toISOString()
};
const この本は = 値("--この本は");

console.log(`\n■ 作品『${作品.title}${作品.subtitle ? " " + 作品.subtitle : ""}』 ${作品id}`);
console.log(`   この本の版：${この本は || 作品.editionLabel || "（名なし）"}　${作品.publisherText}（${作品.year}）`);
(作品.editions || []).forEach(v=>console.log(`   ほかの版　：${v.label}　${v.publisherText}（${v.year}）　${v.isbn}`));
console.log(`\n＋ 足す版：${版の名}　『${題}${副題 ? " " + 副題 : ""}』`);
console.log(`   ${版元の表記}（${年}）${頁 ? `　${頁}ページ` : ""}　ISBN ${isbn}`);
if(正) console.log(`   ${正}`);
console.log(`   届け先：${届け先が増える ? `＋ ${版元id}${既に ? "" : "（新しい主体）"}` : "変わらない（同じ出版社）"}`);
console.log(`   → ${to.join("  ")}`);
if(!この本は && !作品.editionLabel) console.log(`\n⚠ 作品の版の名がありません。--この本は 単行本 などで付けると、本のページで見分けられます。`);
気がかり.forEach(x=>console.log(`\n⚠ ${x}\n  同じ作品か、確かめてください。`));

if(下見){ console.log("\n（下見なので、何も書いていません）"); process.exit(0); }

const 束 = db.batch();
await 無い主体を作る(db, 束, 新しい主体);
束.update(db.collection("books").doc(作品id), {
  editions: [...(作品.editions || []), 版], to,
  ...(この本は ? { editionLabel: この本は } : {})
});
await 束.commit();
console.log(`\n✓ 足しました。品切れの判定と、申請から来た版なら「申請.mjs 並べた」を忘れずに。`);
process.exit(0);
