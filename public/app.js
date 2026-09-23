/* ============================================================
   本返し ― 画面

   ⚠️ 道すじは history API（/、/b/<本のid>、/me、/r、/about）。
      firebase.json の rewrites がぜんぶ index.html に寄せている。
   ⚠️ 画面はすべて「読込中を出す → 待つ → 差し替える」の形。
      Firestore を待つあいだ、空の板が残らないようにするため。
   ⚠️ 組み方の決まりは style.css の頭に書いてある。
      **囲みを増やさない。罫と余白で段をつくる。**
   ============================================================ */

import * as 土台 from "./共通.js";
import { 頁_管理 } from "./管理.js";
const {
  起動, 入る, 出る, 本返しする, 残したい,
  本の集計, 全体の集計, まとめて数える, 番付, 本の声, 最近の声, 私の記録, 受取人の受取,
  本を引く, 届け先, pt, 逃, いつ, 知らせる,
  決済率, 運営率, 既定額
} = 土台;

const 画面 = document.getElementById("画面");
const 帯のnav = document.getElementById("nav");
const 帯の右 = document.getElementById("帯の右");
const 窓 = document.getElementById("窓");

/* ============================================================
   道すじ
   ============================================================ */
let 現在 = { 頁:"home" };

function 道を読む(){
  const p = location.pathname.replace(/\/+$/,"") || "/";
  if(p.startsWith("/b/")) return { 頁:"book", id:decodeURIComponent(p.slice(3)) };
  if(p.startsWith("/e/")) return { 頁:"entity", id:decodeURIComponent(p.slice(3)) };
  if(p === "/me")    return { 頁:"mine" };
  if(p === "/r")     return { 頁:"receiver" };
  if(p === "/about") return { 頁:"about" };
  if(p === "/admin") return { 頁:"admin" };
  if(p === "/books") return { 頁:"books", q:new URLSearchParams(location.search).get("q") || "",
                              並び:new URLSearchParams(location.search).get("s") || "年" };
  return { 頁:"home", q:new URLSearchParams(location.search).get("q") || "" };
}

function go(頁, 他={}, 履歴に積む=true){
  現在 = { 頁, ...他 };
  const 道 = 頁==="book" ? "/b/"+encodeURIComponent(他.id)
           : 頁==="entity" ? "/e/"+encodeURIComponent(他.id)
           : 頁==="mine" ? "/me"
           : 頁==="receiver" ? "/r"
           : 頁==="about" ? "/about"
           : 頁==="admin" ? "/admin"
           : 頁==="books" ? ("/books" + (他.q||他.並び
               ? "?" + new URLSearchParams({...(他.q?{q:他.q}:{}), ...(他.並び?{s:他.並び}:{})}) : ""))
           : (他.q ? "/?q="+encodeURIComponent(他.q) : "/");
  if(履歴に積む) history.pushState(null,"",道);
  window.scrollTo(0,0);
  描く();
}
window.go = go;
window.描き直す = ()=> 描く();      // 管理画面から呼ぶ
window.addEventListener("popstate", ()=>{ 現在 = 道を読む(); 描く(); });

/* ============================================================
   帯
   ============================================================ */
function 帯を描く(){
  /* ⚠️ 権限で出し分ける。③利用者に見せるのは、さがす／本の一覧／わたしの本返し／しくみ だけ。
        受取人の控えは①②、管理は①のみ。 */
  const 品 = [["home","さがす"],["books","本の一覧"]];
  if(土台.私) 品.push(["mine","わたしの本返し"]);
  if(土台.権限.管理者 || 土台.権限.受取人.length) 品.push(["receiver","受取人の控え"]);
  品.push(["about","しくみ"]);
  if(土台.権限.管理者) 品.push(["admin","管理"]);
  帯のnav.innerHTML = 品
    .map(([k,l])=>`<button class="${現在.頁===k?'いま':''}" onclick="go('${k}')">${l}</button>`).join("");

  /* ⚠️ 名前は Google のものではなく**名乗り**を出す。
        本名を出したくない人がいるので、決めていれば必ずそちらを使う。 */
  帯の右.innerHTML = 土台.私 ? `
    <div class="財布">
      <div class="残">${(土台.財布?.残高 ?? 0).toLocaleString()}<span>PT</span></div>
    </div>
    <button class="わたし" onclick="設定をひらく()" title="設定">
      ${しるし(土台.私の印())}
      <span class="名">${逃(土台.私の名())}</span>
      <span class="下向き">▾</span>
    </button>`
  : `<button class="釦 小" onclick="ログイン()">Googleで入る</button>`;
}
window.ログイン  = ()=> 入る();
window.ログアウト = ()=> 出る();

/* ============================================================
   共通の部品
   ============================================================ */
const 読込中 = () => `<div class="読込中"><div class="こま"></div>読み込んでいます</div>`;

const 看板 = () => `<div class="看板"><img src="/看板.webp" alt="本返し ― 読んだあとに、ありがとうを。" width="2000" height="667"></div>`;

const 節の頭 = (題, 添え="") => `<div class="節の頭">
  <h2 class="節見出し">${題}</h2>${添え?`<p class="節の添え">${添え}</p>`:""}</div>`;

async function 描く(){
  帯を描く();
  画面.innerHTML = 読込中();
  try{
    const 作る = { home:頁_さがす, book:頁_本, mine:頁_私, receiver:頁_受取人,
                   about:頁_しくみ, admin:頁_管理, books:頁_一覧, entity:頁_主体 }[現在.頁];
    画面.innerHTML = await 作る();
    列を仕込む();                     // ⚠️ innerHTML を入れ替えた**あと**に呼ぶ
  }catch(e){
    console.error(e);
    画面.innerHTML = `<div class="節"><div class="断り">読み込めませんでした。${逃(e.message||String(e))}<br>
      <button class="釦 枠だけ 小" style="margin-top:12px" onclick="location.reload()">やり直す</button></div></div>`;
  }
  帯を描く();
}

/* 出版社と刊行年の書き方。**ここだけで決める。**
   ⚠️ 前は「文藝春秋・2009」と中黒でつないでいたが、
      出版社名の一部か年か、ぱっと見で切れ目が分からなかった。 */
const 版元と年 = b => 逃(b.版元) + (b.年 ? `（${b.年}）` : "");

function 本の札(b, s){
  s = s || { 人数:0, 金額:0, 残数:0, 約額:0 };
  const 右 = b.状態==="絶版"
    ? `<b>${s.残数.toLocaleString()}</b><span class="添え">人が残したい</span>`
    : `<b>${pt(s.金額).replace("pt","")}</b><span class="添え">pt ／ ${s.人数.toLocaleString()}人</span>`;
  return `<button class="本の札" onclick="go('book',{id:'${b.id}'})">
    <div class="書影" style="background:linear-gradient(155deg,${b.色},${b.色}bb)">
      ${表紙img(b)}
      <span>${逃(b.題)}</span></div>
    <div style="flex:1;min-width:0">
      <div class="本の名">${逃(b.題)}${副(b)}${b.状態==="絶版"?' <span class="札 注">絶版</span>':""}</div>
      <div class="本の素性">${逃(b.著)}　—　${版元と年(b)}${b.頁?`　${b.頁}ページ`:""}</div>
    </div>
    <div class="本の数">${右}</div>
  </button>`;
}

/* ⚠️⚠️ **副題を出さないと、巻が見分けられない。**
      『三剣物語』は1〜3巻と外伝で題がまったく同じで、
      違うのは副題（「1 炎の剣」「外伝 マーシリアの…」）だけだった（2026-09-23）。
      題を出すところには、必ずこれを添えること。 */
const 副 = b => b.副題 ? `<span class="副題">${逃(b.副題)}</span>` : "";

/* 表紙の img。
   ⚠️ 優先順位は 共通.js の 蔵書をよみこむ() で決めている:
      手で入れたもの → Amazon（リンクのある本だけ）→ Google（実在確認済み）→ 色の背表紙。
      読めなければ控えへ、それも駄目なら img ごと消して背表紙を見せる。 */
function 表紙img(b){
  if(!b.書影) return "";
  const 控え = b.控えの書影 && b.控えの書影 !== b.書影 ? 逃(b.控えの書影) : "";
  return `<img src="${逃(b.書影)}" alt="" loading="lazy"
    data-控え="${控え}"
    onload="表紙をみる(this)"
    onerror="表紙をやめる(this)">`;
}

/* ⚠️⚠️ **Amazon は、表紙が無くても 200 を返す。**中身は43バイトの
      1×1 の透明画像で、`onerror` は鳴らない。**読めたかどうかでは判定できない。**
      （2026-09-23、『偉人たちの挑戦』6冊のうち4冊がこれだった）
      Google Books の「image not available」も同じ性質で、あちらは
      04_tools/表紙をつける.mjs が大きさと中身の md5 で弾いている。
      こちらは外のURLを指すだけなので、**出たところの大きさで見る。** */
window.表紙をみる = el =>{ if(el.naturalWidth <= 2 || el.naturalHeight <= 2) 表紙をやめる(el); };
window.表紙をやめる = el =>{
  if(el.dataset.控え){ const u = el.dataset.控え; el.dataset.控え = ""; el.src = u; }
  else el.remove();     // 消せば、下に敷いてある色の背表紙が出る
};

/* ── 横に流れる列 ────────────────────────────
   ⚠️ 本を全部縦に並べると、冊数が増えたときに破綻する。
      トップは流れる列だけにして、全部見るのは検索に任せる。 */
