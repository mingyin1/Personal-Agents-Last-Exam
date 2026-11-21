'use strict';
const c = require('./common.cjs');
function parent(data,id) {
  if (id === null) return;
  const p = c.active(c.find(data,id));
  if (p.kind !== 'folder') c.fail('invalid_arguments','Parent is not a folder.');
}
function handleTool(ctx,data,name,args) {
  const read = c.read(ctx,data,name,args);
  if(read) return {data,result:read};
  let item;
  if(name==='files.mkdir') {
    parent(data,args.parent_id ?? null);
    item=c.create(ctx,data,{name:args.name,parent_id:args.parent_id ?? null,kind:'folder',trashed:false,versions:[]});
  } else if(name==='files.put') {
    if(!ctx.assets?.add) c.fail('unsupported_capability','File import needs an asset writer.');
    if(args.id) {
      item=c.active(c.find(data,args.id));
      if(item.kind!=='file') c.fail('invalid_arguments','Cannot write bytes to a folder.');
      if(args.parent_id !== undefined && args.parent_id !== item.parent_id) c.fail('invalid_arguments','Use files.move to change folders.');
    } else {
      parent(data,args.parent_id ?? null);
      item=c.create(ctx,data,{name:args.file.filename,parent_id:args.parent_id ?? null,kind:'file',trashed:false,versions:[]});
    }
    const [asset_id]=ctx.assets.add({object_type:'file',object_id:item.id,files:[args.file]});
    item.versions.push({number:item.versions.length+1,asset_id,at:ctx.virtual_now,source:args.source || ''});
    c.stamp(ctx,item,'version_added');
  } else if(name==='files.move') {
    item=c.active(c.find(data,args.id));
    if(Object.hasOwn(args.patch,'parent_id')) parent(data,args.patch.parent_id);
    c.patch(item,args.patch);c.stamp(ctx,item,'moved');
  } else if(name==='files.trash') {
    item=c.find(data,args.id);
    if(args.trashed && data.files.some(f=>f.parent_id===item.id && !f.trashed)) c.fail('not_empty','Trash active children first.');
    if(!args.trashed) parent(data,item.parent_id);
    item.trashed=args.trashed;c.stamp(ctx,item,args.trashed?'trashed':'restored');
  } else if(name==='files.read') {
    item=c.find(data,args.id);
    if(item.kind!=='file') c.fail('invalid_arguments','Folders have no file bytes.');
    const version=item.versions.find(v=>v.number===(args.number ?? item.versions.length));
    if(!version) c.fail('not_found','Version does not exist.');
    if(!ctx.assets?.read) c.fail('unsupported_capability','File read needs an asset reader.');
    return {data,result:{file:ctx.assets.read(version.asset_id),number:version.number}};
  } else c.fail('unknown_tool','Unknown Files operation.');
  return {data,result:{id:item.id}};
}
module.exports={handleTool};
