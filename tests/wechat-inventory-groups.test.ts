import test from 'node:test';
import assert from 'node:assert/strict';
import { groupWechatInventory } from '../apps/cocos-wechat-probe/template/assets/scripts/WechatInventoryGroups';
import type { WechatMaterialOption, WechatStorageOption, WechatDishOption } from '../apps/cocos-wechat-probe/template/assets/scripts/WechatProbeController';
const target = (id: string, container_type: string): WechatStorageOption => ({ id, container_type, enabled:true, location_id:'home', storage_type:container_type.includes('cellar')?'cellar':'room_temp', capacity:{amount:10,unit:'slot_weight'}, used_capacity:0, supported_forms:['fresh'] });
const lot = (id:string, storage:string, pieces?:number):WechatMaterialOption => ({id,enabled:true,base_id:'cabbage',current_form:'fresh',quantity:{amount:1200,unit:'g'}, storage_ref:{location_id:'home',storage_type:'room_temp',container_id:storage}, ...(pieces === undefined ? {} : {cabbage_pieces:{kind:'whole',pieces:Array.from({length:pieces},(_,i)=>({id:id+i,weight_g:1200/pieces,source_ref:{source_type:'crop',source_id:id,source_time:0}}))}})});
const dish = (id:string, storage:string):WechatDishOption => ({id,recognized_dish_id:'dish',serving_count:2,enabled:true,storage_ref:{location_id:'home',storage_type:'room_temp',container_id:storage}});

test('warehouse groups by formal base ID and keeps unknown old pieces distinct from known counts', () => {
  const groups=groupWechatInventory([lot('a','room',1),lot('b','room'),lot('c','room',2)], [target('room','room_temp_container')], [dish('food','room')]);
  assert.equal(groups.warehouseBatchCount,4); assert.equal(groups.warehouse[0]!.batches.length,3);
  assert.equal(groups.warehouse[0]!.knownWholeCount,3); assert.equal(groups.warehouse[0]!.unknownWholeBatches,1);
  assert.equal(groups.warehouseDishes[0]!.serving_count,2);
});
test('three actual jars are separate, old cellar remains old, and unknown containers stay visible', () => {
  const targets=[target('home_cellar_01','cellar_jar'),target('home_cellar_jar_02','cellar_jar'),target('home_cellar_jar_03','cellar_jar'),target('old','cellar_container'),target('fermentation','pickling_jar')];
  const groups=groupWechatInventory([lot('a','home_cellar_01',1),lot('b','home_cellar_jar_02',2),lot('c','old'),lot('d','fermentation')],targets,[dish('dish1','home_cellar_jar_03'),dish('dish2','missing')]);
  assert.deepEqual(groups.jars.map(x=>[x.target.id,x.legacy,x.batches.length,x.dishes.length]),[['home_cellar_01',false,1,0],['home_cellar_jar_02',false,1,0],['home_cellar_jar_03',false,0,1],['old',true,1,0]]);
  assert.equal(groups.other[0]!.id,'d'); assert.equal(groups.otherDishes[0]!.id,'dish2');
  assert.equal(groupWechatInventory([lot('oldLot','home_cellar_01')],[target('home_cellar_01','cellar_container')]).jars[0]!.legacy,true,'shared ID does not reclassify old cellar');
});

test('seed counts aggregate in their own unit without mixing whole produce and unknown or malformed quantities', () => {
  const seed=(id:string,amount:number):WechatMaterialOption=>({...lot(id,'room'),base_id:'cabbage_seed',current_form:'dry_seed',quantity:{amount,unit:'count'}});
  const result=groupWechatInventory([seed('a',7),seed('b',3),lot('c','room',1)], [target('room','room_temp_container')]);
  const seeds=result.warehouse.find(group=>group.baseId==='cabbage_seed')!;const cabbage=result.warehouse.find(group=>group.baseId==='cabbage')!;
  assert.equal(seeds.countQuantity,10);assert.equal(seeds.hasCountQuantity,true);assert.equal(seeds.knownWholeCount,0);
  assert.equal(cabbage.knownWholeCount,1);assert.equal(cabbage.hasCountQuantity,false);
  const bad=groupWechatInventory([seed('a',7),seed('b',0.5)],[target('room','room_temp_container')]);
  assert.equal(bad.warehouse[0]!.countQuantity,null,'fractional item counts must not be presented as a definite total');
});
