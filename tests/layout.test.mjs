import test from 'node:test';import assert from 'node:assert/strict';import layout from '../desktop/ui/layout.js';
test('Physical floor plan retains empty aisles and uniquely places every PC',()=>{
  const devices=[{id:'a'},{id:'b'},{id:'c'}],slots=layout.place(devices,{a:{slot:0},b:{slot:3},c:{slot:8}},12);
  assert.equal(slots[3].id,'b');assert.equal(slots[1],null);assert.equal(slots[8].id,'c');assert.equal(slots.filter(Boolean).length,3);
});
test('All four rotations are bijections for rectangular and square rooms',()=>{
  for(const [columns,rows]of [[4,3],[6,5],[2,16],[12,1]])for(let turn=0;turn<4;turn++){
    const original=Array.from({length:columns*rows},(_,slot)=>({id:String(slot)}));const rotated=layout.viewSlots(original,columns,rows,turn);
    assert.equal(new Set(rotated.map(x=>x.visual)).size,columns*rows);assert.deepEqual(rotated.map(x=>x.visual),Array.from({length:columns*rows},(_,i)=>i));
    for(const entry of rotated)assert.equal(entry.device.id,String(entry.slot));
  }
  assert.equal(layout.rotateSlot(0,4,3,1),2);assert.equal(layout.rotateSlot(0,4,3,2),11);assert.equal(layout.rotateSlot(0,4,3,3),9);assert.equal(layout.rotateSlot(5,4,3,4),5);
});