function 流し札(b, s){
  s = s || { 人数:0, 金額:0, 残数:0 };
  const 下 = b.状態==="絶版"
    ? (s.残数 ? `<div class="額">${s.残数}<span>人が残したい</span></div>` : "")
    : (s.金額 ? `<div class="額">${s.金額.toLocaleString()}<span>PT</span></div>` : "");
  return `<button class="流し札" onclick="go('book',{id:'${b.id}'})">
    <div class="表紙" style="background:linear-gradient(155deg,${b.色},${b.色}cc)">
      ${表紙img(b)}
      <span>${逃(b.題)}</span>
    </div>
    <div class="名">${逃(b.題)}${副(b)}</div>
    <div class="素性">${逃(b.著)}</div>
    <div class="素性">${版元と年(b)}</div>
    ${下}
  </button>`;
}

let 列の番号 = 0;
/* ⚠️ 見出しの右に「すべて見る」を置く。NetflixやPrime Videoと同じ場所。
      列は一部しか見せないので、全部への出口が無いと行き止まりになる。 */
function 流れる列(見出し, 添え, 本ら, 表, 並び){
  if(!本ら.length) return "";
  const 名 = "列" + (++列の番号);
  return `<section class="節">
    <div class="列の頭">
      <h2>${見出し}</h2><p class="添え">${添え}</p>
      <a class="すべて" onclick="go('books',${並び?`{並び:'${並び}'}`:"{}"})">すべて見る →</a>
      <div class="矢たち">
        <button class="矢" onclick="列を送る('${名}',-1)" aria-label="左へ">‹</button>
        <button class="矢" onclick="列を送る('${名}',1)" aria-label="右へ">›</button>
      </div>
    </div>
    <div class="列" id="${名}" tabindex="0">${本ら.map(b=>流し札(b,表?.[b.id])).join("")}</div>
  </section>`;
}

const 声の行 = (v, 本を出す=false) => `<div class="声">
  <div class="素性"><b>${名と印(v.送り主, v.表示名||"読者", v.匿)}</b>
    ${本を出す?`<a onclick="go('book',{id:'${v.本}'})">『${逃(本を引く(v.本)?.題||v.本)}』</a>`:""}
    ${v.種==="返し" ? `<span class="金">${pt(v.額)}</span>`
                   : `<span class="札 注">残したい${v.約?" "+pt(v.約):""}</span>`}
    <span>${いつ(v.時)}</span></div>
  <p>${逃(v.文)}</p></div>`;

/* 登録申請への導線。
   ⚠️ 前は一覧の一番下にしか無くて、**見つけられなかった。**
      「無い」と気づく場所すべてに置くこと（検索の空振り、一覧の頭、本のページ）。 */
const 申請ボタン = () => `<button class="釦" onclick="${土台.私 ? "申請を始める()" : "ログイン()"}">
  ${土台.私 ? "この本を入れてほしい" : "入って登録をお願いする"}</button>`;
const 申請リンク = () => `<a onclick="${土台.私 ? "申請を始める()" : "ログイン()"}">登録をお願いできます</a>`;

/* 印つきの名前。**名前が出るところには必ずこれを使う。**
   ⚠️ 匿名のときは印を出さない（誰のものか分かってしまう）。 */
function 名と印(uid, 表示名, 匿){
  if(匿) return `<span class="名と印"><span class="印 匿">匿</span>匿名</span>`;
  return `<span class="名と印">${しるし(土台.印を引く(uid, 表示名))}${逃(表示名)}</span>`;
}

/* 顔があれば画像、無ければ1文字。**必ずどちらかが出る。**
   ⚠️ loading="lazy" は外さないこと。声が並ぶ画面で一度に読みに行かせない。 */
function しるし({ 印, 色, 顔 }, 大きさ){
  const c = "印" + (大きさ ? " " + 大きさ : "");
  return 顔
    ? `<img class="${c}" src="${逃(顔)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="${c}" style="background:${色}">${逃(印)}</span>`;
}

const 数字 = (名,値,添え,朱) =>
  `<div class="数字"><div class="名">${名}</div>
   <div class="値"${朱?' style="color:var(--朱)"':''}>${値}</div>
   <div class="添え">${添え}</div></div>`;


/* ============================================================
   列を動かす

   ⚠️ GEMu_Web の実装から、試行錯誤の結論をそのまま引き継いでいる:
     ・**吸い付き（scroll-snap）は使わない。**流し続けると毎こま吸い戻されて震える
     ・**離れたら、その場で動き出す。**待たせると「壊れている」ように見える
     ・**矢印の smooth 送りの最中に scrollLeft を書き換えない。**動きが壊れるので、
       引き戻すのは「流している一こま」と「矢印を押した頭」だけにする
     ・1秒18px。速いと目で追えず、遅いと止まって見える
   ⚠️ 端を無くすため、画面幅を越えるまで札を複製して輪にする。
      複製には .写し を付けて、本物と区別できるようにしておくこと。
   ============================================================ */
const 列たち = new Map();     // id → { 休ませる, 送る }

window.列を送る = (名, 向き)=>{
  const c = 列たち.get(名);
  if(c){ c.送る(向き); c.休ませる(1200); }
};

function 列を仕込む(){
  列たち.clear();
  for(const 列 of 画面.querySelectorAll(".列")){
    const 一枚ぶん = ()=>{
      const 札 = 列.querySelector(".流し札");
      if(!札) return 列.clientWidth;
      const 間 = parseFloat(getComputedStyle(列).columnGap || "18") || 18;
      return 札.getBoundingClientRect().width + 間;
    };

    let 一組の幅 = 0;
    function 輪にする(){
      const 本物 = [...列.querySelectorAll(".流し札:not(.写し)")];
      列.querySelectorAll(".流し札.写し").forEach(e=>e.remove());
      if(本物.length < 2) return false;
      const 間 = parseFloat(getComputedStyle(列).columnGap || "18") || 18;
      一組の幅 = 本物.reduce((合,e)=>合 + e.getBoundingClientRect().width + 間, 0);
      let いま = 一組の幅, i = 0;
      while(いま < 一組の幅 + 列.clientWidth + 一枚ぶん()){
        const 写し = 本物[i % 本物.length].cloneNode(true);
        写し.classList.add("写し");
        写し.setAttribute("aria-hidden","true");
        写し.tabIndex = -1;
        列.appendChild(写し);
        いま += 一枚ぶん(); i++;
        if(i > 60) break;                      // 念のための歯止め
      }
      return true;
    }

    function 位置を戻す(){
      if(!一組の幅) return;
      if(列.scrollLeft >= 一組の幅) 列.scrollLeft -= 一組の幅;
      else if(列.scrollLeft < 0)    列.scrollLeft += 一組の幅;
    }
    const 送る = 向き=>{ 位置を戻す();
      列.scrollTo({ left: 列.scrollLeft + 向き * 一枚ぶん(), behavior:"smooth" }); };

    const 輪になった = 輪にする();
    let 休み = 0;
    const 休ませる = ミリ秒=>{ 休み = ミリ秒 ? Date.now() + ミリ秒 : 0; };
    列たち.set(列.id, { 休ませる, 送る });

    列.addEventListener("mouseenter", ()=>休ませる(60000));
    列.addEventListener("mouseleave", ()=>休ませる(0));
    列.addEventListener("focusin",    ()=>休ませる(60000));
    列.addEventListener("focusout",   ()=>休ませる(0));
    /* ⚠️ 指と巻物は、離してすぐには動かさない。慣性で流れている最中に重ねると喧嘩する */
    列.addEventListener("touchstart", ()=>休ませる(60000), { passive:true });
    列.addEventListener("touchend",   ()=>休ませる(600),   { passive:true });
    列.addEventListener("wheel",      ()=>休ませる(1200),  { passive:true });

    if(!輪になった) continue;
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches) continue;

    const 秒あたり = 18;
    let 前の時 = 0, 余り = 0;
    function 一こま(いま){
      if(!列.isConnected) return;              // 画面が差し替わったら止める
      const 経った = 前の時 ? Math.min(いま - 前の時, 100) : 0;
      前の時 = いま;
      requestAnimationFrame(一こま);
      if(Date.now() < 休み || document.hidden) return;
      if(列.contains(document.activeElement)) return;
      余り += (秒あたり * 経った) / 1000;
      const 進む = Math.floor(余り);
      if(進む < 1) return;
      余り -= 進む;
      列.scrollLeft += 進む;
      位置を戻す();
    }
    requestAnimationFrame(一こま);
  }
}


/* ── 番付 ─────────────────────────────────
   ⚠️ 追加のクエリを投げていない。トップで既に全件を1回読んでいるので、
      本ごと・主体ごと・人ごとを**同じ読み込みから**出している（共通.js）。
   ⚠️ 人の並びは、**匿名で送った分を名前に使わない。**
      匿名でしか送っていない人は「匿名」のまま並ぶ。 */
const 番付の段 = (題, 行ら, 空の言葉) => `
  <div class="番付">
    <h3>${題}</h3>
    ${行ら.length ? `<ol>${行ら.map(r=>`<li>
      <span class="名">${r.印HTML ? r.印HTML : r.押せる
        ? `<a onclick="go('${r.先頁}',{id:'${逃(r.先id)}'})">${逃(r.名)}</a>`
        : 逃(r.名)}</span>
      <span class="額">${r.金額.toLocaleString()}<i>pt</i></span>
    </li>`).join("")}</ol>`
    : `<p class="節の注" style="margin:10px 0 0">${空の言葉}</p>`}
  </div>`;

