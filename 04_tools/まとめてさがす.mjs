/* ============================================================
   まとめてさがす ― 一覧をまとめて調べて「これですか？」を出す

     node 04_tools/まとめてさがす.mjs 04_tools/登録したい本.tsv

   入力は TSV（タブ区切り）。1行 = 1冊:
     著者名 <TAB> 書名 <TAB> 出版社名 <TAB> 刊行日（任意）
   著者が複数なら「／」で区切る。検索には1人目だけ使う。

   ⚠️ 国会図書館サーチは1回20秒前後かかる。15冊で5分ほど。
      結果は 04_tools/候補.json に残すので、確認は何度でもやり直せる。

   ⚠️ **自動では決めない。**点が十分に高く、かつ2位を大きく引き離した
      ものだけ「◎ほぼ確実」と印をつける。それ以外は人が選ぶ。
   ============================================================ */

import { readFileSync, writeFileSync } from "node:fs";
import { さがす, openBDで引く, 著者をばらす, 読める名に, 主体のid } from "./書誌.mjs";

const 表 = process.argv[2] || "04_tools/登録したい本.tsv";
const 行ら = readFileSync(表, "utf8").split(/\r?\n/)
  .map(l=>l.trim()).filter(l=>l && !l.startsWith("#"))
  .map(l=>{
    const [著, 題, 版元, 日] = l.split("\t").map(x=>(x||"").trim());
    return { 著, 題, 版元, 日, 検索著者:(著||"").split(/[／\/]/)[0].trim() };
  });

console.log(`${行ら.length}冊を調べます。1冊20秒ほどかかります。\n`);

const 結果 = [];
for(let i = 0; i < 行ら.length; i++){
  const 本 = 行ら[i];
  process.stdout.write(`(${i+1}/${行ら.length}) ${本.題} … `);
  const { 候補, 使った条件 } = await さがす(本.題, 本.検索著者, 本.版元, 4);

  // 上位だけ openBD で正データに差し替える
  const 詳しい = [];
  for(const { c, p } of 候補.slice(0, 3)){
    const 正 = (await openBDで引く(c.isbn)) || c;
    詳しい.push({ ...正, 点:p });
  }

  const 一位 = 詳しい[0], 二位 = 詳しい[1];
  const ほぼ確実 = !!一位 && 一位.点 >= 100 && (!二位 || 一位.点 - 二位.点 >= 20);
  結果.push({ もと:本, 使った条件, 候補:詳しい, ほぼ確実 });
  console.log(詳しい.length ? (ほぼ確実 ? "◎" : `候補${詳しい.length}件`) : "× 見つからない");
}

writeFileSync("04_tools/候補.json", JSON.stringify(結果, null, 2), "utf8");

console.log("\n" + "=".repeat(76));
結果.forEach((r, i) => {
  console.log(`\n【${i+1}】 ${r.もと.題}`);
  console.log(`     指定: ${r.もと.著} ／ ${r.もと.版元} ／ ${r.もと.日 || "―"}`);
  if(!r.候補.length){ console.log("     × 見つかりませんでした。ISBN をいただけると確実です。"); return; }
  r.候補.forEach((c, j) => {
    const 印 = j === 0 && r.ほぼ確実 ? "◎" : j === 0 ? "○" : " ";
    const 著者ら = 著者をばらす(c.著).map(a=>`${読める名に(a.名)}(${a.役})`).join("、");
    console.log(`   ${印}${j+1}. ${c.題}`);
    console.log(`      ${著者ら || c.著 || "―"} ／ ${c.版元 || "―"} ／ ${c.年 || "―"}` +
                `　ISBN ${c.isbn}　点${c.点}${c.書影 ? "　書影あり" : ""}`);
  });
});

const 確 = 結果.filter(r=>r.ほぼ確実).length;
const 無 = 結果.filter(r=>!r.候補.length).length;
console.log("\n" + "=".repeat(76));
console.log(`◎ ほぼ確実 ${確}冊 ／ ○ 要確認 ${結果.length - 確 - 無}冊 ／ × 見つからず ${無}冊`);
console.log(`候補は 04_tools/候補.json に保存しました。`);
console.log(`\nこれで登録してよければ「全部OK」、直すものがあれば`);
console.log(`「3番は2を」のように番号でお知らせください。`);
