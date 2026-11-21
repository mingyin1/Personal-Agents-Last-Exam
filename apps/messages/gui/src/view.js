(function(root,factory){
  const view=factory();
  if(typeof module==='object' && module.exports) module.exports=view;
  else {root.PaleAppViews=root.PaleAppViews||{};root.PaleAppViews.messages=view;}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(items){
    return '<section aria-label="messages records">'+items.map(item=>
      '<article data-record-id="'+escape(item.id)+'"><h3>'+escape(item.title||item.name||item.display_name||item.id)+
      '</h3><pre>'+escape(JSON.stringify(item,null,2))+'</pre></article>').join('')+'</section>';
  }
  return {render};
});