function 番付たち(順){
  if(!順) return "";
  const 主体行 = ら => ら.map(e=>({ 名:e.主体.名, 金額:e.金額, 押せる:true,
                                   先頁:"entity", 先id:e.id }));
  return `
  <section class="節">
    ${節の頭("いま、推されているもの", "返された分の多い順")}
    <div class="番付たち">
      ${番付の段("本", 順.本.map(b=>({ 名:b.本.題, 金額:b.金額, 押せる:true,
                                      先頁:"book", 先id:b.id })), "まだありません")}
      ${番付の段("著者", 主体行(順.著者), "まだありません")}
      ${番付の段("出版社", 主体行(順.出版社), "まだありません")}
      ${番付の段("よく返している人",
          順.人.map(u=>({ 名:u.名 || "匿名", 金額:u.金額, 押せる:false,
                          印HTML: 名と印(u.id, u.名 || "匿名", !u.名) })), "まだありません")}
    </div>
  </section>`;
}

/* ============================================================
   頁：主体（著者・出版社・書店）

   ⚠️ 番付から押した先。ここが無いと番付が行き止まりになる。
   ⚠️ 受け取った額と声は returns を読むので**認証が要る。**
      本の一覧だけなら未ログインでも出せるので、そこは出す。
   ============================================================ */
async function 頁_主体(){
  const e = 土台.主体表.get(現在.id);
  if(!e) return `<div class="節"><div class="断り">その相手は見つかりませんでした。
    <button class="釦 枠だけ 小" style="margin-left:10px" onclick="go('home')">さがすへ</button></div></div>`;

  const 入ってる = !!土台.私;
  const 本ら = 土台.蔵書.filter(b=>b.受取.some(r=>r.id === 現在.id));
  const { 明細, 合計 } = await 受取人の受取(現在.id);
  const 声あり = 明細.filter(x=>x.文);

  return `
  <section class="幕">
    <p class="英字の札">${e.型 === "author" ? "Author" : e.型 === "publisher" ? "Publisher" : "Store"}</p>
    <h1 class="大見出し" style="font-size:clamp(26px,3.6vw,38px)">${逃(e.名)}</h1>
    <p class="導き">${逃(土台.種の名[e.型] || e.型)}　${本ら.length}冊
      ${e.認証 ? '<span class="札 済">認証済</span>' : '<span class="札 藤">引き継ぎ待ち</span>'}</p>
    ${e.認証 ? "" : `<div class="断り" style="margin-top:20px;max-width:58ch">
      このページは、まだ本人・関係者に引き継がれていません。
      届いた本返しと読者の声は、引き継がれた時点でお渡しします。</div>`}
    <div class="数字たち">
      ${数字("Received", 合計.toLocaleString(), "受け取った分（支払額の90%・pt）", true)}
      ${数字("Thanks", 明細.length, "届いた本返し")}
      ${数字("Books", 本ら.length, "この相手の本")}
    </div>
  </section>

  ${流れる列("この相手の本", `${本ら.length}冊`, 本ら)}

  <section class="節">
    ${節の頭("読者からの声", 声あり.length + "件")}
    <div class="声の列">
      ${声あり.length ? 声あり.map(i=>`<div class="声">
            <div class="素性"><b>『${逃(本を引く(i.本)?.題 || i.本)}』</b>
              <span class="金">${pt(i.額)}</span><span>${いつ(i.時)}</span></div>
            <p>${逃(i.文)}</p></div>`).join("")
        : '<p class="節の注" style="padding:20px 0">まだありません。</p>'}
    </div>
  </section>`;
}

/* ============================================================
   頁：さがす
   ============================================================ */
async function 頁_さがす(){
  /* ⚠️ **未ログインでも、ほぼ全部見せる。**本・主体・返し・残しはすべて公開読み取り。
        入っている人にしか出さないのは「あなたの残高」と、本返しのボタンだけ。
        リンクを共有されたときに入口しか見えないのは、参加してもらう上で損。 */
  const 入ってる = !!土台.私;
  const q = (現在.q||"").trim();
  /* ⚠️ returns / keeps は公開読み取りにしたので、**入っていなくても数えられる。**
        入っている人にだけ出すのは「あなたの残高」だけ。 */
  const [数, 全体, 新着] = await Promise.all([
    まとめて数える(), 全体の集計(), 最近の声(5)
  ]);
  const 表 = 数.本;
  const 順 = 番付(数, 3);
  const 一覧 = q ? 土台.蔵書.filter(b=>(b.題+b.著+b.版元).includes(q)) : 土台.蔵書;

  return `
  ${看板()}
  <section class="幕">
    <p class="英字の札">Return to books</p>
    <h1 class="大見出し">読んだあとに、<br>ありがとうを。</h1>
    <p class="導き">買うだけでは届かなかった気持ちを、著者・出版社・書店へ。
      図書館で借りた本も、古本で買った本も、昔もらった本も。
      <b style="color:var(--朱);font-weight:600">100ptから返せます。</b></p>
    <form class="さがす" style="margin-top:34px" onsubmit="event.preventDefault();go('home',{q:this.q.value})">
      <input name="q" placeholder="書名・著者名で探す" value="${逃(q)}">
      <button type="submit">さがす</button>
    </form>
    <p class="節の注" style="margin-top:14px">
      ${土台.蔵書.length}冊あります。<a onclick="go('books')">一覧を見る</a>。
      ここに無い本は、${申請リンク()}。</p>
    <div class="数字たち">
      ${数字("Thanks", 全体.人数.toLocaleString(), "これまでの本返し")}
      ${数字("Returned", pt(全体.金額).replace("pt",""), "本の世界へ届いた分（pt）", true)}
      ${数字("Keep", 全体.残数.toLocaleString(), "残したい")}
      ${入ってる
        ? 数字("Wallet", (土台.財布?.残高??0).toLocaleString(), "あなたの残高（pt）")
        : 数字("Books", 土台.蔵書.length, "棚にある本")}
    </div>
  </section>

  ${q ? `
  <section class="節">
    ${節の頭(`「${逃(q)}」の結果`, 一覧.length+"冊")}
    <div class="本の列">${一覧.map(b=>本の札(b,表[b.id])).join("")
      || `<div style="padding:30px 0">
            <p class="節の注" style="margin:0 0 16px">見つかりませんでした。</p>
            ${申請ボタン()}</div>`}</div>
  </section>` : `
  ${番付たち(順)}
  ${/* 「ありがとうが集まっている本」の流れる列は外した（2026-09-23）。
       すぐ上の番付と中身が重なり、冊数が少ないと同じ本が繰り返し流れて見えたため */ ""}
  ${流れる列("新しく入った本", "直近に登録された30冊",
      [...土台.蔵書].sort((a,b)=>String(b.登録日||"").localeCompare(String(a.登録日||"")))
        .slice(0,30), 表, "登録")}
  <section class="節" style="padding-top:44px">
    <a class="釦 枠だけ" onclick="go('books')">本の一覧をぜんぶ見る（${土台.蔵書.length}冊）</a>
  </section>
  ${入ってる ? "" : 入るとこうなる()}`}

  ${q?"":`
  <section class="節">
    ${節の頭("最近、届いた声", "購買データでは取れない、読後の言葉")}
    <div class="声の列">
      ${新着.length ? 新着.map(v=>声の行(v,true)).join("")
        : '<p class="節の注" style="padding:20px 0">まだありません。最初の1件を書いてみてください。</p>'}
    </div>
  </section>`}`;
}

/* ============================================================
   頁：本の一覧

   ⚠️ トップは流れる列だけにしてあるので、**全部を見る場所がここ。**
      冊数が増えたら、ここに絞り込み（出版社・著者・年代）を足す。
      並べ替えは手元でやる。いまの冊数なら十分で、
      Firestore の複合インデックスを増やさずに済む。
   ============================================================ */
async function 頁_一覧(){
  const q = (現在.q || "").trim();
  const 並び = 現在.並び || "年";
  /* ⚠️ 集計は returns/keeps を読むので**認証が要る。**
        本そのものは公開しているのだから、一覧も未ログインで見られるべき。
        入っていないときは金額を出さないだけにする。 */
  const 表 = 土台.私 ? (await まとめて数える()).本 : {};

  let 本ら = [...土台.蔵書];
  if(q) 本ら = 本ら.filter(b=>(b.題 + b.著 + b.版元 + (b.副題||"")).includes(q));
  const 並べ方 = {
    登録: (a,b)=>String(b.登録日||"").localeCompare(String(a.登録日||"")),
    年:   (a,b)=>(b.年||0) - (a.年||0),
    額:   (a,b)=>(表[b.id]?.金額||0) - (表[a.id]?.金額||0),
    題:   (a,b)=>a.題.localeCompare(b.題, "ja"),
    頁:   (a,b)=>(b.頁||0) - (a.頁||0)
  };
  本ら.sort(並べ方[並び] || 並べ方.年);

  return `
  <section class="幕">
    <p class="英字の札">All books</p>
    <h1 class="大見出し" style="font-size:clamp(25px,3.2vw,34px)">本の一覧</h1>
    <p class="導き">本返しで扱っている本。ここに無ければ、下から知らせてください。</p>
    <form class="さがす" style="margin-top:30px"
      onsubmit="event.preventDefault();go('books',{q:this.q.value,並び:'${並び}'})">
      <input name="q" placeholder="書名・著者・出版社でしぼる" value="${逃(q)}">
      <button type="submit">しぼる</button>
    </form>
    <p class="節の注" style="margin-top:14px">
      ここに無い本は、${申請リンク()}。AmazonのURLかISBNがあれば、その場で書誌を引きます。</p>
  </section>

  <section class="節">
    <div class="節の頭">
      <h2 class="節見出し">${q ? `「${逃(q)}」` : "すべて"}</h2>
      <p class="節の添え">${本ら.length}冊</p>
    </div>
    <div style="display:flex;gap:7px;flex-wrap:wrap;margin:16px 0 4px">
      <span class="節の注" style="margin:0 6px 0 0;align-self:center">並び</span>
      ${[["登録","登録の新しい順"],["年","刊行の新しい順"],["額","返された分"],["頁","ページ数"],["題","書名"]]
        .map(([k,l])=>`<button class="釦 ${並び===k?'':'枠だけ'} 小"
          onclick="go('books',{q:'${逃(q)}',並び:'${k}'})">${l}</button>`).join("")}
    </div>
    <div class="本の列" style="margin-top:14px">
      ${本ら.length ? 本ら.map(b=>本の札(b, 表[b.id])).join("")
        : `<div style="padding:30px 0">
             <p class="節の注" style="margin:0 0 16px">見つかりませんでした。</p>
             ${申請ボタン()}</div>`}
    </div>
  </section>

  <section class="節">
    ${節の頭("さがしている本がありませんか", "登録をお願いできます")}
    <p class="節の注" style="max-width:58ch">
      書名・著者名・出版社名を教えていただければ、確認のうえ棚に並べます。
      ISBN が分かれば、その場で書誌を確かめられます。</p>
    <button class="釦" style="margin-top:18px"
      onclick="${土台.私 ? "申請を始める()" : "ログイン()"}">
      ${土台.私 ? "この本を入れてほしい" : "入って申請する"}</button>
  </section>`;
}

