(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,36159,(t,e,a)=>{"use strict";function o(){return null}Object.defineProperty(a,"__esModule",{value:!0}),Object.defineProperty(a,"default",{enumerable:!0,get:function(){return o}}),("function"==typeof a.default||"object"==typeof a.default&&null!==a.default)&&void 0===a.default.__esModule&&(Object.defineProperty(a.default,"__esModule",{value:!0}),Object.assign(a.default,a),e.exports=a.default)},23003,t=>{"use strict";var e=t.i(43476),a=t.i(71645),o=t.i(36159),r=t.i(17996),s=t.i(9165);let i=function(){for(var t,e,a=0,o="",r=arguments.length;a<r;a++)(t=arguments[a])&&(e=function t(e){var a,o,r="";if("string"==typeof e||"number"==typeof e)r+=e;else if("object"==typeof e)if(Array.isArray(e)){var s=e.length;for(a=0;a<s;a++)e[a]&&(o=t(e[a]))&&(r&&(r+=" "),r+=o)}else for(o in e)e[o]&&(r&&(r+=" "),r+=o);return r}(t))&&(o&&(o+=" "),o+=e);return o};var n=t=>"number"==typeof t&&!isNaN(t),l=t=>"string"==typeof t||"function"==typeof t?t:null,c=t=>(0,a.isValidElement)(t)||"string"==typeof t||"function"==typeof t||n(t);function d({enter:t,exit:e,appendPosition:o=!1,collapse:r=!0,collapseDuration:s=300}){return function({children:i,position:n,preventExitTransition:l,done:c,nodeRef:d,isIn:f,playToast:u}){let m=o?`${t}--${n}`:t,p=o?`${e}--${n}`:e,y=(0,a.useRef)(0);return(0,a.useLayoutEffect)(()=>{let t=d.current,e=m.split(" "),a=o=>{o.target===d.current&&(u(),t.removeEventListener("animationend",a),t.removeEventListener("animationcancel",a),0===y.current&&"animationcancel"!==o.type&&t.classList.remove(...e))};t.classList.add(...e),t.addEventListener("animationend",a),t.addEventListener("animationcancel",a)},[]),(0,a.useEffect)(()=>{let t=d.current,e=()=>{t.removeEventListener("animationend",e),r?function(t,e,a=300){let{scrollHeight:o,style:r}=t;requestAnimationFrame(()=>{r.minHeight="initial",r.height=o+"px",r.transition=`all ${a}ms`,requestAnimationFrame(()=>{r.height="0",r.padding="0",r.margin="0",setTimeout(e,a)})})}(t,c,s):c()};f||(l?e():(y.current=1,t.className+=` ${p}`,t.addEventListener("animationend",e)))},[f]),a.default.createElement(a.default.Fragment,null,i)}}function f(t,e){return{content:u(t.content,t.props),containerId:t.props.containerId,id:t.props.toastId,theme:t.props.theme,type:t.props.type,data:t.props.data||{},isLoading:t.props.isLoading,icon:t.props.icon,reason:t.removalReason,status:e}}function u(t,e,o=!1){return(0,a.isValidElement)(t)&&"string"!=typeof t.type?(0,a.cloneElement)(t,{closeToast:e.closeToast,toastProps:e,data:e.data,isPaused:o}):"function"==typeof t?t({closeToast:e.closeToast,toastProps:e,data:e.data,isPaused:o}):t}function m({delay:t,isRunning:e,closeToast:o,type:r="default",hide:s,className:n,controlledProgress:l,progress:c,rtl:d,isIn:f,theme:u}){let p=s||l&&0===c,y={animationDuration:`${t}ms`,animationPlayState:e?"running":"paused"};l&&(y.transform=`scaleX(${c})`);let h=i("Toastify__progress-bar",l?"Toastify__progress-bar--controlled":"Toastify__progress-bar--animated",`Toastify__progress-bar-theme--${u}`,`Toastify__progress-bar--${r}`,{"Toastify__progress-bar--rtl":d}),b="function"==typeof n?n({rtl:d,type:r,defaultClassName:h}):i(h,n);return a.default.createElement("div",{className:"Toastify__progress-bar--wrp","data-hidden":p},a.default.createElement("div",{className:`Toastify__progress-bar--bg Toastify__progress-bar-theme--${u} Toastify__progress-bar--${r}`}),a.default.createElement("div",{role:"progressbar","aria-hidden":p?"true":"false","aria-label":"notification timer","aria-valuenow":l?Math.round(100*c):void 0,"aria-valuemin":0,"aria-valuemax":100,className:b,style:y,...{[l&&c>=1?"onTransitionEnd":"onAnimationEnd"]:l&&c<1?null:()=>{f&&o()}}}))}var p=1,y=()=>`${p++}`,h=new Map,b=[],x=new Set,g=t=>x.forEach(e=>e(t));function v(t,e){var a;if(e)return!!(null!=(a=h.get(e))&&a.isToastActive(t));let o=!1;return h.forEach(e=>{e.isToastActive(t)&&(o=!0)}),o}function _(t,e){c(t)&&(h.size>0||b.push({content:t,options:e}),h.forEach(a=>{a.buildToast(t,e)}))}function T(t,e){h.forEach(a=>{null!=e&&null!=e&&e.containerId&&(null==e?void 0:e.containerId)!==a.id||a.toggle(t,null==e?void 0:e.id)})}function w(t,e){return _(t,e),e.toastId}function j(t,e){var a;return{...e,type:e&&e.type||t,toastId:(a=e)&&("string"==typeof a.toastId||n(a.toastId))?a.toastId:y()}}function N(t){return(e,a)=>w(e,j(t,a))}function k(t,e){return w(t,j("default",e))}k.loading=(t,e)=>w(t,j("default",{isLoading:!0,autoClose:!1,closeOnClick:!1,closeButton:!1,draggable:!1,...e})),k.promise=function(t,{pending:e,error:a,success:o},r){let s;e&&(s="string"==typeof e?k.loading(e,r):k.loading(e.render,{...r,...e}));let i={isLoading:null,autoClose:null,closeOnClick:null,closeButton:null,draggable:null},n=(t,e,a)=>{if(null==e)return void k.dismiss(s);let o={type:t,...i,...r,data:a},n="string"==typeof e?{render:e}:e;return s?k.update(s,{...o,...n}):k(n.render,{...o,...n}),a},l="function"==typeof t?t():t;return l.then(t=>n("success",o,t)).catch(t=>n("error",a,t)),l},k.success=N("success"),k.info=N("info"),k.error=N("error"),k.warning=N("warning"),k.warn=k.warning,k.dark=(t,e)=>w(t,j("default",{theme:"dark",...e})),k.dismiss=function(t){!function(t){let e;if(!(h.size>0)){b=b.filter(e=>null!=t&&e.options.toastId!==t);return}if(null==t||"string"==typeof(e=t)||n(e))h.forEach(e=>{e.removeToast(t)});else if(t&&("containerId"in t||"id"in t)){let e=h.get(t.containerId);e?e.removeToast(t.id):h.forEach(e=>{e.removeToast(t.id)})}}(t)},k.clearWaitingQueue=(t={})=>{h.forEach(e=>{e.props.limit&&(!t.containerId||e.id===t.containerId)&&e.clearQueue()})},k.isActive=v,k.update=(t,e={})=>{let a=((t,{containerId:e})=>{var a;return null==(a=h.get(e||1))?void 0:a.toasts.get(t)})(t,e);if(a){let{props:o,content:r}=a,s={delay:100,...o,...e,toastId:e.toastId||t,updateId:y()};s.toastId!==t&&(s.staleId=t);let i=s.render||r;delete s.render,w(i,s)}},k.done=t=>{k.update(t,{progress:1})},k.onChange=function(t){return x.add(t),()=>{x.delete(t)}},k.play=t=>T(!0,t),k.pause=t=>T(!1,t);var E="u">typeof window?a.useLayoutEffect:a.useEffect,I=({theme:t,type:e,isLoading:o,...r})=>a.default.createElement("svg",{viewBox:"0 0 24 24",width:"100%",height:"100%",fill:"colored"===t?"currentColor":`var(--toastify-icon-color-${e})`,...r}),C={info:function(t){return a.default.createElement(I,{...t},a.default.createElement("path",{d:"M12 0a12 12 0 1012 12A12.013 12.013 0 0012 0zm.25 5a1.5 1.5 0 11-1.5 1.5 1.5 1.5 0 011.5-1.5zm2.25 13.5h-4a1 1 0 010-2h.75a.25.25 0 00.25-.25v-4.5a.25.25 0 00-.25-.25h-.75a1 1 0 010-2h1a2 2 0 012 2v4.75a.25.25 0 00.25.25h.75a1 1 0 110 2z"}))},warning:function(t){return a.default.createElement(I,{...t},a.default.createElement("path",{d:"M23.32 17.191L15.438 2.184C14.728.833 13.416 0 11.996 0c-1.42 0-2.733.833-3.443 2.184L.533 17.448a4.744 4.744 0 000 4.368C1.243 23.167 2.555 24 3.975 24h16.05C22.22 24 24 22.044 24 19.632c0-.904-.251-1.746-.68-2.44zm-9.622 1.46c0 1.033-.724 1.823-1.698 1.823s-1.698-.79-1.698-1.822v-.043c0-1.028.724-1.822 1.698-1.822s1.698.79 1.698 1.822v.043zm.039-12.285l-.84 8.06c-.057.581-.408.943-.897.943-.49 0-.84-.367-.896-.942l-.84-8.065c-.057-.624.25-1.095.779-1.095h1.91c.528.005.84.476.784 1.1z"}))},success:function(t){return a.default.createElement(I,{...t},a.default.createElement("path",{d:"M12 0a12 12 0 1012 12A12.014 12.014 0 0012 0zm6.927 8.2l-6.845 9.289a1.011 1.011 0 01-1.43.188l-4.888-3.908a1 1 0 111.25-1.562l4.076 3.261 6.227-8.451a1 1 0 111.61 1.183z"}))},error:function(t){return a.default.createElement(I,{...t},a.default.createElement("path",{d:"M11.983 0a12.206 12.206 0 00-8.51 3.653A11.8 11.8 0 000 12.207 11.779 11.779 0 0011.8 24h.214A12.111 12.111 0 0024 11.791 11.766 11.766 0 0011.983 0zM10.5 16.542a1.476 1.476 0 011.449-1.53h.027a1.527 1.527 0 011.523 1.47 1.475 1.475 0 01-1.449 1.53h-.027a1.529 1.529 0 01-1.523-1.47zM11 12.5v-6a1 1 0 012 0v6a1 1 0 11-2 0z"}))},spinner:function(){return a.default.createElement("div",{className:"Toastify__spinner"})}},L=t=>{let{isRunning:e,preventExitTransition:o,toastRef:r,eventHandlers:s,playToast:n}=function(t){var e,o;let[r,s]=(0,a.useState)(!1),[i,n]=(0,a.useState)(!1),l=(0,a.useRef)(null),c=(0,a.useRef)({start:0,delta:0,removalDistance:0,canCloseOnClick:!0,canDrag:!1,didMove:!1}).current,{autoClose:d,pauseOnHover:f,closeToast:u,onClick:m,closeOnClick:p}=t;function y(){s(!0)}function b(){s(!1)}function x(e){let a=l.current;if(c.canDrag&&a){c.didMove=!0,r&&b(),"x"===t.draggableDirection?c.delta=e.clientX-c.start:c.delta=e.clientY-c.start,c.start!==e.clientX&&(c.canCloseOnClick=!1);let o="x"===t.draggableDirection?`${c.delta}px, var(--y)`:`0, calc(${c.delta}px + var(--y))`;a.style.transform=`translate3d(${o},0)`,a.style.opacity=`${1-Math.abs(c.delta/c.removalDistance)}`}}function g(){document.removeEventListener("pointermove",x),document.removeEventListener("pointerup",g);let e=l.current;if(c.canDrag&&c.didMove&&e){if(c.canDrag=!1,Math.abs(c.delta)>c.removalDistance){n(!0),t.closeToast(!0),t.collapseAll();return}e.style.transition="transform 0.2s, opacity 0.2s",e.style.removeProperty("transform"),e.style.removeProperty("opacity")}}e={id:t.toastId,containerId:t.containerId,fn:s},null==(o=h.get(e.containerId||1))||o.setToggle(e.id,e.fn),(0,a.useEffect)(()=>{if(t.pauseOnFocusLoss)return document.hasFocus()||b(),window.addEventListener("focus",y),window.addEventListener("blur",b),()=>{window.removeEventListener("focus",y),window.removeEventListener("blur",b)}},[t.pauseOnFocusLoss]);let v={onPointerDown:function(e){if(!0===t.draggable||t.draggable===e.pointerType){c.didMove=!1,document.addEventListener("pointermove",x),document.addEventListener("pointerup",g);let a=l.current;c.canCloseOnClick=!0,c.canDrag=!0,a.style.transition="none","x"===t.draggableDirection?(c.start=e.clientX,c.removalDistance=a.offsetWidth*(t.draggablePercent/100)):(c.start=e.clientY,c.removalDistance=a.offsetHeight*(80===t.draggablePercent?1.5*t.draggablePercent:t.draggablePercent)/100)}},onPointerUp:function(e){let{top:a,bottom:o,left:r,right:s}=l.current.getBoundingClientRect();"mouse"===e.pointerType&&t.pauseOnHover&&e.clientX>=r&&e.clientX<=s&&e.clientY>=a&&e.clientY<=o?b():y()}};return d&&f&&(v.onMouseEnter=b,t.stacked||(v.onMouseLeave=y)),p&&(v.onClick=t=>{m&&m(t),c.canCloseOnClick&&u(!0)}),{playToast:y,pauseToast:b,isRunning:r,preventExitTransition:i,toastRef:l,eventHandlers:v}}(t),{closeButton:l,children:c,autoClose:d,onClick:f,type:p,hideProgressBar:y,closeToast:b,transition:x,position:g,className:v,style:_,progressClassName:T,updateId:w,role:j,progress:N,rtl:k,toastId:E,deleteToast:I,isIn:L,isLoading:P,closeOnClick:O,theme:A,ariaLabel:z}=t,S=i("Toastify__toast",`Toastify__toast-theme--${A}`,`Toastify__toast--${p}`,{"Toastify__toast--rtl":k},{"Toastify__toast--close-on-click":O}),R="function"==typeof v?v({rtl:k,position:g,type:p,defaultClassName:S}):i(S,v),M=function({theme:t,type:e,isLoading:o,icon:r}){let s=null,i={theme:t,type:e};return!1===r||("function"==typeof r?s=r({...i,isLoading:o}):(0,a.isValidElement)(r)?s=(0,a.cloneElement)(r,i):o?s=C.spinner():e in C&&(s=C[e](i))),s}(t),D=!!N||!d,$={closeToast:b,type:p,theme:A},B=null;return!1===l||(B="function"==typeof l?l($):(0,a.isValidElement)(l)?(0,a.cloneElement)(l,$):function({closeToast:t,theme:e,ariaLabel:o="close"}){return a.default.createElement("button",{className:`Toastify__close-button Toastify__close-button--${e}`,type:"button",onClick:e=>{e.stopPropagation(),t(!0)},"aria-label":o},a.default.createElement("svg",{"aria-hidden":"true",viewBox:"0 0 14 16"},a.default.createElement("path",{fillRule:"evenodd",d:"M7.71 8.23l3.75 3.75-1.48 1.48-3.75-3.75-3.75 3.75L1 11.98l3.75-3.75L1 4.48 2.48 3l3.75 3.75L9.98 3l1.48 1.48-3.75 3.75z"})))}($)),a.default.createElement(x,{isIn:L,done:I,position:g,preventExitTransition:o,nodeRef:r,playToast:n},a.default.createElement("div",{id:E,tabIndex:0,onClick:f,"data-in":L,className:R,...s,style:_,ref:r,...L&&{role:j,"aria-label":z}},null!=M&&a.default.createElement("div",{className:i("Toastify__toast-icon",{"Toastify--animate-icon Toastify__zoom-enter":!P})},M),u(c,t,!e),B,!t.customProgressBar&&a.default.createElement(m,{...w&&!D?{key:`p-${w}`}:{},rtl:k,theme:A,delay:d,isRunning:e,isIn:L,closeToast:b,hide:y,type:p,className:T,controlledProgress:D,progress:N||0})))},P=(t,e=!1)=>({enter:`Toastify--animate Toastify__${t}-enter`,exit:`Toastify--animate Toastify__${t}-exit`,appendPosition:e}),O=d(P("bounce",!0));d(P("slide",!0)),d(P("zoom")),d(P("flip"));var A={position:"top-right",transition:O,autoClose:5e3,closeButton:!0,pauseOnHover:!0,pauseOnFocusLoss:!0,draggable:"touch",draggablePercent:80,draggableDirection:"x",role:"alert",theme:"light","aria-label":"Notifications Alt+T",hotKeys:t=>t.altKey&&"KeyT"===t.code};function z(t){let e={...A,...t},o=t.stacked,[r,s]=(0,a.useState)(!0),d=(0,a.useRef)(null),{getToastToRender:u,isToastActive:m,count:p}=function(t){var e;let o,{subscribe:r,getSnapshot:s,setProps:i}=(0,a.useRef)((o=t.containerId||1,{subscribe(e){let a,r,s,i,d,u,m,p,y,x,v,T=(a=1,r=0,s=[],i=[],d=t,u=new Map,m=new Set,p=()=>{i=Array.from(u.values()),m.forEach(t=>t())},y=t=>{var e,a;t.isActive&&(null==(a=null==(e=t.props)?void 0:e.onClose)||a.call(e,t.removalReason),t.isActive=!1,g(f(t,"removed")))},x=t=>{if(null==t)u.forEach(y);else{let e=u.get(t);e&&y(e)}p()},v=t=>{var e,a;let{toastId:o,updateId:r}=t.props,s=null==r;t.staleId&&u.delete(t.staleId),t.isActive=!0,u.set(o,t),p(),g(f(t,s?"added":"updated")),s&&(null==(a=(e=t.props).onOpen)||a.call(e))},{id:o,props:d,observe:t=>(m.add(t),()=>m.delete(t)),toggle:(t,e)=>{u.forEach(a=>{var o;(null==e||e===a.props.toastId)&&(null==(o=a.toggle)||o.call(a,t))})},removeToast:x,toasts:u,clearQueue:()=>{r-=s.length,s=[]},buildToast:(t,e)=>{let i,f;if((({containerId:t,toastId:e,updateId:a})=>{let r=u.has(e)&&null==a;return(t?t!==o:1!==o)||r})(e))return;let{toastId:m,updateId:y,data:h,staleId:b,delay:g}=e,_=null==y;_&&r++;let T={...d,style:d.toastStyle,key:a++,...Object.fromEntries(Object.entries(e).filter(([t,e])=>null!=e)),toastId:m,updateId:y,data:h,isIn:!1,className:l(e.className||d.toastClassName),progressClassName:l(e.progressClassName||d.progressClassName),autoClose:!e.isLoading&&(i=e.autoClose,f=d.autoClose,!1===i||n(i)&&i>0?i:f),closeToast(t){let e=u.get(m);e&&(e.removalReason=t,x(m))},deleteToast(){if(null!=u.get(m)){if(u.delete(m),--r<0&&(r=0),s.length>0)return void v(s.shift());p()}}};T.closeButton=d.closeButton,!1===e.closeButton||c(e.closeButton)?T.closeButton=e.closeButton:!0===e.closeButton&&(T.closeButton=!c(d.closeButton)||d.closeButton);let w={content:t,props:T,staleId:b};d.limit&&d.limit>0&&r>d.limit&&_?s.push(w):n(g)?setTimeout(()=>{v(w)},g):v(w)},setProps(t){d=t},setToggle:(t,e)=>{let a=u.get(t);a&&(a.toggle=e)},isToastActive:t=>{var e;return null==(e=u.get(t))?void 0:e.isActive},getSnapshot:()=>i});h.set(o,T);let w=T.observe(e);return b.forEach(t=>_(t.content,t.options)),b=[],()=>{w(),h.delete(o)}},setProps(t){var e;null==(e=h.get(o))||e.setProps(t)},getSnapshot(){var t;return null==(t=h.get(o))?void 0:t.getSnapshot()}})).current;i(t);let d=null==(e=(0,a.useSyncExternalStore)(r,s,s))?void 0:e.slice();return{getToastToRender:function(e){if(!d)return[];let a=new Map;return t.newestOnTop&&d.reverse(),d.forEach(t=>{let{position:e}=t.props;a.has(e)||a.set(e,[]),a.get(e).push(t)}),Array.from(a,t=>e(t[0],t[1]))},isToastActive:v,count:null==d?void 0:d.length}}(e),{className:y,style:x,rtl:T,containerId:w,hotKeys:j}=e;function N(){o&&(s(!0),k.play())}return E(()=>{var t;if(o){let a=d.current.querySelectorAll('[data-in="true"]'),o=null==(t=e.position)?void 0:t.includes("top"),s=0,i=0;Array.from(a).reverse().forEach((t,e)=>{t.classList.add("Toastify__toast--stacked"),e>0&&(t.dataset.collapsed=`${r}`),t.dataset.pos||(t.dataset.pos=o?"top":"bot");let a=s*(r?.2:1)+(r?0:12*e),n=Math.max(.5,1-(r?i:0));t.style.setProperty("--y",`${o?a:-1*a}px`),t.style.setProperty("--g","12"),t.style.setProperty("--s",`${n}`),s+=t.offsetHeight,i+=.025})}},[r,p,o]),(0,a.useEffect)(()=>{function t(t){var e;let a=d.current;j(t)&&(null==(e=null==a?void 0:a.querySelector('[tabIndex="0"]'))||e.focus(),s(!1),k.pause()),"Escape"===t.key&&(document.activeElement===a||null!=a&&a.contains(document.activeElement))&&(s(!0),k.play())}return document.addEventListener("keydown",t),()=>{document.removeEventListener("keydown",t)}},[j]),a.default.createElement("section",{ref:d,className:"Toastify",id:w,onMouseEnter:()=>{o&&(s(!1),k.pause())},onMouseLeave:N,"aria-live":"polite","aria-atomic":"false","aria-relevant":"additions text","aria-label":e["aria-label"]},u((t,e)=>{var r;let s,n=e.length?{...x}:{...x,pointerEvents:"none"};return a.default.createElement("div",{tabIndex:-1,className:(r=t,s=i("Toastify__toast-container",`Toastify__toast-container--${r}`,{"Toastify__toast-container--rtl":T}),"function"==typeof y?y({position:r,rtl:T,defaultClassName:s}):i(s,l(y))),"data-stacked":o,style:n,key:`c-${t}`},e.map(({content:t,props:e})=>a.default.createElement(L,{...e,stacked:o,collapseAll:N,isIn:m(e.toastId,e.containerId),key:`t-${e.key}`},t)))}))}var S=`:root {
  --toastify-color-light: #fff;
  --toastify-color-dark: #121212;
  --toastify-color-info: #3498db;
  --toastify-color-success: #07bc0c;
  --toastify-color-warning: #f1c40f;
  --toastify-color-error: hsl(6, 78%, 57%);
  --toastify-color-transparent: rgba(255, 255, 255, 0.7);

  --toastify-icon-color-info: var(--toastify-color-info);
  --toastify-icon-color-success: var(--toastify-color-success);
  --toastify-icon-color-warning: var(--toastify-color-warning);
  --toastify-icon-color-error: var(--toastify-color-error);

  --toastify-container-width: fit-content;
  --toastify-toast-width: 320px;
  --toastify-toast-offset: 16px;
  --toastify-toast-top: max(var(--toastify-toast-offset), env(safe-area-inset-top));
  --toastify-toast-right: max(var(--toastify-toast-offset), env(safe-area-inset-right));
  --toastify-toast-left: max(var(--toastify-toast-offset), env(safe-area-inset-left));
  --toastify-toast-bottom: max(var(--toastify-toast-offset), env(safe-area-inset-bottom));
  --toastify-toast-background: #fff;
  --toastify-toast-padding: 14px;
  --toastify-toast-min-height: 64px;
  --toastify-toast-max-height: 800px;
  --toastify-toast-bd-radius: 6px;
  --toastify-toast-shadow: 0px 4px 12px rgba(0, 0, 0, 0.1);
  --toastify-font-family: sans-serif;
  --toastify-z-index: 9999;
  --toastify-text-color-light: #757575;
  --toastify-text-color-dark: #fff;

  /* Used only for colored theme */
  --toastify-text-color-info: #fff;
  --toastify-text-color-success: #fff;
  --toastify-text-color-warning: #fff;
  --toastify-text-color-error: #fff;

  --toastify-spinner-color: #616161;
  --toastify-spinner-color-empty-area: #e0e0e0;
  --toastify-color-progress-light: linear-gradient(to right, #4cd964, #5ac8fa, #007aff, #34aadc, #5856d6, #ff2d55);
  --toastify-color-progress-dark: #bb86fc;
  --toastify-color-progress-info: var(--toastify-color-info);
  --toastify-color-progress-success: var(--toastify-color-success);
  --toastify-color-progress-warning: var(--toastify-color-warning);
  --toastify-color-progress-error: var(--toastify-color-error);
  /* used to control the opacity of the progress trail */
  --toastify-color-progress-bgo: 0.2;
}

.Toastify__toast-container {
  z-index: var(--toastify-z-index);
  -webkit-transform: translate3d(0, 0, var(--toastify-z-index));
  position: fixed;
  width: var(--toastify-container-width);
  box-sizing: border-box;
  color: #fff;
  display: flex;
  flex-direction: column;
}

.Toastify__toast-container--top-left {
  top: var(--toastify-toast-top);
  left: var(--toastify-toast-left);
}
.Toastify__toast-container--top-center {
  top: var(--toastify-toast-top);
  left: 50%;
  transform: translateX(-50%);
  align-items: center;
}
.Toastify__toast-container--top-right {
  top: var(--toastify-toast-top);
  right: var(--toastify-toast-right);
  align-items: end;
}
.Toastify__toast-container--bottom-left {
  bottom: var(--toastify-toast-bottom);
  left: var(--toastify-toast-left);
}
.Toastify__toast-container--bottom-center {
  bottom: var(--toastify-toast-bottom);
  left: 50%;
  transform: translateX(-50%);
  align-items: center;
}
.Toastify__toast-container--bottom-right {
  bottom: var(--toastify-toast-bottom);
  right: var(--toastify-toast-right);
  align-items: end;
}

.Toastify__toast {
  --y: 0px;
  position: relative;
  touch-action: none;
  width: var(--toastify-toast-width);
  min-height: var(--toastify-toast-min-height);
  box-sizing: border-box;
  margin-bottom: 1rem;
  padding: var(--toastify-toast-padding);
  border-radius: var(--toastify-toast-bd-radius);
  box-shadow: var(--toastify-toast-shadow);
  max-height: var(--toastify-toast-max-height);
  font-family: var(--toastify-font-family);
  /* webkit only issue #791 */
  z-index: 0;
  /* inner swag */
  display: flex;
  flex: 1 auto;
  align-items: center;
  word-break: break-word;
}

@media only screen and (max-width: 480px) {
  .Toastify__toast-container {
    width: 100vw;
    left: env(safe-area-inset-left);
    margin: 0;
  }
  .Toastify__toast-container--top-left,
  .Toastify__toast-container--top-center,
  .Toastify__toast-container--top-right {
    top: env(safe-area-inset-top);
    transform: translateX(0);
  }
  .Toastify__toast-container--bottom-left,
  .Toastify__toast-container--bottom-center,
  .Toastify__toast-container--bottom-right {
    bottom: env(safe-area-inset-bottom);
    transform: translateX(0);
  }
  .Toastify__toast-container--rtl {
    right: env(safe-area-inset-right);
    left: initial;
  }
  .Toastify__toast {
    --toastify-toast-width: 100%;
    margin-bottom: 0;
    border-radius: 0;
  }
}

.Toastify__toast-container[data-stacked='true'] {
  width: var(--toastify-toast-width);
}

@media only screen and (max-width: 480px) {
  .Toastify__toast-container[data-stacked='true'] {
    width: 100vw;
  }
}

.Toastify__toast--stacked {
  position: absolute;
  width: 100%;
  transform: translate3d(0, var(--y), 0) scale(var(--s));
  transition: transform 0.3s;
}

.Toastify__toast--stacked[data-collapsed] .Toastify__toast-body,
.Toastify__toast--stacked[data-collapsed] .Toastify__close-button {
  transition: opacity 0.1s;
}

.Toastify__toast--stacked[data-collapsed='false'] {
  overflow: visible;
}

.Toastify__toast--stacked[data-collapsed='true']:not(:last-child) > * {
  opacity: 0;
}

.Toastify__toast--stacked:after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: calc(var(--g) * 1px);
  bottom: 100%;
}

.Toastify__toast--stacked[data-pos='top'] {
  top: 0;
}

.Toastify__toast--stacked[data-pos='bot'] {
  bottom: 0;
}

.Toastify__toast--stacked[data-pos='bot'].Toastify__toast--stacked:before {
  transform-origin: top;
}

.Toastify__toast--stacked[data-pos='top'].Toastify__toast--stacked:before {
  transform-origin: bottom;
}

.Toastify__toast--stacked:before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 100%;
  transform: scaleY(3);
  z-index: -1;
}

.Toastify__toast--rtl {
  direction: rtl;
}

.Toastify__toast--close-on-click {
  cursor: pointer;
}

.Toastify__toast-icon {
  margin-inline-end: 10px;
  width: 22px;
  flex-shrink: 0;
  display: flex;
}

.Toastify--animate {
  animation-fill-mode: both;
  animation-duration: 0.5s;
}

.Toastify--animate-icon {
  animation-fill-mode: both;
  animation-duration: 0.3s;
}

.Toastify__toast-theme--dark {
  background: var(--toastify-color-dark);
  color: var(--toastify-text-color-dark);
}

.Toastify__toast-theme--light {
  background: var(--toastify-color-light);
  color: var(--toastify-text-color-light);
}

.Toastify__toast-theme--colored.Toastify__toast--default {
  background: var(--toastify-color-light);
  color: var(--toastify-text-color-light);
}

.Toastify__toast-theme--colored.Toastify__toast--info {
  color: var(--toastify-text-color-info);
  background: var(--toastify-color-info);
}

.Toastify__toast-theme--colored.Toastify__toast--success {
  color: var(--toastify-text-color-success);
  background: var(--toastify-color-success);
}

.Toastify__toast-theme--colored.Toastify__toast--warning {
  color: var(--toastify-text-color-warning);
  background: var(--toastify-color-warning);
}

.Toastify__toast-theme--colored.Toastify__toast--error {
  color: var(--toastify-text-color-error);
  background: var(--toastify-color-error);
}

.Toastify__progress-bar-theme--light {
  background: var(--toastify-color-progress-light);
}

.Toastify__progress-bar-theme--dark {
  background: var(--toastify-color-progress-dark);
}

.Toastify__progress-bar--info {
  background: var(--toastify-color-progress-info);
}

.Toastify__progress-bar--success {
  background: var(--toastify-color-progress-success);
}

.Toastify__progress-bar--warning {
  background: var(--toastify-color-progress-warning);
}

.Toastify__progress-bar--error {
  background: var(--toastify-color-progress-error);
}

.Toastify__progress-bar-theme--colored.Toastify__progress-bar--info,
.Toastify__progress-bar-theme--colored.Toastify__progress-bar--success,
.Toastify__progress-bar-theme--colored.Toastify__progress-bar--warning,
.Toastify__progress-bar-theme--colored.Toastify__progress-bar--error {
  background: var(--toastify-color-transparent);
}

.Toastify__close-button {
  color: #fff;
  position: absolute;
  top: 6px;
  right: 6px;
  background: transparent;
  outline: none;
  border: none;
  padding: 0;
  cursor: pointer;
  opacity: 0.7;
  transition: 0.3s ease;
  z-index: 1;
}

.Toastify__toast--rtl .Toastify__close-button {
  left: 6px;
  right: unset;
}

.Toastify__close-button--light {
  color: #000;
  opacity: 0.3;
}

.Toastify__close-button > svg {
  fill: currentColor;
  height: 16px;
  width: 14px;
}

.Toastify__close-button:hover,
.Toastify__close-button:focus {
  opacity: 1;
}

@keyframes Toastify__trackProgress {
  0% {
    transform: scaleX(1);
  }
  100% {
    transform: scaleX(0);
  }
}

.Toastify__progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  opacity: 0.7;
  transform-origin: left;
}

.Toastify__progress-bar--animated {
  animation: Toastify__trackProgress linear 1 forwards;
}

.Toastify__progress-bar--controlled {
  transition: transform 0.2s;
}

.Toastify__progress-bar--rtl {
  right: 0;
  left: initial;
  transform-origin: right;
  border-bottom-left-radius: initial;
}

.Toastify__progress-bar--wrp {
  position: absolute;
  overflow: hidden;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 5px;
  border-bottom-left-radius: var(--toastify-toast-bd-radius);
  border-bottom-right-radius: var(--toastify-toast-bd-radius);
}

.Toastify__progress-bar--wrp[data-hidden='true'] {
  opacity: 0;
}

.Toastify__progress-bar--bg {
  opacity: var(--toastify-color-progress-bgo);
  width: 100%;
  height: 100%;
}

.Toastify__spinner {
  width: 20px;
  height: 20px;
  box-sizing: border-box;
  border: 2px solid;
  border-radius: 100%;
  border-color: var(--toastify-spinner-color-empty-area);
  border-right-color: var(--toastify-spinner-color);
  animation: Toastify__spin 0.65s linear infinite;
}

@keyframes Toastify__bounceInRight {
  from,
  60%,
  75%,
  90%,
  to {
    animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  }
  from {
    opacity: 0;
    transform: translate3d(3000px, 0, 0);
  }
  60% {
    opacity: 1;
    transform: translate3d(-25px, 0, 0);
  }
  75% {
    transform: translate3d(10px, 0, 0);
  }
  90% {
    transform: translate3d(-5px, 0, 0);
  }
  to {
    transform: none;
  }
}

@keyframes Toastify__bounceOutRight {
  20% {
    opacity: 1;
    transform: translate3d(-20px, var(--y), 0);
  }
  to {
    opacity: 0;
    transform: translate3d(2000px, var(--y), 0);
  }
}

@keyframes Toastify__bounceInLeft {
  from,
  60%,
  75%,
  90%,
  to {
    animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  }
  0% {
    opacity: 0;
    transform: translate3d(-3000px, 0, 0);
  }
  60% {
    opacity: 1;
    transform: translate3d(25px, 0, 0);
  }
  75% {
    transform: translate3d(-10px, 0, 0);
  }
  90% {
    transform: translate3d(5px, 0, 0);
  }
  to {
    transform: none;
  }
}

@keyframes Toastify__bounceOutLeft {
  20% {
    opacity: 1;
    transform: translate3d(20px, var(--y), 0);
  }
  to {
    opacity: 0;
    transform: translate3d(-2000px, var(--y), 0);
  }
}

@keyframes Toastify__bounceInUp {
  from,
  60%,
  75%,
  90%,
  to {
    animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  }
  from {
    opacity: 0;
    transform: translate3d(0, 3000px, 0);
  }
  60% {
    opacity: 1;
    transform: translate3d(0, -20px, 0);
  }
  75% {
    transform: translate3d(0, 10px, 0);
  }
  90% {
    transform: translate3d(0, -5px, 0);
  }
  to {
    transform: translate3d(0, 0, 0);
  }
}

@keyframes Toastify__bounceOutUp {
  20% {
    transform: translate3d(0, calc(var(--y) - 10px), 0);
  }
  40%,
  45% {
    opacity: 1;
    transform: translate3d(0, calc(var(--y) + 20px), 0);
  }
  to {
    opacity: 0;
    transform: translate3d(0, -2000px, 0);
  }
}

@keyframes Toastify__bounceInDown {
  from,
  60%,
  75%,
  90%,
  to {
    animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
  }
  0% {
    opacity: 0;
    transform: translate3d(0, -3000px, 0);
  }
  60% {
    opacity: 1;
    transform: translate3d(0, 25px, 0);
  }
  75% {
    transform: translate3d(0, -10px, 0);
  }
  90% {
    transform: translate3d(0, 5px, 0);
  }
  to {
    transform: none;
  }
}

@keyframes Toastify__bounceOutDown {
  20% {
    transform: translate3d(0, calc(var(--y) - 10px), 0);
  }
  40%,
  45% {
    opacity: 1;
    transform: translate3d(0, calc(var(--y) + 20px), 0);
  }
  to {
    opacity: 0;
    transform: translate3d(0, 2000px, 0);
  }
}

.Toastify__bounce-enter--top-left,
.Toastify__bounce-enter--bottom-left {
  animation-name: Toastify__bounceInLeft;
}

.Toastify__bounce-enter--top-right,
.Toastify__bounce-enter--bottom-right {
  animation-name: Toastify__bounceInRight;
}

.Toastify__bounce-enter--top-center {
  animation-name: Toastify__bounceInDown;
}

.Toastify__bounce-enter--bottom-center {
  animation-name: Toastify__bounceInUp;
}

.Toastify__bounce-exit--top-left,
.Toastify__bounce-exit--bottom-left {
  animation-name: Toastify__bounceOutLeft;
}

.Toastify__bounce-exit--top-right,
.Toastify__bounce-exit--bottom-right {
  animation-name: Toastify__bounceOutRight;
}

.Toastify__bounce-exit--top-center {
  animation-name: Toastify__bounceOutUp;
}

.Toastify__bounce-exit--bottom-center {
  animation-name: Toastify__bounceOutDown;
}

@keyframes Toastify__zoomIn {
  from {
    opacity: 0;
    transform: scale3d(0.3, 0.3, 0.3);
  }
  50% {
    opacity: 1;
  }
}

@keyframes Toastify__zoomOut {
  from {
    opacity: 1;
  }
  50% {
    opacity: 0;
    transform: translate3d(0, var(--y), 0) scale3d(0.3, 0.3, 0.3);
  }
  to {
    opacity: 0;
  }
}

.Toastify__zoom-enter {
  animation-name: Toastify__zoomIn;
}

.Toastify__zoom-exit {
  animation-name: Toastify__zoomOut;
}

@keyframes Toastify__flipIn {
  from {
    transform: perspective(400px) rotate3d(1, 0, 0, 90deg);
    animation-timing-function: ease-in;
    opacity: 0;
  }
  40% {
    transform: perspective(400px) rotate3d(1, 0, 0, -20deg);
    animation-timing-function: ease-in;
  }
  60% {
    transform: perspective(400px) rotate3d(1, 0, 0, 10deg);
    opacity: 1;
  }
  80% {
    transform: perspective(400px) rotate3d(1, 0, 0, -5deg);
  }
  to {
    transform: perspective(400px);
  }
}

@keyframes Toastify__flipOut {
  from {
    transform: translate3d(0, var(--y), 0) perspective(400px);
  }
  30% {
    transform: translate3d(0, var(--y), 0) perspective(400px) rotate3d(1, 0, 0, -20deg);
    opacity: 1;
  }
  to {
    transform: translate3d(0, var(--y), 0) perspective(400px) rotate3d(1, 0, 0, 90deg);
    opacity: 0;
  }
}

.Toastify__flip-enter {
  animation-name: Toastify__flipIn;
}

.Toastify__flip-exit {
  animation-name: Toastify__flipOut;
}

@keyframes Toastify__slideInRight {
  from {
    transform: translate3d(110%, 0, 0);
    visibility: visible;
  }
  to {
    transform: translate3d(0, var(--y), 0);
  }
}

@keyframes Toastify__slideInLeft {
  from {
    transform: translate3d(-110%, 0, 0);
    visibility: visible;
  }
  to {
    transform: translate3d(0, var(--y), 0);
  }
}

@keyframes Toastify__slideInUp {
  from {
    transform: translate3d(0, 110%, 0);
    visibility: visible;
  }
  to {
    transform: translate3d(0, var(--y), 0);
  }
}

@keyframes Toastify__slideInDown {
  from {
    transform: translate3d(0, -110%, 0);
    visibility: visible;
  }
  to {
    transform: translate3d(0, var(--y), 0);
  }
}

@keyframes Toastify__slideOutRight {
  from {
    transform: translate3d(0, var(--y), 0);
  }
  to {
    visibility: hidden;
    transform: translate3d(110%, var(--y), 0);
  }
}

@keyframes Toastify__slideOutLeft {
  from {
    transform: translate3d(0, var(--y), 0);
  }
  to {
    visibility: hidden;
    transform: translate3d(-110%, var(--y), 0);
  }
}

@keyframes Toastify__slideOutDown {
  from {
    transform: translate3d(0, var(--y), 0);
  }
  to {
    visibility: hidden;
    transform: translate3d(0, 500px, 0);
  }
}

@keyframes Toastify__slideOutUp {
  from {
    transform: translate3d(0, var(--y), 0);
  }
  to {
    visibility: hidden;
    transform: translate3d(0, -500px, 0);
  }
}

.Toastify__slide-enter--top-left,
.Toastify__slide-enter--bottom-left {
  animation-name: Toastify__slideInLeft;
}

.Toastify__slide-enter--top-right,
.Toastify__slide-enter--bottom-right {
  animation-name: Toastify__slideInRight;
}

.Toastify__slide-enter--top-center {
  animation-name: Toastify__slideInDown;
}

.Toastify__slide-enter--bottom-center {
  animation-name: Toastify__slideInUp;
}

.Toastify__slide-exit--top-left,
.Toastify__slide-exit--bottom-left {
  animation-name: Toastify__slideOutLeft;
  animation-timing-function: ease-in;
  animation-duration: 0.3s;
}

.Toastify__slide-exit--top-right,
.Toastify__slide-exit--bottom-right {
  animation-name: Toastify__slideOutRight;
  animation-timing-function: ease-in;
  animation-duration: 0.3s;
}

.Toastify__slide-exit--top-center {
  animation-name: Toastify__slideOutUp;
  animation-timing-function: ease-in;
  animation-duration: 0.3s;
}

.Toastify__slide-exit--bottom-center {
  animation-name: Toastify__slideOutDown;
  animation-timing-function: ease-in;
  animation-duration: 0.3s;
}

@keyframes Toastify__spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
`,R=new Map;function M(t){var e;return E(()=>{if(!S||"u"<typeof document)return;let t=document,a=R.get(t);if(a){e&&a.setAttribute("nonce",e);return}let o=t.createElement("style");o.textContent=S,e&&o.setAttribute("nonce",e),t.head.appendChild(o),R.set(t,o)},[e=t.nonce]),a.default.createElement(z,{...t})}var D=t.i(82310),$=t.i(69969);let B=["Messenger","Phone Call","Walk-In Customer","Manual Entry"],U=["All","Draft Order","Waiting Quotation","Approved","Preparing","Ready","Delivered","Closed","Cancelled"],q=$.orderStatusLabels,F=$.orderSourceLabels;t.s(["default",0,function(){let[t,i]=(0,a.useState)([]),[n,l]=(0,a.useState)(!0),[c,d]=(0,a.useState)("All"),[f,u]=(0,a.useState)(!1),[m,p]=(0,a.useState)(""),[y,h]=(0,a.useState)([]),[b,x]=(0,a.useState)(!1),g=(0,a.useRef)(null),[v,_]=(0,a.useState)([]),[T,w]=(0,a.useState)([]),[j,N]=(0,a.useState)(""),[E,I]=(0,a.useState)("Manual Entry"),[C,L]=(0,a.useState)(0),[P,O]=(0,a.useState)(""),[A,z]=(0,a.useState)([]);(0,a.useEffect)(()=>{(0,s.fetchApi)("/orders").then(i).catch(console.error).finally(()=>l(!1)),(0,s.fetchApi)("/customers").then(w).catch(console.error),(0,s.fetchApi)("/pos/price-levels").then(z).catch(()=>{z([{value:"Retail",label:"قطاعي (Retail)"},{value:"Semi Wholesale",label:"نصف جملة (Semi Wholesale)"},{value:"Wholesale",label:"جملة (Wholesale)"}])})},[]);let S=async()=>{try{l(!0);let t=await (0,s.fetchApi)("/orders");i(t)}catch(t){console.error(t)}finally{l(!1)}};(0,a.useEffect)(()=>{if(!m.trim())return;let t=!0;return g.current&&clearTimeout(g.current),g.current=setTimeout(async()=>{try{let e=await (0,s.fetchApi)("/pos/search?q="+encodeURIComponent(m));t&&h(e)}catch(t){console.error(t)}finally{t&&x(!1)}},300),()=>{t=!1,g.current&&clearTimeout(g.current)}},[m]);let R=t=>{_(e=>e.filter(e=>e.id!==t))},$=(t,e)=>{if(e<=0)return R(t);_(a=>a.map(a=>a.id===t?{...a,quantity:e,totalPrice:e*a.unitPrice}:a))},X=v.reduce((t,e)=>t+e.totalPrice,0),H=X+Number(C),W=async()=>{if(0===v.length)return void k.error("السلة فارغة");try{let t={customer_id:j||null,source:E,status:"Draft Order",shipping_cost:Number(C),notes:P,items:v.map(t=>({product_id:t.productId,unit_id:t.unitId,quantity:t.quantity,price_level:t.priceLevel}))};await (0,s.fetchApi)("/orders/draft",{method:"POST",body:JSON.stringify(t)}),k.success("تم الحفظ بنجاح"),u(!1),_([]),O(""),L(0),S()}catch(t){k.error((0,D.errorMessage)(t,"حدث خطأ أثناء إنشاء الطلب"))}},K=async(t,e)=>{let a=null;if("Delivered"===e||"Closed"===e)try{let t=await (0,s.fetchApi)("/inventory/warehouses");if(!(t.length>0))return void k.error("لا يوجد مخازن متاحة لصرف المخزون");a=t[0].id}catch{k.error("Error fetching warehouses");return}try{await (0,s.fetchApi)("/orders/"+t+"/status",{method:"PATCH",body:JSON.stringify({status:e,warehouse_id:a})}),k.success("تم تحديث حالة الطلب"),S()}catch(t){k.error((0,D.errorMessage)(t,"حدث خطأ"))}},Q="All"===c?t:t.filter(t=>t.status===c);return(0,e.jsxs)("div",{className:"min-h-screen bg-[#131313] text-[#e5e2e1] overflow-x-hidden selection:bg-primary/30 flex",dir:"rtl",children:[(0,e.jsx)(o.default,{children:(0,e.jsx)("title",{children:"إدارة الطلبات | نظام المكتبة"})}),(0,e.jsx)(M,{position:"top-right",theme:"dark",rtl:!0}),(0,e.jsx)(r.default,{}),(0,e.jsxs)("main",{className:"mx-4 mb-8 mt-24 flex min-w-0 flex-1 flex-col gap-6 lg:ml-8 lg:mr-[364px] lg:mt-8 lg:h-[calc(100vh-64px)]",children:[(0,e.jsxs)("header",{className:"glass rounded-2xl hi-fi-shadow border border-white/5 min-h-[80px] shrink-0 flex flex-wrap items-center justify-between gap-4 px-8 py-4",children:[(0,e.jsxs)("div",{className:"flex items-center gap-4",children:[(0,e.jsx)("h1",{className:"text-2xl font-bold text-white",children:"إدارة الطلبات"}),(0,e.jsxs)("span",{className:"px-3 py-1 bg-white/5 rounded-full text-xs text-white/50 border border-white/5",children:[Q.length," طلب"]})]}),(0,e.jsxs)("button",{onClick:()=>u(!0),className:"app-primary-button",children:[(0,e.jsx)("span",{className:"material-symbols-outlined text-xl",children:"add"}),"إنشاء طلب جديد"]})]}),(0,e.jsx)("div",{className:"glass rounded-2xl hi-fi-shadow border border-white/5 px-6 py-4 shrink-0",children:(0,e.jsx)("div",{className:"flex overflow-x-auto gap-2 custom-scrollbar pb-2",children:U.map(t=>(0,e.jsx)("button",{onClick:()=>d(t),className:`px-5 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${c===t?"bg-primary text-white":"hover:bg-white/10 text-[#e2bfb0]/60 bg-white/5 border border-white/5"}`,children:q[t]||t},t))})}),(0,e.jsx)("div",{className:"glass rounded-2xl hi-fi-shadow border border-white/5 flex-1 flex flex-col overflow-hidden",children:n?(0,e.jsx)("div",{className:"flex items-center justify-center flex-1",children:(0,e.jsx)("div",{className:"w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"})}):0===Q.length?(0,e.jsxs)("div",{className:"flex flex-col items-center justify-center flex-1 text-[#e2bfb0]/40 gap-4",children:[(0,e.jsx)("span",{className:"material-symbols-outlined text-6xl",children:"inbox"}),(0,e.jsx)("p",{className:"text-xl",children:"لا توجد طلبات"})]}):(0,e.jsx)("div",{className:"flex-1 overflow-auto custom-scrollbar",children:(0,e.jsxs)("table",{className:"w-full text-right text-sm",children:[(0,e.jsx)("thead",{className:"bg-black/20 text-[#e2bfb0]/60 sticky top-0 backdrop-blur-md border-b border-white/5",children:(0,e.jsxs)("tr",{children:[(0,e.jsx)("th",{className:"px-6 py-4 font-medium",children:"رقم الطلب"}),(0,e.jsx)("th",{className:"px-6 py-4 font-medium",children:"العميل"}),(0,e.jsx)("th",{className:"px-6 py-4 font-medium",children:"المصدر"}),(0,e.jsx)("th",{className:"px-6 py-4 font-medium",children:"المبلغ الإجمالي"}),(0,e.jsx)("th",{className:"px-6 py-4 font-medium",children:"الحالة"}),(0,e.jsx)("th",{className:"px-6 py-4 font-medium",children:"التاريخ"}),(0,e.jsx)("th",{className:"px-6 py-4 font-medium text-center",children:"إجراءات"})]})}),(0,e.jsx)("tbody",{className:"divide-y divide-white/5",children:Q.map(t=>{var a;let o;return(0,e.jsxs)("tr",{className:"hover:bg-white/5 transition-colors group",children:[(0,e.jsx)("td",{className:"px-6 py-4 font-mono text-xs text-[#e2bfb0]/80",children:t.id.split("-")[0].toUpperCase()}),(0,e.jsx)("td",{className:"px-6 py-4 text-white font-medium",children:T.find(e=>e.id===t.customer_id)?.name||"عميل مجهول"}),(0,e.jsx)("td",{className:"px-6 py-4",children:(0,e.jsxs)("div",{className:"flex items-center gap-2",children:[(t=>{switch(t){case"WhatsApp":return(0,e.jsx)("i",{className:"bi bi-whatsapp text-green-500"});case"Messenger":return(0,e.jsx)("i",{className:"bi bi-messenger text-blue-500"});case"Phone Call":return(0,e.jsx)("span",{className:"material-symbols-outlined text-sm text-purple-400",children:"call"});case"Walk-In Customer":return(0,e.jsx)("span",{className:"material-symbols-outlined text-sm text-yellow-400",children:"directions_walk"});default:return(0,e.jsx)("span",{className:"material-symbols-outlined text-sm text-gray-400",children:"edit_document"})}})(t.source),(0,e.jsx)("span",{className:"text-[#e2bfb0]/80",children:F[t.source]||t.source})]})}),(0,e.jsxs)("td",{className:"px-6 py-4 font-bold text-primary",children:[t.total_amount.toFixed(2)," ج.م"]}),(0,e.jsx)("td",{className:"px-6 py-4",children:(a=t.status,o="bg-gray-500/20 text-gray-400 border-gray-500/30","Delivered"===a||"Closed"===a?o="bg-green-500/20 text-green-400 border-green-500/30":a.includes("Quotation")?o="bg-yellow-500/20 text-yellow-400 border-yellow-500/30":"Approved"===a||"Preparing"===a||"Ready"===a?o="bg-blue-500/20 text-blue-400 border-blue-500/30":("Cancelled"===a||"Lost"===a||"Returned"===a)&&(o="bg-red-500/20 text-red-400 border-red-500/30"),(0,e.jsx)("span",{className:`px-2.5 py-1 text-xs font-semibold rounded-full border ${o}`,children:q[a]||a}))}),(0,e.jsx)("td",{className:"px-6 py-4 text-[#e2bfb0]/60 text-xs",children:new Date(t.created_at).toLocaleDateString("ar-EG",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}),(0,e.jsx)("td",{className:"px-6 py-4 text-center relative",children:(0,e.jsxs)("select",{className:"bg-[#131313] border border-white/10 rounded-lg text-xs px-2 py-1.5 text-white focus:outline-none focus:border-primary transition-colors cursor-pointer",value:t.status,disabled:!t.allowed_next_statuses?.length,onChange:e=>K(t.id,e.target.value),children:[(0,e.jsx)("option",{value:t.status,children:q[t.status]||t.status}),t.allowed_next_statuses?.map(t=>(0,e.jsx)("option",{value:t,children:q[t]||t},t))]})})]},t.id)})})]})})})]}),f&&(0,e.jsxs)("div",{className:"fixed inset-0 z-50 flex justify-end",children:[(0,e.jsx)("div",{className:"absolute inset-0 bg-black/60 backdrop-blur-sm",onClick:()=>u(!1)}),(0,e.jsxs)("div",{className:"w-[500px] h-full glass border-r border-white/5 shadow-2xl relative z-10 flex flex-col transform transition-transform duration-300",children:[(0,e.jsxs)("div",{className:"h-[80px] border-b border-white/5 flex items-center justify-between px-6 shrink-0 bg-black/20",children:[(0,e.jsx)("h2",{className:"text-xl font-bold text-white",children:"إنشاء مسودة طلب"}),(0,e.jsx)("button",{onClick:()=>u(!1),className:"w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center transition-colors",children:(0,e.jsx)("span",{className:"material-symbols-outlined text-[#e2bfb0]/80",children:"close"})})]}),(0,e.jsxs)("div",{className:"flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col gap-6",children:[(0,e.jsxs)("div",{className:"flex flex-col gap-4 bg-white/5 p-4 rounded-2xl border border-white/5",children:[(0,e.jsxs)("div",{children:[(0,e.jsx)("label",{className:"block text-xs text-[#e2bfb0]/60 mb-1.5",children:"العميل"}),(0,e.jsxs)("select",{value:j,onChange:t=>N(t.target.value),className:"w-full bg-black border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary transition-colors",children:[(0,e.jsx)("option",{value:"",children:"-- إختر عميل --"}),T.map(t=>(0,e.jsx)("option",{value:t.id,children:t.name},t.id))]})]}),(0,e.jsxs)("div",{children:[(0,e.jsx)("label",{className:"block text-xs text-[#e2bfb0]/60 mb-1.5",children:"مصدر الطلب"}),(0,e.jsx)("select",{value:E,onChange:t=>I(t.target.value),className:"w-full bg-[#131313] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary transition-colors",children:B.map(t=>(0,e.jsx)("option",{value:t,children:F[t]||t},t))})]})]}),(0,e.jsxs)("div",{className:"relative",children:[(0,e.jsx)("div",{className:"absolute inset-y-0 right-0 pl-3 flex items-center justify-center w-12 pointer-events-none",children:b?(0,e.jsx)("div",{className:"w-4 h-4 border-2 border-primary/20 border-t-primary rounded-full animate-spin"}):(0,e.jsx)("span",{className:"material-symbols-outlined text-[#e2bfb0]/40 text-lg",children:"search"})}),(0,e.jsx)("input",{type:"text",placeholder:"ابحث عن منتج (الاسم، الباركود)...",className:"w-full h-12 bg-[#131313] border border-white/10 rounded-xl pr-12 pl-4 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all",value:m,onChange:t=>{let e=t.target.value;p(e),x(!!e.trim()),e.trim()||h([])}}),y.length>0&&(0,e.jsx)("div",{className:"absolute top-14 left-0 right-0 bg-[#1c1b1b] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 max-h-[300px] overflow-y-auto custom-scrollbar",children:y.map(t=>(0,e.jsxs)("div",{onClick:()=>(t=>{if(!t.units||0===t.units.length)return void k.error("هذا المنتج لا يحتوي على وحدات تسعير.");let e=t.units[0],a=e.prices?.[0]?.price_level||"Retail",o=e.prices?.find(t=>t.price_level===a),r=o?Number(o.price):0;_(o=>{let s=o.find(o=>o.productId===t.id&&o.unitId===e.id&&o.priceLevel===a);return s?o.map(t=>t.id===s.id?{...t,quantity:t.quantity+1,totalPrice:t.unitPrice*(t.quantity+1)}:t):[...o,{id:Math.random().toString(),productId:t.id,nameAr:t.name_ar,unitId:e.id,unitName:e.unit_name,quantity:1,priceLevel:a,unitPrice:r,totalPrice:r,conversionFactor:e.conversion_factor,maxStock:t.current_stock||0,availableUnits:t.units}]}),p(""),h([])})(t),className:"p-3 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors flex items-center gap-3",children:[(0,e.jsx)("div",{className:"w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center shrink-0",children:(0,e.jsx)("span",{className:"material-symbols-outlined text-white/30",children:"inventory_2"})}),(0,e.jsxs)("div",{className:"flex-1",children:[(0,e.jsx)("div",{className:"font-bold text-sm text-white",children:t.name_ar}),(0,e.jsx)("div",{className:"text-xs text-white/40",children:t.sku||t.barcode||"بدون كود"})]})]},t.id))})]}),(0,e.jsxs)("div",{className:"flex flex-col gap-3",children:[(0,e.jsxs)("h3",{className:"text-sm font-bold text-white/80 border-b border-white/5 pb-2",children:["عناصر الطلب (",v.length,")"]}),0===v.length?(0,e.jsx)("div",{className:"text-center text-white/30 py-8 text-sm",children:"لا توجد منتجات مضافة"}):v.map(t=>(0,e.jsxs)("div",{className:"bg-white/5 p-4 rounded-xl border border-white/5 flex flex-col gap-3 shadow-sm",children:[(0,e.jsxs)("div",{className:"flex justify-between items-center",children:[(0,e.jsx)("h4",{className:"font-bold text-[14px] text-white truncate flex-1 pl-2",children:t.nameAr}),(0,e.jsx)("button",{onClick:()=>R(t.id),className:"text-[#ffb4ab]/60 hover:text-[#ffb4ab] bg-[#ffb4ab]/5 hover:bg-[#ffb4ab]/15 rounded-lg p-1.5 transition-colors shrink-0",children:(0,e.jsx)("span",{className:"material-symbols-outlined text-[18px]",children:"delete"})})]}),(0,e.jsxs)("div",{className:"flex flex-wrap items-center gap-2",children:[(0,e.jsx)("select",{value:t.unitId,onChange:e=>{var a,o;return a=t.id,o=e.target.value,void _(t=>t.map(t=>{if(t.id===a){let e=t.availableUnits.find(t=>t.id===o);if(!e)return t;let a=t.priceLevel,r=e.prices?.find(t=>t.price_level===a);!r&&e.prices&&e.prices.length>0&&(a=e.prices[0].price_level,r=e.prices[0]);let s=r?r.price:0;return{...t,unitId:o,priceLevel:a,unitPrice:s,totalPrice:s*t.quantity}}return t}))},className:"bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/90 focus:outline-none focus:border-primary flex-1 min-w-[70px]",children:t.availableUnits?.map(t=>(0,e.jsx)("option",{value:t.id,className:"bg-[#1c1b1b]",children:t.unit_name},t.id))}),(0,e.jsx)("select",{value:t.priceLevel,onChange:e=>{var a,o;return a=t.id,o=e.target.value,void _(t=>t.map(t=>{if(t.id===a){let e=t.availableUnits.find(e=>e.id===t.unitId),a=e?.prices?.find(t=>t.price_level===o);if(a)return{...t,priceLevel:o,unitPrice:a.price,totalPrice:a.price*t.quantity}}return t}))},className:"bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/90 focus:outline-none focus:border-primary flex-1 min-w-[100px]",children:t.availableUnits?.find(e=>e.id===t.unitId)?.prices?.map(t=>{let a=A.find(e=>e.value===t.price_level)?.label||t.price_level;return(0,e.jsxs)("option",{value:t.price_level,className:"bg-[#1c1b1b]",children:[a," - ",t.price," ج.م"]},t.price_level)})})]}),(0,e.jsxs)("div",{className:"flex items-center justify-between mt-1 pt-3 border-t border-white/5",children:[(0,e.jsxs)("div",{className:"flex items-center gap-2 bg-[#131313] p-1 rounded-lg border border-white/10",children:[(0,e.jsx)("button",{onClick:()=>$(t.id,t.quantity-1),className:"w-7 h-7 flex items-center justify-center hover:bg-white/10 text-white/70 rounded-md",children:(0,e.jsx)("span",{className:"material-symbols-outlined text-sm",children:"remove"})}),(0,e.jsx)("span",{className:"text-[14px] font-bold w-6 text-center text-primary",children:t.quantity}),(0,e.jsx)("button",{onClick:()=>$(t.id,t.quantity+1),className:"w-7 h-7 flex items-center justify-center hover:bg-white/10 text-white/70 rounded-md",children:(0,e.jsx)("span",{className:"material-symbols-outlined text-sm",children:"add"})})]}),(0,e.jsxs)("span",{className:"font-bold text-sm text-white",children:[t.totalPrice.toFixed(2)," ج.م"]})]})]},t.id))]}),(0,e.jsxs)("div",{className:"flex flex-col gap-4 mt-auto border-t border-white/5 pt-6 pb-20",children:[(0,e.jsxs)("div",{className:"flex items-center justify-between text-sm",children:[(0,e.jsx)("span",{className:"text-white/50",children:"المجموع الفرعي"}),(0,e.jsxs)("span",{className:"font-bold",children:[X.toFixed(2)," ج.م"]})]}),(0,e.jsxs)("div",{className:"flex items-center justify-between text-sm",children:[(0,e.jsx)("span",{className:"text-white/50",children:"تكلفة الشحن"}),(0,e.jsx)("input",{type:"number",value:C,onChange:t=>L(Number(t.target.value)||0),className:"w-24 bg-black border border-white/10 rounded-lg px-2 py-1 text-center text-white focus:outline-none focus:border-primary"})]}),(0,e.jsxs)("div",{className:"flex items-center justify-between text-lg mt-2 pt-2 border-t border-white/10",children:[(0,e.jsx)("span",{className:"text-white",children:"الإجمالي"}),(0,e.jsxs)("span",{className:"font-black text-primary",children:[H.toFixed(2)," ج.م"]})]}),(0,e.jsxs)("div",{className:"mt-2",children:[(0,e.jsx)("label",{className:"block text-xs text-white/50 mb-1.5",children:"ملاحظات (اختياري)"}),(0,e.jsx)("textarea",{value:P,onChange:t=>O(t.target.value),rows:2,className:"w-full bg-black border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary transition-colors resize-none custom-scrollbar"})]})]})]}),(0,e.jsx)("div",{className:"absolute bottom-0 left-0 right-0 p-4 bg-black/50 backdrop-blur-md border-t border-white/5",children:(0,e.jsxs)("button",{onClick:W,disabled:0===v.length,className:"w-full h-12 bg-primary hover:bg-primary/90 disabled:bg-primary/30 disabled:cursor-not-allowed text-black font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(255,180,171,0.15)] flex items-center justify-center gap-2",children:[(0,e.jsx)("span",{className:"material-symbols-outlined text-lg",children:"save"}),"حفظ مسودة الطلب"]})})]})]})]})}],23003)}]);