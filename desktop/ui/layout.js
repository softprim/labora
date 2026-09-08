(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.LaboraLayout=factory();})(typeof window==='undefined'?null:window,function(){
  function place(devices,layout,capacity){const slots=Array(capacity).fill(null),pending=[];for(const d of devices){const n=layout[d.id]?.slot;if(Number.isInteger(n)&&n>=0&&n<capacity&&!slots[n])slots[n]=d;else pending.push(d);}for(let i=0;i<capacity&&pending.length;i++)if(!slots[i])slots[i]=pending.shift();return slots;}
  function rotateSlot(slot,columns,rows,turns){const c=slot%columns,r=Math.floor(slot/columns);switch(((turns%4)+4)%4){case 1:return c*rows+(rows-1-r);case 2:return (rows-1-r)*columns+(columns-1-c);case 3:return (columns-1-c)*rows+r;default:return slot;}}
  function viewSlots(slots,columns,rows,turns){return slots.map((device,slot)=>({device,slot,visual:rotateSlot(slot,columns,rows,turns)})).sort((a,b)=>a.visual-b.visual);}
  return Object.freeze({place,rotateSlot,viewSlots});
});