/* 入っていない人に見せる案内。
   ⚠️ 前は画面ごと乗っ取って棚を隠していた。共有リンクで来た人が、
      何のサービスか分からないまま入口に立たされるので、やめた。
      いまは棚を見せたうえで、この案内を差し込むだけにしている。 */
/* 入らないと見られない画面（自分の記録・受取人の控え）の案内 */
function 入るには(){
  return `<div class="節"><div class="断り" style="margin-top:40px">
    この画面は、入ってから見られます。
    <button class="釦 枠だけ 小" style="margin-left:12px" onclick="ログイン()">Googleで入る</button>
    </div></div>`;
}

function 入るとこうなる(){
  return `
  <div class="入口" style="padding-top:44px">
    <div>
      <p class="英字の札">About</p>
      <h1 class="大見出し" style="font-size:clamp(25px,3.2vw,34px)">本を買うだけでは、<br>届かない気持ちがある。</h1>
      <p class="導き">図書館で借りた本。古本で買った本。人からもらった本。
        読んで確かに何かをもらったのに、その感謝が著者にも、出版社にも、書店にも届かないまま終わる。
        本返しは、読み終わったあとに気持ちを返すための場所です。</p>
      <p class="導き" style="margin-top:22px">
        いまは<b style="color:var(--字)">架空のポイントで試している段階</b>で、実際のお金は一切動きません。
        本物のお金を扱う前に、読後に誰かへ気持ちを託すという行いが本当に起きるのかを確かめています。</p>
    </div>
    <div class="わけ">
      <p class="名札" style="margin-top:0">入ると、こうなります</p>
      <div class="内訳" style="border-top:none;margin-top:10px;padding-top:0">
        <div class="行"><span>はじめに配られる</span><b style="color:var(--朱)">10,000</b></div>
        <div class="行"><span>毎月ふたたび配られる</span><span>3,000</span></div>
        <div class="行 薄"><span>換金・購入</span><span>できません</span></div>
        <div class="行 締め"><span>実際のお金</span><span>0円</span></div>
      </div>
      <button class="釦 全幅" style="margin-top:26px" onclick="ログイン()">Googleで入る</button>
      <p class="節の注" style="margin-top:12px">
        お名前とアイコンだけ使います。<a onclick="go('about')">しくみを読む</a></p>
    </div>
  </div>`;
}

/* ============================================================
   頁：本
   ============================================================ */
async function 頁_本(){
  const 入ってる = !!土台.私;      // ⚠️ 入っていなくても本は見せる。声と本返しだけ求める
  const b = 本を引く(現在.id);
  if(!b) return `<div class="節"><div class="断り">その本は見つかりませんでした。
    <button class="釦 枠だけ 小" style="margin-left:10px" onclick="go('home')">さがすへ</button></div></div>`;

  /* ⚠️ returns / keeps は公開読み取り。**入っていなくても集計と声が出る。** */
  const [s, 声たち] = await Promise.all([本の集計(b.id), 本の声(b.id)]);
  const 受 = 届け先(b);

  return `
  <div class="本の頭">
    <div class="書影 大" style="background:linear-gradient(155deg,${b.色},${b.色}bb)">
      ${表紙img(b)}
      <span>${逃(b.題)}</span></div>
    <div style="flex:1;min-width:0">
      <p class="英字の札" style="margin-bottom:12px">${b.状態==="絶版"?"Out of print":"In print"}</p>
      <h1 class="本の題">${逃(b.題)}</h1>
      ${b.副題 ? `<p class="本の副題">${逃(b.副題)}</p>` : ""}
      <p class="本の素性" style="font-size:12.5px;margin-top:12px">
        ${逃(b.著)}<br>${版元と年(b)}${b.頁?`　${b.頁}ページ`:""}${b.isbn?`<br>ISBN ${b.isbn}`:""}</p>
      <div style="margin-top:14px;display:flex;gap:7px;flex-wrap:wrap">
        ${b.状態==="絶版"?'<span class="札 注">絶版・品切れ</span>':'<span class="札 済">流通中</span>'}
        ${受.length?"":'<span class="札 注">届け先なし</span>'}
      </div>
      <div style="margin-top:26px;display:flex;gap:10px;flex-wrap:wrap">
        ${!入ってる
          ? `<button class="釦 朱" onclick="ログイン()">入って本返しする</button>`
          : 受.length
          ? `<button class="釦 朱" onclick="返し始め('${b.id}')">この本に本返しする</button>
             <button class="釦 枠だけ" onclick="残し始め('${b.id}')">残したい</button>`
          : `<button class="釦 藤" onclick="残し始め('${b.id}')">この本を残したい</button>`}
      </div>
      ${b.Amazonら.length ? `<p style="margin-top:18px;display:flex;gap:9px;align-items:center;flex-wrap:wrap">
        ${b.Amazonら.map(a=>`<a href="${逃(a.url)}" target="_blank" rel="noopener sponsored nofollow"
           class="外へ">Amazonで見る${a.label?`　${逃(a.label)}`:""}</a>`).join("")}
        <span class="節の注" style="display:inline;margin:0">広告リンクです</span></p>` : ""}
      ${受.length?"":`<div class="断り" style="margin-top:22px">
        この本には、まだ受取人が登録されていません。<b>ポイントも受け取りません。</b>
        気持ちと「復刊したら払いたい額」だけを記録します。</div>`}
    </div>
  </div>

  <div class="数字たち" style="margin-top:44px">
    ${数字("Thanks", s.人数.toLocaleString(), "本返しした人")}
    ${数字("Returned", pt(s.金額).replace("pt",""), "この本から返った分（pt）", true)}
    ${数字("Voices", 声たち.length.toLocaleString(), "読後のことば")}
    ${数字("Keep", s.残数.toLocaleString(), s.約額?`残したい（${pt(s.約額)}の意思）`:"残したい")}
  </div>

  <section class="節">
    ${節の頭("この本を支える人たち", "応援する対象は本、受け取るのは人")}
    <div class="受取の列">
      ${(b.受取||[]).length ? b.受取.map(r=>`
        <div class="受取の行">
          <div class="顔">${逃(r.種[0])}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14.5px;font-weight:600;letter-spacing:.03em">
              <a onclick="go('entity',{id:'${逃(r.id)}'})">${逃(r.名)}</a></div>
            <div class="本の素性" style="margin-top:2px">${逃(r.種)}</div>
          </div>
          ${r.認証 ? '<span class="札 済">認証済</span>' : '<span class="札 藤">引き継ぎ待ち</span>'}
        </div>`).join("")
      : `<div class="受取の行"><div style="flex:1" class="本の素性">登録されている受取人は、まだいません。</div></div>`}
    </div>
  </section>

  <section class="節">
    ${節の頭("読者からの声", 声たち.length+"件")}
    <div class="声の列">
      ${声たち.length ? 声たち.map(v=>声の行(v)).join("")
        : '<p class="節の注" style="padding:20px 0">まだ声はありません。</p>'}
    </div>
  </section>`;
}

/* ============================================================
   覆い：本返しする
   ============================================================ */
let F = {};
window.覆い閉じ = ()=>{ 窓.innerHTML=""; };

window.返し始め = id=>{
  const b = 本を引く(id), 受 = 届け先(b);
  F = { 本:id, 段:1, 額:既定額, 自由:"", 文:"", 匿:false, 送信中:false,
        配分:Object.fromEntries(受.map((r,i,a)=>[r.id, Math.floor(100/a.length)+(i===0?100%a.length:0)])) };
  返し描く();
};
window.額指定 = v=>{ F.額=v; F.自由=""; 返し描く(); };
window.額自由 = v=>{ F.自由=v; const n=parseInt(v.replace(/[^0-9]/g,""),10); F.額=isNaN(n)?0:n; 返し描く(true); };
window.配分変更 = (id,v)=>{ F.配分[id]=+v; 返し描く(); };
window.均等 = ()=>{ const k=Object.keys(F.配分);
  k.forEach((x,i)=>F.配分[x]=Math.floor(100/k.length)+(i===0?100%k.length:0)); 返し描く(); };
window.段へ = n=>{ F.段=n; 返し描く(); };

