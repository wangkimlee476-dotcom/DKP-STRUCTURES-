/* DKP STRUCTURES shared language preference and page translation.
   Google Website Translator handles visible page text; the preference persists across pages. */
(()=>{
 const languages=[["en","English"],["id","Bahasa Indonesia"],["es","Español"],["fr","Français"],["de","Deutsch"],["pt","Português"],["ar","العربية"],["hi","हिन्दी"],["ko","한국어"],["zh-CN","中文"],["ja","日本語"],["tr","Türkçe"],["th","ไทย"],["vi","Tiếng Việt"],["nl","Nederlands"],["it","Italiano"],["ru","Русский"]];
 const languageCodes=languages.filter(x=>x[0]!=="en").map(x=>x[0]).join(",");
 const read=()=>{try{return localStorage.getItem("dkp-language")||"en"}catch{return "en"}};
 const write=lang=>{
  if(!languages.some(x=>x[0]===lang))lang="en";
  try{localStorage.setItem("dkp-language",lang)}catch{}
  const value=lang==="en"?"":"/en/"+lang;
  document.cookie="googtrans="+value+";path=/;max-age=31536000;SameSite=Lax";
  document.cookie="googtrans="+value+";path=/;domain="+location.hostname+";max-age=31536000;SameSite=Lax";
 };
 const apply=lang=>{
  write(lang);
  const googleSelect=document.querySelector(".goog-te-combo");
  if(googleSelect){googleSelect.value=lang==="zh-CN"?"zh-CN":lang;googleSelect.dispatchEvent(new Event("change"))}
 };
 const buildOptions=select=>{
  select.innerHTML=languages.map(([v,n])=>'<option value="'+v+'">'+n+'</option>').join("");
  select.value=read();
  select.setAttribute("aria-label","Choose company language");
  select.title="Translate DKP STRUCTURES into your preferred language";
  select.addEventListener("change",()=>{apply(select.value);location.reload()});
 };
 const mount=()=>{
  if(!document.getElementById("companyLanguageSelect")){
   const select=document.createElement("select");select.id="companyLanguageSelect";select.className="dkp-language-select";buildOptions(select);
   const host=document.querySelector(".nav, .brandrow, header")||document.body;
   host.appendChild(select);
  }
  const current=document.getElementById("companyLanguageSelect");
  if(current&&!current.dataset.dkpReady){buildOptions(current);current.dataset.dkpReady="1"}
  const settings=document.getElementById("language");
  if(settings){
   const lang=read();if(languages.some(x=>x[0]===lang))settings.value=lang;
   if(!settings.dataset.dkpReady){settings.addEventListener("change",()=>{apply(settings.value);const top=document.getElementById("companyLanguageSelect");if(top)top.value=settings.value;location.reload()});settings.dataset.dkpReady="1"}
  }
  if(read()!=="en")write(read());
 };
 window.googleTranslateElementInit=()=>{
  if(!window.google?.translate?.TranslateElement)return;
  new google.translate.TranslateElement({pageLanguage:"en",includedLanguages:languageCodes,autoDisplay:false,multilanguagePage:true}, "google_translate_element");
  const lang=read();
  const tick=()=>{const sel=document.querySelector(".goog-te-combo");if(sel&&lang!=="en"){sel.value=lang;sel.dispatchEvent(new Event("change"))}};
  setTimeout(tick,500);setTimeout(tick,1400);
 };
 const start=()=>{
  mount();
  if(!document.getElementById("google_translate_element")){
   const box=document.createElement("div");box.id="google_translate_element";box.style.cssText="position:absolute!important;left:-10000px!important;top:-10000px!important;width:1px;height:1px;overflow:hidden";
   document.body.appendChild(box);
  }
  if(!document.querySelector('script[data-dkp-google-translate]')){
   const s=document.createElement("script");s.src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";s.async=true;s.dataset.dkpGoogleTranslate="1";document.head.appendChild(s);
  }
 };
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
})();
