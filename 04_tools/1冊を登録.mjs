/* ============================================================
   1冊を登録 ― ISBN を渡すと、書誌を引いて棚に並べる

     node 04_tools/1冊を登録.mjs --下見 <ISBN13>
     node 04_tools/1冊を登録.mjs <ISBN13>
     node 04_tools/1冊を登録.mjs <ISBN13> --著者 "P.G.ハマトン" --出版社 "講談社"
     node 04_tools/1冊を登録.mjs <ISBN13> --Amazon "https://…/dp/…"

   ⚠️ **著者は上書きできるようにしてある。**書誌の著者欄は、訳者や
      「ほか」まで一緒くたに入っていることが多く（『知的生活』の openBD は
      "Hamerton,PhilipGilbert,1834-1894 渡部,昇一,1930-2017 ほか"）、
      そのままだと「ほか」という主体ができてしまう。

   ⚠️ **翻訳者は、いまは届け先にしていない。**原著者と出版社だけ。
      翻訳書では訳者の貢献が大きいので、第二段階で扱いを決めること。

   ⚠️ 管理画面の「申請」→「本にする」でも同じことができる。
      こちらは短縮リンクを辿れるのと、まとめて流せるのが利点。

   環境変数: HONGAESHI_KEY
   ============================================================ */

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { openBDで引く, 著者をばらす, 読める名に, 主体のid, 出版社キー, 著者キー, 無い主体を作る } from "./書誌.mjs";
import { 名前をととのえる } from "../public/名寄せ.js";

const 引数 = process.argv.slice(2);
const 下見 = 引数.includes("--下見");
const 取る = 名 => { const i = 引数.indexOf(名); return i >= 0 ? 引数[i + 1] : null; };
const isbn = 引数.find(x=>/^\d{13}$/.test(x.replace(/-/g,"")))?.replace(/-/g,"");

if(!isbn){
  console.log('使い方: node 04_tools/1冊を登録.mjs [--下見] <ISBN13> [--著者 "名前"] [--出版社 "名前"] [--Amazon "URL"]');
  process.exit(1);
}

const 鍵の場所 = process.env.HONGAESHI_KEY;
if(!鍵の場所){ console.error("× HONGAESHI_KEY を渡してください。"); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(readFileSync(鍵の場所, "utf8"))) });
const db = getFirestore();

const o = await openBDで引く(isbn);
if(!o){ console.error(`× ${isbn} は openBD に見つかりません。--著者 と --出版社 を手で渡してください。`); }

const [題, ...副] = String(o?.題 || 取る("--題") || "").split(/\s*:\s*/);
if(!題){ console.error("× 書名が取れません。--題 で渡してください。"); process.exit(1); }

/* ⚠️ --著者 があればそれを使う。無ければ書誌から「著」だけ拾い、
      「ほか」のような主体になりえない語は落とす。 */
const 除ける = /^(ほか|他|編集部|著者不明)$/;
const 著者名ら = 取る("--著者")
  ? [取る("--著者")]
  : 著者をばらす(o?.著).filter(a=>a.役 === "著")
      .map(a=>読める名に(a.名)).filter(n=>n && !除ける.test(n));
const 版元 = 名前をととのえる(取る("--出版社") || o?.版元 || "") || null;

const 受取 = [], 主体 = [];
const 足す = (type, 名)=>{
  if(!名) return;
  const id = 主体のid(type, 名);
  if(受取.includes(id)) return;
  受取.push(id);
  主体.push({ id, type, name:名, key: type==="publisher" ? 出版社キー(名) : 著者キー(名) });
};
著者名ら.forEach(n=>足す("author", n));
足す("publisher", 版元);

const AmazonのURL = 取る("--Amazon");
const asin = (AmazonのURL || "").match(/\/(?:dp|gp\/product)\/([0-9A-Za-z]{10})/)?.[1];

const 中身 = {
  isbn, title:題, subtitle: 副.join(" : ") || null,
  authorText: 著者名ら.join("、"),
  publisherText: 版元,
  year: Number(o?.年) || null, pubDate: null, pages: null,
  cover: null, coverAlt: null,
  amazonLinks: asin
    ? [{ label:"", url:`https://www.amazon.co.jp/dp/${asin}?tag=ucsd67001-22` }] : [],
  to: 受取, status:"流通",
  addedBy:"admin", addedAt:new Date().toISOString(), public:true
};

console.log(`\n  ${題}${中身.subtitle ? " : " + 中身.subtitle : ""}`);
console.log(`    ${中身.authorText || "（著者なし）"} ／ ${版元 || "（出版社なし）"} ／ ${中身.year || "―"}`);
console.log(`    ISBN ${isbn}${asin ? `　Amazon ${asin}` : ""}`);
console.log(`    届け先 ${受取.join("  ")}`);
if(o?.著) console.log(`    （書誌の著者欄: ${o.著}）`);

if(!著者名ら.length || !版元){
  console.error(`\n⚠ 著者か出版社が取れていません。--著者 / --出版社 で渡してください。`);
}
if(下見){ console.log("\n（下見なので、何も書いていません）"); process.exit(0); }

const 束 = db.batch();
await 無い主体を作る(db, 束, 主体);   // ⚠️ 既にある主体には書かない（書誌.mjs）
束.set(db.collection("books").doc(isbn), 中身, { merge:true });
await 束.commit();
console.log(`\n✓ 棚に並べました。ページ数と表紙は 表紙をつける.mjs で入ります。`);
process.exit(0);