/* ⚠️⚠️ **インラインの on... は、グローバルスコープで動く。**
   app.js は type="module" なので、モジュールの中の F / K は**そこから見えない。**
   前は oninput="F.文=this.value" と直に書いていて、
   ReferenceError になり、**ことばと匿名だけが黙って捨てられていた**
   （金額は window.額指定 を通っていたので気づけなかった。2026-09-23に判明）。
   → 値を入れるものも、必ず window に出した関数を通すこと。 */
window.文を書く   = v=>{ F.文 = v; };
window.匿を決める = v=>{ F.匿 = v; };
const 配分計 = ()=> Object.values(F.配分).reduce((a,b)=>a+b,0);

function 返し描く(自由に){
  const b = 本を引く(F.本), 受 = 届け先(b);
  const 額 = F.額||0, 残高 = 土台.財布?.残高 ?? 0;
  const 決 = Math.round(額*決済率), 運 = Math.round(額*運営率), 本へ = 額-決-運;
  const 足りない = 額 > 残高;
  let 中 = "";

  if(F.段===1){
    中 = `
      <p class="節の注" style="margin:0">『${逃(b.題)}』に、いくら返しますか。　残高 ${残高.toLocaleString()}pt</p>
      <div class="金額たち">
        ${[100,300,500,1000,3000,5000].map(v=>
          `<button class="${!F.自由&&F.額===v?'いま':''}" ${v>残高?"disabled":""} onclick="額指定(${v})">${v.toLocaleString()}</button>`).join("")}
      </div>
      <input class="欄" id="自由額" inputmode="numeric" placeholder="自由な額（100〜${Math.min(50000,残高).toLocaleString()}pt）"
        value="${逃(F.自由)}" oninput="額自由(this.value)">
      <div class="内訳">
        <div class="帯グラフ">
          <div style="width:${額?本へ/額*100:0}%;background:var(--朱)"></div>
          <div style="width:${額?決/額*100:0}%;background:var(--罫の濃い)"></div>
          <div style="width:${額?運/額*100:0}%;background:var(--灯)"></div>
        </div>
        <div class="行"><span>本の世界へ届く分</span><b style="color:var(--朱)">${本へ.toLocaleString()}</b></div>
        <div class="行 薄"><span>決済手数料ぶん（約5%）</span><span>${決.toLocaleString()}</span></div>
        <div class="行 薄"><span>本返しの運営（5%）</span><span>${運.toLocaleString()}</span></div>
        <div class="行 締め"><span>お支払い</span><span>${額.toLocaleString()} pt</span></div>
      </div>
      ${足りない?`<p class="節の注" style="color:var(--朱)">残高が足りません。</p>`:""}
      ${額>0&&額<300&&!足りない?`<p class="節の注">
        少額は決済の固定費が重くなるため、本物のお金にするときは数件まとめて決済する方式を想定しています。</p>`:""}
      <button class="釦 朱 全幅" style="margin-top:22px"
        ${額<100||額>50000||足りない?"disabled":""} onclick="段へ(2)">届け先をえらぶ</button>`;
  }

  if(F.段===2){
    const 計 = 配分計();
    中 = `
      <p class="節の注" style="margin:0 0 6px">${本へ.toLocaleString()}pt を、誰に届けますか。</p>
      ${受.map(r=>`<div class="配る">
        <div class="名">${逃(r.名)}<br><span class="種">${逃(r.種)}</span></div>
        <input type="range" min="0" max="100" step="5" value="${F.配分[r.id]}" oninput="配分変更('${r.id}',this.value)">
        <div class="率">${F.配分[r.id]}%</div>
        <div class="率" style="width:56px;color:var(--朱);font-family:var(--明朝);font-size:14px">
          ${Math.round(本へ*F.配分[r.id]/100).toLocaleString()}</div>
      </div>`).join("")}
      <div style="display:flex;align-items:center;gap:14px;margin-top:16px">
        <button class="釦 枠だけ 小" onclick="均等()">均等にする</button>
        <span class="節の注" style="margin:0;${計===100?'':'color:var(--朱)'}">
          合計 ${計}%${計===100?"":" ― 100%にしてください"}</span>
      </div>
      <div style="display:flex;gap:10px;margin-top:26px">
        <button class="釦 枠だけ" onclick="段へ(1)">戻る</button>
        <button class="釦" style="flex:1" ${計===100?"":"disabled"} onclick="段へ(3)">ことばを添える</button>
      </div>`;
  }

  if(F.段===3){
    中 = `
      <p class="節の注" style="margin:0 0 10px">この本に伝えたいことを。（任意・本のページに公開されます）</p>
      <textarea class="欄" id="返しの文" maxlength="400" placeholder="例）高校生の頃に読んで、進路を決めました。"
        oninput="文を書く(this.value)">${逃(F.文)}</textarea>
      <label style="display:flex;align-items:center;gap:10px;margin-top:16px;
        font-family:var(--ゴシック);font-size:12px;color:var(--字の薄い);cursor:pointer">
        <input type="checkbox" id="返しの匿" ${F.匿?"checked":""} onchange="匿を決める(this.checked)"> 匿名で届ける
      </label>
      <div class="内訳">
        <div class="行"><span>お支払い</span><b>${額.toLocaleString()}</b></div>
        ${受.filter(r=>F.配分[r.id]>0).map(r=>
          `<div class="行 薄"><span>${逃(r.名)}</span><span>${Math.round(本へ*F.配分[r.id]/100).toLocaleString()} pt</span></div>`).join("")}
        <div class="行 薄"><span>決済＋運営</span><span>${(決+運).toLocaleString()} pt</span></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:24px">
        <button class="釦 枠だけ" ${F.送信中?"disabled":""} onclick="段へ(2)">戻る</button>
        <button class="釦 朱" style="flex:1" ${F.送信中?"disabled":""} onclick="返し確定()">
          ${F.送信中?"送っています…":"本返しする"}</button>
      </div>
      <p class="節の注" style="text-align:center">架空のポイントです。実際のお金は動きません</p>`;
  }

  if(F.段===4){
    中 = `<div class="終い">
      <div class="印">🕊</div>
      <h3 style="font-size:19px;margin:16px 0 10px;font-weight:600;letter-spacing:.09em">本返し、届きました</h3>
      <p class="節の注" style="margin:0">『${逃(b.題)}』へ ${額.toLocaleString()}pt<br>
        <b style="color:var(--朱);font-family:var(--明朝);font-size:15px">${本へ.toLocaleString()}pt</b> が本の世界へ渡ります<br>
        残り ${(土台.財布?.残高??0).toLocaleString()}pt</p>
      <button class="釦 全幅" style="margin-top:26px" onclick="覆い閉じ();location.reload()">本のページへ戻る</button>
      <button class="釦 枠だけ 全幅" style="margin-top:10px" onclick="覆い閉じ();go('receiver')">受取人の控えを見る</button>
    </div>`;
  }

  窓.innerHTML = `
  <div class="覆い" onclick="if(event.target===this)覆い閉じ()">
    <div class="窓">
      <div class="窓の頭"><h3>${F.段===4?"":"この本に本返しする"}</h3>
        <button class="閉じる" onclick="覆い閉じ()">✕</button></div>
      ${F.段<4?`<div class="段">${[1,2,3].map(i=>`<div class="${F.段>=i?'いま':''}"></div>`).join("")}</div>`:""}
      <div class="窓の中">${中}</div>
    </div></div>`;

  if(自由に){ const t=document.getElementById("自由額");
    if(t&&F.段===1){ t.focus(); t.setSelectionRange(t.value.length,t.value.length); } }
}

window.返し確定 = async ()=>{
  if(F.送信中) return;

  /* ⚠️ **送る直前に、画面から直に読む。**
     oninput だけに頼ると、日本語入力を確定しないままボタンを押されたときに
     取りこぼす余地が残る。ここで読めば、何があっても画面に見えている値が送られる。 */
  const 文欄 = document.getElementById("返しの文");
  if(文欄) F.文 = 文欄.value;
  const 匿欄 = document.getElementById("返しの匿");
  if(匿欄) F.匿 = 匿欄.checked;

  const b = 本を引く(F.本), 受 = 届け先(b);
  const 内訳 = 受.filter(r=>F.配分[r.id]>0)
    .map(r=>({ 受取人:r.id, 名:r.名, 額:Math.round(F.額*F.配分[r.id]/100) }));

  // ⚠️ 端数で合計がずれると firestore.rules に弾かれる。最初の行で吸収する
  const ずれ = F.額 - 内訳.reduce((s,x)=>s+x.額,0);
  if(内訳.length) 内訳[0].額 += ずれ;
  if(内訳.some(x=>x.額<=0)){ 知らせる("配分が細かすぎます。均等にしてください", true); return; }

  F.送信中 = true; 返し描く();
  try{
    await 本返しする({ 本id:F.本, 額:F.額, 内訳, 文:F.文, 匿:F.匿 });
    F.送信中 = false; 段へ(4); 帯を描く();
  }catch(e){
    F.送信中 = false; 返し描く();
    console.error(e);
    知らせる(e.code==="permission-denied"
      ? "残高が合いませんでした。開き直してからもう一度お試しください" : "送れませんでした", true);
  }
};

/* ============================================================
   覆い：残したい（ポイントは動かない）
   ============================================================ */
let K = {};
window.残し始め = id=>{ K={ 本:id, 約:1000, 文:"", 済:false, 送信中:false }; 残し描く(); };
window.約指定 = v=>{ K.約=v; 残し描く(); };
window.残す文を書く = v=>{ K.文 = v; };   // ⚠️ 理由は上の F の setter と同じ

