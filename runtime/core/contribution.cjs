'use strict';
const fs=require('node:fs'),path=require('node:path');
const contract=require('../contracts/validate.cjs');
const profile=require('../profiles/local-reference.json');
const {baseline:ADMIN}=require('./admin-tools.cjs');
function requireThat(ok,message){if(!ok)throw new Error('Contribution ['+profile.id+']: '+message);}
function extensions(value){
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){value.forEach(extensions);return;}
 if(value.extensions?.some(e=>e.required))throw new Error('Unsupported required extension');
 for(const [k,v] of Object.entries(value))if(k!=='extensions')extensions(v);
}
function load(pkg,inside){
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),f=inside(pkg.dir,pkg.manifest.contribution),dir=path.dirname(f),c=read(f);
 contract.validate('app-contribution',c);extensions(c);
 requireThat(c.app_id===pkg.manifest.app_id,'App identity mismatch');
 requireThat(inside(pkg.dir,c.runtime_manifest_ref)===inside(pkg.dir,'app.json'),'runtime manifest mismatch');
 requireThat(c.dependencies.core_api===pkg.manifest.core_api_version,'Core API mismatch');
 requireThat(JSON.stringify([...c.dependencies.required_apps].sort())===JSON.stringify(pkg.manifest.dependencies.map(x=>x.app_id).sort()),'App dependencies mismatch');
 requireThat(!c.dependencies.services.some(x=>x.status==='implemented'),'No external dependency service is implemented by this runtime');
 const implemented=c.interfaces.filter(x=>x.status==='implemented');
 requireThat(implemented.length===2&&implemented.every(i=>i.transport==='mcp.stdio'),'Only the two fixed stdio MCP interfaces are implemented');
 for(const role of ['agent','infra']){
  const rows=implemented.filter(i=>i.audience.length===1&&i.audience[0]===role);requireThat(rows.length===1,'Missing or duplicate '+role+' surface');
  const i=rows[0],expected=role==='agent'?pkg.tools.map(t=>t.name):ADMIN;
  requireThat(i.entrypoint_ref===pkg.manifest.service+' --role '+role,'Fixed service / role mismatch');
  requireThat(JSON.stringify(i.operations.map(o=>o.name).sort())===JSON.stringify([...expected].sort()),'Incomplete or unknown '+role+' operations');
  for(const o of i.operations){const t=pkg.tools.find(t=>t.name===o.name);requireThat(o.caller===role&&o.effect===(role==='infra'?'admin':t.read_only?'read':'write'),'Operation effect / caller mismatch');}
 }
 requireThat(c.state.owner==='app'&&c.state.reset_scope==='app_instance'&&c.state.snapshot_includes_assets,'Lifecycle differs from runtime');
 requireThat(JSON.stringify([...c.state.isolation_keys].sort())===JSON.stringify(['app_id','run_id']),'Unsupported isolation unit');
 requireThat(c.state.version_checks==='implemented'&&c.state.idempotent_writes==='implemented','Version and idempotency declaration mismatch');
 requireThat(c.state.outbox_atomic_with_business_state!=='implemented'&&!c.events.emits.some(e=>e.status==='implemented')&&c.subscriptions.status!=='implemented','Outbound notifications / subscriptions are not implemented');
 for(const ref of [c.state.seed_schema_ref,c.shared_data.account_model_ref])requireThat(inside(pkg.dir,ref)===inside(pkg.dir,pkg.manifest.schemas.seed),'Seed schema mismatch');
 requireThat(inside(pkg.dir,c.shared_data.identity_binding_ref)===inside(pkg.dir,pkg.manifest.fixtures.binding),'Binding reference mismatch');
 requireThat(JSON.stringify(c.events.accepts.filter(e=>e.status==='implemented').map(e=>e.type).sort())===JSON.stringify([...pkg.manifest.event_types].sort()),'Incoming event capability mismatch');
 for(const e of c.events.accepts)requireThat(inside(pkg.dir,e.schema_ref)===inside(pkg.dir,pkg.manifest.schemas.events),'Event schema reference mismatch');
 const seen=new Set();
 for(const direction of ['publishes','receives'])for(const channel of c.messaging[direction]){
  requireThat(!seen.has(direction+channel.channel),'Duplicate messaging direction / channel');seen.add(direction+channel.channel);
  if(channel.status!=='implemented')continue;
  const schema=read(inside(pkg.dir,channel.schema_ref));require('./schema.cjs').compile(schema,path.dirname(inside(pkg.dir,channel.schema_ref)));
  if(direction==='receives')requireThat(channel.mcp_tool==='env.apply_event'&&pkg.manifest.event_types.includes(channel.operation),'Receive endpoint is not an implemented App event');
 }
 const refs=c.shared_data.asset_catalog_refs;requireThat(refs.length===1,'Exactly one canonical catalog is required');
 const catalog=read(inside(dir,refs[0])),dataset=read(inside(dir,catalog.dataset_ref));
 contract.validate('asset-catalog',catalog);contract.validate('dataset',dataset);extensions(catalog);extensions(dataset);
 const gui=c.gui_ref?read(inside(dir,c.gui_ref)):null;
 if(gui?.renderer_ref)requireThat(/\.(js|cjs)$/.test(inside(pkg.dir,gui.renderer_ref)),'GUI renderer must be a package-local JavaScript file');
 if(gui){contract.validateAppSet(c,catalog,dataset,gui);extensions(gui);requireThat(gui.audience.every(x=>x==='reviewer'),'Reference GUI is reviewer-only');
  if(gui.status==='implemented')requireThat(gui.state_connection.adapter==='pale.mcp_bridge'&&gui.state_connection.authoritative_state==='app_runtime'&&gui.state_connection.app_ids.length===1&&gui.state_connection.app_ids[0]===c.app_id,'GUI state adapter mismatch');
  if(gui.status==='implemented')requireThat(gui.entrypoint?.kind==='local_web'&&gui.entrypoint.location==='#example'&&gui.routes.every(r=>r.asset_bindings.every(b=>b.slot==='header.logo')),'Unsupported GUI entrypoint / slot');
  requireThat(gui.content_policy.untrusted_html==='text_only'&&gui.content_policy.svg==='disabled'&&gui.content_policy.remote_fetch==='disabled','Unsupported GUI content policy');
  for(const route of gui.routes)for(const binding of route.asset_bindings){const a=catalog.assets.find(x=>x.asset_id===binding.asset_id);requireThat(a&&a.scope.level==='package'&&a.access.rule==='app_surface'&&a.access.audience.includes('reviewer'),'GUI binding must reference a reviewer-visible package asset');requireThat(!binding.required||a.availability.status==='ready','Required GUI asset is not ready');}
 }
 const a=c.asset_runtime;
 requireThat(JSON.stringify(a.implemented_descriptor_versions)===JSON.stringify(['pale.asset-descriptor.v1']),'Descriptor runtime mismatch');
 requireThat(a.implemented_storage_adapters.every(x=>profile.storage_adapters.includes(x))&&a.max_assets===profile.max_assets&&a.max_bundle_bytes===profile.max_bundle_bytes,'Unsupported asset runtime limits / adapter');
 requireThat(a.implemented_mime_types.every(x=>profile.mime_types.includes(x)),'MIME capability mismatch');
 if(pkg.manifest.resources)requireThat(inside(pkg.dir,pkg.manifest.resources.catalog)===inside(dir,refs[0]),'Resource catalog reference mismatch');
 requireThat(inside(pkg.dir,pkg.manifest.dataset)===inside(dir,catalog.dataset_ref),'Dataset reference mismatch');
 return {declaration:c,catalog,dataset,gui,directory:dir};
}
module.exports={load,extensions,ADMIN};
