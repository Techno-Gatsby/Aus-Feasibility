(function(){
  function fmt(spec){
    var m=spec.match(/^,\.(\d)(~?)f$/); var d=+m[1], trim=!!m[2];
    var nf=new Intl.NumberFormat('en-US',{minimumFractionDigits:trim?0:d,maximumFractionDigits:d});
    return function(v){return nf.format(v);};
  }
  window.d3={format:fmt,min:function(a,f){var m;a.forEach(function(x){var v=f?f(x):x;if(v!=null&&!isNaN(v)&&(m===undefined||v<m))m=+v;});return m;},max:function(a,f){var m;a.forEach(function(x){var v=f?f(x):x;if(v!=null&&!isNaN(v)&&(m===undefined||v>m))m=+v;});return m;},sum:function(a,f){return a.reduce(function(s,x){return s+(+(f?f(x):x)||0);},0);}};
  // The page as shipped, before anything renders: "Download updated dashboard" rebuilds from it.
  window.__PRISTINE = document.getElementById('dash-root').outerHTML;
  // The data shipped with the page; uploads replace window.__DATA, never this.
  window.__BASELINE = JSON.parse(document.getElementById('baseline-data').textContent);
  window.__DATA = window.__BASELINE;
  var subs=[];
  window.dash={
    data:function(id){var d=window.__DATA[id]||[];return {status:'ok',data:d,columns:d.length?Object.keys(d[0]):[]};},
    onData:function(fn){subs.push(fn);fn();},
    // Swap the whole data set (an upload, a revert) and redraw every view.
    setData:function(d){window.__DATA=d;subs.forEach(function(f){f();});},
    refresh:function(){subs.forEach(function(f){f();});},
    setLink:function(n){try{history.replaceState(null,'','#'+n);}catch(e){}},
    colors:['#7C3AED','#0D9488','#1A2B6B','#F59E0B','#DB2777','#2563EB','#65A30D','#9333EA']
  };
  var t;window.addEventListener('resize',function(){clearTimeout(t);t=setTimeout(function(){subs.forEach(function(f){f();});},150);});
})();