function 残し描く(){
  const b = 本を引く(K.本);
  const 中 = K.済 ? `<div class="終い">
      <div class="印">📖</div>
      <h3 style="font-size:19px;margin:16px 0 10px;font-weight:600;letter-spacing:.09em">意思を記録しました</h3>
      <p class="節の注" style="margin:0">権利者がこのページを引き継いだら、お知らせします。</p>
      <button class="釦 全幅" style="margin-top:26px" onclick="覆い閉じ();location.reload()">閉じる</button>
    </div>` : `
    <p class="節の注" style="margin:0">『${逃(b.題)}』を残したい気持ちを記録します。
      <b style="color:var(--字)">ポイントは減りません。</b></p>
    <p class="名札">復刊・電子化されたら、いくら払ってもいいですか</p>
    <div class="金額たち" style="margin-top:8px">
      ${[0,500,1000,2000,3000,5000].map(v=>
        `<button class="${K.約===v?'いま':''}" onclick="約指定(${v})">${v===0?"額なし":v.toLocaleString()}</button>`).join("")}
    </div>
    <p class="名札">この本への思い（任意・公開されます）</p>
    <textarea class="欄" id="残しの文" maxlength="400" placeholder="例）古本で出会いました。子どもにも読ませたい。"
      oninput="残す文を書く(this.value)">${逃(K.文)}</textarea>
    <div class="断り 藤" style="margin-top:22px">
      これは支払いの約束ではなく、<b>需要のしるし</b>です。集まった額は「これだけの読者が待っている」として、
      出版社・権利者に示されます。</div>
    <button class="釦 藤 全幅" style="margin-top:22px" ${K.送信中?"disabled":""} onclick="残し確定()">
      ${K.送信中?"記録しています…":"残したい気持ちを記録する"}</button>`;

  窓.innerHTML = `
  <div class="覆い" onclick="if(event.target===this)覆い閉じ()">
    <div class="窓">
      <div class="窓の頭"><h3>${K.済?"":"この本を残したい"}</h3>
        <button class="閉じる" onclick="覆い閉じ()">✕</button></div>
      <div class="窓の中">${中}</div>
    </div></div>`;
}

window.残し確定 = async ()=>{
  if(K.送信中) return;
  const 文欄 = document.getElementById("残しの文");   // ⚠️ 理由は 返し確定 と同じ
  if(文欄) K.文 = 文欄.value;
  K.送信中 = true; 残し描く();
  try{
    await 残したい({ 本id:K.本, 約:K.約, 文:K.文 });
    K.送信中 = false; K.済 = true; 残し描く();
  }catch(e){
    K.送信中 = false; 残し描く();
    console.error(e); 知らせる("記録できませんでした", true);
  }
};


/* ============================================================
   覆い：本の登録を申請する

   ⚠️ **入力はそのまま受ける。**照合はあとで管理者が回す。
      国会図書館サーチは1回20秒かかるうえ不安定なので、
      ここで待たせると出す気が失せる。
   ⚠️ ISBN のときだけ openBD で即座に確かめられる（57ms）。
      これは待たせても気にならないので、入力補助として使う。
   ============================================================ */
let S = {};
window.申請を始める = ()=>{ S = { 題:"", 著:"", 版元:"", isbn:"", amazon:"", 覚書:"",
  済:false, 送信中:false, 確認:null };
  申請描く(); };

