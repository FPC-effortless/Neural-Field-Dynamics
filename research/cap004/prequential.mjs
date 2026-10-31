export class PrequentialReadout {
 constructor(dim,rate=.05){this.weights=new Float64Array(dim);this.rate=rate;this.pending=null;}
 predict(features,id){if(this.pending)throw Error('Score pending prediction first');if(features.length!==this.weights.length||!features.every(Number.isFinite))throw Error('Invalid features');const x=features.slice();const z=this.weights.reduce((s,w,i)=>s+w*x[i],0);const p=1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));this.pending={x,id,p};return p;}
 observe(target,id,learn=true){if(!this.pending||id!==this.pending.id||![0,1].includes(target))throw Error('Require matching prior prediction and binary target');const {x,p}=this.pending;this.pending=null;const loss=-target*Math.log(Math.max(p,1e-9))-(1-target)*Math.log(Math.max(1-p,1e-9));if(learn)for(let i=0;i<x.length;i++)this.weights[i]-=this.rate*(p-target)*x[i]/x.length;return {prediction:p,target,loss};}
}