function 申請描く(欄を保つ){
  const 中 = S.済 ? `<div class="終い">
      <div class="印">📖</div>
      <h3 style="font-size:19px;margin:16px 0 10px;font-weight:600;letter-spacing:.09em">受け取りました</h3>
      <p class="節の注" style="margin:0">書誌を確かめてから棚に並べます。<br>
        少しお時間をください。</p>
      <button class="釦 全幅" style="margin-top:26px" onclick="覆い閉じ();location.reload()">閉じる</button>
    </div>` : `
    <p class="節の注" style="margin:0">棚に無い本を教えてください。確認のうえ並べます。</p>

    <p class="名札">AmazonのURL（任意・ここから書誌を引けます）</p>
    <div style="display:flex;gap:10px;align-items:flex-end">
      <input class="欄" id="申amazon" placeholder="https://www.amazon.co.jp/…/dp/4166612476"
        value="${逃(S.amazon||"")}" oninput="申請の値('amazon',this.value)">
      <button class="釦 枠だけ 小" style="white-space:nowrap" onclick="Amazonから読む()">読み取る</button>
    </div>
    <p class="節の注">
      紙の本のURLなら、書名・著者・出版社を自動で埋められます。<br>
      短縮リンク（link.amazon/… ）は一度開いて、出てきたURLを貼ってください。<br>
      <b>リンク自体は保存しません。</b>ISBNを取り出すためだけに使います。</p>

    <p class="名札">ISBN（分かれば。あると確実です）</p>
    <div style="display:flex;gap:10px;align-items:flex-end">
      <input class="欄" id="申isbn" inputmode="numeric" placeholder="9784166612475"
        value="${逃(S.isbn)}" oninput="申請の値('isbn',this.value)">
      <button class="釦 枠だけ 小" style="white-space:nowrap" onclick="ISBNを確かめる()">確かめる</button>
    </div>
    ${S.確認 === "さがし中" ? `<p class="節の注">さがしています…</p>`
      : S.確認 ? `<div class="断り 藤" style="margin-top:12px">
          <b>${逃(S.確認.題)}</b><br>${逃(S.確認.著||"")}<br>${逃(S.確認.版元||"")}・${逃(S.確認.年||"")}
          <br><button class="釦 枠だけ 小" style="margin-top:8px"
            onclick="確認を使う()">この内容を入れる</button></div>`
      : S.確認 === false ? `<p class="節の注" style="color:var(--朱)">その ISBN は見つかりませんでした。下に手で書いてください。</p>` : ""}

    <p class="名札">書名 <span style="color:var(--朱)">必須</span></p>
    <input class="欄" id="申題" value="${逃(S.題)}" oninput="申請の値('題',this.value)">
    <p class="名札">著者名 <span style="color:var(--朱)">必須</span></p>
    <input class="欄" id="申著" value="${逃(S.著)}" oninput="申請の値('著',this.value)">
    <p class="名札">出版社名 <span style="color:var(--朱)">必須</span></p>
    <input class="欄" id="申版元" value="${逃(S.版元)}" oninput="申請の値('版元',this.value)">
    <p class="名札">ひとこと（任意）</p>
    <textarea class="欄" id="申覚書" maxlength="300"
      placeholder="例）文庫版でお願いします／この本に返したくて登録しました"
      oninput="申請の値('覚書',this.value)">${逃(S.覚書)}</textarea>

    <div class="断り" style="margin-top:20px">
      そのまま受け取って、こちらで書誌を確かめてから並べます。
      **書名だけでは機械が別の本を掴む**ので、著者名と出版社名もお願いしています。</div>
    <button class="釦 全幅" style="margin-top:20px" ${S.送信中?"disabled":""} onclick="申請を出す()">
      ${S.送信中?"送っています…":"申請する"}</button>`;

  窓.innerHTML = `
  <div class="覆い" onclick="if(event.target===this)覆い閉じ()">
    <div class="窓">
      <div class="窓の頭"><h3>${S.済?"":"この本を入れてほしい"}</h3>
        <button class="閉じる" onclick="覆い閉じ()">✕</button></div>
      <div class="窓の中">${中}</div>
    </div></div>`;
  if(欄を保つ){ const e = document.getElementById(欄を保つ);
    if(e){ e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }
}

/* ⚠️ インラインの on... はグローバルで動く。モジュールの S は見えないので、
      値を入れるものは必ず window 経由で（ことばを取りこぼした件と同じ理由）。 */
window.申請の値 = (名, 値)=>{ S[名] = 値; };

/* ⚠️ **リンクは保存しない。**ASIN→ISBN を取り出す道具として使うだけ。
      利用者の貼ったアフィリエイトタグを、こちらのサイトで使うわけにはいかない。 */
window.Amazonから読む = async ()=>{
  const u = document.getElementById("申amazon")?.value.trim() || "";
  S.amazon = u;
  if(/link\.amazon|amzn\.to|amzn\.asia/.test(u)){
    知らせる("短縮リンクは辿れません。一度開いて、出てきたURLを貼ってください", true); return;
  }
  const asin = 土台.AmazonのASIN(u);
  if(!asin){ 知らせる("AmazonのURLから商品番号を読み取れませんでした", true); return; }
  const isbn13 = 土台.ISBN13にする(asin);
  if(!isbn13){
    知らせる("Kindle版などは書誌を引けません。紙の本のURLでお願いします", true); return;
  }
  S.isbn = isbn13;
  S.確認 = "さがし中"; 申請描く();
  const r = await 土台.ISBNで確かめる(isbn13);
  S.確認 = r || false;
  if(r){ S.題 = r.題 || S.題; S.著 = r.著 || S.著; S.版元 = r.版元 || S.版元; }
  申請描く();
};

window.ISBNを確かめる = async ()=>{
  const v = document.getElementById("申isbn")?.value || "";
  S.isbn = v;
  if(v.replace(/[^0-9Xx]/g,"").length < 10){ 知らせる("ISBNを10桁以上入れてください", true); return; }
  S.確認 = "さがし中"; 申請描く();
  const r = await 土台.ISBNで確かめる(v);
  S.確認 = r || false; 申請描く();
};
window.確認を使う = ()=>{
  const c = S.確認; if(!c) return;
  S.題 = c.題 || S.題; S.著 = c.著 || S.著; S.版元 = c.版元 || S.版元; S.isbn = c.isbn || S.isbn;
  申請描く();
};

window.申請を出す = async ()=>{
  if(S.送信中) return;
  ["題","著","版元","isbn","覚書"].forEach(k=>{
    const e = document.getElementById("申" + (k==="isbn"?"isbn":k));
    if(e) S[k] = e.value.trim();
  });
  if(!S.題 || !S.著 || !S.版元){ 知らせる("書名・著者名・出版社名は必須です", true); return; }
  S.送信中 = true; 申請描く();
  try{
    await 土台.登録を申請する(S);
    S.送信中 = false; S.済 = true; 申請描く();
  }catch(e){
    S.送信中 = false; 申請描く();
    console.error(e); 知らせる("送れませんでした：" + (e.code||e.message), true);
  }
};


/* ============================================================
   覆い：設定

   ⚠️ **Googleの表示名をそのまま出さない。**本名で登録している人が多く、
      「この本に救われた」と本名で書きたくない人がいる。
      名乗りを決めれば、**過去の分もすべてその名前に変わる**
      （記録に名前を焼き付けていないので）。
   ============================================================ */
let 設定中 = { 送信中:false };

window.設定をひらく = ()=>{
  const 私の = 土台.私の印();
  設定中 = { 名:土台.私の名(), 印:私の.印, 色:私の.色, 顔:私の.顔, 送信中:false, 支度中:false };
  設定描く();
};

function 設定描く(){
  const 決めてある = 土台.名乗り表.has(土台.私?.uid);
  const 見本 = 設定中.顔
    ? `<img class="印 大" src="${逃(設定中.顔)}" alt="">`
    : `<span class="印 大" style="background:${設定中.色}">${逃(設定中.印 || "読")}</span>`;
  窓.innerHTML = `
  <div class="覆い" onclick="if(event.target===this)覆い閉じ()">
    <div class="窓">
      <div class="窓の頭"><h3>設定</h3>
        <button class="閉じる" onclick="覆い閉じ()">✕</button></div>
      <div class="窓の中">

        <div class="見本の列">
          ${見本}
          <div>
            <p class="名札" style="margin:0 0 6px">表示する名前</p>
            <input class="欄" id="設定の名" maxlength="24" value="${逃(設定中.名 || "")}"
              placeholder="本の世界に出したい名前" oninput="設定の見本(this.value)">
          </div>
        </div>

        <p class="節の注">
          読者の声や番付に、この名前と印が出ます。${決めてある ? ""
            : "<br>いまは Google のアカウント名がそのまま出ています。"}
          <br><b>変えると、過去に送った分もすべて新しい名前に変わります。</b>
          （記録に名前を焼き付けていないため）
          <br>1回ずつ「匿名で届ける」を選ぶこともできます。</p>

        <p class="名札" style="margin-top:22px">しるし</p>
        <p class="節の注" style="margin-top:4px">
          名前の横に出るものです。画像を選ぶか、字と色で作れます。</p>

        <div class="しるしの段">
          <label class="釦 枠だけ 小">
            ${設定中.支度中 ? "読んでいます…" : (設定中.顔 ? "画像を選び直す" : "画像を選ぶ")}
            <input type="file" accept="image/*" hidden onchange="設定の画像(this)">
          </label>
          ${設定中.顔 ? `<button class="釦 枠だけ 小" onclick="設定の画像をやめる()">画像をやめる</button>` : ""}
        </div>

        <div class="しるしの作り ${設定中.顔 ? "うすい" : ""}">
          <input class="欄 一字" id="設定の印" maxlength="2" value="${逃(設定中.印 || "")}"
            oninput="設定の字(this.value)">
          <div class="色たち">
            ${土台.印の色ら.map(c=>`
              <button class="色" title="${c.名}" style="background:${c.値}"
                aria-pressed="${設定中.色===c.値}"
                onclick="設定の色('${c.値}')"></button>`).join("")}
          </div>
        </div>
        ${設定中.顔 ? `<p class="節の注">画像を選んでいるあいだは、字と色は出ません。</p>` : ""}

        <button class="釦 全幅" style="margin-top:22px" ${設定中.送信中||設定中.支度中?"disabled":""}
          onclick="名乗りを保存()">${設定中.送信中?"保存しています…":"これにする"}</button>

        <div style="border-top:1px solid var(--罫);margin-top:26px;padding-top:20px">
          <p class="節の注" style="margin:0 0 12px">
            ${逃(土台.私?.email || "")} で入っています。</p>
          <button class="釦 枠だけ 全幅" onclick="覆い閉じ();ログアウト()">出る（ログアウト）</button>
        </div>
      </div>
    </div></div>`;
}

/* ⚠️ 名前を打つたびに全部描き直すと、打っている欄から焦点が外れる。
      見本の1文字だけを直に書き換える。**印を自分で決めた人の分は触らない。** */
window.設定の見本 = 値 =>{
  設定中.名 = 値;
  if(設定中.顔) return;
  if(document.getElementById("設定の印")?.value) return;   // 自分で決めた字は触らない
  const 字 = [...(値 || "読")][0] || "読";
  設定中.印 = 字;
  const e = 窓.querySelector(".印.大"); if(e && e.tagName === "SPAN") e.textContent = 字;
};
window.設定の字 = 値 =>{
  設定中.印 = [...(値 || "")][0] || "";
  const e = 窓.querySelector(".印.大");
  if(e && e.tagName === "SPAN") e.textContent = 設定中.印 || [...(設定中.名 || "読")][0] || "読";
};
window.設定の色 = 値 =>{ 設定中.色 = 値; 設定描く(); };

/* ⚠️ ここでは**上げるだけで、users にはまだ書かない。**
      「これにする」を押さずに閉じた人の画像は、どこからも見えないまま残る。
      それは許す（次に上げれば同じ場所に上書きされる）。 */
window.設定の画像 = async 欄 =>{
  const f = 欄.files?.[0]; if(!f) return;
  設定中.支度中 = true; 設定描く();
  try{
    設定中.顔 = await 土台.顔をあげる(f);
    設定中.支度中 = false; 設定描く();
  }catch(e){
    設定中.支度中 = false; 設定描く();
    console.error(e); 知らせる("画像を置けませんでした：" + (e.code||e.message), true);
  }
};
window.設定の画像をやめる = ()=>{ 設定中.顔 = null; 設定描く(); };

window.名乗りを保存 = async ()=>{
  if(設定中.送信中) return;
  const 名 = document.getElementById("設定の名")?.value.trim() || "";
  if(!名){ 知らせる("名前を入れてください", true); return; }
  /* ⚠️ 欄の値は、打ったあと描き直していないことがある。**DOMから読み直す。** */
  const 印 = document.getElementById("設定の印")?.value.trim() || 設定中.印 || "";
  設定中.名 = 名; 設定中.印 = 印; 設定中.送信中 = true; 設定描く();
  try{
    await 土台.名乗りを決める({ 名, 印, 色:設定中.色, 顔:設定中.顔 });
    覆い閉じ(); 知らせる("変えました");
    描く();
  }catch(e){
    設定中.送信中 = false; 設定描く();
    console.error(e); 知らせる("変えられませんでした：" + (e.code||e.message), true);
  }
};

/* ============================================================
   頁：わたしの本返し
   ============================================================ */
async function 頁_私(){
  if(!土台.私) return 入るには();
  const 行 = await 私の記録();
  const 返し = 行.filter(x=>x.種==="返し");
  const 合計 = 返し.reduce((s,x)=>s+x.額,0);
  const 純 = Math.round(合計*(1-決済率-運営率));

  return `
  <section class="幕">
    <p class="英字の札">My returns</p>
    <h1 class="大見出し" style="font-size:clamp(25px,3.2vw,34px)">わたしの本返し</h1>
    <p class="導き">あなたが本の世界へ返したもの。</p>
    <div class="数字たち">
      ${数字("Count", 返し.length, "返した回数")}
      ${数字("Paid", 合計.toLocaleString(), "使ったポイント", true)}
      ${数字("Delivered", 純.toLocaleString(), "本の世界へ届いた分（pt）")}
      ${数字("Wallet", (土台.財布?.残高??0).toLocaleString(), "残高（pt）")}
    </div>
  </section>

  <section class="節">
    ${節の頭("記録", 行.length+"件")}
    <div class="表の板"><table>
      <tr><th>本</th><th>種類</th><th class="右">額</th><th>ことば</th><th>いつ</th></tr>
      ${行.length ? 行.map(r=>{const b=本を引く(r.本);return `<tr>
        <td class="本"><a onclick="go('book',{id:'${r.本}'})">${逃(b?.題||r.本)}</a></td>
        <td>${r.種==="返し"?'<span class="札 済">本返し</span>':'<span class="札 注">残したい</span>'}</td>
        <td class="右">${r.種==="返し"?r.額.toLocaleString():(r.約?r.約.toLocaleString()+"の意思":"―")}</td>
        <td style="color:var(--字の薄い);max-width:34ch">${逃(r.文)||"―"}</td>
        <td style="color:var(--字のごく薄い);white-space:nowrap">${いつ(r.時)}</td></tr>`}).join("")
      : '<tr><td colspan="5" style="color:var(--字のごく薄い)">まだ記録がありません。本をさがして、返してみてください。</td></tr>'}
    </table></div>
  </section>`;
}

/* ============================================================
   頁：受取人の控え

   ⚠️ トライアル中は、誰でも好きな受取人の控えを開ける。
      本番では「本人確認を通した人だけが、自分の控えを見る」形にする。
   ⚠️ 受取人のidは**本ごとに別**（岩波書店は momo_p と ho_p を持つ）。
      名前でまとめると片方の受取が消えるので、idのまま並べて本の題を添える。
   ============================================================ */
async function 頁_受取人(){
  if(!土台.私) return 入るには();
  /* ⚠️ ③利用者には見せない。①管理者は全部、②受取人は自分の主体だけ。 */
  const 管 = 土台.権限.管理者, 自分の = 土台.権限.受取人;
  if(!管 && !自分の.length) return `<div class="節"><div class="断り" style="margin-top:40px">
    <b>この画面は受取人のためのものです。</b><br>
    著者・出版社・書店としてページを引き継ぐと、ここで受け取ったぶんと読者の声が見られます。
    </div></div>`;

  const 受取人ら = [];
  /* ⚠️ 主体は本をまたいで1つになったので、id で重複を落とす。
        （前は受取人IDが本ごとに別で、岩波書店が2人に割れていた） */
  土台.蔵書.forEach(b=>届け先(b).forEach(r=>{
    if(!受取人ら.some(x=>x.id === r.id)) 受取人ら.push({ ...r });
  }));
  受取人ら.forEach(r=>r.冊数 = 土台.蔵書.filter(b=>届け先(b).some(x=>x.id===r.id)).length);
  const 見える = 管 ? 受取人ら : 受取人ら.filter(r=>自分の.includes(r.id));
  const 選 = (見える.some(r=>r.id===現在.rid) ? 現在.rid : null) || 見える[0]?.id;
  if(!選) return `<div class="節"><div class="断り">受取人がまだいません。</div></div>`;

  const 本人 = 見える.find(x=>x.id===選) || 見える[0];
  const { 明細, 合計 } = await 受取人の受取(選);
  const 声あり = 明細.filter(x=>x.文);

  return `
  <section class="幕">
    <p class="英字の札">Receiver</p>
    <h1 class="大見出し" style="font-size:clamp(25px,3.2vw,34px)">受取人の控え</h1>
    <p class="導き">${逃(本人.名)}（${逃(本人.種)}・${本人.冊数}冊）として見ています。
      ${管 ? "管理者なので、すべての受取人に切り替えられます。" : ""}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:22px">
      ${見える.map(r=>`<button class="釦 ${r.id===選?'':'枠だけ'} 小"
        onclick="受取人を選ぶ('${r.id}')">${逃(r.名)}<span style="opacity:.55"> ${r.冊数}冊</span></button>`).join("")}
    </div>
    <div class="数字たち">
      ${数字("Received", 合計.toLocaleString(), "受取額（支払額の90%・pt）", true)}
      ${数字("Thanks", 明細.length, "届いた本返し")}
      ${数字("Voices", 声あり.length, "読者の声")}
    </div>
  </section>

  <section class="節">
    ${節の頭("明細", "支払額の90%が配分に応じて渡ります")}
    <div class="表の板"><table>
      <tr><th>本</th><th>読者</th><th class="右">受取額</th><th>いつ</th></tr>
      ${明細.length ? 明細.map(i=>`<tr>
        <td class="本"><a onclick="go('book',{id:'${i.本}'})">${逃(本を引く(i.本)?.題||i.本)}</a></td>
        <td>${名と印(i.送り主, i.名, i.名==="匿名")}</td><td class="右">${i.額.toLocaleString()}</td>
        <td style="color:var(--字のごく薄い);white-space:nowrap">${いつ(i.時)}</td></tr>`).join("")
      : '<tr><td colspan="4" style="color:var(--字のごく薄い)">まだ受取はありません。</td></tr>'}
    </table></div>
  </section>

  <section class="節">
    ${節の頭("読者の声", "購買データでは決して取れない、読後の感情")}
    <div class="声の列">
      ${声あり.length ? 声あり.map(i=>`<div class="声">
        <div class="素性"><b>『${逃(本を引く(i.本)?.題||i.本)}』</b>
          <span class="金">${pt(i.額)}</span><span>${いつ(i.時)}</span></div>
        <p>${逃(i.文)}</p></div>`).join("")
      : '<p class="節の注" style="padding:20px 0">まだありません。</p>'}
    </div>
    <div class="断り 藤" style="margin-top:28px">
      <b>この画面が、本返しのいちばんの資産です。</b>
      「1,000人が復刊希望を押した」より、「1,000人が合計72万円出してでも残したいと言っている」のほうが、
      出版社にとって意思決定できるしるしになります。</div>
  </section>`;
}
window.受取人を選ぶ = rid=>{ 現在.rid = rid; 描く(); };

/* ============================================================
   頁：しくみ
   ============================================================ */
async function 頁_しくみ(){
  return `
  <section class="幕">
    <p class="英字の札">How it works</p>
    <h1 class="大見出し">お金の流れと、<br>守っていること。</h1>
    <p class="導き">本返しは、本を買う場所ではありません。
      読み終わったあとに、その本を支えた人へ気持ちを返すための場所です。</p>
  </section>

  <section class="節">
    ${節の頭("いまは、架空のポイントで試しています", "実際のお金は1円も動きません")}
    <div style="display:grid;gap:44px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-top:26px">
      <div class="内訳" style="border-top:none;margin-top:0;padding-top:0">
        <div class="行"><span>はじめに配られる</span><b style="color:var(--朱)">10,000</b></div>
        <div class="行"><span>毎月ふたたび配られる</span><span>3,000</span></div>
        <div class="行 薄"><span>換金・購入</span><span>できません</span></div>
        <div class="行 締め"><span>実際のお金</span><span>0円</span></div>
      </div>
      <p class="導き" style="margin:0">
        本物のお金を扱う前に、<b style="color:var(--字)">読んだあとに、誰かへ気持ちを託すという行いが実際に起きるか</b>を
        確かめています。ポイントには限りがあるので、どの本に使うかを選ぶことになります。
        その選び方こそが、いま知りたいことです。</p>
    </div>
  </section>

  <section class="節">
    ${節の頭("100pt を返すと、どうなるか", "送る前に、必ずこの内訳を見せます")}
    <div style="display:grid;gap:44px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin-top:26px">
      <div>
        <div class="帯グラフ" style="height:6px">
          <div style="width:90%;background:var(--朱)"></div>
          <div style="width:5%;background:var(--罫の濃い)"></div>
          <div style="width:5%;background:var(--灯)"></div>
        </div>
        <div class="内訳" style="border-top:none;margin-top:0;padding-top:0">
          <div class="行"><span>本の世界へ</span><b style="color:var(--朱)">90</b></div>
          <div class="行 薄"><span>決済手数料ぶん</span><span>5</span></div>
          <div class="行 薄"><span>本返しの運営</span><span>5</span></div>
          <div class="行 締め"><span>お支払い</span><span>100 pt</span></div>
        </div>
      </div>
      <p class="導き" style="margin:0">
        ほかのサービスの手数料は、CAMPFIRE が 12%＋決済5%、OFUSE が単発支援 16%（2026年10月〜）。
        本返しは合計10%を上限とし、<b style="color:var(--字)">受取人に90%</b>を渡します。</p>
    </div>
  </section>

  <section class="節">
    ${節の頭("3つの行い", "本返しでできることは、これだけです")}
    <div class="流れ">
      <div><div class="番">01</div><h4>ありがとう</h4>
        <p>いま読める本への感謝。著者・出版社・書店へ、100ptから返せます。</p></div>
      <div><div class="番">02</div><h4>応援する</h4>
        <p>本ではなく、人・出版社・書店そのものへ。次の一冊が出るように。</p></div>
      <div><div class="番">03</div><h4>残したい</h4>
        <p>絶版・希少本へ。ポイントは動かさず、「復刊したら払う額」を意思として貯めます。</p></div>
    </div>
  </section>

  <section class="節">
    ${節の頭("受取人がいない本のこと", "ここが、本返しでいちばん大事な設計です")}
    <div style="max-width:60ch;margin-top:26px">
      <p style="margin:0 0 18px">絶版本ほど、読者の思いは濃い。けれど出版社が解散していたり、権利者が分からないことがあります。</p>
      <p style="margin:0 0 18px">本返しは、そういう本で<b>1ポイントも預かりません。</b>受け取る人がいないお金を持つことは、
        法律上も、気持ちの上でも、健全ではないからです。</p>
      <p style="margin:0">代わりに、ことばと「復刊したら払える額」を貯めます。権利者があとからページを引き継いだとき、
        そこには<b>すでに読者が待っている</b>という事実が残っています。</p>
    </div>
  </section>

  <section class="節">
    ${節の頭("本物のお金にするときは", "トライアルのあとに控えている宿題")}
    <div class="流れ">
      <div><div class="番">01</div><h4>本人確認</h4><p>身分証、または法人登記。受取人が本当にその人かを確かめる。</p></div>
      <div><div class="番">02</div><h4>関係の確認</h4><p>奥付・契約書・屋号など、その本との関係を示すもの。</p></div>
      <div><div class="番">03</div><h4>直接の入金</h4><p>資金は預からず、Stripe Connect で受取人へ直接渡す。</p></div>
    </div>
    <div class="断り" style="margin-top:28px;max-width:62ch">
      プラットフォームが利用者から資金を受け取り第三者へ渡す設計は、資金決済法上の論点を含み得ます。
      自前でお金を預からない前提で、ローンチ前に専門家とスキームを確認します。図書館への支援は第二段階です。</div>
  </section>`;
}

/* ============================================================
   はじまり
   ============================================================ */
現在 = 道を読む();
起動(async ()=>{ await 土台.権限をしらべる(); 描く(); }).catch(e=>{
  console.error(e);
  画面.innerHTML = `<div class="節"><div class="断り">
    <b>Firebase の設定が読めませんでした。</b><br>
    このページは Firebase Hosting 上、またはローカルでは <code>firebase serve</code> で開いてください。
    ファイルを直接ダブルクリックして開くと、ここで止まります。<br>
    <a href="/demo">ダミーデータのデモはこちら</a></div></div>`;
});
